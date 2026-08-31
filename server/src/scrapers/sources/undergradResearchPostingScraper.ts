/**
 * Undergraduate research posting scraper.
 *
 * Acquires real, apply-now undergraduate research postings from curated,
 * public Yale posting/opportunity index pages and emits `POSTED_OPENING`
 * access evidence for the hiring research home (#1568). This is the producer
 * that #1303 found missing and #1332 retired from the serve contract: the
 * highest-value access signal ("a specific position is open now, with an apply
 * route and a deadline") had no source.
 *
 * Evidence-first and fail-closed by design. A posting is only emitted when it
 * carries all four requirements: a title, a resolvable hiring research
 * home/entity, an apply route (http(s) apply URL), and an application deadline
 * that has not already passed. Generic guidance, undated postings, and
 * postings whose hiring home cannot be resolved to an existing ResearchEntity
 * are dropped. Auth-gated aggregators (Handshake, Workday student jobs) are
 * never configured here - inferring an opening from a generic lab website is
 * exactly the over-promise #1332 removed.
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import { getCached, setCached } from '../snapshotCache';
import type { IScraper, ObservationInput, ScraperContext, ScraperResult } from '../types';
import { ResearchEntity } from '../../models/researchEntity';
import { slugify } from '../utils/scraperHelpers';
import {
  DEFAULT_SOURCE_CONCURRENCY,
  mapWithConcurrency,
  resolveSourceConcurrency,
} from '../utils/mapWithConcurrency';
import { assertPublicHttpUrl, ssrfSafeAgents } from '../../utils/ssrfGuard';

export const UNDERGRAD_RESEARCH_POSTING_SOURCE = 'undergrad-research-posting';

const USER_AGENT = 'ylabs-scraper/1.0 (+https://yalelabs.io)';
const FETCH_TIMEOUT_MS = 30_000;

export interface UndergradResearchPostingPageConfig {
  key: string;
  url: string;
  blockSelector: string;
}

export interface RawUndergradResearchPosting {
  title: string;
  applyUrl: string;
  deadline: Date;
  hiringHome: string;
  evidenceQuote: string;
  postingUrl: string;
}

export interface ResolvedHiringHome {
  entityId: string;
  slug: string;
  name: string;
}

export type ResolveHiringHome = (name: string) => Promise<ResolvedHiringHome | null>;

type FetchHtml = (url: string, useCache: boolean) => Promise<string>;

export interface UndergradResearchPostingScraperDeps {
  pageConfigs?: UndergradResearchPostingPageConfig[];
  fetchHtml?: FetchHtml;
  resolveHiringHome?: ResolveHiringHome;
  now?: () => Date;
}

/**
 * Curated, public posting-index pages. Each must publish per-posting title,
 * hiring home, deadline, and apply URL. The source seed is disabled by default
 * (like the official research-home roster): an operator confirms each page is
 * reliably public and enables it on Development after verifying the live
 * capture, per docs/scraper-deployment-runbook.md.
 */
export const DEFAULT_UNDERGRAD_RESEARCH_POSTING_PAGES: UndergradResearchPostingPageConfig[] = [
  {
    key: 'yale-college-research-opportunities',
    url: 'https://science.yalecollege.yale.edu/research-opportunities/current-openings',
    blockSelector: 'article, .opportunity, .listing, .views-row, li',
  },
];

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function absoluteHttpUrl(rawUrl: string | undefined, pageUrl: string): string | undefined {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed || trimmed.startsWith('#') || /^mailto:/i.test(trimmed)) return undefined;
  if (/[<>"\s]/.test(trimmed)) return undefined;
  try {
    const url = new URL(trimmed, pageUrl);
    if (!/^https?:$/i.test(url.protocol)) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

const HIRING_HOME_LABEL =
  /\b(?:hiring\s+lab|host\s+lab|hosted\s+by|research\s+group|research\s+home|lab|principal\s+investigator|pi|faculty\s+mentor|mentor|supervisor|advisor|faculty)\b\s*[:\-–—]\s*(.+?)(?:[.;|]|$)/i;

const DEADLINE_LABEL =
  /\b(?:application\s+deadline|apply\s+by|applications?\s+(?:are\s+)?due|deadline|due\s+date|closes?)\b\s*[:\-–—]?\s*(.+?)(?:[.;|]|$)/i;

const APPLY_LINK_PATTERN = /\b(?:apply|application|interfolio|qualtrics|workday|submit|form)\b/i;

function blockLines($: cheerio.CheerioAPI, block: cheerio.Cheerio<any>): string[] {
  const lines = block
    .find('p, li, dd, dt')
    .toArray()
    .map((node) => normalizeText($(node).text()))
    .filter(Boolean);
  return lines.length > 0 ? lines : [normalizeText(block.text())];
}

function firstLabeledValue(lines: string[], pattern: RegExp): string | undefined {
  for (const line of lines) {
    const value = line.match(pattern)?.[1];
    if (value) return normalizeText(value);
  }
  return undefined;
}

function parseDeadline(value: string | undefined, now: Date): Date | undefined {
  if (!value) return undefined;
  const cleaned = normalizeText(value).replace(/\b(\d{1,2})(?:st|nd|rd|th)\b/gi, '$1');
  const parsed = new Date(cleaned);
  if (!Number.isFinite(parsed.getTime())) return undefined;
  return parsed.getTime() > now.getTime() ? parsed : undefined;
}

function blockApplyUrl(
  $: cheerio.CheerioAPI,
  block: cheerio.Cheerio<any>,
  pageUrl: string,
): string | undefined {
  const links = block
    .find('a')
    .toArray()
    .map((node) => ({
      text: normalizeText($(node).text()),
      url: absoluteHttpUrl($(node).attr('href'), pageUrl),
    }))
    .filter((link): link is { text: string; url: string } => Boolean(link.url));
  return links.find((link) => APPLY_LINK_PATTERN.test(`${link.text} ${link.url}`))?.url;
}

function blockTitle($: cheerio.CheerioAPI, block: cheerio.Cheerio<any>): string {
  const heading = block.find('h1, h2, h3, h4, h5').first();
  if (heading.length > 0) return normalizeText(heading.text());
  const strong = block.find('strong, b').first();
  return strong.length > 0 ? normalizeText(strong.text()) : '';
}

/**
 * Parse a curated posting-index page into fully-specified postings, dropping
 * any block that is missing a title, an apply route, a hiring home, or a
 * future-dated deadline. Deterministic and pure so it can be unit-tested
 * against captured HTML without a network or database.
 */
export function parseUndergradResearchPostingsPage(
  html: string,
  config: UndergradResearchPostingPageConfig,
  now: Date,
): RawUndergradResearchPosting[] {
  const $ = cheerio.load(html);
  const postings: RawUndergradResearchPosting[] = [];
  const seenTitles = new Set<string>();

  $(config.blockSelector).each((_i, node) => {
    const block = $(node);
    if (block.find(config.blockSelector).length > 0) return;
    const blockText = normalizeText(block.text());
    if (!blockText) return;

    const lines = blockLines($, block);
    const title = blockTitle($, block);
    const hiringHome = firstLabeledValue(lines, HIRING_HOME_LABEL);
    const deadline = parseDeadline(firstLabeledValue(lines, DEADLINE_LABEL), now);
    const applyUrl = blockApplyUrl($, block, config.url);
    if (!title || !hiringHome || !deadline || !applyUrl) return;

    const dedupeKey = `${title.toLowerCase()}::${applyUrl}`;
    if (seenTitles.has(dedupeKey)) return;
    seenTitles.add(dedupeKey);

    postings.push({
      title,
      applyUrl,
      deadline,
      hiringHome,
      evidenceQuote: blockText.slice(0, 500),
      postingUrl: config.url,
    });
  });

  return postings;
}

export function undergradResearchPostingObservations(
  posting: RawUndergradResearchPosting,
  home: ResolvedHiringHome,
): ObservationInput[] {
  const base = {
    entityType: 'researchEntity' as const,
    entityId: home.entityId,
    entityKey: home.slug,
    sourceUrl: posting.postingUrl,
  };
  return [
    {
      ...base,
      field: 'postedOpening',
      value: {
        title: posting.title,
        applyUrl: posting.applyUrl,
        deadline: posting.deadline.toISOString(),
        hiringHome: home.name,
        evidenceQuote: posting.evidenceQuote,
      },
      confidenceOverride: 0.85,
    },
    {
      ...base,
      field: 'sourceUrls',
      value: Array.from(new Set([posting.postingUrl, posting.applyUrl])),
    },
  ];
}

async function defaultResolveHiringHome(name: string): Promise<ResolvedHiringHome | null> {
  const trimmed = normalizeText(name);
  if (!trimmed) return null;
  const slug = slugify(trimmed);
  const matches: any[] = await ResearchEntity.find(
    {
      archived: false,
      $or: [
        { slug },
        { name: new RegExp(`^${escapeRegExp(trimmed)}$`, 'i') },
        { displayName: new RegExp(`^${escapeRegExp(trimmed)}$`, 'i') },
      ],
    },
    { _id: 1, slug: 1, name: 1, displayName: 1 },
  )
    .limit(2)
    .lean();
  if (matches.length !== 1) return null;
  const entity = matches[0];
  return {
    entityId: String(entity._id),
    slug: entity.slug,
    name: entity.displayName || entity.name || entity.slug,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function defaultFetchHtml(url: string, useCache: boolean): Promise<string> {
  const safeUrl = await assertPublicHttpUrl(url);
  const safeUrlText = safeUrl.toString();
  const cacheKey = `page:${safeUrlText}`;
  if (useCache) {
    const cached = await getCached<string>(UNDERGRAD_RESEARCH_POSTING_SOURCE, cacheKey);
    if (cached) return cached;
  }
  const agents = ssrfSafeAgents();
  const response = await axios.get(safeUrlText, {
    timeout: FETCH_TIMEOUT_MS,
    headers: { 'User-Agent': USER_AGENT },
    maxRedirects: 5,
    httpAgent: agents.httpAgent,
    httpsAgent: agents.httpsAgent,
  });
  const html = response.data as string;
  if (useCache) await setCached(UNDERGRAD_RESEARCH_POSTING_SOURCE, cacheKey, html);
  return html;
}

export class UndergradResearchPostingScraper implements IScraper {
  readonly name = UNDERGRAD_RESEARCH_POSTING_SOURCE;
  readonly displayName = 'Undergraduate research postings';
  private readonly pageConfigs: UndergradResearchPostingPageConfig[];
  private readonly fetchHtml: FetchHtml;
  private readonly resolveHiringHome: ResolveHiringHome;
  private readonly now: () => Date;

  constructor(deps: UndergradResearchPostingScraperDeps = {}) {
    this.pageConfigs = deps.pageConfigs || DEFAULT_UNDERGRAD_RESEARCH_POSTING_PAGES;
    this.fetchHtml = deps.fetchHtml || defaultFetchHtml;
    this.resolveHiringHome = deps.resolveHiringHome || defaultResolveHiringHome;
    this.now = deps.now || (() => new Date());
  }

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    const only =
      ctx.options.only && ctx.options.only.length > 0
        ? new Set(ctx.options.only.map((value) => value.trim().toLowerCase()).filter(Boolean))
        : null;
    let totalObs = 0;
    let totalEntities = 0;
    let unresolved = 0;
    const summaries: string[] = [];

    const pages = this.pageConfigs.filter((page) => !only || only.has(page.key.toLowerCase()));
    const concurrency = resolveSourceConcurrency(
      ctx.options.sourceConcurrency,
      DEFAULT_SOURCE_CONCURRENCY,
    );
    await mapWithConcurrency(pages, concurrency, async (page) => {
      ctx.log(`Fetching ${page.url}`);
      const html = await this.fetchHtml(page.url, ctx.options.useCache);
      const postings = parseUndergradResearchPostingsPage(html, page, this.now());
      let emitted = 0;
      for (const posting of postings) {
        const home = await this.resolveHiringHome(posting.hiringHome);
        if (!home) {
          unresolved += 1;
          ctx.log(`Skipping posting with unresolved hiring home: ${posting.hiringHome}`);
          continue;
        }
        const observations = undergradResearchPostingObservations(posting, home);
        await ctx.emit(observations);
        totalObs += observations.length;
        emitted += 1;
        totalEntities += 1;
      }
      summaries.push(`${page.key}=${emitted}`);
    });

    return {
      observationCount: totalObs,
      entitiesObserved: totalEntities,
      notes: `Undergraduate research postings: ${summaries.join(', ')}; unresolved hiring homes: ${unresolved}`,
    };
  }
}
