import axios from 'axios';
import { fetchPageWithPolicy } from '../utils/httpFetch';
import * as cheerio from 'cheerio';
import mongoose from 'mongoose';
import { ResearchEntity } from '../../models/researchEntity';
import { VisibilityReleaseQueueItem } from '../../models/visibilityReleaseQueueItem';
import {
  deriveShortDescriptionFromFullDescription,
  shortDescriptionQuality,
} from '../../utils/researchEntityDescriptionQuality';
import { redactDirectContactInfo } from '../../utils/contactRedaction';
import { openAiChatSampling } from '../../utils/openAiChatSampling';
import { isBibliographyCitationEntryText } from '../../utils/descriptionHygiene';
import { hasMultipleCareerTimelineSentences } from '../../utils/researchEntityBiographyDescriptionRepair';
import { stripTrailingResearchHomeDescription } from '../../utils/researchEntityNameNormalization';
import { serializedDocumentId } from '../../utils/idSerialization';
import { sanitizeLogValue } from '../../utils/logSanitizer';
import type { IScraper, ObservationInput, ScraperContext, ScraperResult } from '../types';
import {
  createWorkPlannerMetrics,
  getWorkPlannerSourcePolicy,
  loadEntityWorkPlan,
  recordWorkPlannerDecision,
  recordWorkPlannerNoIdentifier,
  type EntityWorkPlan,
  type WorkPlannerSourcePolicy,
} from '../workPlanner';
import {
  DEFAULT_SOURCE_CONCURRENCY,
  mapWithConcurrency,
  resolveSourceConcurrency,
} from '../utils/mapWithConcurrency';
import { extractLabHomepageDescription } from './ysmAtoZScraper';
import { extractElementTextWithBlockSeparators } from '../utils/htmlText';
import { personProfileSourceMatchesEntity } from '../utils/personProfileEntityMatch';
import { isFacultyResearchTextEntity } from '../../utils/researchEntityDescriptionText';
import {
  describesResearchHome,
  scoreResearchHomeDescriptionCandidate,
  type DescriptionEntityKind,
} from '../../utils/researchHomeDescriptionSelection';
import {
  extractOfficialResearchDescription,
  isDescriptionGroundedInSource,
} from '../../utils/officialResearchDescription';
import {
  CARD_SYNTHESIS_MODEL,
  CARD_SYNTHESIS_PROMPT_HASH,
  defaultCardSynthesisLLM,
  synthesizeGroundedCardDescription,
  type CardSynthesisLLMFn,
} from '../../utils/groundedCardSynthesis';
import { DESCRIPTION_EXTRACTION_PROMPT, DESCRIPTION_EXTRACTION_PROMPT_HASH } from '../prompts';
import { groundMethods } from '../utils/methodGrounding';
import {
  isPersonCmsProfileUrl,
  isPersonProfileOrDirectoryUrl,
} from '../../utils/researchHomeWebsiteUrl';
import {
  claimsAnotherPersonsLab,
  entityKeyPersonTokens,
  isPersonScopedResearchEntity,
  isPlaceholderEntityName,
  isUmbrellaOrganizationName,
} from '../../utils/researchHomeNameIdentityAuthority';
import {
  computeVersionedContentHash,
  contentHashObservation,
  contentUnchanged,
  descriptionHashObservations,
  loadStoredContentHash,
} from '../contentHashGate';

const SOURCE_KEY = 'lab-microsite-description-llm';
export const DEFAULT_MODEL = 'gpt-5-mini';

// The prompt text lives in server/src/scrapers/prompts/micrositeDescriptionExtraction.md
// and the content-hash gate keys on DESCRIPTION_EXTRACTION_PROMPT_HASH (sha256 of
// that file), so editing the .md re-extracts affected entities with no manual bump.
export const DESCRIPTION_EXTRACTION_SYSTEM_PROMPT = DESCRIPTION_EXTRACTION_PROMPT;
export { DESCRIPTION_EXTRACTION_PROMPT_HASH };
const MAX_PROMPT_CHARS = 40_000;
// The lab's own microsite is the authoritative source of its real name, so its
// name observation must outrank the 0.9 NIH/NSF "<PI> Lab" placeholder fallback
// (nihReporterScraper.ts / nsfAwardScraper.ts) during field resolution (issue #456).
const LAB_NAME_CONFIDENCE = 0.95;
const DESCRIPTION_LLM_OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

export function normalizeDescriptionLlmObjectId(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return DESCRIPTION_LLM_OBJECT_ID_RE.test(trimmed) ? trimmed : undefined;
  }
  if (value instanceof mongoose.Types.ObjectId) return value.toHexString();
  return undefined;
}

export interface SourceLinkHealthEntry {
  url?: string;
  healthStatus?: string;
  httpStatusCode?: number;
}

export interface CandidateDescriptionLab {
  _id?: unknown;
  slug?: string;
  name: string;
  websiteUrl: string;
  sourceUrls?: string[];
  manuallyLockedFields?: string[];
  entityType?: string;
  kind?: string;
  school?: string;
  schools?: string[];
  departments?: string[];
  fullDescription?: string;
  sourceLinkHealth?: SourceLinkHealthEntry[];
}

export interface CandidateDescriptionLabDoc {
  _id?: unknown;
  slug?: string;
  name?: string;
  displayName?: string;
  websiteUrl?: string;
  website?: string;
  sourceUrls?: string[];
  manuallyLockedFields?: string[];
  entityType?: string;
  kind?: string;
  school?: string;
  schools?: string[];
  departments?: string[];
  sourceLinkHealth?: SourceLinkHealthEntry[];
}

export interface FetchedDescriptionPage {
  url: string;
  html: string;
}

export interface DescriptionExtraction {
  fullDescription: string;
  shortDescription: string;
  topics: string[];
  methods: string[];
  name?: string;
}

export type FetchDescriptionPageFn = (url: string) => Promise<FetchedDescriptionPage | null>;
export type CallDescriptionLLMFn = (input: {
  model: string;
  apiKey: string;
  labName: string;
  sourceUrl: string;
  pageText: string;
}) => Promise<DescriptionExtraction>;

export type DescriptionWorkPlanLoaderFn = (
  lab: CandidateDescriptionLab,
  policy: WorkPlannerSourcePolicy,
  ctx: ScraperContext,
) => Promise<EntityWorkPlan>;

export interface LabMicrositeDescriptionLLMExtractorDeps {
  fetchPage?: FetchDescriptionPageFn;
  callLLM?: CallDescriptionLLMFn;
  callCardLLM?: CardSynthesisLLMFn;
  workPlanLoader?: DescriptionWorkPlanLoaderFn;
  labFinder?: (options?: { only?: string[] }) => Promise<CandidateDescriptionLab[]>;
  apiKey?: string;
  model?: string;
  cardModel?: string;
}

const textValue = (value: unknown): string =>
  typeof value === 'string'
    ? value
        .replace(/[\u200b\ufeff]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
    : '';

const uniqueStrings = (values: unknown): string[] =>
  Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );

const normalizeSourceUrlKey = (url: string): string => url.trim().replace(/\/+$/, '').toLowerCase();

function isKnownUnavailableSourceUrl(
  url: string,
  health: SourceLinkHealthEntry[] | undefined,
): boolean {
  if (!Array.isArray(health) || health.length === 0) return false;
  const key = normalizeSourceUrlKey(url);
  return health.some(
    (entry) =>
      typeof entry?.url === 'string' &&
      normalizeSourceUrlKey(entry.url) === key &&
      (entry.healthStatus === 'UNAVAILABLE' ||
        (typeof entry.httpStatusCode === 'number' && entry.httpStatusCode >= 400)),
  );
}

function parseRuntimeIntegerOption(
  value: number | undefined,
  flag: string,
  options: { min: number; label: 'positive' | 'non-negative'; fallback: number },
): number {
  if (value === undefined) return options.fallback;
  if (!Number.isSafeInteger(value) || value < options.min) {
    throw new Error(`${flag} must be a safe ${options.label} integer`);
  }
  return value;
}

const rejectedDescriptionSourcePatterns = [
  /\/about\/a-to-z-index\/(?:atoz\/)?lab-websites$/i,
  /\/membership\/directory\/?$/i,
  /\/(?:people|faculty|directory|members)\/?$/i,
  // A department-wide "how to get involved" hub (e.g.
  // mcdb.yale.edu/undergraduate/undergraduate-research-opportunities) describes
  // the whole department's undergrad research process, not any one person's
  // work, so its prose must never become an individual entity's description
  // (#1716).
  /\/undergrad(?:uate)?\/undergrad(?:uate)?[\w-]*\/?$/i,
  /\bjob-seekers?\b/i,
  /\bcareers?\b/i,
  /(?:^|\.)orcid\.org/i,
  /(?:^|\.)doi\.org/i,
  /(?:^|\.)openalex\.org/i,
  /(?:^|\.)crossref\.org/i,
  /reporter\.nih\.gov/i,
  /nsf\.gov/i,
  /api\.nsf\.gov/i,
];

export function isRejectedDescriptionSourceUrl(value: unknown): boolean {
  const urlText = textValue(value);
  if (!/^https?:\/\//i.test(urlText)) return true;
  try {
    const url = new URL(urlText);
    const hostPath = `${url.hostname}${url.pathname}`.replace(/\/+$/, '');
    return rejectedDescriptionSourcePatterns.some((pattern) => pattern.test(hostPath));
  } catch {
    return true;
  }
}

const idValue = (value: unknown): string => {
  const directId = serializedDocumentId(value);
  if (directId) return directId;
  if (typeof value === 'object' && value !== null && '_id' in value) {
    return idValue((value as Record<string, unknown>)._id);
  }
  return '';
};

const candidateKeyMatches = (candidate: CandidateDescriptionLab, keys: string[]): boolean => {
  if (keys.length === 0) return true;
  const normalized = new Set(keys.map((key) => key.toLowerCase()));
  return [idValue(candidate._id), candidate.slug, candidate.name].some((value) => {
    const text = textValue(value).toLowerCase();
    return text && normalized.has(text);
  });
};

function descriptionUrlPriority(value: string): number {
  try {
    const url = new URL(value);
    const path = url.pathname.toLowerCase();
    if (
      /\/(?:lab|labs|research|center|centers|institute|institutes|program|programs)\b/.test(path)
    ) {
      return 0;
    }
    if (/\/profile\//.test(path)) return 1;
    if (/\/people\//.test(path)) return 2;
  } catch {
    return 9;
  }
  return 3;
}

/** Anchor text that names a research-content page on a research home's own site. */
const RESEARCH_SUBPAGE_ANCHOR_RE =
  /^(?:our\s+|the\s+|current\s+)?(?:research(?:\s+(?:areas?|interests?|overview|projects?|topics?|themes?))?|projects?|research\s+&\s+publications|science|what\s+we\s+(?:do|study)|areas\s+of\s+research)$/i;

// Mirrors the selection floor in researchHomeDescriptionSelection - its length
// floor plus the same describesResearchHome test - so "already has something
// worth keeping" means the same thing on both sides. Length alone would also
// protect text that would never survive selection (a figure caption, directory
// index chrome, a person bio on an organization) and pin it forever (#2180).
const USABLE_STORED_DESCRIPTION_MIN_LENGTH = 120;

function storedDescriptionIsWorthKeeping(stored: string): boolean {
  return stored.length >= USABLE_STORED_DESCRIPTION_MIN_LENGTH && describesResearchHome(stored);
}

const MAX_RESEARCH_SUBPAGE_CANDIDATES = 2;

function sameRegistrableHost(a: string, b: string): boolean {
  try {
    return (
      new URL(a).hostname.replace(/^www\./i, '').toLowerCase() ===
      new URL(b).hostname.replace(/^www\./i, '').toLowerCase()
    );
  } catch {
    return false;
  }
}

const withoutTrailingSlash = (value: string): string => value.replace(/\/+$/, '');

/**
 * Pure: same-host pages on a research home's own site whose anchor text names
 * research content. The home page alone often carries only a mission or welcome
 * blurb while the site's `/research` page carries the actual research prose, so
 * the lane has to enumerate the site rather than stop at the root (#2176).
 *
 * Enumeration is uncapped and deduped on the trailing-slash-insensitive key so
 * that a nav publishing both `/research` and `/research/` yields one target
 * rather than consuming two of the crawl budget. The fetch budget belongs to
 * researchSubPageCrawlUrls(), which is the single cap.
 */
export function discoverResearchSubPageUrls(html: string, pageUrl: string): string[] {
  if (!html) return [];
  let $: cheerio.CheerioAPI;
  try {
    $ = cheerio.load(html);
  } catch {
    return [];
  }
  const found: string[] = [];
  const seen = new Set<string>([withoutTrailingSlash(pageUrl.split('#')[0])]);
  $('a[href]').each((_i, el) => {
    const text = textValue($(el).text());
    if (!text || !RESEARCH_SUBPAGE_ANCHOR_RE.test(text)) return;
    try {
      const absolute = new URL($(el).attr('href') || '', pageUrl).toString().split('#')[0];
      if (!/^https?:\/\//i.test(absolute)) return;
      if (!sameRegistrableHost(absolute, pageUrl)) return;
      const key = withoutTrailingSlash(absolute);
      if (!key || seen.has(key)) return;
      seen.add(key);
      found.push(absolute);
    } catch {
      /* ignore unparseable hrefs */
    }
  });
  return found;
}

/**
 * Pure: bounded, deduped research-page crawl list, built only from links the
 * site actually publishes. Blind origin-rooted probes (`/research`, `/projects`,
 * ...) are deliberately NOT attempted: a corpus sample found published anchors
 * already reach every research page the crawl recovers, while blind probing
 * costs two mostly-404 requests per entity across the whole corpus. Published
 * links also preserve the site's own URL shape, which matters because `/research`
 * frequently redirects to something like `/research_page/`.
 */
export function researchSubPageCrawlUrls(
  homeHtml: string,
  homeUrl: string,
  maxUrls: number = MAX_RESEARCH_SUBPAGE_CANDIDATES,
): string[] {
  if (maxUrls <= 0) return [];
  return discoverResearchSubPageUrls(homeHtml, homeUrl)
    .filter((url) => !isRejectedDescriptionSourceUrl(url))
    .slice(0, maxUrls);
}

export interface DescriptionPageProse {
  url: string;
  fullDescription: string;
  shortDescription: string;
}

/**
 * Deterministic official prose for one fetched page. The embedded-JSON path runs
 * first because many Yale pages are JS-rendered shells whose verbatim
 * description only exists in a script-tag payload.
 */
export function extractDescriptionPageProse(
  page: FetchedDescriptionPage,
  kind: DescriptionEntityKind,
): DescriptionPageProse | null {
  const embedded = extractLabHomepageDescription(page.html, { kind });
  const prose = embedded?.description
    ? { fullDescription: embedded.description, shortDescription: embedded.shortDescription || '' }
    : extractOfficialResearchDescription(page.html, { kind });
  if (!prose?.fullDescription) return null;
  return {
    url: page.url,
    fullDescription: prose.fullDescription,
    shortDescription: prose.shortDescription || '',
  };
}

/**
 * Pure: pick the fetched page whose prose best says what the home studies.
 * Candidates arrive primary-page-first and only a STRICTLY better score wins, so
 * a crawled research page replaces the primary page's prose only when that prose
 * is off-topic (a mission statement, a recruiting notice). This deliberate
 * conservatism matters: a corpus dry-run over the 504 homepage-sourced entities
 * found that preferring a research page whenever one merely exists regresses
 * roughly a third of them onto figure captions, single-project leads, textbook
 * background framing, and CV/contact blocks. Widening this to also beat weak but
 * on-topic home-page prose needs a positive specificity signal, not a tiebreak
 * (#2176).
 */
export function selectBestDescriptionPageProse(
  candidates: DescriptionPageProse[],
  kind: DescriptionEntityKind,
): DescriptionPageProse | null {
  let best: DescriptionPageProse | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates) {
    const score = scoreResearchHomeDescriptionCandidate(candidate.fullDescription, kind);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function descriptionSourceUrlVariants(value: string): string[] {
  const original = textValue(value);
  if (!original) return [];
  try {
    const url = new URL(original);
    if (!/(^|\.)yale\.edu$/i.test(url.hostname)) return [original];
    const match = url.pathname.match(/^\/people\/([^/]+)\/?$/i);
    if (!match) return [original];
    const profileUrl = new URL(url.toString());
    profileUrl.pathname = `/profile/${match[1]}`;
    profileUrl.search = '';
    profileUrl.hash = '';
    return [original, profileUrl.toString()];
  } catch {
    return [original];
  }
}

function expandDescriptionSourceUrls(values: unknown[]): string[] {
  return uniqueStrings(values).flatMap(descriptionSourceUrlVariants);
}

function candidateUrlsForDoc(doc: CandidateDescriptionLabDoc): string[] {
  // Drop a person page whose name belongs to a different professor than this
  // entity, so a mis-picked source URL (e.g. Keith Baker's people page ending up
  // in Charles Brown's sourceUrls) can never key a description onto the wrong
  // entity. Non-person and corroborated person URLs are unaffected (#688).
  const usableDescriptionSource = (url: string): boolean =>
    !isRejectedDescriptionSourceUrl(url) && personProfileSourceMatchesEntity(url, doc);
  const primaryUrls = expandDescriptionSourceUrls([doc.websiteUrl, doc.website])
    .filter(usableDescriptionSource)
    .sort((a, b) => descriptionUrlPriority(a) - descriptionUrlPriority(b) || a.localeCompare(b));
  const primaryNonProfileUrls = primaryUrls.filter((url) => {
    try {
      return !/\/profile\//i.test(new URL(url).pathname);
    } catch {
      return false;
    }
  });
  if (primaryNonProfileUrls.length > 0) {
    const fallbackUrls = expandDescriptionSourceUrls([...primaryUrls, ...(doc.sourceUrls || [])])
      .filter(usableDescriptionSource)
      .sort((a, b) => descriptionUrlPriority(a) - descriptionUrlPriority(b) || a.localeCompare(b));
    return uniqueStrings([...primaryNonProfileUrls, ...fallbackUrls]);
  }

  return expandDescriptionSourceUrls([...primaryUrls, ...(doc.sourceUrls || [])])
    .filter(usableDescriptionSource)
    .sort((a, b) => descriptionUrlPriority(a) - descriptionUrlPriority(b) || a.localeCompare(b));
}

export function candidateDescriptionLabsFromDocs(
  docs: CandidateDescriptionLabDoc[],
  options: { only?: string[]; queueOrder?: string[] } = {},
): CandidateDescriptionLab[] {
  const queueRank = new Map((options.queueOrder || []).map((id, index) => [id, index]));
  const keys = uniqueStrings(options.only || []);
  const candidates = docs.flatMap((doc) => {
    const urls = candidateUrlsForDoc(doc);
    if (urls.length === 0) return [];
    const candidate: CandidateDescriptionLab = {
      _id: doc._id,
      slug: doc.slug,
      name: textValue(doc.displayName || doc.name || doc.slug || idValue(doc._id)),
      websiteUrl: urls[0],
      sourceUrls: urls,
      manuallyLockedFields: doc.manuallyLockedFields || [],
      entityType: doc.entityType,
      kind: doc.kind,
      school: doc.school,
      schools: doc.schools,
      departments: doc.departments,
      fullDescription:
        textValue((doc as { fullDescription?: unknown }).fullDescription) || undefined,
      sourceLinkHealth: doc.sourceLinkHealth,
    };
    return candidateKeyMatches(candidate, keys) ? [candidate] : [];
  });

  return candidates.sort((a, b) => {
    const rankA = queueRank.get(idValue(a._id)) ?? Number.MAX_SAFE_INTEGER;
    const rankB = queueRank.get(idValue(b._id)) ?? Number.MAX_SAFE_INTEGER;
    return rankA - rankB || a.name.localeCompare(b.name);
  });
}

function usefulDescription(value: unknown): string {
  const text = textValue(value);
  if (text.length < 80) return '';
  if (/^(?:n\/a|none|unknown)$/i.test(text)) return '';
  return text;
}

const PERSON_BIO_CARD_PATTERN =
  /\bAbout\s+[A-Z][\p{L}.'’-]+(?:\s+[A-Z][\p{L}.'’-]+){0,3}\s+is\s+(?:an?|the)\b/gu;

/**
 * A directory/landing page (fellows roster, staff listing) yields a page-text
 * summary that concatenates several unrelated people's "About <Name> is a/the
 * ..." bio cards rather than describing the single entity the extractor asked
 * about (#1678). Two or more distinct bio cards is the tell of a multi-person
 * dump; a genuine single-entity description never repeats this construction.
 */
function isMultiPersonBioDirectoryDumpText(value: string): boolean {
  const matches = value.match(PERSON_BIO_CARD_PATTERN);
  return Boolean(matches && matches.length >= 2);
}

const PAGE_SECTION_HEADING_TOPIC_PATTERNS = [
  /^selected\s+(?:presentations?|publications?|articles?|media|press|talks?)\b/i,
  /^(?:in\s+the\s+)?news$/i,
  /^publications?$/i,
  /^presentations?$/i,
  /^media(?:\s+coverage)?$/i,
  /^press$/i,
  /^events?$/i,
  /^awards?(?:\s*(?:&|and)\s*honors?)?$/i,
  /for\s+a\s+general\s+audience$/i,
];

/**
 * A page section heading ("Selected Presentations and Articles for a General
 * Audience", "In the News") that the LLM mistook for a research topic string
 * rather than page furniture (#1678). Real topics never read as a bare page
 * section label.
 */
function isPageSectionHeadingTopic(value: string): boolean {
  const cleaned = textValue(value);
  return PAGE_SECTION_HEADING_TOPIC_PATTERNS.some((pattern) => pattern.test(cleaned));
}

function sentenceCase(value: string): string {
  return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : '';
}

function withTerminalPeriod(value: string): string {
  const text = value.replace(/[.;:,]+$/g, '').trim();
  return text && !/[.!?]$/.test(text) ? `${text}.` : text;
}

function normalizeKnownDescriptionAcronyms(value: string): string {
  return value.replace(/\bCar\s+DS\b/g, 'CarDS').replace(/\bNOu\s+RISH\b/g, 'NOURISH');
}

function firstPersonShortToCardShort(value: string, fullDescription: string): string {
  const rewrites: Array<[RegExp, (match: RegExpMatchArray) => string]> = [
    [/^we\s+study\s+(.+)$/i, (match) => `Studies ${match[1]}`],
    [/^we\s+investigate\s+(.+)$/i, (match) => `Investigates ${match[1]}`],
    [/^we\s+focus\s+on\s+(.+)$/i, (match) => `Focuses on ${match[1]}`],
    [
      /^our\s+research\s+(?:studies|investigates|examines)\s+(.+)$/i,
      (match) => `Studies ${match[1]}`,
    ],
    [/^our\s+research\s+focuses\s+on\s+(.+)$/i, (match) => `Focuses on ${match[1]}`],
  ];

  for (const [pattern, rewrite] of rewrites) {
    const match = value.match(pattern);
    if (!match) continue;
    const candidate = withTerminalPeriod(sentenceCase(rewrite(match)));
    if (shortDescriptionQuality(candidate, fullDescription).isUseful) return candidate;
  }
  return '';
}

function usefulShortDescription(value: unknown, fullDescription: string): string {
  const text = normalizeKnownDescriptionAcronyms(usefulDescription(value));
  if (text && shortDescriptionQuality(text, fullDescription).isUseful) return text;
  const rewritten = text ? firstPersonShortToCardShort(text, fullDescription) : '';
  if (rewritten) return rewritten;
  const derived = deriveShortDescriptionFromFullDescription(fullDescription);
  return shortDescriptionQuality(derived, fullDescription).isUseful ? derived : '';
}

export function htmlToText(html: string): string {
  if (!html) return '';
  const $ = cheerio.load(html);
  $('script, style, noscript, svg, iframe, nav, footer').remove();
  const body = $('body')[0] || $.root()[0];
  return extractElementTextWithBlockSeparators(body).slice(0, MAX_PROMPT_CHARS);
}

const GOVERNANCE_ORG_NAME_RE =
  /^(?:the\s+)?(?:council|committee|consortium|commission|task\s+force|working\s+group|senate|assembly|office\s+of|board\s+of)\b/i;

// A microsite frequently leads with the PI's faculty title/credential line
// ("Joshua L. Warren Professor of Biostatistics, Yale University") rather than a
// branded research-home name. The LLM prompt already asks for an empty name in
// that case, but enforce it deterministically so a title line can never
// materialize as the entity's student-facing name.
const PERSON_TITLE_OR_CREDENTIAL_NAME_RE =
  /\bprofessor\b|\bph\.?\s?d\b|\bm\.?\s?d\b|\bendowed\s+chair\b|,\s*yale\s+university\s*$/i;

export function usefulLabName(value: unknown): string {
  const text = stripTrailingResearchHomeDescription(textValue(value));
  if (text.length < 2 || text.length > 120) return '';
  if (isPlaceholderEntityName(text)) return '';
  if (/^(?:the lab|lab|laboratory|research)$/i.test(text)) return '';
  if (GOVERNANCE_ORG_NAME_RE.test(text)) return '';
  if (PERSON_TITLE_OR_CREDENTIAL_NAME_RE.test(text)) return '';
  return text;
}

export function groundDescriptionExtraction(
  extraction: DescriptionExtraction,
  pageText: string,
): DescriptionExtraction {
  const groundedFull = isDescriptionGroundedInSource(extraction.fullDescription, pageText)
    ? extraction.fullDescription
    : '';
  const groundedShort = isDescriptionGroundedInSource(extraction.shortDescription, pageText)
    ? extraction.shortDescription
    : '';
  return { ...extraction, fullDescription: groundedFull, shortDescription: groundedShort };
}

export function descriptionExtractionToObservations(
  extraction: DescriptionExtraction,
  context: {
    entityId?: string;
    entityKey?: string;
    sourceUrl: string;
    entityType?: string;
    kind?: string;
  },
): ObservationInput[] {
  if (isRejectedDescriptionSourceUrl(context.sourceUrl)) return [];
  const labName = usefulLabName(extraction.name);
  const pageAttribution = classifyExtractedPageAttribution(labName, context);
  if (pageAttribution === 'ANOTHER_PERSONS_LAB') return [];

  const fullDescription = normalizeKnownDescriptionAcronyms(
    usefulDescription(extraction.fullDescription),
  );
  if (
    !fullDescription ||
    isMultiPersonBioDirectoryDumpText(fullDescription) ||
    hasMultipleCareerTimelineSentences(fullDescription) ||
    isBibliographyCitationEntryText(fullDescription)
  ) {
    return [];
  }
  const shortDescription = usefulShortDescription(extraction.shortDescription, fullDescription);

  const base = {
    entityType: 'researchEntity' as const,
    entityId: context.entityId,
    entityKey: context.entityKey,
    sourceUrl: context.sourceUrl,
    confidenceOverride: isPersonProfileOrDirectoryUrl(context.sourceUrl) ? 0.55 : 0.82,
  };
  const observations: ObservationInput[] = [
    { ...base, field: 'fullDescription', value: fullDescription },
  ];

  if (shortDescription) {
    observations.push({ ...base, field: 'shortDescription', value: shortDescription });
  }
  const topics = uniqueStrings(extraction.topics || [])
    .filter((topic) => !isPageSectionHeadingTopic(topic))
    .slice(0, 12);
  if (topics.length) observations.push({ ...base, field: 'researchAreas', value: topics });
  const methods = uniqueStrings(extraction.methods || []).slice(0, 12);
  if (methods.length) observations.push({ ...base, field: 'methods', value: methods });

  if (labName && pageAttribution === 'THIS_ENTITY') {
    const nameBase = { ...base, confidenceOverride: LAB_NAME_CONFIDENCE };
    observations.push({ ...nameBase, field: 'name', value: labName });
    observations.push({ ...nameBase, field: 'displayName', value: labName });
  }
  return observations;
}

/**
 * Whose page the extractor just read, judged from the name the page gives itself.
 *
 * `THIS_ENTITY` - the page may both name and describe this record.
 *
 * `AFFILIATED_ORGANIZATION` - the page's own name is an umbrella organization, or
 * the page is a person's unbranded CMS profile. Neither may become this record's
 * identity, but in both cases the prose can still be this person's own research,
 * so the description is kept.
 *
 * `ANOTHER_PERSONS_LAB` - the page is provably a DIFFERENT named person's lab, the
 * eponym in its name corroborated by its own URL path. Nothing on it belongs here.
 */
type ExtractedPageAttribution = 'THIS_ENTITY' | 'AFFILIATED_ORGANIZATION' | 'ANOTHER_PERSONS_LAB';

export interface ExtractedPageIdentityContext {
  sourceUrl: string;
  entityKey?: string;
  entityType?: string;
  kind?: string;
}

/**
 * Whether the page an extraction came from is another named person's lab, and so
 * describes nothing that belongs to this record. Exported because the caller's
 * methods-only fallback fires precisely when `descriptionExtractionToObservations`
 * returns nothing, and a foreign lab's techniques are as much a graft as its prose.
 */
export function extractedPageDescribesAnotherPersonsLab(
  extraction: { name?: unknown },
  context: ExtractedPageIdentityContext,
): boolean {
  return (
    classifyExtractedPageAttribution(usefulLabName(extraction.name), context) ===
    'ANOTHER_PERSONS_LAB'
  );
}

/**
 * Certainty that the extractor read a name off a page is not authority to make
 * that name an entity's identity. A page belonging to an umbrella organization
 * or to another person's lab names that other thing, so neither may become a
 * person-scoped entity's identity no matter how cleanly it was extracted
 * (issue #2234). Judging the name rather than only the URL is what makes this
 * hold for a directory shape nobody has enumerated yet.
 *
 * `ANOTHER_PERSONS_LAB` additionally governs the page's DESCRIPTION (#2272).
 * Refusing only the name left the prose half of the graft in place: a trainee
 * whose profile links their principal investigator's lab site kept "The Liu
 * laboratory is dedicated to developing a high-throughput cryo-electron
 * tomography (cryo-ET) pipeline" as their own research description while the name
 * it came from was correctly refused, so seven of the eight records serving that
 * paragraph were lab members rather than the lab. A page we have already decided
 * cannot name this record cannot describe it either.
 *
 * `AFFILIATED_ORGANIZATION` deliberately does NOT reach the description, and the
 * asymmetry is measured rather than assumed. Of 22 served records whose harvested
 * name was an umbrella organization, 9 carried a CORRECT description of the
 * person ("He studies how financial reporting regulation and the accessibility of
 * information shape the behavior of organizations"), because the LLM had returned
 * an affiliation line from the person's own site as the name. Withholding those
 * descriptions would lose more good prose than bad. Separating the harvested
 * name's own subject from the description's subject needs the LLM subject-scope
 * judgement, not this predicate.
 *
 * An empty harvested name fails OPEN. The extraction prompt asks for an empty
 * name when a page states none, which is the normal answer for a person's own
 * unbranded lab site, and treating "no name to judge" as "attribution failed"
 * would withhold the description of every such site in the corpus.
 */
function classifyExtractedPageAttribution(
  labName: string,
  context: ExtractedPageIdentityContext,
): ExtractedPageAttribution {
  if (isPersonCmsProfileUrl(context.sourceUrl)) return 'AFFILIATED_ORGANIZATION';
  if (!isPersonScopedResearchEntity(context)) return 'THIS_ENTITY';
  if (!labName) return 'THIS_ENTITY';
  if (isUmbrellaOrganizationName(labName)) return 'AFFILIATED_ORGANIZATION';
  return claimsAnotherPersonsLab({
    harvestedName: labName,
    websiteUrl: context.sourceUrl,
    identityTokens: entityKeyPersonTokens(context.entityKey),
  })
    ? 'ANOTHER_PERSONS_LAB'
    : 'THIS_ENTITY';
}

async function defaultFetchPage(url: string): Promise<FetchedDescriptionPage | null> {
  // SSRF guard, per-host rate limiting, and retry-on-403 live in fetchPageWithPolicy.
  // It throws after retries are exhausted so the caller advances to the next candidate URL.
  const page = await fetchPageWithPolicy(url, {
    headers: { 'User-Agent': 'ylabs-scraper/1.0 (+https://yalelabs.io)' },
    timeoutMs: 10_000,
  });
  return { url: page.url, html: page.html };
}

async function defaultCallLLM(input: {
  model: string;
  apiKey: string;
  labName: string;
  sourceUrl: string;
  pageText: string;
}): Promise<DescriptionExtraction> {
  const safeLabName = redactDirectContactInfo(input.labName).slice(0, 240);
  const safeSourceUrl = redactDirectContactInfo(input.sourceUrl).slice(0, 2048);
  const safePageText = redactDirectContactInfo(input.pageText).slice(0, MAX_PROMPT_CHARS);
  const response = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model: input.model,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: DESCRIPTION_EXTRACTION_SYSTEM_PROMPT,
        },
        {
          role: 'user',
          content: [
            `Lab: ${safeLabName}`,
            `Source URL: ${safeSourceUrl}`,
            'Return JSON with fullDescription, shortDescription, topics, methods, name.',
            "fullDescription: copy the page's own overview/about/mission prose describing what this research entity studies, verbatim (one or more consecutive sentences, exactly as written). shortDescription: copy a single verbatim sentence that best summarizes the work, or an empty string.",
            'topics and methods: only terms that appear verbatim on the page.',
            'For name, return the research entity\'s own proper or branded name exactly as it appears prominently on the page (for example "The Efficient Computing Lab (ECL)"). If the page only identifies it by the principal investigator\'s personal name, or no clear proper name is stated, return an empty string.',
            safePageText,
          ].join('\n\n'),
        },
      ],
      ...openAiChatSampling(input.model),
    },
    {
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 30_000,
    },
  );
  const content = response.data?.choices?.[0]?.message?.content;
  if (!content || typeof content !== 'string') throw new Error('LLM returned empty content');
  return JSON.parse(content) as DescriptionExtraction;
}

async function defaultLabFinder(
  options: { only?: string[]; exhaustive?: boolean } = {},
): Promise<CandidateDescriptionLab[]> {
  const only = uniqueStrings(options.only || []);
  const onlyObjectIds = only
    .map((value) => normalizeDescriptionLlmObjectId(value))
    .filter((value): value is string => Boolean(value))
    .map((value) => new mongoose.Types.ObjectId(value));
  let queueItems: Array<{ recordId?: unknown }> = [];
  if (!only.length) {
    const queueQuery = VisibilityReleaseQueueItem.find({
      collection: 'research',
      status: 'open',
      repairStage: 'source_description',
      repairStatus: { $in: ['queued', 'blocked', 'attempted'] },
    }).sort({ lastSeenAt: 1, _id: 1 });
    if (!options.exhaustive) {
      queueQuery.limit(1000);
    }
    queueItems = (await queueQuery.select('recordId').lean()) as Array<{ recordId?: unknown }>;
  }
  const queueOrder = uniqueStrings(queueItems.map((item: any) => item.recordId));
  const identityFilter = only.length
    ? {
        $or: [
          ...(onlyObjectIds.length ? [{ _id: { $in: onlyObjectIds } }] : []),
          { slug: { $in: only } },
          { name: { $in: only } },
          { displayName: { $in: only } },
        ],
      }
    : queueOrder.length
      ? { _id: { $in: queueOrder } }
      : {};
  const urlFilter = {
    $or: [
      { websiteUrl: /^https?:\/\//i },
      { website: /^https?:\/\//i },
      { sourceUrls: /^https?:\/\//i },
    ],
  };
  const docs = await ResearchEntity.find(
    {
      $and: [{ archived: { $ne: true } }, urlFilter, identityFilter],
    },
    {
      _id: 1,
      slug: 1,
      name: 1,
      displayName: 1,
      websiteUrl: 1,
      website: 1,
      sourceUrls: 1,
      manuallyLockedFields: 1,
      entityType: 1,
      kind: 1,
      school: 1,
      schools: 1,
      departments: 1,
      fullDescription: 1,
      sourceLinkHealth: 1,
    },
  ).lean();
  return candidateDescriptionLabsFromDocs(docs as CandidateDescriptionLabDoc[], {
    only,
    queueOrder,
  });
}

async function defaultWorkPlanLoader(
  lab: CandidateDescriptionLab,
  policy: WorkPlannerSourcePolicy,
  _ctx: ScraperContext,
): Promise<EntityWorkPlan> {
  return loadEntityWorkPlan({
    entityType: policy.entityType,
    entityId: idValue(lab._id) || undefined,
    entityKey: lab.slug,
    sourceName: policy.sourceName,
    targetFields: policy.targetFields,
    manuallyLockedFields: lab.manuallyLockedFields,
    freshnessWindowMs: policy.freshnessWindowMs,
    now: new Date(),
  });
}

export class LabMicrositeDescriptionLLMExtractor implements IScraper {
  readonly name = SOURCE_KEY;
  readonly displayName = 'Lab microsite LLM (description only)';

  private readonly fetchPage: FetchDescriptionPageFn;
  private readonly callLLM: CallDescriptionLLMFn;
  private readonly callCardLLM: CardSynthesisLLMFn;
  private readonly workPlanLoader: DescriptionWorkPlanLoaderFn;
  private readonly labFinder: (options?: {
    only?: string[];
    exhaustive?: boolean;
  }) => Promise<CandidateDescriptionLab[]>;
  private readonly apiKey?: string;
  private readonly model: string;
  private readonly cardModel: string;

  constructor(deps: LabMicrositeDescriptionLLMExtractorDeps = {}) {
    this.fetchPage = deps.fetchPage || defaultFetchPage;
    this.callLLM = deps.callLLM || defaultCallLLM;
    this.callCardLLM = deps.callCardLLM || defaultCardSynthesisLLM;
    this.workPlanLoader = deps.workPlanLoader || defaultWorkPlanLoader;
    this.labFinder = deps.labFinder || defaultLabFinder;
    this.apiKey = deps.apiKey || process.env.OPENAI_API_KEY;
    this.model = deps.model || DEFAULT_MODEL;
    this.cardModel = deps.cardModel || CARD_SYNTHESIS_MODEL;
  }

  private async withSynthesizedCard(observations: ObservationInput[]): Promise<ObservationInput[]> {
    const hasCard = observations.some(
      (observation) => observation.field === 'shortDescription' && textValue(observation.value),
    );
    if (hasCard) return observations;
    const fullObservation = observations.find(
      (observation) => observation.field === 'fullDescription',
    );
    const fullDescription = textValue(fullObservation?.value);
    if (!fullObservation || !fullDescription || !this.apiKey) return observations;
    const apiKey = this.apiKey;
    const card = await synthesizeGroundedCardDescription({
      fullDescription,
      callLLM: (llmInput) => this.callCardLLM({ ...llmInput, apiKey, model: this.cardModel }),
    });
    if (!card) return observations;
    return [
      ...observations,
      {
        entityType: fullObservation.entityType,
        entityId: fullObservation.entityId,
        entityKey: fullObservation.entityKey,
        sourceUrl: fullObservation.sourceUrl,
        confidenceOverride: fullObservation.confidenceOverride,
        field: 'shortDescription',
        value: card,
      },
    ];
  }

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    if (!this.apiKey) {
      ctx.log('OPENAI_API_KEY missing; skipping lab microsite description extraction.');
      return { observationCount: 0, entitiesObserved: 0, notes: 'OPENAI_API_KEY missing' };
    }

    const only = uniqueStrings(ctx.options.only || []);
    const offset = parseRuntimeIntegerOption(ctx.options.offset, '--offset', {
      min: 0,
      label: 'non-negative',
      fallback: 0,
    });
    const limit =
      ctx.options.exhaustive && ctx.options.limit === undefined
        ? Number.POSITIVE_INFINITY
        : parseRuntimeIntegerOption(ctx.options.limit, '--limit', {
            min: 1,
            label: 'positive',
            fallback: 100,
          });
    const candidates = (await this.labFinder({ only, exhaustive: ctx.options.exhaustive }))
      .filter(
        (candidate) =>
          candidateKeyMatches(candidate, only) &&
          candidate.websiteUrl &&
          !isRejectedDescriptionSourceUrl(candidate.websiteUrl),
      )
      .slice(offset, offset + limit);
    let observationCount = 0;
    let entitiesObserved = 0;
    let contentUnchangedSkipped = 0;
    const workPlannerPolicy = ctx.options.ignoreWorkPlanner
      ? undefined
      : getWorkPlannerSourcePolicy(this.name);
    const workPlannerMetrics = createWorkPlannerMetrics();

    const concurrency = resolveSourceConcurrency(
      ctx.options.sourceConcurrency,
      DEFAULT_SOURCE_CONCURRENCY,
    );
    await mapWithConcurrency(candidates, concurrency, async (lab) => {
      try {
        if (workPlannerPolicy) {
          if (!idValue(lab._id) && !lab.slug) {
            recordWorkPlannerNoIdentifier(workPlannerMetrics);
            ctx.log('[candidate] skipped by WorkPlanner — missing entity identifier.');
            return;
          }
          const plan = await this.workPlanLoader(lab, workPlannerPolicy, ctx);
          recordWorkPlannerDecision(workPlannerMetrics, plan);
          if (!plan.shouldFetch) {
            const reasons = Array.from(new Set(plan.fields.map((field) => field.reason))).join(',');
            ctx.log(`[${lab.slug || 'candidate'}] skipped by WorkPlanner — ${reasons || 'fresh'}.`);
            return;
          }
        }
        const urls = uniqueStrings([lab.websiteUrl, ...(lab.sourceUrls || [])]).filter(
          (url) =>
            !isRejectedDescriptionSourceUrl(url) &&
            !isKnownUnavailableSourceUrl(url, lab.sourceLinkHealth) &&
            personProfileSourceMatchesEntity(url, lab),
        );
        let page: FetchedDescriptionPage | null = null;
        let lastFetchError = '';
        for (const sourceUrl of urls) {
          try {
            page = await this.fetchPage(sourceUrl);
          } catch (error) {
            lastFetchError = sanitizeLogValue(error);
            ctx.log(
              `[${lab.slug || 'candidate'}] description extraction source failed: ${lastFetchError}`,
            );
            continue;
          }
          if (page?.html) break;
        }
        if (!page?.html && lastFetchError) {
          ctx.log(
            `[${lab.slug || 'candidate'}] skipping description extraction: ${lastFetchError}`,
          );
        }
        if (!page?.html) return;

        // A candidate URL can redirect to a different professor's page; re-check
        // the resolved URL so a redirect never keys a description onto the wrong
        // entity (#688).
        if (!personProfileSourceMatchesEntity(page.url, lab)) {
          ctx.log(
            `[${lab.slug || 'candidate'}] skipping description extraction: resolved source ${page.url} names a different person than the entity.`,
          );
          return;
        }

        const kind: DescriptionEntityKind = isFacultyResearchTextEntity({
          entityType: lab.entityType,
          kind: lab.kind,
        })
          ? 'person'
          : 'organization';

        // A home page often carries only a mission or welcome blurb while the
        // site's own research page carries the research prose, so enumerate the
        // site instead of stopping at whichever URL happened to be stored (#2176).
        const pages: FetchedDescriptionPage[] = [page];
        let crawlIncomplete = false;
        for (const researchUrl of researchSubPageCrawlUrls(page.html, page.url)) {
          if (isKnownUnavailableSourceUrl(researchUrl, lab.sourceLinkHealth)) continue;
          let researchPage: FetchedDescriptionPage | null = null;
          try {
            researchPage = await this.fetchPage(researchUrl);
          } catch (error) {
            crawlIncomplete = true;
            ctx.log(
              `[${lab.slug || 'candidate'}] research subpage skipped: ${sanitizeLogValue(error)}`,
            );
            continue;
          }
          if (!researchPage?.html) {
            crawlIncomplete = true;
            continue;
          }
          if (!personProfileSourceMatchesEntity(researchPage.url, lab)) continue;
          if (pages.some((fetched) => fetched.url === researchPage.url)) continue;
          pages.push(researchPage);
        }

        // A run that could not read every research page the home page links has
        // seen strictly less than the run that produced the stored description,
        // so extracting from the remaining pages would supersede a research-page
        // description with the home page's mission blurb on a single timeout,
        // and flip back on the next run at full LLM cost. Keep what is stored
        // instead. An entity with no description yet still proceeds, so a
        // permanently broken research link never starves it (#2176).
        if (crawlIncomplete && textValue(lab.fullDescription)) {
          ctx.log(
            `[${lab.slug || 'candidate'}] skipping description extraction: a linked research page could not be read, keeping the stored description.`,
          );
          return;
        }

        // Raw HTML covers both extraction paths below: the visible-text LLM path
        // and the deterministic embedded-JSON official-prose path (which reads
        // script-tag payloads htmlToText strips). Hashing raw HTML ensures an
        // embedded-prose-only change still re-runs extraction. A single-page
        // entity keeps its pre-crawl hash input so adding this crawl does not
        // force LLM re-spend on homes that gained no research page (#2022).
        const entityRef = {
          entityType: 'researchEntity' as const,
          entityId: serializedDocumentId(lab._id) || undefined,
          entityKey: lab.slug,
        };
        const contentHash = computeVersionedContentHash(
          pages.length === 1
            ? page.html
            : pages.map((fetched) => `${fetched.url}\n${fetched.html}`).join('\n'),
          DESCRIPTION_EXTRACTION_PROMPT_HASH,
          this.model,
          this.cardModel,
          CARD_SYNTHESIS_PROMPT_HASH,
        );
        const storedContentHash = ctx.options.forceLlm
          ? undefined
          : await loadStoredContentHash(this.name, entityRef);
        if (contentUnchanged(storedContentHash, contentHash, ctx.options.forceLlm)) {
          contentUnchangedSkipped += 1;
          ctx.log(
            `[${lab.slug || 'candidate'}] skipping description extraction: content unchanged.`,
          );
          return;
        }
        // Fast, faithful path: the deterministic extractors are cheaper than the
        // LLM and recover prose the plain-text path misses, so run them across
        // every fetched page and keep the best passage. The page that wins also
        // becomes the cited source URL and the text the LLM reads for methods.
        const primaryPage = page;
        const primaryProse = extractDescriptionPageProse(primaryPage, kind);

        // A crawled page may only ADD a description, never contribute an
        // off-topic one, and it has to beat the primary page's own candidate
        // outright. Ties go to the primary page, so the crawl changes an entity
        // only when the primary page's prose is genuinely worse (a mission
        // statement, a recruiting pitch) than the research page's (#2176).
        const crawledProse = pages
          .slice(1)
          .map((fetched) => extractDescriptionPageProse(fetched, kind))
          .filter(
            (prose): prose is DescriptionPageProse =>
              prose !== null &&
              scoreResearchHomeDescriptionCandidate(prose.fullDescription, kind) >= 0,
          );
        const bestCrawledProse = selectBestDescriptionPageProse(crawledProse, kind);

        const primaryPageText = htmlToText(primaryPage.html);

        // When the primary page has deterministic prose of its own and a crawled
        // research page already beats it, the winner is settled without the LLM,
        // so calling it on the primary page would pay for a result nothing reads.
        const crawledBeatsPrimaryProse =
          bestCrawledProse !== null &&
          primaryProse !== null &&
          scoreResearchHomeDescriptionCandidate(bestCrawledProse.fullDescription, kind) >
            scoreResearchHomeDescriptionCandidate(primaryProse.fullDescription, kind);

        const llmExtraction =
          !crawledBeatsPrimaryProse && primaryPageText.length >= 120
            ? await this.callLLM({
                model: this.model,
                apiKey: this.apiKey as string,
                labName: lab.name,
                sourceUrl: primaryPage.url,
                pageText: primaryPageText,
              })
            : null;
        const groundedLlmExtraction = llmExtraction
          ? groundDescriptionExtraction(llmExtraction, primaryPageText)
          : null;

        // The primary page's own candidate, under today's precedence: its
        // deterministic prose if it has any, otherwise its grounded LLM prose.
        const primaryCandidate: DescriptionPageProse | null =
          primaryProse ??
          (groundedLlmExtraction?.fullDescription
            ? {
                url: primaryPage.url,
                fullDescription: groundedLlmExtraction.fullDescription,
                shortDescription: groundedLlmExtraction.shortDescription || '',
              }
            : null);
        // When the primary page is a JS shell it yields no candidate at all, and
        // then a crawled candidate would win unopposed - which is how a figure
        // caption on hatlab.yale.edu/research replaced a good stored description
        // (#2180). A crawled page the primary page cannot vouch for may only FILL
        // a description, never replace one worth keeping.
        const storedDescription = textValue(lab.fullDescription);
        const unopposedCrawledProseSuppressed =
          bestCrawledProse !== null &&
          primaryCandidate === null &&
          storedDescriptionIsWorthKeeping(storedDescription);
        if (unopposedCrawledProseSuppressed) {
          ctx.log(
            `[${lab.slug || 'candidate'}] keeping the stored description: ${primaryPage.url} yielded no candidate of its own, so a crawled page cannot replace it.`,
          );
        }
        const crawledProseWins =
          bestCrawledProse !== null &&
          (primaryCandidate === null
            ? !unopposedCrawledProseSuppressed
            : scoreResearchHomeDescriptionCandidate(bestCrawledProse.fullDescription, kind) >
              scoreResearchHomeDescriptionCandidate(primaryCandidate.fullDescription, kind));

        if (crawledProseWins && bestCrawledProse) {
          page = pages.find((fetched) => fetched.url === bestCrawledProse.url) ?? primaryPage;
        }
        const officialProse = crawledProseWins ? bestCrawledProse : primaryProse;

        // The suppression above is decided by the stored description, which is
        // not an input to contentHash, so recording the hash would freeze that
        // decision: clearing the stored description later would never be
        // reconsidered because the content-unchanged gate returns first. Leave
        // the hash unwritten so the next run re-decides on current state, like
        // the crawl-incomplete guard that returns before hashing (#2180).
        const hashObservations = unopposedCrawledProseSuppressed
          ? []
          : [contentHashObservation(entityRef, page.url, contentHash)];

        // Methods are grounded in the text of the page that is actually cited, so
        // a crawled winner never attributes home-page methods to its own URL.
        // They are therefore extracted from that page too: grounding the primary
        // page's methods against a crawled winner's text would discard all of
        // them and lose the winning page's own method language (#2176).
        const pageText = page === primaryPage ? primaryPageText : htmlToText(page.html);
        const citedPageExtraction =
          page === primaryPage
            ? llmExtraction
            : pageText.length >= 120
              ? await this.callLLM({
                  model: this.model,
                  apiKey: this.apiKey as string,
                  labName: lab.name,
                  sourceUrl: page.url,
                  pageText,
                })
              : null;

        // Methods are LLM-extracted and word-grounded before use, and are
        // emitted regardless of which description path wins - the deterministic
        // embedded-prose path previously dropped methods entirely. When the live
        // page names no groundable methods, fall back to deriving them from the
        // entity's already-stored description so research homes without method
        // language on the page still surface techniques.
        let methods = citedPageExtraction
          ? groundMethods(citedPageExtraction.methods, pageText)
          : [];
        if (methods.length === 0 && storedDescription.length >= 120) {
          const descExtraction = await this.callLLM({
            model: this.model,
            apiKey: this.apiKey as string,
            labName: lab.name,
            sourceUrl: page.url,
            pageText: storedDescription,
          });
          methods = groundMethods(descExtraction.methods, storedDescription);
        }

        const identity = {
          entityId: serializedDocumentId(lab._id),
          entityKey: lab.slug,
          sourceUrl: page.url,
          entityType: lab.entityType,
          kind: lab.kind,
        };

        let observations: ObservationInput[] = officialProse?.fullDescription
          ? descriptionExtractionToObservations(
              {
                fullDescription: officialProse.fullDescription,
                shortDescription: officialProse.shortDescription || '',
                topics: [],
                methods,
              },
              identity,
            )
          : [];
        if (observations.length === 0 && groundedLlmExtraction) {
          observations = descriptionExtractionToObservations(
            { ...groundedLlmExtraction, methods },
            identity,
          );
        }

        if (observations.length === 0) {
          // No usable description this run, but grounded methods (e.g. derived
          // from the stored description when the live page is an empty shell)
          // should still fill the field on their own - unless the page turned out
          // to belong to another person's lab, in which case its techniques are
          // as foreign as its prose (#2272).
          const foreignLabPage = groundedLlmExtraction
            ? extractedPageDescribesAnotherPersonsLab(groundedLlmExtraction, identity)
            : false;
          if (methods.length > 0 && !foreignLabPage) {
            const methodsObservation: ObservationInput = {
              entityType: 'researchEntity',
              entityId: identity.entityId,
              entityKey: identity.entityKey,
              sourceUrl: identity.sourceUrl,
              confidenceOverride: /\/profile\//i.test(page.url) ? 0.55 : 0.82,
              field: 'methods',
              value: methods,
            };
            await ctx.emit([methodsObservation, ...hashObservations]);
            observationCount += 1;
            entitiesObserved += 1;
          } else {
            await ctx.emit(hashObservations);
          }
          return;
        }

        const withCard = await this.withSynthesizedCard(observations);
        await ctx.emit([...withCard, ...descriptionHashObservations(withCard, hashObservations)]);
        observationCount += withCard.length;
        entitiesObserved += 1;
      } catch (error) {
        const message = sanitizeLogValue(error);
        ctx.log(`[${lab.slug || 'candidate'}] skipping description extraction: ${message}`);
      }
    });

    return {
      observationCount,
      entitiesObserved,
      notes: `Extracted source-backed descriptions for ${entitiesObserved} research entities (${contentUnchangedSkipped} content-unchanged skipped).`,
      metrics: { workPlanner: workPlannerMetrics },
    };
  }
}
