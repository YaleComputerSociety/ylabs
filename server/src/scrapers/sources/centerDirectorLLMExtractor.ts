/**
 * Center director LLM extractor.
 *
 * Organizational research homes (CENTER / INSTITUTE / INITIATIVE / CORE_FACILITY)
 * have no single PI, so the membership rosters scraped by
 * `centersInstitutesScraper` tag everyone `core-faculty` and the public
 * "Principal Investigator" panel renders empty. The actual leader — the
 * center's Director / Executive Director / Faculty Director — is named on a
 * separate leadership/about page that the roster scrape never reads.
 *
 * This source closes that gap. For each organizational home with an official
 * `websiteUrl` it:
 *   1. fetches the website and discovers same-host leadership-page candidates
 *      (anchors whose text/href match a leadership lexicon, plus the page
 *      itself), all SSRF-guarded;
 *   2. asks an LLM to extract the SINGLE top director literally named on the
 *      best candidate page (name, title, profile URL, director vs co-director);
 *   3. emits **entity-level** `inferredDirector*` observations keyed by the
 *      center's own slug.
 *
 * Conservatism is load-bearing, mirroring `centerAffiliationLLMExtractor`: the
 * LLM output is an observation, not a conclusion. The materializer
 * (`materializeInferredDirectorMembership`) resolves the named director to a
 * unique Yale User and only then promotes them to a `director` member — an
 * unresolved or hallucinated name never mints a lead. We intentionally extract
 * only the single top director; co-directors and multi-leader rosters are out
 * of scope for this source.
 */
import axios from 'axios';
import mongoose from 'mongoose';
import * as cheerio from 'cheerio';
import { assertPublicHttpUrl, ssrfSafeAgents } from '../../utils/ssrfGuard';
import { sanitizeLogValue } from '../../utils/logSanitizer';
import { redactDirectContactInfo } from '../../utils/contactRedaction';
import { serializedDocumentId } from '../../utils/idSerialization';
import { ResearchEntity } from '../../models/researchEntity';
import type { IScraper, ObservationInput, ScraperContext, ScraperResult } from '../types';
import { normalizeName, splitName } from '../utils/scraperHelpers';

const SOURCE_KEY = 'center-director-llm';
const DEFAULT_MODEL = 'gpt-4o-mini';
const MAX_PROMPT_CHARS = 30_000;
const MAX_LEADERSHIP_PAGES = 3;
const ORG_ENTITY_TYPES = ['CENTER', 'INSTITUTE', 'INITIATIVE', 'CORE_FACILITY'];
const CENTER_DIRECTOR_OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

export function normalizeCenterDirectorObjectId(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return CENTER_DIRECTOR_OBJECT_ID_RE.test(trimmed) ? trimmed : undefined;
  }
  if (value instanceof mongoose.Types.ObjectId) return value.toHexString();
  return undefined;
}

/** Anchor text / href tokens that suggest a page naming the center's leadership. */
const LEADERSHIP_LINK_PATTERN =
  /\b(leadership|director|directors|our[-\s]?(?:people|team|leadership)|about[-\s]?us|about|staff|administration|governance|who[-\s]?we[-\s]?are)\b/i;

export interface CenterDirector {
  name: string;
  title?: string;
  profileUrl?: string;
  role?: 'director' | 'co-director';
}

export interface CenterDirectorExtraction {
  director: CenterDirector | null;
}

export interface CandidateCenter {
  _id?: string;
  slug?: string;
  name: string;
  websiteUrl?: string;
}

export type FetchPageFn = (url: string) => Promise<{ url: string; html: string } | null>;
export type CallCenterDirectorLLMFn = (input: {
  model: string;
  apiKey: string;
  centerName: string;
  sourceUrl: string;
  pageText: string;
}) => Promise<CenterDirectorExtraction>;
export type CenterFinderFn = (options?: {
  only?: string[];
  missingLeadOnly?: boolean;
}) => Promise<CandidateCenter[]>;

export interface CenterDirectorLLMExtractorDeps {
  fetchPage?: FetchPageFn;
  callLLM?: CallCenterDirectorLLMFn;
  centerFinder?: CenterFinderFn;
  apiKey?: string;
  model?: string;
}

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

function htmlToText(html: string): string {
  if (!html) return '';
  const $ = cheerio.load(html);
  $('script, style, noscript, svg, iframe, nav, footer').remove();
  return textValue($('body').text() || $.root().text()).slice(0, MAX_PROMPT_CHARS);
}

function sameHost(a: string, b: string): boolean {
  try {
    return new URL(a).host === new URL(b).host;
  } catch {
    return false;
  }
}

/** Map an LLM-provided role onto director vs co-director. */
function normalizeDirectorRole(role: unknown, title: unknown): 'director' | 'co-director' {
  const value = `${textValue(role)} ${textValue(title)}`.toLowerCase();
  if (/\b(co[-\s]?director|associate director|deputy director|interim director)\b/.test(value)) {
    return 'co-director';
  }
  return 'director';
}

/**
 * From a fetched website, build the ordered list of same-host pages worth
 * reading for a director. Leadership-flavored links rank ahead of the page
 * itself; the result is capped to keep the crawl bounded.
 */
export function discoverLeadershipUrls(
  html: string,
  pageUrl: string,
  max = MAX_LEADERSHIP_PAGES,
): string[] {
  const ranked: string[] = [];
  const seen = new Set<string>();
  const push = (url: string) => {
    const normalized = url.split('#')[0];
    if (!normalized || seen.has(normalized) || !sameHost(normalized, pageUrl)) return;
    seen.add(normalized);
    ranked.push(normalized);
  };

  const $ = cheerio.load(html);
  $('a[href]').each((_i, el) => {
    const href = $(el).attr('href') || '';
    const text = textValue($(el).text());
    if (!LEADERSHIP_LINK_PATTERN.test(`${text} ${href}`)) return;
    try {
      push(new URL(href, pageUrl).toString());
    } catch {
      /* ignore unparseable hrefs */
    }
  });

  // Always consider the page itself last — some centers name the director inline.
  push(pageUrl.split('#')[0]);
  return ranked.slice(0, max);
}

/**
 * Turn an LLM director extraction into entity-level observations keyed by the
 * center's own slug. Emitting on the center entity (not a member slug) routes
 * the signal through `materializeInferredDirectorMembership`, which resolves the
 * name to a real User before writing any lead — avoiding the fuzzy
 * name→member-slug join the roster scraper uses.
 */
export function directorExtractionToObservations(
  extraction: CenterDirectorExtraction,
  context: { centerEntityKey: string; sourceUrl: string },
): ObservationInput[] {
  const director = extraction?.director;
  const name = textValue(director?.name);
  if (!context.centerEntityKey || !name) return [];
  const cleaned = normalizeName(name);
  const { last } = splitName(cleaned);
  // Match on first-token + surname (drop middle names/initials): User docs store
  // fname without a middle initial, so "Eric P. Winer" must resolve to {Eric, Winer}.
  const fname = cleaned.split(/\s+/).filter(Boolean)[0] || '';
  if (!fname || !last || fname === last) return [];

  const base = {
    entityType: 'researchEntity' as const,
    entityKey: context.centerEntityKey,
    sourceUrl: context.sourceUrl,
  };
  const role = normalizeDirectorRole(director?.role, director?.title);
  const obs: ObservationInput[] = [
    { ...base, field: 'inferredDirectorName', value: cleaned },
    { ...base, field: 'inferredDirectorUserName', value: { fname, lname: last } },
    // The director's leadership role is the high-trust signal; lift its
    // confidence above the roster scraper's core-faculty weight so the
    // promotion reads as authoritative.
    { ...base, field: 'inferredDirectorRole', value: role, confidenceOverride: 0.85 },
  ];
  const profileUrl = textValue(director?.profileUrl);
  if (profileUrl && /^https?:\/\//i.test(profileUrl)) {
    obs.push({ ...base, field: 'inferredDirectorProfileUrl', value: profileUrl });
  }
  const title = textValue(director?.title);
  if (title) obs.push({ ...base, field: 'inferredDirectorTitle', value: title });
  return obs;
}

async function defaultFetchPage(url: string): Promise<{ url: string; html: string } | null> {
  // SSRF guard: url is a DB-sourced center websiteUrl (or a link discovered on
  // it) — block private/metadata hosts and validate redirect hops at connect time.
  const safeUrl = await assertPublicHttpUrl(url);
  const safeUrlText = safeUrl.toString();
  const agents = ssrfSafeAgents();
  const res = await axios.get(safeUrlText, {
    timeout: 15_000,
    headers: { 'User-Agent': 'ylabs-scraper/1.0 (+https://yalelabs.io)' },
    httpAgent: agents.httpAgent,
    httpsAgent: agents.httpsAgent,
    maxRedirects: 5,
  });
  return { url: res.request?.res?.responseUrl || safeUrlText, html: String(res.data || '') };
}

async function defaultCallLLM(input: {
  model: string;
  apiKey: string;
  centerName: string;
  sourceUrl: string;
  pageText: string;
}): Promise<CenterDirectorExtraction> {
  const safeCenterName = redactDirectContactInfo(input.centerName).slice(0, 240);
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
          content:
            'You identify the single top leader of a Yale research center or institute from its official web page. ' +
            'Return the person whose title is Director, Executive Director, Faculty Director, or equivalent head of the center. ' +
            'Only return a real personal name that literally appears in the provided page text. ' +
            'Never invent a name. If no individual is clearly named as the center\'s director, return {"director":null}. ' +
            'Prefer the overall Director over associate/deputy/co-directors when both appear.',
        },
        {
          role: 'user',
          content: [
            `Center: ${safeCenterName}`,
            `Source URL: ${safeSourceUrl}`,
            'Return JSON: {"director":{"name":"First Last","title":"optional","profileUrl":"optional","role":"director|co-director"}} or {"director":null}',
            safePageText,
          ].join('\n\n'),
        },
      ],
      temperature: 0,
    },
    {
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 40_000,
    },
  );
  const content = response.data?.choices?.[0]?.message?.content;
  if (!content || typeof content !== 'string') throw new Error('LLM returned empty content');
  const parsed = JSON.parse(content) as Partial<CenterDirectorExtraction>;
  const director = parsed.director && typeof parsed.director === 'object' ? parsed.director : null;
  return { director: director && textValue((director as CenterDirector).name) ? (director as CenterDirector) : null };
}

async function defaultCenterFinder(
  options: { only?: string[]; missingLeadOnly?: boolean } = {},
): Promise<CandidateCenter[]> {
  // Local import to keep the model graph lazy and avoid a hard cycle.
  const { ResearchGroupMember } = await import('../../models/researchGroupMember');
  const only = Array.from(new Set((options.only || []).map((value) => value.trim()).filter(Boolean)));
  const onlyObjectIds = only
    .map((value) => normalizeCenterDirectorObjectId(value))
    .filter((value): value is string => Boolean(value))
    .map((value) => new mongoose.Types.ObjectId(value));
  const identityFilter = only.length
    ? {
        $or: [
          ...(onlyObjectIds.length ? [{ _id: { $in: onlyObjectIds } }] : []),
          { slug: { $in: only } },
          { name: { $in: only } },
        ],
      }
    : {};
  const docs = await ResearchEntity.find(
    {
      $and: [
        { entityType: { $in: ORG_ENTITY_TYPES } },
        { archived: { $ne: true } },
        { websiteUrl: /^https?:\/\//i },
        identityFilter,
      ],
    },
    { _id: 1, slug: 1, name: 1, websiteUrl: 1 },
  ).lean();

  let candidates = (docs as any[]).map((doc) => ({
    _id: serializedDocumentId(doc._id),
    slug: doc.slug,
    name: doc.name,
    websiteUrl: doc.websiteUrl,
  }));

  if (options.missingLeadOnly) {
    const withLead = await ResearchGroupMember.distinct('researchEntityId', {
      researchEntityId: { $in: (docs as any[]).map((doc) => doc._id) },
      role: { $in: ['pi', 'co-pi', 'director', 'co-director'] },
      isCurrentMember: { $ne: false },
    });
    const withLeadSet = new Set(withLead.map((id: any) => String(id)));
    candidates = candidates.filter((c) => !c._id || !withLeadSet.has(c._id));
  }
  return candidates;
}

export class CenterDirectorLLMExtractor implements IScraper {
  readonly name = SOURCE_KEY;
  readonly displayName = 'Center director LLM (organizational lead)';

  private readonly fetchPage: FetchPageFn;
  private readonly callLLM: CallCenterDirectorLLMFn;
  private readonly centerFinder: CenterFinderFn;
  private readonly apiKey?: string;
  private readonly model: string;

  constructor(deps: CenterDirectorLLMExtractorDeps = {}) {
    this.fetchPage = deps.fetchPage || defaultFetchPage;
    this.callLLM = deps.callLLM || defaultCallLLM;
    this.centerFinder = deps.centerFinder || defaultCenterFinder;
    this.apiKey = deps.apiKey || process.env.OPENAI_API_KEY;
    this.model = deps.model || DEFAULT_MODEL;
  }

  /**
   * Resolve the director for one center: read its website, follow the best
   * leadership-page candidates, and return the first confidently extracted
   * director plus the page it came from. Pure of DB writes — reused by the
   * backfill script.
   */
  async extractDirectorForCenter(
    center: CandidateCenter,
    log: (msg: string) => void = () => {},
  ): Promise<{ observations: ObservationInput[]; director: CenterDirector; sourceUrl: string } | null> {
    if (!this.apiKey || !center.websiteUrl || !center.slug) return null;
    let landing: { url: string; html: string } | null = null;
    try {
      landing = await this.fetchPage(center.websiteUrl);
    } catch (error) {
      log(`[${center.slug}] fetch failed for configured center URL: ${sanitizeLogValue(error)}`);
      return null;
    }
    if (!landing) return null;

    const candidateUrls = discoverLeadershipUrls(landing.html, landing.url);
    for (const url of candidateUrls) {
      let page: { url: string; html: string } | null = landing.url === url ? landing : null;
      if (!page) {
        try {
          page = await this.fetchPage(url);
        } catch (error) {
          log(`[${center.slug}] leadership fetch failed for discovered center URL: ${sanitizeLogValue(error)}`);
          continue;
        }
      }
      const pageText = htmlToText(page?.html || '');
      if (pageText.length < 120) continue;

      let extraction: CenterDirectorExtraction;
      try {
        extraction = await this.callLLM({
          model: this.model,
          apiKey: this.apiKey,
          centerName: center.name,
          sourceUrl: page?.url || url,
          pageText,
        });
      } catch (error) {
        log(`[${center.slug}] director LLM failed for center page: ${sanitizeLogValue(error)}`);
        continue;
      }
      const sourceUrl = page?.url || url;
      const observations = directorExtractionToObservations(extraction, {
        centerEntityKey: center.slug,
        sourceUrl,
      });
      if (observations.length && extraction.director) {
        return { observations, director: extraction.director, sourceUrl };
      }
    }
    return null;
  }

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    if (!this.apiKey) {
      ctx.log('OPENAI_API_KEY missing; skipping center director extraction.');
      return { observationCount: 0, entitiesObserved: 0, notes: 'OPENAI_API_KEY missing' };
    }

    const only = Array.from(
      new Set((ctx.options.only || []).map((v) => String(v).trim()).filter(Boolean)),
    );
    const offset = Math.max(0, Number(ctx.options.offset) || 0);
    const limit = Math.max(1, Number(ctx.options.limit) || 100);
    const candidates = (await this.centerFinder({ only, missingLeadOnly: true }))
      .filter((c) => c.websiteUrl && c.slug)
      .slice(offset, offset + limit);

    let observationCount = 0;
    let entitiesObserved = 0;

    for (const center of candidates) {
      try {
        const result = await this.extractDirectorForCenter(center, ctx.log);
        if (!result) {
          ctx.log(`[${center.slug}] no director named on leadership pages.`);
          continue;
        }
        await ctx.emit(result.observations);
        observationCount += result.observations.length;
        entitiesObserved += 1;
        ctx.log(`[${center.slug}] director extracted.`);
      } catch (error) {
        ctx.log(`[${center.slug}] director extraction failed: ${sanitizeLogValue(error)}`);
      }
    }

    return {
      observationCount,
      entitiesObserved,
      notes: `Extracted directors for ${entitiesObserved} organizational homes.`,
    };
  }
}
