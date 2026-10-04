/**
 * LabMicrositeUndergradLLMExtractor
 *
 * For every canonical ResearchEntity with a usable website URL, fetch the lab home
 * page (and a likely "people"/"members"/"join" sub-page if discoverable),
 * strip HTML to plain text, and ask an LLM (gpt-5-mini via OpenAI's
 * structured-output API) to extract evidence about undergrad access:
 *
 *   - `undergradAccessEvidence` (Object)    — evidence-shaped access assessment
 *   - `currentUndergradCount`   (Integer)   — only emitted when the LLM
 *                                              identified a members section
 *                                              (open prose is unreliable)
 *   - `undergradEvidenceQuote`  (String)    — verbatim quote from the page
 *                                              proving the verdict
 *   - `joinPageUrl`             (String)    — official join/application route
 *   - role, contact-instruction, and constraint quotes when present
 *
 * The scraper is deliberately conservative:
 *   - LLM-derived observations carry a 0.5 confidence override (low-trust)
 *     so manual edits and direct human signals always win.
 *   - A manual lock on `undergradAccessEvidence` suppresses only that observation.
 *   - Per-(websiteUrl, modelVersion) caching is used so reruns don't re-charge
 *     OpenAI for unchanged pages.
 *   - LLM call count is capped by `ctx.options.limit` (default 100). The
 *     `--only` filter (slug list) further restricts which labs we look at.
 *
 * I/O is fully injectable (`fetchPage`, `callLLM`, `userFinder`) so the
 * runtime can be exercised in tests without ever touching the network.
 */
import axios from 'axios';
import mongoose, { type QueryFilter } from 'mongoose';
import { sanitizeLogValue } from '../../utils/logSanitizer';
import { fetchPageWithPolicy } from '../utils/httpFetch';
import * as cheerio from 'cheerio';
import { plainTextContent } from '../utils/htmlText';
import { ResearchEntity } from '../../models/researchEntity';
import { Observation } from '../../models/observation';
import { listResearchEntityMergedInRows } from '../../services/researchEntityCanonicalTombstone';
import { isBenchmarkModeActive } from '../snapshotBenchmarkMode';
import { redactDirectContactInfo } from '../../utils/contactRedaction';
import { stripInvisibleFormatCharacters } from '../../utils/invisibleFormatCharacters';
import { openAiChatSampling } from '../../utils/openAiChatSampling';
import {
  quoteStatesAnUndergraduateAccessFact,
  rosterSnippetNamesAnUndergraduate,
} from '../undergradQuoteRelevance';
import { contactQuoteStatesAnInstruction } from '../contactInstructionQuoteAdmission';
import { pageListsPeople, rosterSnippetNamesAPerson } from '../undergradRosterEvidence';
import {
  deriveShortDescriptionFromFullDescription,
  fullDescriptionMeetsEvidenceBar,
  isFullDescriptionRestatementOfShortDescription,
  shortDescriptionQuality,
} from '../../utils/researchEntityDescriptionQuality';
import { publicResearchEntityDescriptionText } from '../../utils/researchEntityDescriptionText';
import {
  isOwnDepartmentUndergraduateResearchProgramme,
  joinPageUrlRefusal,
  joinRouteInvitation,
  joinRouteKind,
  joinRouteTextAdmits,
  joinRouteUrlRefusal,
  namesAnUnqualifiedStudentAudience,
  recruitingSentences,
  textInvitesUndergraduates,
  type JoinPageEntity,
  type JoinRouteRefusal,
} from '../undergradJoinPageAdmission';
import { isRejectedDescriptionSourceUrl } from './labMicrositeDescriptionLLMExtractor';
import {
  personProfileSourceNamesADifferentPerson,
  type ResearchEntityIdentity,
} from '../utils/personProfileEntityMatch';
import { UNDERGRAD_EXTRACTION_PROMPT, UNDERGRAD_EXTRACTION_PROMPT_HASH } from '../prompts';
import {
  createScraplingRenderedFetcher,
  measureRenderedFallback,
  measureRenderedFetch,
  summarizeFetchMetrics,
  type RenderedFetcher,
} from '../renderedFetch';
import { getCachedModelAnswer, setCached } from '../snapshotCache';
import {
  computeContentHash,
  computeVersionedContentHash,
  contentHashObservation,
  contentUnchanged,
  loadStoredContentHash,
} from '../contentHashGate';
import type {
  IScraper,
  ObservationInput,
  ScraperFetchMetric,
  ScraperContext,
  ScraperResult,
} from '../types';
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

const USER_AGENT = 'ylabs-scraper/1.0 (+https://yalelabs.io)';
const FETCH_TIMEOUT_MS = 10_000;
const MAX_PROMPT_CHARS = 50_000;
const DEFAULT_LIMIT = 100;
export const DEFAULT_MODEL = 'gpt-5-mini';

// Prompt text lives in server/src/scrapers/prompts/undergradExtraction.md; the
// content-hash gate keys on UNDERGRAD_EXTRACTION_PROMPT_HASH (sha256 of that
// file), so editing it re-extracts affected entities with no manual bump.
const SOURCE_KEY = 'lab-microsite-undergrad-llm';
const MAX_CANDIDATE_SUBPAGE_URLS = 8;
const MAX_SUBPAGES_FETCHED = 3;
// A manual lock on this field suppresses this lane's access observation outright,
// so `releaseRevisitableFieldLocksCore` lists it as lock-suppressed too.
const UNDERGRAD_ACCESS_EVIDENCE_FIELD = 'undergradAccessEvidence';
const UNDERGRAD_EVIDENCE_QUOTE_FIELD = 'undergradEvidenceQuote';
const MIN_READABLE_PAGE_TEXT_CHARS = 200;
// Part of the content-hash contract: bumping it makes an unchanged page re-derive its
// observations on the next read, served from the answer cache when one is held (#3789).
const OBSERVATION_DERIVATION_VERSION = 'join-route-invites-undergraduates-v4';

/** Path patterns we'll probe on the lab origin if the home page doesn't link
 *  to one. Ordered most-specific → least-specific. */
const SUBPAGE_PATH_HINTS = [
  '/people',
  '/members',
  '/team',
  '/lab-members',
  '/our-team',
  '/join',
  '/join-us',
  '/opportunities',
  '/undergraduates',
  '/undergrad',
];

/** Anchor-text matchers the home-page parser uses to follow a likely sub-page
 *  if one is linked. */
const SUBPAGE_ANCHOR_RE =
  /\b(people|members|team|lab\s*members|our\s*team|join|join\s*us|opportunities|undergrad(uates)?)\b/i;

// ---------------------------------------------------------------------------
// LLM schema + types (mirrors OpenAI structured-output JSON schema)
// ---------------------------------------------------------------------------

export type OpenToUndergrads = 'yes' | 'no' | 'unclear';
export type EvidenceSource = 'explicit_text' | 'members_section' | 'none';
export interface LLMExtraction {
  openToUndergrads: OpenToUndergrads;
  currentUndergradCount: number;
  currentUndergradEvidenceQuotes?: string[];
  evidenceQuote: string;
  evidenceSource: EvidenceSource;
  joinPageUrl: string | null;
  researchSummary?: string;
  methodsQuote?: string;
  topicsQuote?: string;
  undergradRoleQuote?: string;
  contactInstructionsQuote?: string;
  explicitConstraintQuote?: string;
}

export interface PromptSourcePage {
  url: string;
  text: string;
  rosterText?: string;
}

export const LAB_UNDERGRAD_RESPONSE_FORMAT = {
  type: 'json_schema' as const,
  json_schema: {
    name: 'lab_undergrad_extraction',
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        openToUndergrads: { type: 'string', enum: ['yes', 'no', 'unclear'] },
        currentUndergradCount: { type: 'integer', minimum: 0 },
        currentUndergradEvidenceQuotes: {
          type: 'array',
          items: { type: 'string' },
        },
        evidenceQuote: { type: 'string' },
        evidenceSource: {
          type: 'string',
          enum: ['explicit_text', 'members_section', 'none'],
        },
        joinPageUrl: { type: ['string', 'null'] },
        researchSummary: { type: 'string' },
        methodsQuote: { type: 'string' },
        topicsQuote: { type: 'string' },
        undergradRoleQuote: { type: 'string' },
        contactInstructionsQuote: { type: 'string' },
        explicitConstraintQuote: { type: 'string' },
      },
      required: [
        'openToUndergrads',
        'currentUndergradCount',
        'currentUndergradEvidenceQuotes',
        'evidenceQuote',
        'evidenceSource',
        'joinPageUrl',
        'researchSummary',
        'methodsQuote',
        'topicsQuote',
        'undergradRoleQuote',
        'contactInstructionsQuote',
        'explicitConstraintQuote',
      ],
    },
    strict: true,
  },
};

export const LAB_UNDERGRAD_SYSTEM_PROMPT = UNDERGRAD_EXTRACTION_PROMPT;

// ---------------------------------------------------------------------------
// Pure helpers (unit-testable, no I/O)
// ---------------------------------------------------------------------------

/**
 * Pure: turn a page's raw HTML into compact plain text suitable for an LLM
 * prompt. Strips `<script>`, `<style>`, `<noscript>`, collapses whitespace,
 * and truncates to MAX_PROMPT_CHARS so we stay well below model context.
 */
const PAGE_CHROME_SELECTOR =
  'script, style, noscript, svg, iframe, nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"], .breadcrumb, .breadcrumbs';

/**
 * The page's text without its navigation, header and footer. A site menu lists "Alumni" or
 * "Past members" beside every other section, so a roster read against the whole page sat
 * under that menu link and looked historical (#4430).
 */
export function htmlToRosterText(html: string): string {
  if (!html) return '';
  try {
    const $ = cheerio.load(html);
    $(PAGE_CHROME_SELECTOR).remove();
    return (plainTextContent($('body').toArray()) || '').replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}

export function htmlToPromptText(html: string): string {
  if (!html) return '';
  let $: cheerio.CheerioAPI;
  try {
    $ = cheerio.load(html);
  } catch {
    return String(html).slice(0, MAX_PROMPT_CHARS);
  }
  $('script, style, noscript, svg, iframe').remove();
  const text = plainTextContent($('body').toArray()) || plainTextContent($.root().toArray());
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > MAX_PROMPT_CHARS ? collapsed.slice(0, MAX_PROMPT_CHARS) : collapsed;
}

/**
 * Pure: discover candidate sub-page URLs given the home-page HTML and its
 * resolved URL. Returns same-host absolute URLs whose anchor text looks useful
 * for undergraduate-access evidence.
 */
export function discoverSubPageUrls(
  html: string,
  pageUrl: string,
  maxUrls: number = MAX_CANDIDATE_SUBPAGE_URLS,
): string[] {
  if (!html || maxUrls <= 0) return [];
  let $: cheerio.CheerioAPI;
  try {
    $ = cheerio.load(html);
  } catch {
    return [];
  }
  const found: string[] = [];
  const seen = new Set<string>();
  $('a').each((_i, el) => {
    if (found.length >= maxUrls) return;
    const text = plainTextContent(el).trim();
    const href = $(el).attr('href') || '';
    if (!text || !href) return;
    if (!SUBPAGE_ANCHOR_RE.test(text)) return;
    try {
      const abs = new URL(href, pageUrl).toString();
      if (!/^https?:\/\//i.test(abs)) return;
      // Only follow same-host links (don't chase off-site)
      const base = new URL(pageUrl);
      const dest = new URL(abs);
      if (dest.hostname.replace(/^www\./, '') !== base.hostname.replace(/^www\./, '')) {
        return;
      }
      const normalized = normalizeCandidateUrl(abs);
      if (seen.has(normalized)) return;
      seen.add(normalized);
      found.push(normalized);
    } catch {
      /* ignore malformed URL */
    }
  });
  return found;
}

/**
 * Backward-compatible helper for callers/tests that only need the first
 * discovered sub-page.
 */
export function discoverSubPageUrl(html: string, pageUrl: string): string | null {
  return discoverSubPageUrls(html, pageUrl, 1)[0] ?? null;
}

/**
 * Pure: build the list of candidate sub-page URLs to probe (origin + hint
 * paths). Used as a fallback when the home-page HTML doesn't expose a
 * link with a "people"/"members"/"join" anchor.
 */
export function candidateSubPageUrls(homeUrl: string): string[] {
  try {
    const u = new URL(homeUrl);
    return SUBPAGE_PATH_HINTS.map((p) => `${u.origin}${p}`);
  } catch {
    return [];
  }
}

/**
 * Pure: build a bounded, deduped crawl list. Home-page links win because they
 * preserve the site's own URL shape; origin-rooted fallback paths fill the
 * remaining budget.
 */
export function candidateCrawlUrls(
  homeHtml: string,
  homeUrl: string,
  maxUrls: number = MAX_CANDIDATE_SUBPAGE_URLS,
): string[] {
  if (maxUrls <= 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of [
    ...discoverSubPageUrls(homeHtml, homeUrl, maxUrls),
    ...candidateSubPageUrls(homeUrl),
  ]) {
    const normalized = normalizeCandidateUrl(url);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= maxUrls) break;
  }
  return out;
}

function normalizeCandidateUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    u.hash = '';
    return u.toString();
  } catch {
    return '';
  }
}

function normalizeKnownLabWebsiteUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    if (
      url.hostname.toLowerCase() === 'ursula.chem.yale.edu' &&
      /^\/~yanlab\/?$/i.test(url.pathname)
    ) {
      return 'https://yan.chem.yale.edu/';
    }
    return rawUrl;
  } catch {
    return rawUrl;
  }
}

const rejectedUndergradSourcePatterns = [
  /\/membership\/directory\/?$/i,
  /\/(?:people|faculty|directory|members)\/?$/i,
  /(?:^|\.)orcid\.org/i,
  /(?:^|\.)doi\.org/i,
  /(?:^|\.)openalex\.org/i,
  /(?:^|\.)crossref\.org/i,
  /reporter\.nih\.gov/i,
  /nsf\.gov/i,
  /api\.nsf\.gov/i,
];

function isRejectedUndergradSourceUrl(value: unknown): boolean {
  if (typeof value !== 'string') return true;
  const urlText = value.trim();
  if (!/^https?:\/\//i.test(urlText)) return true;
  try {
    const url = new URL(urlText);
    const hostPath = `${url.hostname}${url.pathname}`.replace(/\/+$/, '');
    return rejectedUndergradSourcePatterns.some((pattern) => pattern.test(hostPath));
  } catch {
    return true;
  }
}

/**
 * Pure: assemble the user-facing prompt body the LLM sees.
 */
export function buildLLMPrompt(
  groupName: string,
  homeUrl: string,
  homeText: string,
  subPageUrl: string | null,
  subPageText: string | null,
  additionalSubPages: PromptSourcePage[] = [],
): string {
  const safeGroupName = redactDirectContactInfo(groupName).slice(0, 240);
  const safeHomeUrl = redactDirectContactInfo(homeUrl).slice(0, 2048);
  const parts: string[] = [];
  parts.push(`Lab name: ${safeGroupName}`);
  parts.push(`Home page URL: ${safeHomeUrl}`);
  parts.push('');
  parts.push('--- HOME PAGE TEXT ---');
  parts.push(redactDirectContactInfo(homeText) || '(empty)');
  if (subPageUrl && subPageText) {
    const safeSubPageUrl = redactDirectContactInfo(subPageUrl).slice(0, 2048);
    parts.push('');
    parts.push(`--- SUB-PAGE TEXT (${safeSubPageUrl}) ---`);
    parts.push(redactDirectContactInfo(subPageText));
  }
  for (const page of additionalSubPages) {
    if (!page.url || !page.text) continue;
    const safePageUrl = redactDirectContactInfo(page.url).slice(0, 2048);
    parts.push('');
    parts.push(`--- SUB-PAGE TEXT (${safePageUrl}) ---`);
    parts.push(redactDirectContactInfo(page.text));
  }
  return parts.join('\n').slice(0, MAX_PROMPT_CHARS);
}

// The model has returned a page's zero-width spaces as NUL characters, so a roster line it
// copied verbatim no longer matched the page it came from (#4430).
const withoutControlCharacters = (text: string): string =>
  Array.from(text)
    .filter((char) => char.charCodeAt(0) >= 0x20 || /\s/.test(char))
    .join('');

const normalizeQuoteText = (text: string): string =>
  stripInvisibleFormatCharacters(withoutControlCharacters(text))
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * The fetched page a model quote was copied from, or null when no page contains it. The
 * model reads contact-redacted text, so a page matches on either form, and only
 * whitespace and typographic quote or dash differences are forgiven.
 */
export function pageContainingQuote(
  quote: string | undefined,
  pages: readonly PromptSourcePage[],
): PromptSourcePage | null {
  const needle = normalizeQuoteText(quote || '');
  if (!needle) return null;
  return (
    pages.find(
      (page) =>
        normalizeQuoteText(page.text).includes(needle) ||
        normalizeQuoteText(redactDirectContactInfo(page.text)).includes(needle),
    ) ?? null
  );
}

export interface LiveEvidenceQuote {
  value: string;
  sourceUrl: string;
}

export type LiveEvidenceQuoteLoaderFn = (entityKey: string) => Promise<LiveEvidenceQuote | null>;

type LaneQuoteObservationRow = { value?: unknown; sourceUrl?: unknown };

function liveEvidenceQuoteFromRow(row: LaneQuoteObservationRow | null): LiveEvidenceQuote | null {
  const value = typeof row?.value === 'string' ? row.value.trim() : '';
  const sourceUrl = typeof row?.sourceUrl === 'string' ? row.sourceUrl.trim() : '';
  return value && sourceUrl ? { value, sourceUrl } : null;
}

function latestLaneQuoteObservation(
  identity: QueryFilter<unknown>,
): Promise<LaneQuoteObservationRow | null> {
  return Observation.findOne({
    entityType: 'researchEntity',
    sourceName: SOURCE_KEY,
    field: UNDERGRAD_EVIDENCE_QUOTE_FIELD,
    superseded: false,
    ...identity,
  })
    .sort({ observedAt: -1 })
    .select('value sourceUrl')
    .lean<LaneQuoteObservationRow>();
}

/**
 * The lane quote the survivor resolves to, which may sit on a row merged into it (#3831). The
 * materializer reads a survivor over every archived row whose tombstone chain reaches it and lets
 * a loser's observation fill a field the survivor holds no evidence for, so a quote whose only
 * evidence is on a loser still serves. The survivor's own observation is read first because it
 * displaces a loser's; a withdrawal the read emits is the survivor's own, so it clears the quote.
 * Otherwise only the loser observation the stored quote's provenance names is read, because the
 * materializer pins a loser-backed field to that loser, so checking any other quote would judge
 * one quote and clear a different one.
 */
export const defaultLiveEvidenceQuoteLoader: LiveEvidenceQuoteLoaderFn = async (entityKey) => {
  if (isBenchmarkModeActive() || mongoose.connection.readyState !== 1) return null;
  const survivor = await ResearchEntity.findOne({ slug: entityKey, archived: { $ne: true } })
    .select(`_id fieldProvenance.${UNDERGRAD_EVIDENCE_QUOTE_FIELD}`)
    .lean<{
      _id: mongoose.Types.ObjectId;
      fieldProvenance?: Record<string, { observationId?: unknown } | undefined>;
    }>();
  const ownIdentity: QueryFilter<unknown> = survivor
    ? { $or: [{ entityKey }, { entityId: survivor._id }] }
    : { entityKey };
  const own = await latestLaneQuoteObservation(ownIdentity);
  if (own || !survivor) return liveEvidenceQuoteFromRow(own);
  const backingObservationId = String(
    survivor.fieldProvenance?.[UNDERGRAD_EVIDENCE_QUOTE_FIELD]?.observationId ?? '',
  );
  if (!mongoose.isValidObjectId(backingObservationId)) return null;
  const mergedIn = await listResearchEntityMergedInRows(survivor._id);
  if (mergedIn.length === 0) return null;
  const loserSlugs = mergedIn.map((row) => row.slug).filter((slug): slug is string => !!slug);
  return liveEvidenceQuoteFromRow(
    await latestLaneQuoteObservation({
      _id: new mongoose.Types.ObjectId(backingObservationId),
      $or: [
        { entityId: { $in: mergedIn.map((row) => row._id) } },
        { entityId: null, entityKey: { $in: loserSlugs } },
      ],
    }),
  );
};

export function pageUrlIdentity(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    return `${host}${parsed.pathname.replace(/\/+$/, '')}${parsed.search}`;
  } catch {
    return url.trim();
  }
}

export function evidenceQuoteIsWithdrawnByRead(
  live: LiveEvidenceQuote,
  readPages: readonly PromptSourcePage[],
): boolean {
  const citedIdentity = pageUrlIdentity(live.sourceUrl);
  const citedPage = readPages.find((page) => pageUrlIdentity(page.url) === citedIdentity);
  if (!citedPage || normalizeQuoteText(citedPage.text).length < MIN_READABLE_PAGE_TEXT_CHARS) {
    return false;
  }
  return pageContainingQuote(live.value, pagesWithinEntityScope(readPages)) === null;
}

/**
 * A stored quote that a read keeps, but on a page other than the one it cites (#3831).
 * Observations written before #3679 cite the page the lane was handed, usually the entity's own
 * profile, so the page check reads that profile rather than the program page the words are on.
 * The lane restates its own evidence from the page that carries it: the same value, cited to that
 * page, as a latest-wins observation. No field is written directly.
 */
export function evidenceQuoteRecitationObservation(
  entityKey: string,
  live: LiveEvidenceQuote,
  readPages: readonly PromptSourcePage[],
): ObservationInput | null {
  const scopedPages = pagesWithinEntityScope(readPages);
  const citedIdentity = pageUrlIdentity(live.sourceUrl);
  const citedPages = scopedPages.filter((page) => pageUrlIdentity(page.url) === citedIdentity);
  if (pageContainingQuote(live.value, citedPages)) return null;
  const carrying = pageContainingQuote(live.value, scopedPages);
  if (!carrying) return null;
  return {
    entityType: 'researchEntity',
    entityKey,
    sourceUrl: carrying.url,
    field: UNDERGRAD_EVIDENCE_QUOTE_FIELD,
    value: live.value,
    confidenceOverride: 0.5,
  };
}

export function evidenceQuoteWithdrawalObservation(
  entityKey: string,
  live: LiveEvidenceQuote,
): ObservationInput {
  return {
    entityType: 'researchEntity',
    entityKey,
    sourceUrl: live.sourceUrl,
    field: UNDERGRAD_EVIDENCE_QUOTE_FIELD,
    value: '',
    assertsNoValueFor: [UNDERGRAD_EVIDENCE_QUOTE_FIELD],
    confidenceOverride: 0.5,
  };
}

const LANDING_PAGE_SEGMENT = /^(?:home|index(?:\.\w+)?|welcome|main|default(?:\.\w+)?)$/i;

function sectionPrefix(url: string): { host: string; prefix: string } | null {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1];
    if (last && (LANDING_PAGE_SEGMENT.test(last) || last.includes('.'))) segments.pop();
    return {
      host: parsed.host.toLowerCase(),
      prefix: segments.length ? `/${segments.join('/')}` : '',
    };
  } catch {
    return null;
  }
}

/**
 * The fetched pages that belong to this entity. A home page with its own path, such as a center
 * that lives at `/southasia` on a shared host, can link into a sibling program's section of the
 * same host, and a quote from there describes that program rather than this one (#3764).
 */
export function pagesWithinEntityScope(pages: readonly PromptSourcePage[]): PromptSourcePage[] {
  const home = pages[0] ? sectionPrefix(pages[0].url) : null;
  if (!home || !home.prefix) return [...pages];
  return pages.filter((page, index) => {
    if (index === 0) return true;
    const candidate = sectionPrefix(page.url);
    if (!candidate || candidate.host !== home.host) return false;
    return candidate.prefix === home.prefix || candidate.prefix.startsWith(`${home.prefix}/`);
  });
}

const PAGE_QUOTE_FIELDS = [
  'evidenceQuote',
  'undergradRoleQuote',
  'contactInstructionsQuote',
  'explicitConstraintQuote',
] as const;

export function quoteFieldsNotOnPage(
  extraction: LLMExtraction,
  pages: readonly PromptSourcePage[],
): string[] {
  const fields: string[] = PAGE_QUOTE_FIELDS.filter(
    (field) => (extraction[field] || '').trim() && !pageContainingQuote(extraction[field], pages),
  );
  (extraction.currentUndergradEvidenceQuotes ?? []).forEach((quote, index) => {
    if ((quote || '').trim() && !pageContainingQuote(quote, pages)) {
      fields.push(`currentUndergradEvidenceQuotes[${index}]`);
    }
  });
  return fields;
}

export function sourceUrlForExtraction(
  homePage: PromptSourcePage,
  subPages: PromptSourcePage[],
  extraction: LLMExtraction,
): string {
  const quoteCandidates = [
    extraction.evidenceQuote,
    extraction.undergradRoleQuote,
    extraction.contactInstructionsQuote,
    extraction.explicitConstraintQuote,
    extraction.methodsQuote,
    extraction.topicsQuote,
  ]
    .map((q) => (q || '').trim())
    .filter(Boolean);
  for (const quote of quoteCandidates) {
    const matchingSubPage = subPages.find((page) => page.text.includes(quote));
    if (matchingSubPage) return matchingSubPage.url;
    if (homePage.text.includes(quote)) return homePage.url;
  }
  return homePage.url;
}

/**
 * Recency gate. Lab "people" pages fold alumni / former members / past
 * undergraduate researchers into one roster with no date scoping (#1209/#1314),
 * so a stored count silently absorbs entries that are unambiguously historical.
 * A backing snippet matching any of these markers is not a current researcher.
 */
const HISTORICAL_UNDERGRAD_EVIDENCE_PATTERNS: RegExp[] = [
  /\bformer(ly)?\b/i,
  /\balumn(i|us|ae|a)\b/i,
  /\bgraduated\b/i,
  /\bpast\s+(under)?grad/i,
  /\bprevious(ly)?\b/i,
  /\bvisiting\s+(under)?grad/i,
  /\b(?:19|20)\d{2}\s*[-–—]\s*(?:19|20)\d{2}\b/,
  /\b\d{1,2}\/(?:19|20)\d{2}\s*[-\u2013\u2014]\s*\d{1,2}\/(?:19|20)\d{2}\b/,
  /\b(?:19|20)\d{2}\/\d{1,2}\s*[-\u2013\u2014]\s*(?:19|20)\d{2}\/\d{1,2}\b/,
  /\bnow\s+(?!accept|recruit|hir|seek|welcom|tak|open|avail|enroll|offer|host)(?:a\b|an\b|the\b|at\b|with\b|working|serv|senior|director|professor|assistant|associate|principal|chief|head|vp|ceo|cto|president|manager|scientist|research|postdoc|resident|fellow|md\b|phd\b|student|pursuing|completing|attend)/i,
  /\b(?:associate|analyst|consultant|engineer|scientist|manager|director|officer|founder|president|attorney|physician)\s+at\s+(?!yale\b)/i,
];

/**
 * Institution gate. Yale lab rosters also list visiting undergraduates from
 * other schools (#1314). A Yale lab's default context is Yale, so an unqualified
 * undergrad is presumed to be a Yale undergrad; we only exclude when the backing
 * snippet names a clearly non-Yale institution or marks the person as visiting.
 */
const NON_YALE_INSTITUTION_PATTERNS: RegExp[] = [
  /\bvisiting\s+(?:[a-z-]+\s+){0,2}(?:undergrad\w*|students?|scholars?|researchers?|interns?|fellows?)\b/i,
  /\bvisiting\s*(?:,|from\b)/i,
  /\buniversit(?:y|ies)\b/i,
  /\bpolytechnic\b/i,
  /\binstitute\s+of\s+technolog/i,
  /\bgeorgia\s+tech\b/i,
  /\bjohns\s+hopkins\b/i,
  /\bharvey\s+mudd\b/i,
  /\bemory\b/i,
  /\b(?:UCLA|USC|MIT|UConn|UCSD|UCSB|UCSC|NYU|UPenn|UMich|Caltech)\b/,
];

export function isHistoricalUndergradEvidence(quote?: string): boolean {
  const text = (quote || '').trim();
  if (!text) return false;
  return HISTORICAL_UNDERGRAD_EVIDENCE_PATTERNS.some((pattern) => pattern.test(text));
}

export function namesNonYaleInstitution(quote?: string): boolean {
  const text = (quote || '').trim();
  if (!text) return false;
  if (/\byale\b/i.test(text)) return false;
  return NON_YALE_INSTITUTION_PATTERNS.some((pattern) => pattern.test(text));
}

function isCurrentYaleUndergradEvidence(quote?: string): boolean {
  return !isHistoricalUndergradEvidence(quote) && !namesNonYaleInstitution(quote);
}

const HISTORICAL_ROSTER_SECTION_MARKER =
  /\b(?:(?:lab|group|team)\s+)?alumn(?:i|ae|us|a)\b|\b(?:former|past|previous)\s+(?:[\w-]+\s+){0,2}?(?:members?|students?|undergrad(?:uate)?s?|researchers?|trainees?|interns?|people|fellows?|associates?|post-?docs?)\b|\b(?:former|past|previous)\s*:|\bwhere\s+are\s+they\s+now\b/gi;

const CURRENT_ROSTER_SECTION_MARKER =
  /\bcurrent\b(?!\s*:?\s*(?:position|role|affiliation|job|employer|title|institution|address|location)\b)(?:\s+(?:(?:lab|group|team)\s+)?(?:members?|students?|undergrad(?:uate)?s?|researchers?|trainees?|team))?|\b(?:lab|group|team)\s+members\b|\b(?:our|the|meet\s+the)\s+team\b|\bmembers\b|\bpeople\b|\bprincipal\s+investigators?\b/gi;

// Site builders glue adjacent blocks without a space ("Example UniversityAlumniCasey"), so
// a heading would not stand on a word boundary; both sides are split the same way.
const rosterText = (text: string): string =>
  normalizeQuoteText(text).replace(/([a-z])([A-Z])/g, '$1 $2');

interface RosterSectionMarker {
  start: number;
  end: number;
  historical: boolean;
}

const ROSTER_TAB_LABEL =
  /(?:principal\s+investigators?|post-?docs?|post-?doctoral\s+(?:researchers?|fellows?|associates?|scholars?)|graduate\s+students?|ph\.?\s?d\.?\s+students?|undergrad(?:uate)?\s+(?:students?|researchers?)|research\s+(?:staff|scientists?|associates?)|staff|faculty(?:\s+collaborators?)?|collaborators?|visiting\s+(?:scholars?|students?)|lab\s+managers?)/gi;

const TRAILING_TAB_LABEL_RUN = new RegExp(
  `(?:${ROSTER_TAB_LABEL.source}\\s*[|/,•·]?\\s*){2,}$`,
  'i',
);

// A filtered roster page renders its section names as a tab strip ("Graduate Students
// Undergraduate Students Alumni") before the panels, so the strip's "Alumni" sits before every
// current member (#4430). A strip is a run of section labels that the page repeats as headings
// after it, which an alumni heading that follows a section's members never is.
function isTabStripLabel(text: string, start: number, end: number): boolean {
  const run = text.slice(Math.max(0, start - 400), start).match(TRAILING_TAB_LABEL_RUN)?.[0];
  if (!run) return false;
  const after = text.slice(end).toLowerCase();
  const labels = Array.from(run.matchAll(ROSTER_TAB_LABEL), (match) => match[0].toLowerCase());
  return labels.filter((label) => after.includes(label)).length >= 2;
}

function rosterSectionMarkers(text: string): RosterSectionMarker[] {
  const historical = Array.from(text.matchAll(HISTORICAL_ROSTER_SECTION_MARKER), (match) => ({
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
    historical: true,
  }));
  const current = Array.from(text.matchAll(CURRENT_ROSTER_SECTION_MARKER), (match) => ({
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
    historical: false,
  })).filter((marker) =>
    historical.every((span) => marker.end <= span.start || marker.start >= span.end),
  );
  return [
    ...historical.filter((marker) => !isTabStripLabel(text, marker.start, marker.end)),
    ...current,
  ].sort((left, right) => left.start - right.start);
}

/**
 * Whether a roster line the model counted sits only under an alumni or former-members
 * heading (#4430). A lab page lists alumni as bare names below that heading, so the line
 * carries no marker of its own and `isHistoricalUndergradEvidence` cannot see it; one
 * served row counted seven undergraduates who were all listed under "Alumni". The line is
 * judged by the nearest section marker before each place it appears, and is historical
 * only when every appearance is, because a site that renders its roster twice (a tab
 * strip, then the panel) puts the first copy after the tab labels.
 *
 * Each page is read in one form: the roster text without navigation when the line is on
 * it, and the unredacted form before the redacted one, because contact redaction can
 * swallow a heading glued to an address ("lab@example.eduAlumni").
 */
export function rosterSnippetSitsUnderAHistoricalHeading(
  snippet: string | undefined,
  pages: readonly PromptSourcePage[],
): boolean {
  const needle = rosterText(snippet || '');
  if (!needle) return false;
  const formCarryingNeedle = (raw: string | undefined): string | undefined =>
    [raw || '', redactDirectContactInfo(raw || '')]
      .map(rosterText)
      .find((text) => text.includes(needle));
  let appearances = 0;
  for (const page of pages) {
    const text = formCarryingNeedle(page.rosterText) ?? formCarryingNeedle(page.text);
    if (!text) continue;
    const markers = rosterSectionMarkers(text);
    for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) {
      appearances += 1;
      const nearest = markers.filter((marker) => marker.start < at + needle.length).pop();
      if (!nearest?.historical) return false;
    }
  }
  return appearances > 0;
}

const NON_UNDERGRADUATE_AUDIENCE =
  /\b(?:ph\.?\s?d\.?|doctoral|graduate\s+students?|grad\s+students?|post-?docs?|post-?doctora(?:l|tes?)|post-?graduates?|post-?bac\w*|staff|technicians?|(?:research|visiting)\s+scientists?|patients?|participants?|volunteers?|parents|families|residents|fellows|medical\s+students?|master'?s)\b/i;

const UNDERGRADUATE_OR_OPEN_AUDIENCE =
  /\b(?:undergrad\w*|yale\s+college|college\s+students?|high\s+school|(?:all|every)\s+levels?|anyone|everyone|trainees?)\b/i;

/**
 * Whether a join page recruits only audiences other than undergraduates (#4430). One
 * served signal was a lab "Join our Team" page "on the lookout for motivated
 * postgraduates, graduate students, post-doctorates and visiting scientists". Only
 * recruiting sentences are read, so navigation chrome naming patients or staff is not
 * an audience, and a page that mentions undergraduates anywhere is never refused.
 */
export function joinPageRecruitsOnlyNonUndergraduates(text: string | undefined): boolean {
  const normalized = normalizeQuoteText(text || '');
  if (!normalized || /\bundergrad|\byale\s+college\b/i.test(normalized)) return false;
  const recruiting = recruitingSentences(normalized);
  if (
    recruiting.some(
      (sentence) =>
        UNDERGRADUATE_OR_OPEN_AUDIENCE.test(sentence) ||
        namesAnUnqualifiedStudentAudience(sentence),
    )
  ) {
    return false;
  }
  return recruiting.some((sentence) => NON_UNDERGRADUATE_AUDIENCE.test(sentence));
}

export type LaneJoinPageRefusal =
  | JoinRouteRefusal
  | 'join-page-not-read'
  | 'join-page-outside-the-entity-scope'
  | 'join-page-invites-no-one'
  | 'join-page-recruits-only-non-undergraduates'
  | 'home-profile-or-member-listing-does-not-invite-undergraduates'
  | 'join-page-names-no-undergraduate-audience';

const SHARED_INSTITUTIONAL_HOST_LABEL = /(?:lab|labs|group|project)/i;

// A school or center host publishes many entities in sibling sections, so a page outside
// the row's section belongs to another entity there; a lab's own host does not, and a
// lab site whose home is `/about` still owns its `/contact` page.
function isSharedInstitutionalHost(url: string): boolean {
  try {
    const labels = new URL(url).hostname
      .toLowerCase()
      .replace(/^www\./, '')
      .split('.');
    return (
      labels.length === 3 &&
      labels[1] === 'yale' &&
      labels[2] === 'edu' &&
      !SHARED_INSTITUTIONAL_HOST_LABEL.test(labels[0])
    );
  } catch {
    return false;
  }
}

/**
 * Why the join page the model named is not an undergraduate route for this row (#4430).
 * The page must be one the lane read, which `run` ensures by fetching a named page the
 * crawl skipped, so a URL that does not resolve is refused: three served signals cited
 * such a URL, and each answered 404. On a shared school or center host the page must sit
 * in the row's own section, the scope `pagesWithinEntityScope` applies to quotes, and it
 * must invite someone: a roster page offered as the join page lists members and recruits
 * no one. A home page, profile or member listing must invite undergraduates by name, and
 * any other page must name an audience that can include them, so a generic hiring or
 * "contact us if interested" line stays contact evidence (#4543).
 */
export function laneJoinPageRefusal(
  joinPageUrl: string | null | undefined,
  sourcePages: readonly PromptSourcePage[],
  entity?: JoinPageEntity,
): LaneJoinPageRefusal | null {
  const urlRefusal = joinPageUrlRefusal(joinPageUrl, entity);
  if (urlRefusal) return urlRefusal;
  const identity = pageUrlIdentity(String(joinPageUrl));
  const page = sourcePages.find((candidate) => pageUrlIdentity(candidate.url) === identity);
  if (!page) return 'join-page-not-read';
  const isOwnDepartmentProgramme =
    isOwnDepartmentUndergraduateResearchProgramme(page.url, entity) &&
    /\bundergrad|\byale\s+college\b/i.test(page.text);
  if (
    sourcePages[0] &&
    isSharedInstitutionalHost(sourcePages[0].url) &&
    !pagesWithinEntityScope(sourcePages).includes(page) &&
    !isOwnDepartmentProgramme
  ) {
    return 'join-page-outside-the-entity-scope';
  }
  const routeRefusal = joinRouteUrlRefusal(joinPageUrl, entity);
  if (routeRefusal) return routeRefusal;
  if (recruitingSentences(page.text).length === 0) return 'join-page-invites-no-one';
  if (joinPageRecruitsOnlyNonUndergraduates(page.text)) {
    return 'join-page-recruits-only-non-undergraduates';
  }
  if (isOwnDepartmentProgramme) return null;
  const kind = joinRouteKind(page.url, entity);
  if (joinRouteTextAdmits(kind, page.text)) return null;
  return kind === 'join-page'
    ? 'join-page-names-no-undergraduate-audience'
    : 'home-profile-or-member-listing-does-not-invite-undergraduates';
}

/**
 * The sentence on an admitted join page that invites undergraduates, recorded beside the
 * access verdict so the materializer can judge the page on its own words (#4543).
 */
export function joinRouteInvitationOnPage(
  joinPageUrl: string,
  pages: readonly PromptSourcePage[],
  entity?: JoinPageEntity,
): string | null {
  const identity = pageUrlIdentity(joinPageUrl);
  const page = pages.find((candidate) => pageUrlIdentity(candidate.url) === identity);
  return page ? joinRouteInvitation(joinRouteKind(page.url, entity), page.text) : null;
}

/**
 * The join route a read emits: the page the model named when it is admissible, and
 * otherwise the home page or profile carrying the read's own access quote when that quote
 * invites undergraduates by name, as a profile saying "undergraduates interested in joining
 * my group should contact me" does while the model named its department's jobs page
 * (#4543). A read whose model named no join page emits none.
 */
export function admissibleJoinRoute(
  extraction: Pick<LLMExtraction, 'joinPageUrl' | 'openToUndergrads'>,
  evidenceQuote: { text: string; sourceUrl: string } | null,
  pages: readonly PromptSourcePage[],
  entity?: JoinPageEntity,
): string {
  if (!extraction.joinPageUrl) return '';
  if (!laneJoinPageRefusal(extraction.joinPageUrl, pages, entity)) return extraction.joinPageUrl;
  if (
    extraction.openToUndergrads === 'yes' &&
    evidenceQuote &&
    joinRouteKind(evidenceQuote.sourceUrl, entity) === 'home-or-profile' &&
    textInvitesUndergraduates(evidenceQuote.text) &&
    !laneJoinPageRefusal(evidenceQuote.sourceUrl, pages, entity)
  ) {
    return evidenceQuote.sourceUrl;
  }
  return '';
}

/**
 * Fail-closed recency + institution gate for `currentUndergradCount`. The raw
 * LLM integer is never trusted on its own because the roster it counts mixes
 * current Yale undergrads with alumni and non-Yale visiting undergrads (#1314).
 *
 *   - When the LLM supplies a per-person `currentUndergradEvidenceQuotes` roster
 *     (the strengthened prompt requires one snippet per counted undergrad), the
 *     count is derived from the distinct snippets that clear both gates, so a line the
 *     model listed twice is one person.
 *   - Each snippet must also pass rosterSnippetNamesAnUndergraduate: a bare name
 *     counts, while a staff title, a graduate role or a member's own degree does not
 *     (#3789); and rosterSnippetNamesAPerson, so a section heading counts no one (#4430).
 *   - With no roster the count is zero: the bare LLM integer backed 13 of 20 stored
 *     counts on a hand-read, so it is never trusted on its own (#3789).
 */
export function deriveCurrentUndergradCount(extraction: LLMExtraction): number {
  return distinctRosterLines(extraction.currentUndergradEvidenceQuotes).filter(
    (quote) => isAdmissibleRosterLine(quote) && !isHistoricalUndergradEvidence(quote),
  ).length;
}

function isAdmissibleRosterLine(quote: string): boolean {
  return (
    rosterSnippetNamesAPerson(quote) &&
    rosterSnippetNamesAnUndergraduate(quote) &&
    !namesNonYaleInstitution(quote)
  );
}

function distinctRosterLines(quotes: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  return (Array.isArray(quotes) ? quotes : []).filter((quote) => {
    const key = normalizeQuoteText(quote || '').toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface RosterUndergraduateEvidence {
  count: number;
  sourceUrl: string;
}

export interface RosterUndergraduateSplit {
  current: RosterUndergraduateEvidence | null;
  past: RosterUndergraduateEvidence | null;
}

function rosterEvidenceFromLines(
  lines: readonly { quote: string; pages: PromptSourcePage[] }[],
): RosterUndergraduateEvidence | null {
  if (lines.length === 0) return null;
  const coverage = new Map<PromptSourcePage, number>();
  for (const line of lines) {
    for (const page of line.pages) coverage.set(page, (coverage.get(page) ?? 0) + 1);
  }
  const [citedPage] = Array.from(coverage.entries()).reduce(
    (best, entry) => (entry[1] > best[1] ? entry : best),
    Array.from(coverage.entries())[0],
  );
  return { count: lines.length, sourceUrl: citedPage.url };
}

/**
 * The undergraduates a read's roster lists, split into current members and alumni (#4430).
 * A line counts only on a fetched page that lists people (`pageListsPeople`), and the count
 * cites that page: the lane used to cite the page its access quote came from, so a correct
 * roster count served a join or home page that lists no one. A line under an alumni or
 * former-members heading, or marked as historical itself, is past-hosting evidence: the
 * owner keeps it as "has hosted undergraduate researchers" and it never counts as current.
 */
export function splitRosterUndergraduates(
  extraction: LLMExtraction,
  pages: readonly PromptSourcePage[],
): RosterUndergraduateSplit {
  const current: { quote: string; pages: PromptSourcePage[] }[] = [];
  const past: { quote: string; pages: PromptSourcePage[] }[] = [];
  for (const quote of distinctRosterLines(extraction.currentUndergradEvidenceQuotes)) {
    if (!isAdmissibleRosterLine(quote)) continue;
    const carrying = pages.filter(
      (page) =>
        pageContainingQuote(quote, [page]) !== null &&
        pageListsPeople(page.url, page.rosterText || page.text),
    );
    if (carrying.length === 0) continue;
    const historical =
      isHistoricalUndergradEvidence(quote) ||
      rosterSnippetSitsUnderAHistoricalHeading(quote, carrying);
    (historical ? past : current).push({ quote, pages: carrying });
  }
  return { current: rosterEvidenceFromLines(current), past: rosterEvidenceFromLines(past) };
}

export const ROSTER_ALUMNI_PROGRAM_NAME = 'Lab roster alumni';

/**
 * Pure: turn an LLMExtraction into the ObservationInput list the materializer
 * will consume. Implements the rules:
 *
 *   - undergradAccessEvidence: emitted iff openToUndergrads is 'yes' or 'no';
 *     skipped on 'unclear', and skipped unless its quote is on a fetched page. Confidence override 0.5 (LLM-based, low-trust).
 *   - currentUndergradCount: emitted on every read, and zero when no grounded
 *     current roster line on a page that lists people survives the gates in
 *     splitRosterUndergraduates; a positive count cites that roster page. The field
 *     is latest-wins, so a re-read replaces a stale positive (#3789). A zero is
 *     withheld when readIsComplete is false, so a sub-page the home page links to
 *     that failed to fetch cannot erase a count it backed. Confidence 0.5.
 *   - pastUndergradAdvisees: emitted when the roster lists undergraduate alumni, as
 *     one entry counting them, cited to the roster page (#4430). Confidence 0.5.
 *   - every quote field: emitted only when the quote is on a fetched page, and
 *     cited to that page (#3592).
 *   - undergradEvidenceQuote: emitted iff evidenceQuote is non-empty, plausible,
 *     and passes the same recency/institution gate as currentUndergradCount, so
 *     a historical or non-Yale snippet never gets displayed as current evidence.
 *     Confidence 0.5.
 *   - joinPageUrl: emitted on every read like currentUndergradCount, empty when the read
 *     found no admissible join page, so a re-read replaces a join page an earlier read
 *     named (#4430); withheld under the same incomplete-read rule.
 *   - lastObservedAt: always emitted (to refresh the freshness clock).
 */
export function extractionToObservations(
  groupSlug: string,
  sourceUrl: string,
  extraction: LLMExtraction,
  observedAt: Date = new Date(),
  sourceContext: {
    sourceUrls?: string[];
    quoteSourceUrl?: string;
    sourceTexts?: string[];
    sourcePages?: PromptSourcePage[];
    entityIdentity?: ResearchEntityIdentity;
    entityShape?: JoinPageEntity;
    joinPages?: PromptSourcePage[];
    readIsComplete?: boolean;
  } = {},
): ObservationInput[] {
  const sourceUrls = sourceContext.sourceUrls?.filter(Boolean) ?? [sourceUrl];
  const quoteSourceUrl = sourceContext.quoteSourceUrl || sourceUrl;
  const pages = pagesWithinEntityScope(sourceContext.sourcePages ?? []);
  const quoteOnPage = (quote: string | undefined) => {
    const text = (quote || '').trim();
    const page = pageContainingQuote(text, pages);
    return page ? { text, sourceUrl: page.url } : null;
  };
  const evidenceQuote = quoteOnPage(extraction.evidenceQuote);
  const base = {
    entityType: 'researchEntity' as const,
    entityKey: groupSlug,
    sourceUrl,
  };
  const out: ObservationInput[] = [];
  const joinCandidatePages = [
    ...(sourceContext.sourcePages ?? []),
    ...(sourceContext.joinPages ?? []),
  ];
  const admissibleJoinPageUrl = admissibleJoinRoute(
    extraction,
    evidenceQuote,
    joinCandidatePages,
    sourceContext.entityShape,
  );
  const joinPageInvitation = admissibleJoinPageUrl
    ? joinRouteInvitationOnPage(
        admissibleJoinPageUrl,
        joinCandidatePages,
        sourceContext.entityShape,
      )
    : null;

  if (extraction.openToUndergrads === 'yes' && evidenceQuote) {
    out.push({
      ...base,
      field: 'undergradAccessEvidence',
      value: {
        openToUndergrads: extraction.openToUndergrads,
        evidenceSource: extraction.evidenceSource,
        evidenceQuote: extraction.evidenceQuote,
        sourceUrls,
        quoteSourceUrl: evidenceQuote.sourceUrl,
        ...(joinPageInvitation
          ? {
              joinPageUrl: admissibleJoinPageUrl,
              joinPageInvitation: redactDirectContactInfo(joinPageInvitation).slice(0, 500),
            }
          : {}),
      },
      confidenceOverride: 0.5,
    });
  } else if (extraction.openToUndergrads === 'no' && evidenceQuote) {
    out.push({
      ...base,
      field: 'undergradAccessEvidence',
      value: {
        openToUndergrads: extraction.openToUndergrads,
        evidenceSource: extraction.evidenceSource,
        evidenceQuote: extraction.evidenceQuote,
        sourceUrls,
        quoteSourceUrl: evidenceQuote.sourceUrl,
      },
      confidenceOverride: 0.5,
    });
  }
  // 'unclear' → no observation

  const roster = splitRosterUndergraduates(extraction, pages);
  if (roster.current || sourceContext.readIsComplete !== false) {
    out.push({
      ...base,
      sourceUrl: roster.current?.sourceUrl ?? sourceUrl,
      field: 'currentUndergradCount',
      value: roster.current?.count ?? 0,
      confidenceOverride: 0.5,
    });
  }
  if (roster.past) {
    out.push({
      ...base,
      sourceUrl: roster.past.sourceUrl,
      field: 'pastUndergradAdvisees',
      value: [{ programName: ROSTER_ALUMNI_PROGRAM_NAME, count: roster.past.count }],
      confidenceOverride: 0.5,
    });
  }

  if (
    evidenceQuote &&
    quoteStatesAnUndergraduateAccessFact(evidenceQuote.text) &&
    isCurrentYaleUndergradEvidence(evidenceQuote.text)
  ) {
    out.push({
      ...base,
      sourceUrl: evidenceQuote.sourceUrl,
      field: 'undergradEvidenceQuote',
      value: redactDirectContactInfo(evidenceQuote.text).slice(0, 500),
      confidenceOverride: 0.5,
    });
  }

  if (admissibleJoinPageUrl || sourceContext.readIsComplete !== false) {
    out.push({
      ...base,
      sourceUrl: admissibleJoinPageUrl || sourceUrl,
      field: 'joinPageUrl',
      value: admissibleJoinPageUrl,
      confidenceOverride: 0.5,
    });
  }

  const researchSummary = cleanResearchSummary(extraction.researchSummary);
  const studentReadyDescription =
    researchSummary &&
    !isRejectedDescriptionSourceUrl(quoteSourceUrl) &&
    // The sibling description lane has gated on this since #688; this lane never
    // did, so a crawled page belonging to a different person could supply this
    // row's research prose (#2570). An absent identity carries no tokens to check
    // and so is allowed, the same way the guard allows a URL with no readable name.
    !personProfileSourceNamesADifferentPerson(quoteSourceUrl, sourceContext.entityIdentity || {}) &&
    sourceSupportsResearchSummary(extraction, sourceContext.sourceTexts)
      ? cleanStudentFacingDescription(researchSummary)
      : '';
  if (studentReadyDescription) {
    out.push({
      ...base,
      field: 'fullDescription',
      value: studentReadyDescription,
      confidenceOverride: 0.55,
    });
    const cardDescription = distinctCardDescription(studentReadyDescription);
    if (cardDescription) {
      out.push({
        ...base,
        field: 'shortDescription',
        value: cardDescription,
        confidenceOverride: 0.55,
      });
    }
  }

  const undergradRoleQuote = quoteOnPage(extraction.undergradRoleQuote);
  if (undergradRoleQuote) {
    out.push({
      ...base,
      sourceUrl: undergradRoleQuote.sourceUrl,
      field: 'undergradRoleEvidenceQuote',
      value: redactDirectContactInfo(undergradRoleQuote.text).slice(0, 500),
      confidenceOverride: 0.5,
    });
  }

  const contactInstructionsQuote = quoteOnPage(extraction.contactInstructionsQuote);
  if (contactInstructionsQuote && contactQuoteStatesAnInstruction(contactInstructionsQuote.text)) {
    out.push({
      ...base,
      sourceUrl: contactInstructionsQuote.sourceUrl,
      field: 'contactInstructionsQuote',
      value: redactDirectContactInfo(contactInstructionsQuote.text).slice(0, 500),
      confidenceOverride: 0.5,
    });
  }

  const explicitConstraintQuote = quoteOnPage(extraction.explicitConstraintQuote);
  if (explicitConstraintQuote) {
    out.push({
      ...base,
      sourceUrl: explicitConstraintQuote.sourceUrl,
      field: 'undergradConstraintQuote',
      value: redactDirectContactInfo(explicitConstraintQuote.text).slice(0, 500),
      confidenceOverride: 0.5,
    });
  }

  out.push({ ...base, field: 'lastObservedAt', value: observedAt });

  return out;
}

function cleanResearchSummary(raw: string | undefined): string {
  return (raw || '').replace(/\s+/g, ' ').trim().slice(0, 500);
}

/**
 * Fail-closed student-facing description gate. The LLM `researchSummary` is a
 * paraphrase, so before it can become a stored fullDescription it must clear the
 * same hygiene and quality bar the visibility census applies at read time
 * (page chrome, academic-appointment/PI-bio prose, synthetic/meta notes,
 * role-only fragments, recruitment boilerplate). Returns clean prose or an empty
 * string when the summary would only produce a description hold downstream.
 */
function cleanStudentFacingDescription(researchSummary: string): string {
  const cleaned = publicResearchEntityDescriptionText(researchSummary);
  if (!cleaned || !fullDescriptionMeetsEvidenceBar(cleaned)) return '';
  return cleaned;
}

// Emitting one value to both description fields is self-defeating: the
// materializer's restatement guard reacts by clearing fullDescription, so the
// detail page loses its prose while the surviving card keeps the record looking
// healthy to the visibility gate. A card line is therefore only emitted when it
// compresses the full into something genuinely distinct; otherwise no
// shortDescription observation is written and the card-derivation path owns it.
function distinctCardDescription(fullDescription: string): string {
  const derived = deriveShortDescriptionFromFullDescription(fullDescription);
  if (!derived) return '';
  if (isFullDescriptionRestatementOfShortDescription(fullDescription, derived)) return '';
  return shortDescriptionQuality(derived, fullDescription).isUseful ? derived : '';
}

function sourceSupportsResearchSummary(
  extraction: LLMExtraction,
  sourceTexts: string[] | undefined,
): boolean {
  const summary = cleanResearchSummary(extraction.researchSummary);
  if (!summary || !sourceTexts?.length) return false;

  const combined = normalizeSupportText(sourceTexts.join(' '));
  const supportQuotes = [extraction.methodsQuote, extraction.topicsQuote]
    .map((quote) => (quote || '').trim())
    .filter((quote) => quote.length >= 8);
  const hasSourceBackedQuote = supportQuotes.some((quote) =>
    combined.includes(normalizeSupportText(quote)),
  );
  if (!hasSourceBackedQuote) return false;

  const summaryTokens = contentTokens(summary);
  if (summaryTokens.length === 0) return false;
  const sourceTokens = new Set(contentTokens(sourceTexts.join(' ')));
  const matched = summaryTokens.filter((token) => sourceTokens.has(token));
  return matched.length / summaryTokens.length >= 0.45;
}

function normalizeSupportText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function contentTokens(text: string): string[] {
  const stop = new Set([
    'the',
    'and',
    'with',
    'using',
    'uses',
    'use',
    'our',
    'lab',
    'research',
    'studies',
    'study',
    'studying',
    'into',
    'from',
    'that',
    'this',
    'their',
    'current',
  ]);
  const seen = new Set<string>();
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4 && !stop.has(token))
    .filter((token) => {
      if (seen.has(token)) return false;
      seen.add(token);
      return true;
    });
}

/**
 * Pure: filter the list of candidate ResearchEntities down to the ones we
 * should actually process this run.
 *
 *   - drop labs without a websiteUrl
 *   - drop labs that are archived
 *   - apply --only slug allowlist (case-insensitive)
 *   - apply --limit cap
 */
export interface CandidateLab extends ResearchEntityIdentity {
  _id: any;
  slug: string;
  name: string;
  websiteUrl: string;
  archived?: boolean;
  manuallyLockedFields?: string[];
  entityType?: string;
  kind?: string;
  storedWebsiteUrl?: string;
}

function usableWebsiteUrlFromDoc(doc: Record<string, any>): string {
  const candidates = [
    doc.websiteUrl,
    doc.website,
    ...(Array.isArray(doc.sourceUrls) ? doc.sourceUrls : []),
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const url = normalizeKnownLabWebsiteUrl(candidate.trim());
    if (/^https?:\/\//i.test(url) && !isRejectedUndergradSourceUrl(url)) return url;
  }
  return '';
}

export function candidateLabFromResearchEntityDoc(doc: Record<string, any>): CandidateLab {
  return {
    _id: doc._id,
    slug: doc.slug,
    name: doc.name,
    websiteUrl: usableWebsiteUrlFromDoc(doc),
    archived: !!doc.archived,
    manuallyLockedFields: doc.manuallyLockedFields || [],
    entityType: doc.entityType,
    kind: doc.kind,
    storedWebsiteUrl: typeof doc.websiteUrl === 'string' ? doc.websiteUrl : undefined,
    displayName: doc.displayName,
    school: doc.school,
    schools: doc.schools,
    departments: doc.departments,
    sourceUrls: doc.sourceUrls,
    fullDescription: doc.fullDescription,
  };
}

export function selectLabsToProcess(
  candidates: CandidateLab[],
  options: { only?: string[]; limit?: number; exhaustive?: boolean },
): CandidateLab[] {
  const onlyFilter =
    options.only && options.only.length > 0
      ? new Set(options.only.map((s) => s.trim().toLowerCase()))
      : null;
  const limit =
    options.limit && options.limit > 0
      ? options.limit
      : options.exhaustive
        ? Number.POSITIVE_INFINITY
        : DEFAULT_LIMIT;

  const out: CandidateLab[] = [];
  for (const lab of candidates) {
    if (!lab.websiteUrl || !/^https?:\/\//i.test(lab.websiteUrl)) continue;
    if (lab.archived) continue;
    if (onlyFilter && !onlyFilter.has(lab.slug.toLowerCase())) continue;
    out.push(lab);
    if (out.length >= limit) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// I/O hooks (default implementations)
// ---------------------------------------------------------------------------

/** Result of fetching one page. `null` means we couldn't fetch (404, timeout). */
export interface FetchedPage {
  url: string;
  html: string;
}

/** Default page fetcher: axios + 10s timeout + USER_AGENT. Returns null on
 *  any non-2xx, network error, or timeout. */
export type FetchPageFn = (url: string) => Promise<FetchedPage | null>;

export const defaultFetchPage: FetchPageFn = async (url) => {
  // SSRF guard, per-host rate limiting, and retry-on-403 live in fetchPageWithPolicy;
  // preserve this path's null-on-failure contract by mapping any final error to null.
  try {
    const page = await fetchPageWithPolicy(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,*/*' },
      timeoutMs: FETCH_TIMEOUT_MS,
    });
    return { url: page.url, html: page.html };
  } catch {
    return null;
  }
};

/** Default LLM caller: hits OpenAI's chat-completions endpoint with the
 *  structured-output JSON schema. We use axios (rather than the openai SDK)
 *  to keep dependencies lean — the response contract is a simple
 *  `choices[0].message.content` JSON string. */
export type CallLLMFn = (input: {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  apiKey: string;
  responseFormat: Record<string, unknown>;
}) => Promise<LLMExtraction>;

export type WorkPlanLoaderFn = (
  lab: CandidateLab,
  policy: WorkPlannerSourcePolicy,
  ctx: ScraperContext,
) => Promise<EntityWorkPlan>;

export const defaultCallLLM: CallLLMFn = async ({
  model,
  systemPrompt,
  userPrompt,
  apiKey,
  responseFormat,
}) => {
  const res = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: responseFormat,
      ...openAiChatSampling(model),
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 60_000,
    },
  );
  const content = res.data?.choices?.[0]?.message?.content;
  if (!content || typeof content !== 'string') {
    throw new Error('LLM returned empty content');
  }
  let parsed: LLMExtraction;
  try {
    parsed = JSON.parse(content) as LLMExtraction;
  } catch (err: any) {
    throw new Error(`LLM returned invalid JSON: ${sanitizeLogValue(err)}`, { cause: err });
  }
  return parsed;
};

// ---------------------------------------------------------------------------
// Scraper class
// ---------------------------------------------------------------------------

export interface LabMicrositeUndergradLLMExtractorDeps {
  fetchPage?: FetchPageFn;
  renderedFetcher?: RenderedFetcher | null;
  callLLM?: CallLLMFn;
  workPlanLoader?: WorkPlanLoaderFn;
  liveEvidenceQuoteLoader?: LiveEvidenceQuoteLoaderFn;
  /** Resolves the candidate-lab list. Default queries Mongo. */
  labFinder?: () => Promise<CandidateLab[]>;
  model?: string;
  apiKey?: string;
  env?: NodeJS.ProcessEnv;
}

async function defaultWorkPlanLoader(
  lab: CandidateLab,
  policy: WorkPlannerSourcePolicy,
  _ctx: ScraperContext,
): Promise<EntityWorkPlan> {
  return loadEntityWorkPlan({
    entityType: policy.entityType,
    entityKey: lab.slug,
    sourceName: policy.sourceName,
    targetFields: policy.targetFields,
    manuallyLockedFields: lab.manuallyLockedFields,
    freshnessWindowMs: policy.freshnessWindowMs,
    now: new Date(),
  });
}

/**
 * The rows this source will attempt, which is the population any coverage
 * ceiling for it has to be read against. Exported so the audit reports the same
 * number the run would process instead of restating the predicate (#1362).
 */
export const UNDERGRAD_LLM_CANDIDATE_FILTER: QueryFilter<Record<string, unknown>> = {
  archived: { $ne: true },
  $or: [
    { websiteUrl: { $exists: true, $ne: '' } },
    { website: { $exists: true, $ne: '' } },
    { sourceUrls: /^https?:\/\//i },
  ],
};

/** Default: query ResearchEntity for non-archived rows that have a website. */
async function defaultLabFinder(): Promise<CandidateLab[]> {
  const docs = await ResearchEntity.find(UNDERGRAD_LLM_CANDIDATE_FILTER, {
    _id: 1,
    slug: 1,
    name: 1,
    displayName: 1,
    websiteUrl: 1,
    website: 1,
    sourceUrls: 1,
    archived: 1,
    manuallyLockedFields: 1,
    entityType: 1,
    kind: 1,
    // Read only so `personProfileSourceMatchesEntity` can tell this entity's own
    // person from a namesake at another Yale school before a crawled page's prose
    // becomes this row's description (#2570).
    school: 1,
    schools: 1,
    departments: 1,
    fullDescription: 1,
  }).lean();
  return (docs as any[]).map(candidateLabFromResearchEntityDoc);
}

class SharedDependencyFailure extends Error {
  constructor(readonly dependencyError: unknown) {
    super('shared lane dependency failed');
  }
}

async function abortLaneOnFailure<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw new SharedDependencyFailure(error);
  }
}

export class LabMicrositeUndergradLLMExtractor implements IScraper {
  readonly name = 'lab-microsite-undergrad-llm';
  readonly displayName = 'Lab microsite LLM (undergrad signals)';

  private readonly fetchPage: FetchPageFn;
  private readonly renderedFetcher: RenderedFetcher | null;
  private readonly callLLM: CallLLMFn;
  private readonly workPlanLoader: WorkPlanLoaderFn;
  private readonly liveEvidenceQuoteLoader: LiveEvidenceQuoteLoaderFn;
  private readonly labFinder: () => Promise<CandidateLab[]>;
  private readonly model: string;
  private readonly apiKey: string | undefined;
  private readonly env: NodeJS.ProcessEnv;

  constructor(deps: LabMicrositeUndergradLLMExtractorDeps = {}) {
    this.fetchPage = deps.fetchPage ?? defaultFetchPage;
    this.renderedFetcher = deps.renderedFetcher ?? createScraplingRenderedFetcher();
    this.callLLM = deps.callLLM ?? defaultCallLLM;
    this.workPlanLoader = deps.workPlanLoader ?? defaultWorkPlanLoader;
    this.liveEvidenceQuoteLoader = deps.liveEvidenceQuoteLoader ?? defaultLiveEvidenceQuoteLoader;
    this.labFinder = deps.labFinder ?? defaultLabFinder;
    this.model = deps.model ?? DEFAULT_MODEL;
    this.apiKey = deps.apiKey ?? process.env.OPENAI_API_KEY;
    this.env = deps.env ?? process.env;
  }

  // The model can name a join page it only saw in navigation text; reading that page is
  // what lets the join arms judge it, and a page that does not resolve is not a route.
  private async readNamedJoinPage(
    joinPageUrl: string | null | undefined,
    readPages: readonly PromptSourcePage[],
  ): Promise<{ page?: PromptSourcePage; metric?: ScraperFetchMetric } | null> {
    if (!joinPageUrl || !/^https?:\/\//i.test(joinPageUrl)) return null;
    const identity = pageUrlIdentity(joinPageUrl);
    if (readPages.some((page) => pageUrlIdentity(page.url) === identity)) return null;
    const measured = await measureRenderedFetch(joinPageUrl, 'http', () =>
      this.fetchPage(joinPageUrl),
    );
    const text = measured.result ? htmlToPromptText(measured.result.html) : '';
    return { metric: measured.metric, page: text ? { url: joinPageUrl, text } : undefined };
  }

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    if (!this.apiKey) {
      ctx.log('OPENAI_API_KEY missing — cannot run LLM extraction; emitting zero observations.');
      return {
        observationCount: 0,
        entitiesObserved: 0,
        notes: 'OPENAI_API_KEY missing',
      };
    }

    const limitOption = ctx.options.limit;
    if (limitOption !== undefined && (!Number.isSafeInteger(limitOption) || limitOption < 1)) {
      throw new Error('--limit must be a safe positive integer');
    }

    const candidates = await this.labFinder();
    ctx.log(`Found ${candidates.length} candidate ResearchEntities with usable website URLs`);

    const labs = selectLabsToProcess(candidates, {
      only: ctx.options.only,
      limit: limitOption,
      exhaustive: ctx.options.exhaustive,
    });
    ctx.log(
      `Processing ${labs.length} labs (limit=${ctx.options.exhaustive && limitOption === undefined ? 'all' : (limitOption ?? DEFAULT_LIMIT)}, only=${(ctx.options.only || []).join(',') || 'none'})`,
    );

    let totalObs = 0;
    let processed = 0;
    let succeeded = 0;
    let fetchFailed = 0;
    let llmFailed = 0;
    let processingFailed = 0;
    let contentUnchangedSkipped = 0;
    let quotesNotOnPage = 0;
    let evidenceQuotesWithdrawn = 0;
    let evidenceQuotesRecited = 0;
    const fetchAttempts: ScraperFetchMetric[] = [];
    const workPlannerPolicy = ctx.options.ignoreWorkPlanner
      ? undefined
      : getWorkPlannerSourcePolicy(this.name);
    const workPlannerMetrics = createWorkPlannerMetrics();
    const concurrency = resolveSourceConcurrency(
      ctx.options.sourceConcurrency,
      DEFAULT_SOURCE_CONCURRENCY,
    );

    await mapWithConcurrency(labs, concurrency, async (lab) => {
      processed++;
      try {
        if (workPlannerPolicy) {
          if (!lab.slug) {
            recordWorkPlannerNoIdentifier(workPlannerMetrics);
            ctx.log('[candidate] skipped by WorkPlanner — missing slug/entity key.');
            return;
          }
          const plan = await abortLaneOnFailure(() =>
            this.workPlanLoader(lab, workPlannerPolicy, ctx),
          );
          recordWorkPlannerDecision(workPlannerMetrics, plan);
          if (!plan.shouldFetch) {
            const reasons = Array.from(new Set(plan.fields.map((field) => field.reason))).join(',');
            ctx.log(`[${lab.slug}] skipped by WorkPlanner — ${reasons || 'fresh'}.`);
            return;
          }
        }

        const measuredHomePage = await measureRenderedFetch(lab.websiteUrl, 'http', () =>
          this.fetchPage(lab.websiteUrl),
        );
        fetchAttempts.push(measuredHomePage.metric);
        let homePage: FetchedPage | null = measuredHomePage.result;
        if (!homePage || htmlToPromptText(homePage.html).length < 200) {
          const rendered = await measureRenderedFallback(
            lab.websiteUrl,
            {
              sourceName: SOURCE_KEY,
              useCache: ctx.options.useCache,
              request: { url: lab.websiteUrl, waitSelector: 'body', timeoutMs: FETCH_TIMEOUT_MS },
              renderedFetcher: this.renderedFetcher,
            },
            { selectorName: 'body' },
          );
          if (rendered) fetchAttempts.push(rendered.metric);
          if (rendered?.result?.html) {
            homePage = {
              url: rendered.result.url || lab.websiteUrl,
              html: rendered.result.html,
            };
          }
        }
        if (!homePage) {
          fetchFailed++;
          return;
        }
        const homeText = htmlToPromptText(homePage.html);

        const linkedSubPageUrls = new Set(
          discoverSubPageUrls(homePage.html, homePage.url).map(normalizeCandidateUrl),
        );
        let linkedSubPageUnread = false;
        const subPages: PromptSourcePage[] = [];
        for (const candidate of candidateCrawlUrls(homePage.html, homePage.url)) {
          if (subPages.length >= MAX_SUBPAGES_FETCHED) break;
          const measuredSubPage = await measureRenderedFetch(candidate, 'http', () =>
            this.fetchPage(candidate),
          );
          fetchAttempts.push(measuredSubPage.metric);
          const fetched = measuredSubPage.result;
          if (!fetched) {
            if (linkedSubPageUrls.has(candidate)) linkedSubPageUnread = true;
            continue;
          }
          const text = htmlToPromptText(fetched.html);
          if (!text) continue;
          subPages.push({ url: fetched.url, text, rosterText: htmlToRosterText(fetched.html) });
        }
        const [primarySubPage, ...additionalSubPages] = subPages;

        const liveEvidenceQuote = await abortLaneOnFailure(() =>
          this.liveEvidenceQuoteLoader(lab.slug),
        );
        if (liveEvidenceQuote) {
          const readPages: PromptSourcePage[] = [
            { url: homePage.url, text: homeText },
            ...subPages,
          ];
          const citedIdentity = pageUrlIdentity(liveEvidenceQuote.sourceUrl);
          if (!readPages.some((page) => pageUrlIdentity(page.url) === citedIdentity)) {
            const measuredCitedPage = await measureRenderedFetch(
              liveEvidenceQuote.sourceUrl,
              'http',
              () => this.fetchPage(liveEvidenceQuote.sourceUrl),
            );
            fetchAttempts.push(measuredCitedPage.metric);
            if (measuredCitedPage.result) {
              readPages.push({
                url: liveEvidenceQuote.sourceUrl,
                text: htmlToPromptText(measuredCitedPage.result.html),
              });
            }
          }
          if (evidenceQuoteIsWithdrawnByRead(liveEvidenceQuote, readPages)) {
            await abortLaneOnFailure(() =>
              ctx.emit([evidenceQuoteWithdrawalObservation(lab.slug, liveEvidenceQuote)]),
            );
            evidenceQuotesWithdrawn += 1;
            totalObs += 1;
          } else {
            const recitation = evidenceQuoteRecitationObservation(
              lab.slug,
              liveEvidenceQuote,
              readPages,
            );
            if (recitation) {
              await abortLaneOnFailure(() => ctx.emit([recitation]));
              evidenceQuotesRecited += 1;
              totalObs += 1;
            }
          }
        }

        const entityRef = { entityType: 'researchEntity' as const, entityKey: lab.slug };
        const contentHash = computeVersionedContentHash(
          [homeText, ...subPages.map((page) => page.text)].join('\n'),
          UNDERGRAD_EXTRACTION_PROMPT_HASH,
          this.model,
          OBSERVATION_DERIVATION_VERSION,
        );
        const storedContentHash = ctx.options.forceLlm
          ? undefined
          : await abortLaneOnFailure(() => loadStoredContentHash(this.name, entityRef));
        if (contentUnchanged(storedContentHash, contentHash, ctx.options.forceLlm)) {
          contentUnchangedSkipped += 1;
          ctx.log(`[${lab.slug}] skipped — content unchanged.`);
          return;
        }

        const userPrompt = buildLLMPrompt(
          lab.name,
          homePage.url,
          homeText,
          primarySubPage?.url ?? null,
          primarySubPage?.text ?? null,
          additionalSubPages,
        );

        // Keyed by the exact request, so a changed prompt, response format, or page text is
        // a cache miss, and a benchmark replay never serves an answer to a different question.
        const sourceUrls = [homePage.url, ...subPages.map((page) => page.url)];
        const cacheKey = `llm:undergrad-v4:${this.model}:${computeContentHash(
          JSON.stringify([LAB_UNDERGRAD_SYSTEM_PROMPT, LAB_UNDERGRAD_RESPONSE_FORMAT, userPrompt]),
        )}`;

        let extraction: LLMExtraction | null = null;
        if (ctx.options.useCache) {
          try {
            const cached = await getCachedModelAnswer<LLMExtraction>(SOURCE_KEY, cacheKey);
            if (cached) extraction = cached;
          } catch {
            /* ignore cache errors */
          }
        }

        if (!extraction) {
          try {
            extraction = await this.callLLM({
              model: this.model,
              systemPrompt: LAB_UNDERGRAD_SYSTEM_PROMPT,
              userPrompt,
              apiKey: this.apiKey as string,
              responseFormat: LAB_UNDERGRAD_RESPONSE_FORMAT,
            });
          } catch (err: any) {
            ctx.log(`[${lab.slug}] LLM call failed: ${sanitizeLogValue(err)}; skipping.`);
            llmFailed++;
            return;
          }
          if (ctx.options.useCache && extraction) {
            try {
              await setCached(SOURCE_KEY, cacheKey, extraction);
            } catch {
              /* ignore cache errors */
            }
          }
        }

        const sourcePages = [
          { url: homePage.url, text: homeText, rosterText: htmlToRosterText(homePage.html) },
          ...subPages,
        ];
        quotesNotOnPage += quoteFieldsNotOnPage(extraction, sourcePages).length;
        const joinPage = await this.readNamedJoinPage(extraction.joinPageUrl, sourcePages);
        if (joinPage?.metric) fetchAttempts.push(joinPage.metric);
        let observations = extractionToObservations(
          lab.slug,
          sourceUrlForExtraction({ url: homePage.url, text: homeText }, subPages, extraction),
          extraction,
          new Date(),
          {
            sourceUrls,
            quoteSourceUrl: sourceUrlForExtraction(
              { url: homePage.url, text: homeText },
              subPages,
              extraction,
            ),
            sourceTexts: [homeText, ...subPages.map((page) => page.text)],
            sourcePages,
            joinPages: joinPage?.page ? [joinPage.page] : [],
            entityIdentity: lab,
            entityShape: {
              entityType: lab.entityType,
              kind: lab.kind,
              websiteUrl: lab.storedWebsiteUrl,
              departments: lab.departments,
            },
            readIsComplete: !linkedSubPageUnread,
          },
        );
        if ((lab.manuallyLockedFields || []).includes(UNDERGRAD_ACCESS_EVIDENCE_FIELD)) {
          observations = observations.filter(
            (observation) => observation.field !== UNDERGRAD_ACCESS_EVIDENCE_FIELD,
          );
        }
        if (observations.length > 0) {
          await abortLaneOnFailure(() => ctx.emit(observations));
          totalObs += observations.length;
        }
        await abortLaneOnFailure(() =>
          ctx.emit([contentHashObservation(entityRef, homePage.url, contentHash)]),
        );
        succeeded++;

        if (processed % 25 === 0 || processed === labs.length) {
          ctx.log(
            `progress: ${processed}/${labs.length} labs | ${succeeded} ok | ${fetchFailed} fetch-failed | ${llmFailed} llm-failed | ${processingFailed} processing-failed | ${totalObs} obs`,
          );
        }
      } catch (error) {
        if (error instanceof SharedDependencyFailure) throw error.dependencyError;
        processingFailed++;
        ctx.log(
          `[${lab.slug || 'candidate'}] processing failed: ${sanitizeLogValue(error)}; skipping.`,
        );
      }
    });

    ctx.log(
      `Done. processed=${processed}, succeeded=${succeeded}, fetchFailed=${fetchFailed}, llmFailed=${llmFailed}, processingFailed=${processingFailed}, observations=${totalObs}`,
    );

    return {
      observationCount: totalObs,
      entitiesObserved: succeeded,
      notes: `LLM-extracted undergrad signals for ${succeeded}/${processed} labs (${fetchFailed} fetch-failed, ${llmFailed} llm-failed, ${processingFailed} processing-failed, ${contentUnchangedSkipped} content-unchanged skipped, ${quotesNotOnPage} quotes not on page, ${evidenceQuotesWithdrawn} stored evidence quotes withdrawn, ${evidenceQuotesRecited} re-cited, ${workPlannerMetrics.skippedFresh + workPlannerMetrics.skippedManualLock} workplanner-skipped)`,
      metrics: {
        workPlanner: workPlannerMetrics,
        quotesNotOnPage,
        evidenceQuotesWithdrawn,
        evidenceQuotesRecited,
      },
      fetchMetrics: summarizeFetchMetrics(fetchAttempts),
    };
  }
}
