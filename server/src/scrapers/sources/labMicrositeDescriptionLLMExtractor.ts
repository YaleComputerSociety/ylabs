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
import type { DescriptionEntityKind } from '../../utils/researchHomeDescriptionSelection';
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
  computeVersionedContentHash,
  contentHashObservation,
  contentUnchanged,
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
  if (/^(?:n\/a|none|unknown|the lab|lab|laboratory|research)$/i.test(text)) return '';
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
  context: { entityId?: string; entityKey?: string; sourceUrl: string },
): ObservationInput[] {
  if (isRejectedDescriptionSourceUrl(context.sourceUrl)) return [];
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
    confidenceOverride: /\/profile\//i.test(context.sourceUrl) ? 0.55 : 0.82,
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

  const labName = usefulLabName(extraction.name);
  const isProfileSource = /\/profile\//i.test(context.sourceUrl);
  if (labName && !isProfileSource) {
    const nameBase = { ...base, confidenceOverride: LAB_NAME_CONFIDENCE };
    observations.push({ ...nameBase, field: 'name', value: labName });
    observations.push({ ...nameBase, field: 'displayName', value: labName });
  }
  return observations;
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
            'fullDescription: copy the page\'s own overview/about/mission prose describing what this research entity studies, verbatim (one or more consecutive sentences, exactly as written). shortDescription: copy a single verbatim sentence that best summarizes the work, or an empty string.',
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

  private async withSynthesizedCard(
    observations: ObservationInput[],
  ): Promise<ObservationInput[]> {
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
      callLLM: (llmInput) =>
        this.callCardLLM({ ...llmInput, apiKey, model: this.cardModel }),
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

        // Raw HTML covers both extraction paths below: the visible-text LLM path
        // and the deterministic embedded-JSON official-prose path (which reads
        // script-tag payloads htmlToText strips). Hashing raw HTML ensures an
        // embedded-prose-only change still re-runs extraction.
        const entityRef = {
          entityType: 'researchEntity' as const,
          entityId: serializedDocumentId(lab._id) || undefined,
          entityKey: lab.slug,
        };
        const contentHash = computeVersionedContentHash(
          page.html,
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
        const hashObservation = contentHashObservation(entityRef, page.url, contentHash);

        // Fast, faithful path: many Yale pages (medicine.yale.edu /lab and
        // /profile, etc.) are JS-rendered, so the visible-text LLM path sees an
        // empty shell — but the verbatim official description sits in an embedded
        // script-tag JSON payload that extractLabHomepageDescription() parses.
        // Use it before the LLM: cheaper, and it recovers descriptions the
        // plain-text path misses.
        const kind: DescriptionEntityKind = isFacultyResearchTextEntity({
          entityType: lab.entityType,
          kind: lab.kind,
        })
          ? 'person'
          : 'organization';

        const embedded = extractLabHomepageDescription(page.html, { kind });
        const officialProse = embedded?.description
          ? {
              fullDescription: embedded.description,
              shortDescription: embedded.shortDescription || '',
            }
          : extractOfficialResearchDescription(page.html, { kind });

        const pageText = htmlToText(page.html);
        const llmExtraction =
          pageText.length >= 120
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
        let methods = llmExtraction ? groundMethods(llmExtraction.methods, pageText) : [];
        const storedDescription = textValue(lab.fullDescription);
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
        if (observations.length === 0 && llmExtraction) {
          observations = descriptionExtractionToObservations(
            { ...groundDescriptionExtraction(llmExtraction, pageText), methods },
            identity,
          );
        }

        if (observations.length === 0) {
          // No usable description this run, but grounded methods (e.g. derived
          // from the stored description when the live page is an empty shell)
          // should still fill the field on their own.
          if (methods.length > 0) {
            const methodsObservation: ObservationInput = {
              entityType: 'researchEntity',
              entityId: identity.entityId,
              entityKey: identity.entityKey,
              sourceUrl: identity.sourceUrl,
              confidenceOverride: /\/profile\//i.test(page.url) ? 0.55 : 0.82,
              field: 'methods',
              value: methods,
            };
            await ctx.emit([methodsObservation, hashObservation]);
            observationCount += 1;
            entitiesObserved += 1;
          } else {
            await ctx.emit([hashObservation]);
          }
          return;
        }

        const withCard = await this.withSynthesizedCard(observations);
        await ctx.emit([...withCard, hashObservation]);
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
