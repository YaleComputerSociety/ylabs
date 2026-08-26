/**
 * BeineckeCollectionsResearchScraper
 *
 * Discovery-only scraper for the Yale Beinecke Rare Book & Manuscript Library
 * research fellowship programs, minting `ARCHIVE_OR_MUSEUM_PROJECT` research
 * homes. This closes the last humanities/collections coverage gap (tracked in
 * issue #2040, after the DHLab pilot #1345 and the
 * Peabody producer #1349), reusing the `ARCHIVE_OR_MUSEUM_PROJECT` path proven
 * end-to-end by `peabodyCollectionsResearchScraper`.
 *
 * The scraper walks the Beinecke fellowships index only to enumerate the
 * distinct named fellowship programs, then fetches and cites each program's own
 * page - never the index root - per the self-referential / index-page source
 * guards (#516/#549). It emits identity and an official-page description only.
 * It never emits contact routes, undergraduate-access claims, posted openings,
 * or the awarded-fellow roster that these pages publish: it fails closed on
 * contact and access data, consistent with skills/scrapers/SKILL.md. Programs
 * without a citable own-page URL, and FAQ/how-to chrome pages, are skipped.
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import { getCached, setCached } from '../snapshotCache';
import type { IScraper, ObservationInput, ScraperContext, ScraperResult } from '../types';
import { assertPublicHttpUrl, ssrfSafeAgents } from '../../utils/ssrfGuard';

const SOURCE_NAME = 'beinecke-collections-research';
const USER_AGENT = 'ylabs-scraper/1.0 (+https://yalelabs.io)';
const FETCH_TIMEOUT_MS = 30_000;

export const DEFAULT_BEINECKE_FELLOWSHIPS_INDEX_URL =
  'https://beinecke.library.yale.edu/beinecke/researchers/fellowships';

const PROGRAM_PATH_RE = /^\/beinecke\/researchers\/fellowships\/[a-z0-9-]+$/i;

const NON_PROGRAM_SLUG_RE = /(faq|how-to|apply|application)/i;

export interface BeineckeProgramLink {
  name: string;
  url: string;
  slug: string;
}

export interface BeineckeProgram extends BeineckeProgramLink {
  entityType: 'ARCHIVE_OR_MUSEUM_PROJECT';
  kind: 'group';
  description?: string;
}

export type BeineckeHtmlFetcher = (
  url: string,
  useCache: boolean,
  sourceName: string,
) => Promise<string>;

function cleanText(value: string | undefined | null): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function absoluteUrl(href: string | undefined, baseUrl: string): string {
  const raw = cleanText(href);
  if (!raw) return '';
  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return raw;
  }
}

function programPathname(url: string): string {
  try {
    return new URL(url).pathname.replace(/\/$/, '');
  } catch {
    return '';
  }
}

function programSlugFromUrl(url: string): string {
  const pathname = programPathname(url);
  const lastSegment = pathname.split('/').filter(Boolean).pop() || '';
  return lastSegment ? `beinecke-${lastSegment}`.slice(0, 100) : '';
}

export function parseBeineckeFellowshipsIndex(
  html: string,
  pageUrl: string,
): BeineckeProgramLink[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const programs: BeineckeProgramLink[] = [];

  $('.link-card.custom-card > a[href]').each((_i, el) => {
    const link = $(el);
    const url = absoluteUrl(link.attr('href'), pageUrl);
    const pathname = programPathname(url);
    if (!PROGRAM_PATH_RE.test(pathname)) return;

    const lastSegment = pathname.split('/').filter(Boolean).pop() || '';
    if (NON_PROGRAM_SLUG_RE.test(lastSegment)) return;

    const name =
      cleanText(link.find('.custom-card-title').first().text()) ||
      cleanText(link.attr('title')) ||
      cleanText(link.text());
    const slug = programSlugFromUrl(url);
    if (!name || !slug || seen.has(slug)) return;

    seen.add(slug);
    programs.push({ name, url, slug });
  });

  return programs;
}

function extractProgramDescription($: cheerio.CheerioAPI): string | undefined {
  let description = '';
  $('.layout__region .yl-content-block--basic p, .layout__region .block-content--basic p').each(
    (_i, el) => {
      if (description) return;
      const paragraph = $(el);
      if (paragraph.closest('.link-card, .custom-card, .announcement-feed').length > 0) return;
      const text = cleanText(paragraph.text());
      if (text.length >= 40) description = text;
    },
  );
  return description || undefined;
}

export function parseBeineckeProgramPage(
  html: string,
  program: BeineckeProgramLink,
): BeineckeProgram {
  const $ = cheerio.load(html);
  const heading =
    cleanText($('h1.field--name-title').first().text()) || cleanText($('h1').first().text());
  const description = extractProgramDescription($);

  return {
    ...program,
    name: heading || program.name,
    entityType: 'ARCHIVE_OR_MUSEUM_PROJECT',
    kind: 'group',
    ...(description ? { description } : {}),
  };
}

export function programToObservations(program: BeineckeProgram): ObservationInput[] {
  const base = {
    entityType: 'researchEntity' as const,
    entityKey: program.slug,
    sourceUrl: program.url,
    confidenceOverride: 0.9,
  };

  const observations: ObservationInput[] = [
    { ...base, field: 'slug', value: program.slug },
    { ...base, field: 'name', value: program.name },
    { ...base, field: 'displayName', value: program.name },
    { ...base, field: 'kind', value: program.kind },
    { ...base, field: 'entityType', value: program.entityType },
    { ...base, field: 'websiteUrl', value: program.url },
    { ...base, field: 'sourceUrls', value: [program.url] },
  ];

  if (program.description) {
    observations.push({ ...base, field: 'fullDescription', value: program.description });
  }

  return observations;
}

export async function fetchBeineckeHtml(
  url: string,
  useCache: boolean,
  sourceName: string,
): Promise<string> {
  const safeUrl = await assertPublicHttpUrl(url);
  const safeUrlText = safeUrl.toString();
  const cacheKey = `page:${safeUrlText}`;
  if (useCache) {
    const cached = await getCached<string>(sourceName, cacheKey);
    if (cached) return cached;
  }
  const agents = ssrfSafeAgents();
  const res = await axios.get(safeUrlText, {
    timeout: FETCH_TIMEOUT_MS,
    headers: { 'User-Agent': USER_AGENT },
    maxRedirects: 5,
    httpAgent: agents.httpAgent,
    httpsAgent: agents.httpsAgent,
  });
  const html = res.data as string;
  if (useCache) await setCached(sourceName, cacheKey, html);
  return html;
}

export class BeineckeCollectionsResearchScraper implements IScraper {
  readonly name = SOURCE_NAME;
  readonly displayName = 'Yale Beinecke Library research fellowship programs';

  constructor(
    private readonly indexUrl: string = DEFAULT_BEINECKE_FELLOWSHIPS_INDEX_URL,
    private readonly htmlFetcher: BeineckeHtmlFetcher = fetchBeineckeHtml,
  ) {}

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    const limitOption = ctx.options.limit;
    if (limitOption !== undefined && (!Number.isSafeInteger(limitOption) || limitOption < 1)) {
      throw new Error('--limit must be a safe positive integer');
    }
    const limit = limitOption ?? Infinity;

    const onlyFilter =
      ctx.options.only && ctx.options.only.length > 0
        ? new Set(ctx.options.only.map((value) => value.trim().toLowerCase()))
        : null;

    ctx.log(`[beinecke] fetching fellowships index ${this.indexUrl}`);
    const indexHtml = await this.htmlFetcher(this.indexUrl, ctx.options.useCache, SOURCE_NAME);
    const programs = parseBeineckeFellowshipsIndex(indexHtml, this.indexUrl);
    ctx.log(`[beinecke] discovered ${programs.length} fellowship programs`);

    let totalObservations = 0;
    let totalEntities = 0;
    let skipped = 0;

    for (const link of programs) {
      if (totalEntities >= limit) break;
      if (
        onlyFilter &&
        !onlyFilter.has(link.slug.toLowerCase()) &&
        !onlyFilter.has(programPathname(link.url).split('/').filter(Boolean).pop() || '')
      ) {
        continue;
      }

      ctx.log(`[beinecke] fetching program ${link.url}`);
      const programHtml = await this.htmlFetcher(link.url, ctx.options.useCache, SOURCE_NAME);
      const program = parseBeineckeProgramPage(programHtml, link);
      if (!program.description) {
        skipped += 1;
        continue;
      }
      const observations = programToObservations(program);
      await ctx.emit(observations);
      totalObservations += observations.length;
      totalEntities += 1;
    }

    ctx.log(
      `Emitted ${totalObservations} observations across ${totalEntities} Beinecke fellowship programs (${skipped} skipped for no official-page description)`,
    );

    return {
      observationCount: totalObservations,
      entitiesObserved: totalEntities,
      notes: `programs=${totalEntities}, skippedNoDescription=${skipped}`,
    };
  }
}
