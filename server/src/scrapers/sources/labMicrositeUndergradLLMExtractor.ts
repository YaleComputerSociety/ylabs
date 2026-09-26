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
import type { FilterQuery } from 'mongoose';
import { sanitizeLogValue } from '../../utils/logSanitizer';
import { fetchPageWithPolicy } from '../utils/httpFetch';
import * as cheerio from 'cheerio';
import { plainTextContent } from '../utils/htmlText';
import { ResearchEntity } from '../../models/researchEntity';
import { redactDirectContactInfo } from '../../utils/contactRedaction';
import { openAiChatSampling } from '../../utils/openAiChatSampling';
import { isPlausibleUndergradEvidenceQuote } from '../undergradEvidenceQuoteValidation';
import {
  deriveShortDescriptionFromFullDescription,
  fullDescriptionQuality,
  isFullDescriptionRestatementOfShortDescription,
  shortDescriptionQuality,
} from '../../utils/researchEntityDescriptionQuality';
import { publicResearchEntityDescriptionText } from '../../utils/researchEntityDescriptionText';
import { isRejectedDescriptionSourceUrl } from './labMicrositeDescriptionLLMExtractor';
import {
  personProfileSourceNamesADifferentPerson,
  type ResearchEntityIdentity,
} from '../utils/personProfileEntityMatch';
import { UNDERGRAD_EXTRACTION_PROMPT, UNDERGRAD_EXTRACTION_PROMPT_HASH } from '../prompts';
import {
  createScraplingRenderedFetcher,
  measureRenderedFetch,
  summarizeFetchMetrics,
  type RenderedFetcher,
  type RenderedFetchResult,
} from '../renderedFetch';
import { getCached, setCached } from '../snapshotCache';
import {
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
  /\bvisiting\b/i,
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

/**
 * Fail-closed recency + institution gate for `currentUndergradCount`. The raw
 * LLM integer is never trusted on its own because the roster it counts mixes
 * current Yale undergrads with alumni and non-Yale visiting undergrads (#1314).
 *
 *   - When the LLM supplies a per-person `currentUndergradEvidenceQuotes` roster
 *     (the strengthened prompt requires one snippet per counted undergrad), the
 *     count is derived from the subset of snippets that clear both gates.
 *   - When no roster is present (legacy cache or an omitted array), fall back to
 *     the LLM integer but zero it when the single backing `evidenceQuote` shows a
 *     historical or non-Yale marker, so a contaminated count never survives.
 */
export function deriveCurrentUndergradCount(extraction: LLMExtraction): number {
  const roster = extraction.currentUndergradEvidenceQuotes;
  if (Array.isArray(roster)) {
    return roster.filter((quote) => isCurrentYaleUndergradEvidence(quote)).length;
  }
  const rawCount = extraction.currentUndergradCount;
  if (!Number.isInteger(rawCount) || rawCount <= 0) return 0;
  return isCurrentYaleUndergradEvidence(extraction.evidenceQuote) ? rawCount : 0;
}

/**
 * Pure: turn an LLMExtraction into the ObservationInput list the materializer
 * will consume. Implements the rules:
 *
 *   - undergradAccessEvidence: emitted iff openToUndergrads is 'yes' or 'no';
 *     skipped on 'unclear'. Confidence override 0.5 (LLM-based, low-trust).
 *   - currentUndergradCount: emitted iff evidenceSource is 'members_section'
 *     AND the recency/institution-gated count (deriveCurrentUndergradCount) is
 *     a positive integer. Open prose ("we have many undergrads") is too
 *     unreliable to write a count from, and alumni / non-Yale visiting undergrads
 *     never count toward it. Confidence 0.5.
 *   - undergradEvidenceQuote: emitted iff evidenceQuote is non-empty, plausible,
 *     and passes the same recency/institution gate as currentUndergradCount, so
 *     a historical or non-Yale snippet never gets displayed as current evidence.
 *     Confidence 0.5.
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
  } = {},
): ObservationInput[] {
  const sourceUrls = sourceContext.sourceUrls?.filter(Boolean) ?? [sourceUrl];
  const quoteSourceUrl = sourceContext.quoteSourceUrl || sourceUrl;
  const base = {
    entityType: 'researchEntity' as const,
    entityKey: groupSlug,
    sourceUrl,
  };
  const out: ObservationInput[] = [];

  if (extraction.openToUndergrads === 'yes') {
    out.push({
      ...base,
      field: 'undergradAccessEvidence',
      value: {
        openToUndergrads: extraction.openToUndergrads,
        evidenceSource: extraction.evidenceSource,
        evidenceQuote: extraction.evidenceQuote,
        sourceUrls,
        quoteSourceUrl,
      },
      confidenceOverride: 0.5,
    });
  } else if (extraction.openToUndergrads === 'no') {
    out.push({
      ...base,
      field: 'undergradAccessEvidence',
      value: {
        openToUndergrads: extraction.openToUndergrads,
        evidenceSource: extraction.evidenceSource,
        evidenceQuote: extraction.evidenceQuote,
        sourceUrls,
        quoteSourceUrl,
      },
      confidenceOverride: 0.5,
    });
  }
  // 'unclear' → no observation

  if (extraction.evidenceSource === 'members_section') {
    out.push({
      ...base,
      field: 'currentUndergradCount',
      value: deriveCurrentUndergradCount(extraction),
      confidenceOverride: 0.5,
    });
  }

  const quote = (extraction.evidenceQuote || '').trim();
  if (quote && isPlausibleUndergradEvidenceQuote(quote) && isCurrentYaleUndergradEvidence(quote)) {
    out.push({
      ...base,
      sourceUrl: quoteSourceUrl,
      field: 'undergradEvidenceQuote',
      value: redactDirectContactInfo(quote).slice(0, 500),
      confidenceOverride: 0.5,
    });
  }

  if (extraction.joinPageUrl) {
    out.push({
      ...base,
      field: 'joinPageUrl',
      value: extraction.joinPageUrl,
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

  const undergradRoleQuote = (extraction.undergradRoleQuote || '').trim();
  if (undergradRoleQuote) {
    out.push({
      ...base,
      sourceUrl: quoteSourceUrl,
      field: 'undergradRoleEvidenceQuote',
      value: redactDirectContactInfo(undergradRoleQuote).slice(0, 500),
      confidenceOverride: 0.5,
    });
  }

  const contactInstructionsQuote = (extraction.contactInstructionsQuote || '').trim();
  if (contactInstructionsQuote) {
    out.push({
      ...base,
      sourceUrl: quoteSourceUrl,
      field: 'contactInstructionsQuote',
      value: redactDirectContactInfo(contactInstructionsQuote).slice(0, 500),
      confidenceOverride: 0.5,
    });
  }

  const explicitConstraintQuote = (extraction.explicitConstraintQuote || '').trim();
  if (explicitConstraintQuote) {
    out.push({
      ...base,
      sourceUrl: quoteSourceUrl,
      field: 'undergradConstraintQuote',
      value: redactDirectContactInfo(explicitConstraintQuote).slice(0, 500),
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
  if (!cleaned || !fullDescriptionQuality(cleaned).isUseful) return '';
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
    throw new Error(`LLM returned invalid JSON: ${sanitizeLogValue(err)}`);
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
export const UNDERGRAD_LLM_CANDIDATE_FILTER: FilterQuery<Record<string, unknown>> = {
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

class ObservationWriteFailure extends Error {
  constructor(readonly writeError: unknown) {
    super('observation write failed');
  }
}

async function emitOrAbortLane(
  ctx: ScraperContext,
  observations: Parameters<ScraperContext['emit']>[0],
): Promise<void> {
  try {
    await ctx.emit(observations);
  } catch (error) {
    throw new ObservationWriteFailure(error);
  }
}

export class LabMicrositeUndergradLLMExtractor implements IScraper {
  readonly name = 'lab-microsite-undergrad-llm';
  readonly displayName = 'Lab microsite LLM (undergrad signals)';

  private readonly fetchPage: FetchPageFn;
  private readonly renderedFetcher: RenderedFetcher | null;
  private readonly callLLM: CallLLMFn;
  private readonly workPlanLoader: WorkPlanLoaderFn;
  private readonly labFinder: () => Promise<CandidateLab[]>;
  private readonly model: string;
  private readonly apiKey: string | undefined;
  private readonly env: NodeJS.ProcessEnv;

  constructor(deps: LabMicrositeUndergradLLMExtractorDeps = {}) {
    this.fetchPage = deps.fetchPage ?? defaultFetchPage;
    this.renderedFetcher = deps.renderedFetcher ?? createScraplingRenderedFetcher();
    this.callLLM = deps.callLLM ?? defaultCallLLM;
    this.workPlanLoader = deps.workPlanLoader ?? defaultWorkPlanLoader;
    this.labFinder = deps.labFinder ?? defaultLabFinder;
    this.model = deps.model ?? DEFAULT_MODEL;
    this.apiKey = deps.apiKey ?? process.env.OPENAI_API_KEY;
    this.env = deps.env ?? process.env;
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
          const plan = await this.workPlanLoader(lab, workPlannerPolicy, ctx);
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
          const rendered = await measureRenderedFetch(
            lab.websiteUrl,
            'scrapling',
            () =>
              fetchRenderedLabPage(
                SOURCE_KEY,
                ctx.options.useCache,
                lab.websiteUrl,
                this.renderedFetcher,
              ),
            { selectorName: 'body' },
          );
          fetchAttempts.push(rendered.metric);
          if (rendered.result?.html) {
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

        const subPages: PromptSourcePage[] = [];
        for (const candidate of candidateCrawlUrls(homePage.html, homePage.url)) {
          if (subPages.length >= MAX_SUBPAGES_FETCHED) break;
          const measuredSubPage = await measureRenderedFetch(candidate, 'http', () =>
            this.fetchPage(candidate),
          );
          fetchAttempts.push(measuredSubPage.metric);
          const fetched = measuredSubPage.result;
          if (!fetched) continue;
          const text = htmlToPromptText(fetched.html);
          if (!text) continue;
          subPages.push({ url: fetched.url, text });
        }
        const [primarySubPage, ...additionalSubPages] = subPages;

        const entityRef = { entityType: 'researchEntity' as const, entityKey: lab.slug };
        const contentHash = computeVersionedContentHash(
          [homeText, ...subPages.map((page) => page.text)].join('\n'),
          UNDERGRAD_EXTRACTION_PROMPT_HASH,
          this.model,
        );
        const storedContentHash = ctx.options.forceLlm
          ? undefined
          : await loadStoredContentHash(this.name, entityRef);
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

        // Per-(websiteUrl, model) cache so reruns don't re-charge OpenAI. The namespace
        // must be bumped whenever the response format changes, because the cache is read
        // before the prompt-hash re-extraction gate and would otherwise hand back a
        // response shaped for the previous schema.
        const sourceUrls = [homePage.url, ...subPages.map((page) => page.url)];
        const cacheKey = `llm:undergrad-v3:${this.model}:${sourceUrls.join('+')}`;

        let extraction: LLMExtraction | null = null;
        if (ctx.options.useCache) {
          try {
            const cached = await getCached<LLMExtraction>(SOURCE_KEY, cacheKey);
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
            sourcePages: [{ url: homePage.url, text: homeText }, ...subPages],
            entityIdentity: lab,
          },
        );
        if ((lab.manuallyLockedFields || []).includes(UNDERGRAD_ACCESS_EVIDENCE_FIELD)) {
          observations = observations.filter(
            (observation) => observation.field !== UNDERGRAD_ACCESS_EVIDENCE_FIELD,
          );
        }
        if (observations.length > 0) {
          await emitOrAbortLane(ctx, observations);
          totalObs += observations.length;
        }
        await emitOrAbortLane(ctx, [contentHashObservation(entityRef, homePage.url, contentHash)]);
        succeeded++;

        if (processed % 25 === 0 || processed === labs.length) {
          ctx.log(
            `progress: ${processed}/${labs.length} labs | ${succeeded} ok | ${fetchFailed} fetch-failed | ${llmFailed} llm-failed | ${processingFailed} processing-failed | ${totalObs} obs`,
          );
        }
      } catch (error) {
        if (error instanceof ObservationWriteFailure) throw error.writeError;
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
      notes: `LLM-extracted undergrad signals for ${succeeded}/${processed} labs (${fetchFailed} fetch-failed, ${llmFailed} llm-failed, ${processingFailed} processing-failed, ${contentUnchangedSkipped} content-unchanged skipped, ${workPlannerMetrics.skippedFresh + workPlannerMetrics.skippedManualLock} workplanner-skipped)`,
      metrics: {
        workPlanner: workPlannerMetrics,
      },
      fetchMetrics: summarizeFetchMetrics(fetchAttempts),
    };
  }
}

async function fetchRenderedLabPage(
  sourceName: string,
  useCache: boolean,
  url: string,
  renderedFetcher: RenderedFetcher | null,
): Promise<RenderedFetchResult | null> {
  if (!renderedFetcher) return null;
  const cacheKey = `rendered-page:v1:${url}`;
  if (useCache) {
    const cached = await getCached<RenderedFetchResult>(sourceName, cacheKey);
    if (cached) return cached;
  }
  const result = await renderedFetcher({
    url,
    waitSelector: 'body',
    timeoutMs: FETCH_TIMEOUT_MS,
  });
  if (useCache && result?.html) await setCached(sourceName, cacheKey, result);
  return result;
}
