/**
 * YaleResearchOfficialScraper
 *
 * Discovery-only scraper for research.yale.edu directories. These pages are
 * authoritative for research entities and research infrastructure, but they do
 * not by themselves prove undergraduate access, contact routes, or openings.
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import { getCached, setCached } from '../snapshotCache';
import type { IScraper, ObservationInput, ScraperContext, ScraperResult } from '../types';
import { slugify } from '../utils/scraperHelpers';
import type { ResearchEntityType } from '../../models/researchAccessTypes';
import { assertPublicHttpUrl, ssrfSafeAgents } from '../../utils/ssrfGuard';

const SOURCE_NAME = 'yale-research-official';
const USER_AGENT = 'ylabs-scraper/1.0 (+https://yalelabs.io)';
const FETCH_TIMEOUT_MS = 30_000;
const MAX_PAGES_PER_DIRECTORY = 20;

export type YaleResearchDirectoryParser = 'centers-institutes' | 'core-facilities';
export type YaleResearchSourceCategory = 'centers-institutes' | 'core-facility';
export type YaleResearchKind =
  | 'center'
  | 'institute'
  | 'lab'
  | 'program'
  | 'initiative'
  | 'group'
  | 'core_facility';

export interface YaleResearchOfficialEntity {
  name: string;
  url: string;
  slug: string;
  kind: YaleResearchKind;
  entityType: ResearchEntityType;
  description?: string;
  researchAreas?: string[];
  sourceCategory: YaleResearchSourceCategory;
}

export interface YaleResearchDirectoryConfig {
  key: string;
  url: string;
  paginated?: boolean;
  parser: YaleResearchDirectoryParser;
}

export type YaleResearchHtmlFetcher = (
  url: string,
  useCache: boolean,
  sourceName: string,
) => Promise<string>;

export const DEFAULT_YALE_RESEARCH_DIRECTORY_CONFIGS: YaleResearchDirectoryConfig[] = [
  {
    key: 'centers-institutes',
    url: 'https://research.yale.edu/centers-institutes',
    paginated: true,
    parser: 'centers-institutes',
  },
  {
    key: 'core-facilities',
    url: 'https://research.yale.edu/cores?f%5B0%5D=result_type%3A1',
    paginated: true,
    parser: 'core-facilities',
  },
];

function cleanText(value: string | undefined | null): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.map(cleanText).filter(Boolean)));
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

export function slugifyResearchYaleEntity(name: string): string {
  return `research-yale-${slugify(name)}`.slice(0, 100);
}

export function inferResearchYaleKind(name: string): {
  kind: YaleResearchKind;
  entityType: ResearchEntityType;
} {
  if (/\b(?:lab|laboratory)\b/i.test(name)) return { kind: 'lab', entityType: 'LAB' };
  if (/\binstitute\b/i.test(name)) return { kind: 'institute', entityType: 'INSTITUTE' };
  if (/\b(?:center|centre|core|facility)\b/i.test(name)) {
    return { kind: 'center', entityType: 'CENTER' };
  }
  if (/\b(?:program|project|initiative)\b/i.test(name)) {
    return { kind: 'initiative', entityType: 'INITIATIVE' };
  }
  return { kind: 'initiative', entityType: 'INITIATIVE' };
}

export function classifyResearchYaleEntity(
  name: string,
  sourceCategory: YaleResearchSourceCategory,
): { kind: YaleResearchKind; entityType: ResearchEntityType } {
  if (sourceCategory === 'core-facility') {
    return { kind: 'core_facility', entityType: 'CORE_FACILITY' };
  }
  return inferResearchYaleKind(name);
}

/**
 * research.yale.edu tags each directory record with its own topic-specific
 * `.item__type` chips, but also reuses the page's top-level facet buckets
 * (its own domain-filter categories) as one of those chips. A bucket this
 * broad describes every entity in the domain, not this one, so it is dropped
 * rather than served as a researchArea chip (#1580 delta 1 / #1584).
 */
export const GENERIC_TAXONOMY_BUCKET_LABEL_LIST = [
  'Sciences & engineering',
  'Medical & health sciences',
  'Arts, humanities, & social sciences',
  'Research administration & collaboration',
  'Faculty resources',
];

const GENERIC_TAXONOMY_BUCKET_LABELS = new Set(
  GENERIC_TAXONOMY_BUCKET_LABEL_LIST.map((label) => label.toLowerCase()),
);

export function isGenericTaxonomyBucketLabel(value: string): boolean {
  return GENERIC_TAXONOMY_BUCKET_LABELS.has(value.trim().toLowerCase());
}

function entityFromRecord(
  $: cheerio.CheerioAPI,
  record: cheerio.Cheerio<any>,
  link: cheerio.Cheerio<any>,
  pageUrl: string,
  sourceCategory: YaleResearchSourceCategory,
): YaleResearchOfficialEntity | null {
  const name = cleanText(link.text());
  const url = absoluteUrl(link.attr('href'), pageUrl);
  if (!name || !url) return null;

  const classification = classifyResearchYaleEntity(name, sourceCategory);
  const description = cleanText(record.find('p').first().text()) || undefined;
  const researchAreas = uniqueStrings(
    record
      .find('.item__types .item__type, .item__type')
      .map((_i, el) => cleanText($(el).text()))
      .get(),
  ).filter((area) => !isGenericTaxonomyBucketLabel(area));

  return {
    name,
    url,
    slug: slugifyResearchYaleEntity(name),
    ...classification,
    ...(description ? { description } : {}),
    ...(researchAreas.length > 0 ? { researchAreas } : {}),
    sourceCategory,
  };
}

const PLACEHOLDER_DESCRIPTION_RE = /^lorem ipsum\b/i;

const NON_ENTITY_PAGE_NAME_RE =
  /^(?:faqs?|help|about(?: us)?|contact(?: us)?|search|log ?in|sign ?in|home|news|events?|overview|resources?|shared resources?|pages?|sitemap|privacy|terms|accessibility)$/i;

const NON_ENTITY_URL_PATH_RE =
  /\/(?:pages?|faqs?|node|taxonomy|user|admin|search|login|sitemap)(?:\/|$)/i;

export function isMintableResearchYaleEntity(entity: YaleResearchOfficialEntity): boolean {
  const name = cleanText(entity.name);
  if (!name || NON_ENTITY_PAGE_NAME_RE.test(name)) return false;
  if (PLACEHOLDER_DESCRIPTION_RE.test(cleanText(entity.description))) return false;
  try {
    if (NON_ENTITY_URL_PATH_RE.test(new URL(entity.url).pathname)) return false;
  } catch {
    return false;
  }
  return true;
}

function uniqueEntities(entities: YaleResearchOfficialEntity[]): YaleResearchOfficialEntity[] {
  const seen = new Set<string>();
  return entities.filter((entity) => {
    const key = entity.slug || entity.url;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function parseResearchYaleCenters(
  html: string,
  pageUrl: string,
): YaleResearchOfficialEntity[] {
  const $ = cheerio.load(html);
  const entities: YaleResearchOfficialEntity[] = [];

  $('ol.listing-items > li.item, main li.item').each((_i, el) => {
    const record = $(el);
    const link = record.find('h2 a[href], h3 a[href]').first();
    const entity = entityFromRecord($, record, link, pageUrl, 'centers-institutes');
    if (entity) entities.push(entity);
  });

  return uniqueEntities(entities.filter(isMintableResearchYaleEntity));
}

export function parseResearchYaleCoreFacilities(
  html: string,
  pageUrl: string,
): YaleResearchOfficialEntity[] {
  const $ = cheerio.load(html);
  const entities: YaleResearchOfficialEntity[] = [];

  $('main h2 a[href^="/cores/"], main h2 a[href*="/cores/"]').each((_i, el) => {
    const link = $(el);
    const record = link.closest('article, li, .card').first();
    const entity = entityFromRecord(
      $,
      record.length > 0 ? record : link.parent(),
      link,
      pageUrl,
      'core-facility',
    );
    if (entity) entities.push(entity);
  });

  return uniqueEntities(entities.filter(isMintableResearchYaleEntity));
}

export function entityToObservations(
  entity: YaleResearchOfficialEntity,
  sourceUrl: string,
): ObservationInput[] {
  const base = {
    entityType: 'researchEntity' as const,
    entityKey: entity.slug,
    sourceUrl,
    confidenceOverride: 0.9,
  };
  const observations: ObservationInput[] = [
    { ...base, field: 'slug', value: entity.slug },
    { ...base, field: 'name', value: entity.name },
    { ...base, field: 'displayName', value: entity.name },
    { ...base, field: 'kind', value: entity.kind },
    { ...base, field: 'entityType', value: entity.entityType },
    { ...base, field: 'websiteUrl', value: entity.url },
    { ...base, field: 'sourceUrls', value: [entity.url] },
    { ...base, field: 'sourceCategory', value: entity.sourceCategory },
  ];

  if (entity.description) {
    observations.push({ ...base, field: 'fullDescription', value: entity.description });
  }
  if (entity.researchAreas && entity.researchAreas.length > 0) {
    observations.push({ ...base, field: 'researchAreas', value: entity.researchAreas });
  }

  return observations;
}

export async function fetchResearchYaleHtml(
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

function pageUrlForIndex(baseUrl: string, index: number): string {
  if (index <= 0) return baseUrl;
  const url = new URL(baseUrl);
  url.searchParams.set('page', String(index));
  return url.toString();
}

function parseDirectory(
  config: YaleResearchDirectoryConfig,
  html: string,
  pageUrl: string,
): YaleResearchOfficialEntity[] {
  if (config.parser === 'core-facilities') return parseResearchYaleCoreFacilities(html, pageUrl);
  return parseResearchYaleCenters(html, pageUrl);
}

export class YaleResearchOfficialScraper implements IScraper {
  readonly name = SOURCE_NAME;
  readonly displayName = 'Yale Research official directories';

  constructor(
    private readonly configs: YaleResearchDirectoryConfig[] = DEFAULT_YALE_RESEARCH_DIRECTORY_CONFIGS,
    private readonly htmlFetcher: YaleResearchHtmlFetcher = fetchResearchYaleHtml,
  ) {}

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    const onlyFilter =
      ctx.options.only && ctx.options.only.length > 0
        ? new Set(ctx.options.only.map((value) => value.trim().toLowerCase()))
        : null;
    const limitOption = ctx.options.limit;
    if (limitOption !== undefined && (!Number.isSafeInteger(limitOption) || limitOption < 1)) {
      throw new Error('--limit must be a safe positive integer');
    }
    const limit = limitOption ?? Infinity;

    let totalObservations = 0;
    let totalEntities = 0;
    const summaries: string[] = [];

    for (const config of this.configs) {
      if (onlyFilter && !onlyFilter.has(config.key.toLowerCase())) continue;
      if (totalEntities >= limit) break;

      let pagesFetched = 0;
      let configEntities = 0;
      const maxPages = config.paginated ? MAX_PAGES_PER_DIRECTORY : 1;

      for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
        if (totalEntities >= limit) break;
        const pageUrl = pageUrlForIndex(config.url, pageIndex);
        ctx.log(`[${config.key}] fetching ${pageUrl}`);
        const html = await this.htmlFetcher(pageUrl, ctx.options.useCache, SOURCE_NAME);
        pagesFetched += 1;
        const entities = parseDirectory(config, html, pageUrl);
        if (entities.length === 0) break;

        const remaining = limit - totalEntities;
        const selected = remaining < entities.length ? entities.slice(0, remaining) : entities;
        for (const entity of selected) {
          const observations = entityToObservations(entity, config.url);
          await ctx.emit(observations);
          totalObservations += observations.length;
          totalEntities += 1;
          configEntities += 1;
        }
      }

      summaries.push(
        `${config.key}=${configEntities} (${pagesFetched} page${pagesFetched === 1 ? '' : 's'})`,
      );
    }

    ctx.log(
      `Emitted ${totalObservations} observations across ${totalEntities} research.yale.edu entities`,
    );

    return {
      observationCount: totalObservations,
      entitiesObserved: totalEntities,
      notes: summaries.join(', '),
    };
  }
}
