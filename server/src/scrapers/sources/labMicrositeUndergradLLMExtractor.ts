/**
 * LabMicrositeUndergradLLMExtractor
 *
 * For every canonical ResearchEntity with a usable website URL, fetch the lab home
 * page (and a likely "people"/"members"/"join" sub-page if discoverable),
 * strip HTML to plain text, and ask an LLM (gpt-4o-mini via OpenAI's
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
 *   - Labs whose `acceptingUndergrads` field has been manually locked
 *     (`manuallyLockedFields` includes 'acceptingUndergrads') are skipped.
 *   - Per-(websiteUrl, modelVersion) caching is used so reruns don't re-charge
 *     OpenAI for unchanged pages.
 *   - LLM call count is capped by `ctx.options.limit` (default 100). The
 *     `--only` filter (slug list) further restricts which labs we look at.
 *
 * I/O is fully injectable (`fetchPage`, `callLLM`, `userFinder`) so the
 * runtime can be exercised in tests without ever touching the network.
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import { ResearchEntity } from '../../models/researchEntity';
import { User } from '../../models/user';
import { redactDirectContactInfo } from '../../utils/contactRedaction';
import {
  firstUsableResearchWebsiteUrl,
  isUsableResearchWebsiteUrl,
} from '../../utils/researchWebsiteUrl';
import {
  createScraplingRenderedFetcher,
  measureRenderedFetch,
  summarizeFetchMetrics,
  type RenderedFetcher,
  type RenderedFetchResult,
} from '../renderedFetch';
import { getCached, setCached } from '../snapshotCache';
import type {
  IScraper,
  ObservationInput,
  ScraperFetchMetric,
  ScraperContext,
  ScraperResult,
  UndergradLlmReviewSample,
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
  findPiUserIdsForLabFromCandidates,
  parsePrincipalInvestigatorProfilesFromLabHtml,
  piProfileUserObservationsFromProfiles,
  type FacultyUserCandidate,
} from './ysmAtoZScraper';

const USER_AGENT = 'ylabs-scraper/1.0 (+https://yalelabs.io)';
const FETCH_TIMEOUT_MS = 10_000;
const MAX_PROMPT_CHARS = 50_000;
const DEFAULT_LIMIT = 100;
const DEFAULT_MODEL = 'gpt-4o-mini';
const SOURCE_KEY = 'lab-microsite-undergrad-llm';
const LAB_IDENTITY_CONFIDENCE_OVERRIDE = 0.55;
const MAX_CANDIDATE_SUBPAGE_URLS = 8;
const MAX_SUBPAGES_FETCHED = 3;
const MAX_UNDERGRAD_LLM_REVIEW_SAMPLES = 100;
const HARD_NEGATIVE_UNDERGRAD_RE =
  /\b(not currently accepting|not accepting|not taking|do not accept|don't accept|do not take|don't take|no bandwidth|don't have bandwidth|do not have bandwidth|cannot respond|can't respond|unable to respond|please do not email)\b/i;
const GRAD_ONLY_INSTRUCTION_RE =
  /\bprospective\s+(?:ph\.?d\.?|doctoral|graduate)\b|\b(?:ph\.?d\.?|doctoral|graduate)\s+(?:students?|applicants?)\b.{0,100}\b(?:apply|application|applications|welcome|welcomed|contact|email|should)\b|\b(?:apply|applications?|welcome|welcomed|contact|email|should apply|open to)\b.{0,100}\b(?:ph\.?d\.?|doctoral|graduate)\s+(?:students?|applicants?)\b/i;
const UNDERGRAD_REFERENCE_RE = /\bundergrad(?:uate)?s?\b/i;
const UNDERGRAD_ADMIN_TITLE_RE =
  /\b(?:director|co-director|chair|dean|advisor|adviser)\b.{0,120}\bundergraduate\s+studies\b|\bundergraduate\s+studies\b.{0,120}\b(?:director|co-director|chair|dean|advisor|adviser)\b/i;

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
  evidenceQuote: string;
  evidenceSource: EvidenceSource;
  joinPageUrl: string | null;
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
        evidenceQuote: { type: 'string' },
        evidenceSource: {
          type: 'string',
          enum: ['explicit_text', 'members_section', 'none'],
        },
        joinPageUrl: { type: ['string', 'null'] },
        undergradRoleQuote: { type: 'string' },
        contactInstructionsQuote: { type: 'string' },
        explicitConstraintQuote: { type: 'string' },
      },
      required: [
        'openToUndergrads',
        'currentUndergradCount',
        'evidenceQuote',
        'evidenceSource',
        'joinPageUrl',
        'undergradRoleQuote',
        'contactInstructionsQuote',
        'explicitConstraintQuote',
      ],
    },
    strict: true,
  },
};

const SYSTEM_PROMPT = `You are an expert classifier evaluating whether a Yale research lab's website indicates that the lab accepts undergraduate researchers.

Your job is to read text scraped from a lab's website (home page plus optionally a "members" or "join" sub-page) and return a JSON object with these fields:

- openToUndergrads: "yes" if there is text that affirmatively states the lab welcomes / hires / mentors undergraduates, OR if the members section lists undergraduate students. "no" if the lab explicitly states they do NOT take undergraduates. "unclear" otherwise. Default to "unclear" — be conservative.
- Treat strong constraints like "not accepting undergraduates", "do not email about openings", or "I do not have bandwidth to respond" as "no" rather than "unclear".
- If the page only gives PhD or graduate-student application instructions and provides no undergraduate path, keep "openToUndergrads" conservative, but put that quote in explicitConstraintQuote.
- currentUndergradCount: integer count of currently-listed undergraduates if (and only if) you can identify a members section that explicitly labels undergraduates. Return 0 if no members section exists or no undergrads are listed there.
- evidenceQuote: a verbatim quote from the page (≤200 characters) that supports your verdict. If openToUndergrads is "unclear" or "no", quote the most relevant text you found, or empty string if there is none.
- evidenceSource: "explicit_text" if your verdict comes from prose ("we welcome undergraduates"), "members_section" if from a roster listing, "none" if no evidence.
- joinPageUrl: the URL (absolute) of a "join the lab" or "opportunities" page, if mentioned. Otherwise null.
- undergradRoleQuote: a verbatim quote that describes undergraduate roles/tasks, if present. Otherwise empty string.
- contactInstructionsQuote: a verbatim quote with contact/application instructions, if present. Otherwise empty string.
- explicitConstraintQuote: a verbatim quote with constraints such as "not accepting", eligibility, required courses, or application-only instructions, if present. Otherwise empty string.

Be conservative. Do not infer openness from the mere presence of undergraduates as authors on papers. Quotes must be verbatim — do not paraphrase.`;

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
  const text = $('body').text() || $.root().text() || '';
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > MAX_PROMPT_CHARS
    ? collapsed.slice(0, MAX_PROMPT_CHARS)
    : collapsed;
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
    const text = ($(el).text() || '').trim();
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
      if (!isWithinMicrositePath(base, dest)) return;
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
    const base = micrositeBaseUrl(new URL(homeUrl));
    return SUBPAGE_PATH_HINTS.map((p) => `${base}${p.replace(/^\//, '')}`);
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

function micrositeBaseUrl(url: URL): string {
  const pathname = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
  return `${url.origin}${pathname}`;
}

function isWithinMicrositePath(base: URL, candidate: URL): boolean {
  const basePath = base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`;
  if (basePath === '/') return true;
  return candidate.pathname === base.pathname || candidate.pathname.startsWith(basePath);
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
  const parts: string[] = [];
  parts.push(`Lab name: ${groupName}`);
  parts.push(`Home page URL: ${homeUrl}`);
  parts.push('');
  parts.push('--- HOME PAGE TEXT ---');
  parts.push(homeText || '(empty)');
  if (subPageUrl && subPageText) {
    parts.push('');
    parts.push(`--- SUB-PAGE TEXT (${subPageUrl}) ---`);
    parts.push(subPageText);
  }
  for (const page of additionalSubPages) {
    if (!page.url || !page.text) continue;
    parts.push('');
    parts.push(`--- SUB-PAGE TEXT (${page.url}) ---`);
    parts.push(page.text);
  }
  return parts.join('\n').slice(0, MAX_PROMPT_CHARS);
}

export function sourceUrlForExtraction(
  homePage: PromptSourcePage,
  subPages: PromptSourcePage[],
  extraction: LLMExtraction,
): string | null {
  const quote = (extraction.evidenceQuote || '').trim();
  if (!quote) return homePage.url;
  return sourceUrlForQuote(homePage, subPages, quote);
}

type LLMQuoteField =
  | 'evidenceQuote'
  | 'undergradRoleQuote'
  | 'contactInstructionsQuote'
  | 'explicitConstraintQuote';

type LLMQuoteSourceUrls = Partial<Record<LLMQuoteField, string>>;

function sourceUrlForQuote(
  homePage: PromptSourcePage,
  subPages: PromptSourcePage[],
  quote: string,
): string | null {
  const normalizedQuote = quote.trim();
  if (!normalizedQuote) return null;
  const matchingSubPage = subPages.find((page) => page.text.includes(normalizedQuote));
  if (matchingSubPage) return matchingSubPage.url;
  if (homePage.text.includes(normalizedQuote)) return homePage.url;
  return null;
}

function isSupportedJoinPageUrl(
  rawUrl: string,
  homeUrl: string,
  sourceUrls: string[],
): string | null {
  const normalized = normalizeCandidateUrl(rawUrl);
  if (!normalized) return null;

  const fetchedUrls = new Set(sourceUrls.map(normalizeCandidateUrl).filter(Boolean));
  if (fetchedUrls.has(normalized)) return normalized;

  try {
    const home = new URL(homeUrl);
    const candidate = new URL(normalized);
    if (!/^https?:$/i.test(candidate.protocol)) return null;
    if (candidate.hostname.replace(/^www\./, '') !== home.hostname.replace(/^www\./, '')) {
      return null;
    }
    if (!isWithinMicrositePath(home, candidate)) return null;
    return normalized;
  } catch {
    return null;
  }
}

function uniqueRejectionReasons(reasons: string[]): string[] {
  return Array.from(new Set(reasons));
}

function validateExtractionAgainstSources(
  extraction: LLMExtraction,
  homePage: PromptSourcePage,
  subPages: PromptSourcePage[],
  sourceUrls: string[],
): {
  extraction: LLMExtraction;
  quoteSourceUrl: string | null;
  quoteSourceUrls: LLMQuoteSourceUrls;
  rejectionReasons: string[];
  decision: 'accepted' | 'rejected';
} {
  const normalized = normalizeExtraction(extraction);
  const quoteSourceUrls: LLMQuoteSourceUrls = {};
  const rejectionReasons: string[] = [];

  const evidenceQuote = normalized.evidenceQuote.trim();
  if (evidenceQuote) {
    const evidenceSourceUrl = sourceUrlForQuote(homePage, subPages, evidenceQuote);
    if (evidenceSourceUrl) {
      quoteSourceUrls.evidenceQuote = evidenceSourceUrl;
    } else {
      rejectionReasons.push('unsupported_evidence_quote');
      normalized.openToUndergrads = 'unclear';
      normalized.evidenceSource = 'none';
      normalized.evidenceQuote = '';
      normalized.currentUndergradCount = 0;
    }
  } else if (
    normalized.openToUndergrads !== 'unclear' ||
    normalized.evidenceSource !== 'none'
  ) {
    rejectionReasons.push('missing_evidence_quote');
    normalized.openToUndergrads = 'unclear';
    normalized.evidenceSource = 'none';
    normalized.currentUndergradCount = 0;
  }

  const ancillaryQuoteFields: Array<[LLMQuoteField, string]> = [
    ['undergradRoleQuote', 'unsupported_undergrad_role_quote'],
    ['contactInstructionsQuote', 'unsupported_contact_instructions_quote'],
    ['explicitConstraintQuote', 'unsupported_explicit_constraint_quote'],
  ];
  for (const [field, reason] of ancillaryQuoteFields) {
    const quote = (normalized[field] || '').trim();
    if (!quote) continue;
    const quoteSourceUrl = sourceUrlForQuote(homePage, subPages, quote);
    if (quoteSourceUrl) {
      quoteSourceUrls[field] = quoteSourceUrl;
    } else {
      normalized[field] = '';
      rejectionReasons.push(reason);
    }
  }

  const renormalized = normalizeExtraction(normalized);
  Object.assign(normalized, renormalized);
  for (const field of [
    'evidenceQuote',
    'undergradRoleQuote',
    'contactInstructionsQuote',
    'explicitConstraintQuote',
  ] as LLMQuoteField[]) {
    if (!(normalized[field] || '').trim()) {
      delete quoteSourceUrls[field];
    }
  }

  if (normalized.joinPageUrl) {
    const supportedJoinPageUrl = isSupportedJoinPageUrl(
      normalized.joinPageUrl,
      homePage.url,
      sourceUrls,
    );
    if (supportedJoinPageUrl) {
      normalized.joinPageUrl = supportedJoinPageUrl;
    } else {
      normalized.joinPageUrl = null;
      rejectionReasons.push('unsupported_join_page_url');
    }
  }

  const uniqueReasons = uniqueRejectionReasons(rejectionReasons);
  return {
    extraction: normalized,
    quoteSourceUrl: quoteSourceUrls.evidenceQuote ?? null,
    quoteSourceUrls,
    rejectionReasons: uniqueReasons,
    decision: uniqueReasons.some((reason) =>
      ['unsupported_evidence_quote', 'missing_evidence_quote'].includes(reason),
    )
      ? 'rejected'
      : 'accepted',
  };
}

function looksLikeHardNegativeUndergradConstraint(value: string): boolean {
  return value.length > 0 && HARD_NEGATIVE_UNDERGRAD_RE.test(value);
}

function looksLikeGraduateOnlyInstruction(value: string): boolean {
  return (
    value.length > 0 &&
    GRAD_ONLY_INSTRUCTION_RE.test(value) &&
    !UNDERGRAD_REFERENCE_RE.test(value)
  );
}

function looksLikeUndergradAdministrativeTitle(value: string): boolean {
  return value.length > 0 && UNDERGRAD_ADMIN_TITLE_RE.test(value);
}

function quoteMentionsUndergraduates(value: string | undefined | null): boolean {
  return Boolean(value && UNDERGRAD_REFERENCE_RE.test(value));
}

function firstUndergradSpecificQuote(normalized: LLMExtraction): string {
  return (
    [
      normalized.evidenceQuote,
      normalized.undergradRoleQuote,
      normalized.contactInstructionsQuote,
      normalized.explicitConstraintQuote,
    ].find((quote) => quoteMentionsUndergraduates(quote)) || ''
  );
}

function clearAccessVerdict(normalized: LLMExtraction): void {
  normalized.openToUndergrads = 'unclear';
  normalized.evidenceSource = 'none';
  normalized.evidenceQuote = '';
  normalized.currentUndergradCount = 0;
  normalized.joinPageUrl = null;
}

export function normalizeExtraction(extraction: LLMExtraction): LLMExtraction {
  const normalized: LLMExtraction = {
    ...extraction,
    evidenceQuote: (extraction.evidenceQuote || '').trim(),
    joinPageUrl: extraction.joinPageUrl ? extraction.joinPageUrl.trim() : null,
    undergradRoleQuote: (extraction.undergradRoleQuote || '').trim(),
    contactInstructionsQuote: (extraction.contactInstructionsQuote || '').trim(),
    explicitConstraintQuote: (extraction.explicitConstraintQuote || '').trim(),
  };

  const hardNegativeQuote = [
    normalized.explicitConstraintQuote,
    normalized.evidenceQuote,
    normalized.contactInstructionsQuote,
  ].find((quote): quote is string => looksLikeHardNegativeUndergradConstraint(quote || ''));
  const gradOnlyQuote = [
    normalized.explicitConstraintQuote,
    normalized.contactInstructionsQuote,
    normalized.evidenceQuote,
  ].find((quote): quote is string => looksLikeGraduateOnlyInstruction(quote || ''));

  if (!normalized.explicitConstraintQuote) {
    normalized.explicitConstraintQuote = hardNegativeQuote || gradOnlyQuote || '';
  }

  if (normalized.openToUndergrads === 'yes') {
    const supportedQuote = firstUndergradSpecificQuote(normalized);
    if (gradOnlyQuote && !supportedQuote) {
      clearAccessVerdict(normalized);
    } else if (!supportedQuote) {
      clearAccessVerdict(normalized);
    } else if (!quoteMentionsUndergraduates(normalized.evidenceQuote)) {
      normalized.evidenceQuote = supportedQuote;
    }
  }

  if (
    normalized.openToUndergrads === 'yes' &&
    looksLikeUndergradAdministrativeTitle(normalized.evidenceQuote)
  ) {
    normalized.openToUndergrads = 'unclear';
    normalized.evidenceSource = 'none';
    normalized.evidenceQuote = '';
    normalized.currentUndergradCount = 0;
  }

  if (
    normalized.openToUndergrads === 'no' &&
    !hardNegativeQuote &&
    !quoteMentionsUndergraduates(normalized.evidenceQuote)
  ) {
    clearAccessVerdict(normalized);
  }

  if (normalized.openToUndergrads === 'unclear' && hardNegativeQuote) {
    normalized.openToUndergrads = 'no';
    if (normalized.evidenceSource === 'none') {
      normalized.evidenceSource = 'explicit_text';
    }
    if (!normalized.evidenceQuote) {
      normalized.evidenceQuote = hardNegativeQuote;
    }
  }

  if (normalized.openToUndergrads === 'unclear') {
    normalized.evidenceSource = 'none';
    normalized.evidenceQuote = '';
    normalized.currentUndergradCount = 0;
  }

  return normalized;
}

/**
 * Pure: turn an LLMExtraction into the ObservationInput list the materializer
 * will consume. Implements the rules:
 *
 *   - undergradAccessEvidence: emitted iff openToUndergrads is 'yes' or 'no';
 *     skipped on 'unclear'. Confidence override 0.5 (LLM-based, low-trust).
 *   - acceptingUndergrads: still emitted for legacy compatibility only.
 *   - currentUndergradCount: emitted iff evidenceSource is 'members_section'
 *     AND the count is a non-negative integer. Open prose ("we have many
 *     undergrads") is too unreliable to write a count from. Confidence 0.5.
 *   - undergradEvidenceQuote: emitted iff evidenceQuote is non-empty.
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
    quoteSourceUrls?: LLMQuoteSourceUrls;
  } = {},
): ObservationInput[] {
  const normalizedExtraction = normalizeExtraction(extraction);
  const sourceUrls = sourceContext.sourceUrls?.filter(Boolean) ?? [sourceUrl];
  const quoteSourceUrl = sourceContext.quoteSourceUrl || sourceUrl;
  const quoteSourceUrls = sourceContext.quoteSourceUrls || {};
  const evidenceQuoteSourceUrl = quoteSourceUrls.evidenceQuote || quoteSourceUrl;
  const base = {
    entityType: 'researchEntity' as const,
    entityKey: groupSlug,
    sourceUrl,
  };
  const out: ObservationInput[] = [];

  if (normalizedExtraction.openToUndergrads === 'yes') {
    out.push({
      ...base,
      field: 'undergradAccessEvidence',
      value: {
        openToUndergrads: normalizedExtraction.openToUndergrads,
        evidenceSource: normalizedExtraction.evidenceSource,
        evidenceQuote: normalizedExtraction.evidenceQuote,
        sourceUrls,
        quoteSourceUrl: evidenceQuoteSourceUrl,
      },
      confidenceOverride: 0.5,
    });
    out.push({
      ...base,
      field: 'acceptingUndergrads',
      value: true,
      confidenceOverride: 0.5,
    });
  } else if (normalizedExtraction.openToUndergrads === 'no') {
    out.push({
      ...base,
      field: 'undergradAccessEvidence',
      value: {
        openToUndergrads: normalizedExtraction.openToUndergrads,
        evidenceSource: normalizedExtraction.evidenceSource,
        evidenceQuote: normalizedExtraction.evidenceQuote,
        sourceUrls,
        quoteSourceUrl: evidenceQuoteSourceUrl,
      },
      confidenceOverride: 0.5,
    });
    out.push({
      ...base,
      field: 'acceptingUndergrads',
      value: false,
      confidenceOverride: 0.5,
    });
  }
  // 'unclear' → no observation

  if (
    normalizedExtraction.evidenceSource === 'members_section' &&
    Number.isInteger(normalizedExtraction.currentUndergradCount) &&
    normalizedExtraction.currentUndergradCount >= 0
  ) {
    out.push({
      ...base,
      field: 'currentUndergradCount',
      value: normalizedExtraction.currentUndergradCount,
      confidenceOverride: 0.5,
    });
  }

  const quote = normalizedExtraction.evidenceQuote;
  if (quote) {
    out.push({
      ...base,
      sourceUrl: evidenceQuoteSourceUrl,
      field: 'undergradEvidenceQuote',
      value: redactDirectContactInfo(quote).slice(0, 500),
      confidenceOverride: 0.5,
    });
  }

  if (normalizedExtraction.joinPageUrl) {
    out.push({
      ...base,
      field: 'joinPageUrl',
      value: normalizedExtraction.joinPageUrl,
      confidenceOverride: 0.5,
    });
  }

  const undergradRoleQuote = normalizedExtraction.undergradRoleQuote || '';
  if (undergradRoleQuote) {
    out.push({
      ...base,
      sourceUrl: quoteSourceUrls.undergradRoleQuote || quoteSourceUrl,
      field: 'undergradRoleEvidenceQuote',
      value: redactDirectContactInfo(undergradRoleQuote).slice(0, 500),
      confidenceOverride: 0.5,
    });
  }

  const contactInstructionsQuote = normalizedExtraction.contactInstructionsQuote || '';
  if (contactInstructionsQuote) {
    out.push({
      ...base,
      sourceUrl: quoteSourceUrls.contactInstructionsQuote || quoteSourceUrl,
      field: 'contactInstructionsQuote',
      value: redactDirectContactInfo(contactInstructionsQuote).slice(0, 500),
      confidenceOverride: 0.5,
    });
  }

  const explicitConstraintQuote = normalizedExtraction.explicitConstraintQuote || '';
  if (explicitConstraintQuote) {
    out.push({
      ...base,
      sourceUrl: quoteSourceUrls.explicitConstraintQuote || quoteSourceUrl,
      field: 'undergradConstraintQuote',
      value: redactDirectContactInfo(explicitConstraintQuote).slice(0, 500),
      confidenceOverride: 0.5,
    });
  }

  out.push({ ...base, field: 'lastObservedAt', value: observedAt });

  return out;
}

/**
 * Pure: filter the list of candidate ResearchEntities down to the ones we
 * should actually process this run.
 *
 *   - drop labs without a websiteUrl
 *   - drop labs whose `acceptingUndergrads` is locked manually
 *   - drop labs that are archived
 *   - apply --only slug allowlist (case-insensitive)
 *   - apply --limit cap
 */
export interface CandidateLab {
  _id: any;
  slug: string;
  name: string;
  websiteUrl: string;
  archived?: boolean;
  manuallyLockedFields?: string[];
  listingBacked?: boolean;
  activeListingCount?: number;
  listingWebsiteUrls?: string[];
}

export interface ListingGuidance {
  researchEntityId: string;
  activeListingCount: number;
  websiteUrls: string[];
}

function usableWebsiteUrlFromDoc(doc: Record<string, any>): string {
  return firstUsableResearchWebsiteUrl([
    doc.websiteUrl,
    doc.website,
    ...(Array.isArray(doc.sourceUrls) ? doc.sourceUrls : []),
  ]);
}

function idToString(value: unknown): string {
  if (!value) return '';
  return String(value);
}

function uniqueHttpUrls(values: unknown[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values.flatMap((item) => (Array.isArray(item) ? item : [item]))) {
    if (typeof value !== 'string') continue;
    const url = value.trim();
    if (!isUsableResearchWebsiteUrl(url)) continue;
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url);
  }
  return out;
}

function cleanHomepageLabName(value: unknown): string {
  if (typeof value !== 'string') return '';
  const cleaned = value
    .replace(/\s+/g, ' ')
    .replace(/\s*[|–—-]\s*(?:Yale University|Yale School of.*|Yale Engineering).*$/i, '')
    .replace(/\s+at\s+Yale(?:\s+University)?(?:\s+.*)?$/i, '')
    .trim();
  if (!cleaned || cleaned.length < 3 || cleaned.length > 80) return '';
  if (/^(home|welcome|research|people|members|publications|contact|about)$/i.test(cleaned)) {
    return '';
  }
  if (!/\b(lab|laboratory|center|centre|group|faboratory)\b/i.test(cleaned)) return '';
  return cleaned;
}

function isGeneratedFacultyResearchArea(lab: Pick<CandidateLab, 'slug'>): boolean {
  return /^faculty-research-area-/i.test(lab.slug || '');
}

function officialLabNameFromHomePage(html: string): string {
  if (!html) return '';
  let $: cheerio.CheerioAPI;
  try {
    $ = cheerio.load(html);
  } catch {
    return '';
  }

  const candidates = [
    $('h1').first().text(),
    $('meta[property="og:title"]').attr('content'),
    $('meta[name="twitter:title"]').attr('content'),
    $('title').first().text(),
  ];

  for (const candidate of candidates) {
    const name = cleanHomepageLabName(candidate);
    if (name) return name;
  }
  return '';
}

export function labIdentityObservationsFromHomePage(
  lab: Pick<CandidateLab, '_id' | 'slug' | 'name' | 'websiteUrl' | 'manuallyLockedFields'>,
  homePage: FetchedPage,
  observedAt: Date = new Date(),
): ObservationInput[] {
  const websiteUrl = firstUsableResearchWebsiteUrl([homePage.url]);
  if (!lab.slug || !websiteUrl) return [];

  const locked = new Set(lab.manuallyLockedFields || []);
  const base = {
    entityType: 'researchEntity' as const,
    entityKey: lab.slug,
    sourceUrl: websiteUrl,
    observedAt,
    confidenceOverride: LAB_IDENTITY_CONFIDENCE_OVERRIDE,
  };
  const out: ObservationInput[] = [];
  const homepageName = officialLabNameFromHomePage(homePage.html);
  const existingName = String(lab.name || '').replace(/\s+/g, ' ').trim().toLowerCase();

  if (homepageName && homepageName.toLowerCase() !== existingName && !locked.has('name')) {
    out.push({ ...base, field: 'name', value: homepageName });
  }
  if (!lab.websiteUrl && !locked.has('websiteUrl')) {
    out.push({ ...base, field: 'websiteUrl', value: websiteUrl });
  }
  if (!locked.has('sourceUrls')) {
    out.push({ ...base, field: 'sourceUrls', value: [websiteUrl] });
  }

  return out;
}

function isYsmOfficialLabMicrositeUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return (
      url.hostname.toLowerCase() === 'medicine.yale.edu' &&
      /^\/lab\/[^/]+\/?$/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}

export function ysmLeadObservationsFromHomePage(
  lab: Pick<CandidateLab, 'slug' | 'name' | 'websiteUrl'>,
  homePage: FetchedPage,
  candidates: FacultyUserCandidate[],
  observedAt: Date = new Date(),
): ObservationInput[] {
  if (!lab.slug || !isYsmOfficialLabMicrositeUrl(homePage.url)) return [];

  const principalInvestigators = parsePrincipalInvestigatorProfilesFromLabHtml(
    homePage.html,
    homePage.url,
  );
  if (principalInvestigators.length === 0) return [];

  const piUserIds = findPiUserIdsForLabFromCandidates(
    {
      name: lab.name,
      url: lab.websiteUrl || homePage.url,
      slug: lab.slug,
      principalInvestigators,
    },
    candidates,
  );
  const base = {
    entityType: 'researchEntity' as const,
    entityKey: lab.slug,
    sourceUrl: homePage.url,
    observedAt,
    confidenceOverride: 0.5,
  };

  return [
    ...piUserIds.map((piUserId) => ({
      ...base,
      field: 'inferredPiUserId',
      value: piUserId,
    })),
    ...piProfileUserObservationsFromProfiles(
      principalInvestigators,
      candidates,
      homePage.url,
    ).map((observation) => ({ ...observation, observedAt })),
  ];
}

export function candidateLabFromResearchEntityDoc(doc: Record<string, any>): CandidateLab {
  return {
    _id: doc._id,
    slug: doc.slug,
    name: doc.name,
    websiteUrl: usableWebsiteUrlFromDoc(doc),
    archived: !!doc.archived,
    manuallyLockedFields: doc.manuallyLockedFields || [],
  };
}

export function applyListingGuidanceToCandidateLabs(
  candidates: CandidateLab[],
  guidance: ListingGuidance[],
): CandidateLab[] {
  const guidanceByEntityId = new Map(
    guidance.map((item) => [String(item.researchEntityId), item]),
  );

  return candidates.map((candidate) => {
    const item = guidanceByEntityId.get(idToString(candidate._id));
    if (!item) return candidate;

    const listingWebsiteUrls = uniqueHttpUrls(item.websiteUrls);
    return {
      ...candidate,
      websiteUrl: candidate.websiteUrl || listingWebsiteUrls[0] || '',
      activeListingCount: item.activeListingCount,
      listingBacked: item.activeListingCount > 0,
      listingWebsiteUrls,
    };
  });
}

function listingGuidanceFromDocs(listings: Record<string, any>[]): ListingGuidance[] {
  const byEntityId = new Map<string, ListingGuidance>();
  for (const listing of listings) {
    const researchEntityId = idToString(listing.researchEntityId || listing.researchGroupId);
    if (!researchEntityId) continue;
    const existing = byEntityId.get(researchEntityId) || {
      researchEntityId,
      activeListingCount: 0,
      websiteUrls: [],
    };
    existing.activeListingCount += 1;
    existing.websiteUrls = uniqueHttpUrls([...existing.websiteUrls, listing.websites]);
    byEntityId.set(researchEntityId, existing);
  }
  return Array.from(byEntityId.values());
}

export function selectLabsToProcess(
  candidates: CandidateLab[],
  options: { only?: string[]; limit?: number },
): CandidateLab[] {
  const onlyFilter =
    options.only && options.only.length > 0
      ? new Set(options.only.map((s) => s.trim().toLowerCase()))
      : null;
  const limit = options.limit && options.limit > 0 ? options.limit : DEFAULT_LIMIT;

  const out: CandidateLab[] = [];
  for (const lab of candidates) {
    if (!isUsableResearchWebsiteUrl(lab.websiteUrl)) continue;
    if (isGeneratedFacultyResearchArea(lab)) continue;
    if (lab.archived) continue;
    if ((lab.manuallyLockedFields || []).includes('acceptingUndergrads')) continue;
    if (onlyFilter && !onlyFilter.has(lab.slug.toLowerCase())) continue;
    out.push(lab);
  }
  return out
    .sort((a, b) => (b.activeListingCount || 0) - (a.activeListingCount || 0))
    .slice(0, limit);
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
  try {
    const res = await axios.get(url, {
      timeout: FETCH_TIMEOUT_MS,
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,*/*' },
      maxRedirects: 5,
      validateStatus: (s) => s >= 200 && s < 300,
      responseType: 'text',
      transitional: { clarifyTimeoutError: true } as any,
    });
    return { url, html: typeof res.data === 'string' ? res.data : String(res.data ?? '') };
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
}) => Promise<LLMExtraction>;

export type WorkPlanLoaderFn = (
  lab: CandidateLab,
  policy: WorkPlannerSourcePolicy,
  ctx: ScraperContext,
) => Promise<EntityWorkPlan>;
export type UserFinderFn = () => Promise<FacultyUserCandidate[]>;

export const defaultCallLLM: CallLLMFn = async ({
  model,
  systemPrompt,
  userPrompt,
  apiKey,
}) => {
  const res = await axios.post(
    'https://api.openai.com/v1/chat/completions',
    {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: LAB_UNDERGRAD_RESPONSE_FORMAT,
      temperature: 0,
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
    throw new Error(`LLM returned invalid JSON: ${err?.message || err}`);
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
  userFinder?: UserFinderFn;
  /** Resolves the candidate-lab list. Default queries Mongo. */
  labFinder?: () => Promise<CandidateLab[]>;
  model?: string;
  apiKey?: string;
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

/** Default: query ResearchEntity rows with a usable website/source URL. */
async function defaultLabFinder(): Promise<CandidateLab[]> {
  const docs = await ResearchEntity.find(
    {
      archived: { $ne: true },
      $or: [
        { websiteUrl: { $exists: true, $ne: '' } },
        { website: { $exists: true, $ne: '' } },
        { sourceUrls: /^https?:\/\//i },
      ],
    },
    {
      _id: 1,
      slug: 1,
      name: 1,
      websiteUrl: 1,
      website: 1,
      sourceUrls: 1,
      archived: 1,
      manuallyLockedFields: 1,
    },
  ).lean();
  return (docs as any[]).map(candidateLabFromResearchEntityDoc);
}

async function defaultUserFinder(): Promise<FacultyUserCandidate[]> {
  const docs = await User.find(
    {
      $or: [
        { userType: { $in: ['professor', 'faculty'] } },
        { email: /@yale\.edu$/i },
        { profileUrls: { $exists: true, $ne: null } },
      ],
    },
    { _id: 1, netid: 1, fname: 1, lname: 1, primaryDepartment: 1, email: 1, profileUrls: 1 },
  ).lean();
  return docs as FacultyUserCandidate[];
}

export class LabMicrositeUndergradLLMExtractor implements IScraper {
  readonly name = 'lab-microsite-undergrad-llm';
  readonly displayName = 'Lab microsite LLM (undergrad signals)';

  private readonly fetchPage: FetchPageFn;
  private readonly renderedFetcher: RenderedFetcher | null;
  private readonly callLLM: CallLLMFn;
  private readonly workPlanLoader: WorkPlanLoaderFn;
  private readonly userFinder: UserFinderFn;
  private readonly labFinder: () => Promise<CandidateLab[]>;
  private readonly model: string;
  private readonly apiKey: string | undefined;

  constructor(deps: LabMicrositeUndergradLLMExtractorDeps = {}) {
    this.fetchPage = deps.fetchPage ?? defaultFetchPage;
    this.renderedFetcher = deps.renderedFetcher ?? createScraplingRenderedFetcher();
    this.callLLM = deps.callLLM ?? defaultCallLLM;
    this.workPlanLoader = deps.workPlanLoader ?? defaultWorkPlanLoader;
    this.userFinder = deps.userFinder ?? defaultUserFinder;
    this.labFinder = deps.labFinder ?? defaultLabFinder;
    this.model = deps.model ?? DEFAULT_MODEL;
    this.apiKey = deps.apiKey ?? process.env.OPENAI_API_KEY;
  }

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    if (!this.apiKey) {
      ctx.log(
        'OPENAI_API_KEY missing — cannot run LLM extraction; emitting zero observations.',
      );
      return {
        observationCount: 0,
        entitiesObserved: 0,
        notes: 'OPENAI_API_KEY missing',
      };
    }

    const candidates = await this.labFinder();
    const listingBackedCandidates = candidates.filter((lab) => lab.listingBacked).length;
    ctx.log(
      `Found ${candidates.length} candidate ResearchEntities (${listingBackedCandidates} listing-backed)`,
    );

    const labs = selectLabsToProcess(candidates, {
      only: ctx.options.only,
      limit: ctx.options.limit,
    });
    const needsYsmLeadCandidates = labs.some((lab) =>
      isYsmOfficialLabMicrositeUrl(lab.websiteUrl),
    );
    const userCandidates = needsYsmLeadCandidates ? await this.userFinder() : [];
    ctx.log(
      `Processing ${labs.length} labs (limit=${ctx.options.limit ?? DEFAULT_LIMIT}, only=${(ctx.options.only || []).join(',') || 'none'})`,
    );

    let totalObs = 0;
    let processed = 0;
    let succeeded = 0;
    let fetchFailed = 0;
    let llmFailed = 0;
    const fetchAttempts: ScraperFetchMetric[] = [];
    const undergradLlmReviewSamples: UndergradLlmReviewSample[] = [];
    const workPlannerPolicy = ctx.options.ignoreWorkPlanner
      ? undefined
      : getWorkPlannerSourcePolicy(this.name);
    const workPlannerMetrics = createWorkPlannerMetrics();

    for (const lab of labs) {
      processed++;
      if (workPlannerPolicy) {
        if (!lab.slug) {
          recordWorkPlannerNoIdentifier(workPlannerMetrics);
          ctx.log(`[${lab.name}] skipped by WorkPlanner — missing slug/entity key.`);
          continue;
        }
        const plan = await this.workPlanLoader(lab, workPlannerPolicy, ctx);
        recordWorkPlannerDecision(workPlannerMetrics, plan);
        if (!plan.shouldFetch) {
          const reasons = Array.from(new Set(plan.fields.map((field) => field.reason))).join(',');
          ctx.log(`[${lab.slug}] skipped by WorkPlanner — ${reasons || 'fresh'}.`);
          continue;
        }
      }

      const measuredHomePage = await measureRenderedFetch(
        lab.websiteUrl,
        'http',
        () => this.fetchPage(lab.websiteUrl),
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
        continue;
      }
      const homeText = htmlToPromptText(homePage.html);

      const subPages: PromptSourcePage[] = [];
      for (const candidate of candidateCrawlUrls(homePage.html, homePage.url)) {
        if (subPages.length >= MAX_SUBPAGES_FETCHED) break;
        const measuredSubPage = await measureRenderedFetch(
          candidate,
          'http',
          () => this.fetchPage(candidate),
        );
        fetchAttempts.push(measuredSubPage.metric);
        const fetched = measuredSubPage.result;
        if (!fetched) continue;
        const text = htmlToPromptText(fetched.html);
        if (!text) continue;
        subPages.push({ url: fetched.url, text });
      }
      const [primarySubPage, ...additionalSubPages] = subPages;

      const userPrompt = buildLLMPrompt(
        lab.name,
        homePage.url,
        homeText,
        primarySubPage?.url ?? null,
        primarySubPage?.text ?? null,
        additionalSubPages,
      );

      // Per-(websiteUrl, model) cache so reruns don't re-charge OpenAI.
      const sourceUrls = [homePage.url, ...subPages.map((page) => page.url)];
      const cacheKey = `llm:${this.model}:${sourceUrls.join('+')}`;

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
            systemPrompt: SYSTEM_PROMPT,
            userPrompt,
            apiKey: this.apiKey,
          });
        } catch (err: any) {
          ctx.log(
            `[${lab.slug}] LLM call failed: ${err?.message || err}; skipping.`,
          );
          llmFailed++;
          continue;
        }
        if (ctx.options.useCache && extraction) {
          try {
            await setCached(SOURCE_KEY, cacheKey, extraction);
          } catch {
            /* ignore cache errors */
          }
        }
      }

      const observedAt = new Date();
      const validation = validateExtractionAgainstSources(
        extraction,
        { url: homePage.url, text: homeText },
        subPages,
        sourceUrls,
      );
      const quoteSourceUrl = validation.quoteSourceUrl || homePage.url;
      if (
        ctx.options.dryRun &&
        undergradLlmReviewSamples.length < MAX_UNDERGRAD_LLM_REVIEW_SAMPLES
      ) {
        undergradLlmReviewSamples.push({
          slug: lab.slug,
          name: lab.name,
          sourceUrl: quoteSourceUrl,
          sourceUrls,
          quote: (validation.extraction.evidenceQuote || '').trim(),
          verdict: validation.extraction.openToUndergrads,
          evidenceSource: validation.extraction.evidenceSource,
          joinPageUrl: validation.extraction.joinPageUrl,
          decision: validation.decision,
          rejectionReasons: validation.rejectionReasons,
        });
      }
      const observations = [
        ...labIdentityObservationsFromHomePage(lab, homePage, observedAt),
        ...ysmLeadObservationsFromHomePage(lab, homePage, userCandidates, observedAt),
        ...extractionToObservations(
          lab.slug,
          quoteSourceUrl,
          validation.extraction,
          observedAt,
          {
            sourceUrls,
            quoteSourceUrl,
            quoteSourceUrls: validation.quoteSourceUrls,
          },
        ),
      ];
      if (observations.length > 0) {
        await ctx.emit(observations);
        totalObs += observations.length;
      }
      succeeded++;

      if (processed % 25 === 0 || processed === labs.length) {
        ctx.log(
          `progress: ${processed}/${labs.length} labs | ${succeeded} ok | ${fetchFailed} fetch-failed | ${llmFailed} llm-failed | ${totalObs} obs`,
        );
      }
    }

    ctx.log(
      `Done. processed=${processed}, succeeded=${succeeded}, fetchFailed=${fetchFailed}, llmFailed=${llmFailed}, observations=${totalObs}`,
    );

    return {
      observationCount: totalObs,
      entitiesObserved: succeeded,
      notes: `LLM-extracted undergrad signals for ${succeeded}/${processed} labs (${fetchFailed} fetch-failed, ${llmFailed} llm-failed, ${workPlannerMetrics.skippedFresh + workPlannerMetrics.skippedManualLock} workplanner-skipped)`,
      metrics: {
        workPlanner: workPlannerMetrics,
        ...(undergradLlmReviewSamples.length > 0
          ? { undergradLlmReviewSamples }
          : {}),
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
