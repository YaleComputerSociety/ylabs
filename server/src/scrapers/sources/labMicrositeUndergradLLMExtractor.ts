/**
 * LabMicrositeUndergradLLMExtractor
 *
 * For every ResearchGroup with a non-empty `websiteUrl`, fetch the lab home
 * page (and a likely "people"/"members"/"join" sub-page if discoverable),
 * strip HTML to plain text, and ask an LLM (gpt-4o-mini via OpenAI's
 * structured-output API) to extract three undergrad-related signals:
 *
 *   - `acceptingUndergrads`     (Boolean)   — yes/no/unclear from page content
 *   - `currentUndergradCount`   (Integer)   — only emitted when the LLM
 *                                              identified a members section
 *                                              (open prose is unreliable)
 *   - `undergradEvidenceQuote`  (String)    — verbatim quote from the page
 *                                              proving the verdict
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
import { ResearchGroup } from '../../models/researchGroup';
import { getCached, setCached } from '../snapshotCache';
import type {
  IScraper,
  ObservationInput,
  ScraperContext,
  ScraperResult,
} from '../types';

const USER_AGENT = 'ylabs-scraper/1.0 (+https://yalelabs.io)';
const FETCH_TIMEOUT_MS = 10_000;
const MAX_PROMPT_CHARS = 50_000;
const DEFAULT_LIMIT = 100;
const DEFAULT_MODEL = 'gpt-4o-mini';
const SOURCE_KEY = 'lab-microsite-undergrad-llm';

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
      },
      required: [
        'openToUndergrads',
        'currentUndergradCount',
        'evidenceQuote',
        'evidenceSource',
        'joinPageUrl',
      ],
    },
    strict: true,
  },
};

const SYSTEM_PROMPT = `You are an expert classifier evaluating whether a Yale research lab's website indicates that the lab accepts undergraduate researchers.

Your job is to read text scraped from a lab's website (home page plus optionally a "members" or "join" sub-page) and return a JSON object with these fields:

- openToUndergrads: "yes" if there is text that affirmatively states the lab welcomes / hires / mentors undergraduates, OR if the members section lists undergraduate students. "no" if the lab explicitly states they do NOT take undergraduates. "unclear" otherwise. Default to "unclear" — be conservative.
- currentUndergradCount: integer count of currently-listed undergraduates if (and only if) you can identify a members section that explicitly labels undergraduates. Return 0 if no members section exists or no undergrads are listed there.
- evidenceQuote: a verbatim quote from the page (≤200 characters) that supports your verdict. If openToUndergrads is "unclear" or "no", quote the most relevant text you found, or empty string if there is none.
- evidenceSource: "explicit_text" if your verdict comes from prose ("we welcome undergraduates"), "members_section" if from a roster listing, "none" if no evidence.
- joinPageUrl: the URL (absolute) of a "join the lab" or "opportunities" page, if mentioned. Otherwise null.

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
 * resolved URL. Returns at most one absolute URL — the first anchor whose
 * text matches `SUBPAGE_ANCHOR_RE`. The caller can additionally probe
 * `SUBPAGE_PATH_HINTS` if no link is found.
 */
export function discoverSubPageUrl(html: string, pageUrl: string): string | null {
  if (!html) return null;
  let $: cheerio.CheerioAPI;
  try {
    $ = cheerio.load(html);
  } catch {
    return null;
  }
  let found: string | null = null;
  $('a').each((_i, el) => {
    if (found) return;
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
      found = abs;
    } catch {
      /* ignore malformed URL */
    }
  });
  return found;
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
 * Pure: assemble the user-facing prompt body the LLM sees.
 */
export function buildLLMPrompt(
  groupName: string,
  homeUrl: string,
  homeText: string,
  subPageUrl: string | null,
  subPageText: string | null,
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
  return parts.join('\n').slice(0, MAX_PROMPT_CHARS);
}

/**
 * Pure: turn an LLMExtraction into the ObservationInput list the materializer
 * will consume. Implements the rules:
 *
 *   - acceptingUndergrads: emitted iff openToUndergrads is 'yes' or 'no';
 *     skipped on 'unclear'. Confidence override 0.5 (LLM-based, low-trust).
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
): ObservationInput[] {
  const base = {
    entityType: 'researchGroup' as const,
    entityKey: groupSlug,
    sourceUrl,
  };
  const out: ObservationInput[] = [];

  if (extraction.openToUndergrads === 'yes') {
    out.push({
      ...base,
      field: 'acceptingUndergrads',
      value: true,
      confidenceOverride: 0.5,
    });
  } else if (extraction.openToUndergrads === 'no') {
    out.push({
      ...base,
      field: 'acceptingUndergrads',
      value: false,
      confidenceOverride: 0.5,
    });
  }
  // 'unclear' → no observation

  if (
    extraction.evidenceSource === 'members_section' &&
    Number.isInteger(extraction.currentUndergradCount) &&
    extraction.currentUndergradCount >= 0
  ) {
    out.push({
      ...base,
      field: 'currentUndergradCount',
      value: extraction.currentUndergradCount,
      confidenceOverride: 0.5,
    });
  }

  const quote = (extraction.evidenceQuote || '').trim();
  if (quote) {
    out.push({
      ...base,
      field: 'undergradEvidenceQuote',
      value: quote.slice(0, 500),
      confidenceOverride: 0.5,
    });
  }

  out.push({ ...base, field: 'lastObservedAt', value: observedAt });

  return out;
}

/**
 * Pure: filter the list of candidate ResearchGroups down to the ones we
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
    if (!lab.websiteUrl || !/^https?:\/\//i.test(lab.websiteUrl)) continue;
    if (lab.archived) continue;
    if ((lab.manuallyLockedFields || []).includes('acceptingUndergrads')) continue;
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
  callLLM?: CallLLMFn;
  /** Resolves the candidate-lab list. Default queries Mongo. */
  labFinder?: () => Promise<CandidateLab[]>;
  model?: string;
  apiKey?: string;
}

/** Default: query ResearchGroup for non-archived rows that have a website. */
async function defaultLabFinder(): Promise<CandidateLab[]> {
  const docs = await ResearchGroup.find(
    {
      archived: { $ne: true },
      websiteUrl: { $exists: true, $ne: '' },
    },
    {
      _id: 1,
      slug: 1,
      name: 1,
      websiteUrl: 1,
      archived: 1,
      manuallyLockedFields: 1,
    },
  ).lean();
  return (docs as any[]).map((d) => ({
    _id: d._id,
    slug: d.slug,
    name: d.name,
    websiteUrl: d.websiteUrl || '',
    archived: !!d.archived,
    manuallyLockedFields: d.manuallyLockedFields || [],
  }));
}

export class LabMicrositeUndergradLLMExtractor implements IScraper {
  readonly name = 'lab-microsite-undergrad-llm';
  readonly displayName = 'Lab microsite LLM (undergrad signals)';

  private readonly fetchPage: FetchPageFn;
  private readonly callLLM: CallLLMFn;
  private readonly labFinder: () => Promise<CandidateLab[]>;
  private readonly model: string;
  private readonly apiKey: string | undefined;

  constructor(deps: LabMicrositeUndergradLLMExtractorDeps = {}) {
    this.fetchPage = deps.fetchPage ?? defaultFetchPage;
    this.callLLM = deps.callLLM ?? defaultCallLLM;
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
    ctx.log(`Found ${candidates.length} candidate ResearchGroups with websiteUrl`);

    const labs = selectLabsToProcess(candidates, {
      only: ctx.options.only,
      limit: ctx.options.limit,
    });
    ctx.log(
      `Processing ${labs.length} labs (limit=${ctx.options.limit ?? DEFAULT_LIMIT}, only=${(ctx.options.only || []).join(',') || 'none'})`,
    );

    let totalObs = 0;
    let processed = 0;
    let succeeded = 0;
    let fetchFailed = 0;
    let llmFailed = 0;

    for (const lab of labs) {
      processed++;
      let homePage: FetchedPage | null;
      try {
        homePage = await this.fetchPage(lab.websiteUrl);
      } catch (err: any) {
        ctx.log(
          `[${lab.slug}] fetch error for ${lab.websiteUrl}: ${err?.message || err}`,
        );
        homePage = null;
      }
      if (!homePage) {
        fetchFailed++;
        continue;
      }
      const homeText = htmlToPromptText(homePage.html);

      // Try to find a likely sub-page (people/members/join). Best-effort.
      let subPage: FetchedPage | null = null;
      const linkedSub = discoverSubPageUrl(homePage.html, homePage.url);
      if (linkedSub) {
        try {
          subPage = await this.fetchPage(linkedSub);
        } catch {
          subPage = null;
        }
      } else {
        // Fall back to probing common path hints (one shot — first 200 wins).
        for (const candidate of candidateSubPageUrls(homePage.url)) {
          try {
            subPage = await this.fetchPage(candidate);
          } catch {
            subPage = null;
          }
          if (subPage) break;
        }
      }
      const subText = subPage ? htmlToPromptText(subPage.html) : null;
      const subUrl = subPage ? subPage.url : null;

      const userPrompt = buildLLMPrompt(
        lab.name,
        homePage.url,
        homeText,
        subUrl,
        subText,
      );

      // Per-(websiteUrl, model) cache so reruns don't re-charge OpenAI.
      const cacheKey = `llm:${this.model}:${homePage.url}${subUrl ? `+${subUrl}` : ''}`;

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

      const observations = extractionToObservations(
        lab.slug,
        homePage.url,
        extraction,
      );
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
      notes: `LLM-extracted undergrad signals for ${succeeded}/${processed} labs (${fetchFailed} fetch-failed, ${llmFailed} llm-failed)`,
    };
  }
}
