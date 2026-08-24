/**
 * YaleUniversityArtGalleryScraper
 *
 * Discovery-only scraper for the Yale University Art Gallery (YUAG) curatorial
 * areas catalog (African Art, American Paintings and Sculpture, Ancient Art, Art
 * of the Ancient Americas, Asian Art, European Art, Numismatics, Prints and
 * Drawings, ...). Each curatorial area is a marquee, object-based,
 * undergraduate-accessible museum/collections research home. It is the flagship
 * art-museum peer of the Peabody producer (#1349/#1367) for the reserved
 * `ARCHIVE_OR_MUSEUM_PROJECT` entity type; the taxonomy, access materializer, and
 * product model already handle museum/collections homes.
 *
 * YUAG fronts every page with a Cloudflare bot interstitial, so a plain HTTP fetch
 * only ever returns the "Just a moment..." challenge shell. This producer fetches
 * through the shared rendered (headless) path so the challenge is cleared and the
 * server-rendered markup reaches the extractor, mirroring the rendered-crawl
 * precedent (#1453). When no rendered fetcher is configured it fails closed and
 * emits nothing rather than parsing a challenge shell.
 *
 * The scraper walks the curatorial-areas index only to enumerate areas, then
 * fetches and cites each individual area's own page - never the index root - per
 * the self-referential / index-page source guards (#516/#549). It emits identity
 * and the area's own official-page summary description.
 *
 * Curatorial lead, verified live: YUAG curatorial-area pages publish no structured
 * named-curator credit; the departmental staff live on separate, contact-laden
 * roster pages that this producer deliberately does not read.
 * `extractCuratorialLead` therefore reads only a structured staff/credit block on
 * the area's own page, so it fails closed rather than promoting a name from prose
 * or a roster. Where an area ever publishes a structured named curatorial lead on
 * its own page, it is emitted as an entity-level inferred-director observation and
 * `materializeInferredDirectorMembership` resolves that name to a unique Yale User
 * before promotion, introducing no new access logic. Without a named director a
 * museum home still earns the organizational REACH_OUT_PLAUSIBLE ways-in from its
 * official page. The scraper never emits contact routes, undergraduate-access
 * claims, or posted openings; it fails closed on contact data, consistent with
 * skills/scrapers/SKILL.md.
 */
import * as cheerio from 'cheerio';
import { getCached, setCached } from '../snapshotCache';
import { createScraplingRenderedFetcher, type RenderedFetcher } from '../renderedFetch';
import type { IScraper, ObservationInput, ScraperContext, ScraperResult } from '../types';
import { normalizeName, slugify, splitName } from '../utils/scraperHelpers';

const SOURCE_NAME = 'yuag-curatorial-areas';
const FETCH_TIMEOUT_MS = 30_000;

export const DEFAULT_YUAG_CURATORIAL_AREAS_INDEX_URL =
  'https://artgallery.yale.edu/research-and-learning/curatorial-areas';

const AREA_PATH_RE = /^\/research-and-learning\/curatorial-areas\/[a-z0-9-]+$/i;

const CURATOR_ROLE_RE = /\bcurator\b|\bhead of\b|\bkeeper\b/i;

export interface YuagCuratorialLead {
  name: string;
  role: 'director';
  title?: string;
  profileUrl?: string;
}

export interface YuagAreaLink {
  name: string;
  url: string;
  slug: string;
}

export interface YuagArea extends YuagAreaLink {
  entityType: 'ARCHIVE_OR_MUSEUM_PROJECT';
  kind: 'group';
  description?: string;
  lead?: YuagCuratorialLead;
}

export type YuagHtmlFetcher = (
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

function areaPathname(url: string): string {
  try {
    return new URL(url).pathname.replace(/\/$/, '');
  } catch {
    return '';
  }
}

function areaSlugFromUrl(url: string): string {
  const pathname = areaPathname(url);
  const lastSegment = pathname.split('/').filter(Boolean).pop() || '';
  return lastSegment ? `yuag-${lastSegment}`.slice(0, 100) : '';
}

export function slugifyYuagArea(name: string): string {
  return `yuag-${slugify(name)}`.slice(0, 100);
}

export function parseYuagCuratorialAreasIndex(html: string, pageUrl: string): YuagAreaLink[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const areas: YuagAreaLink[] = [];

  $('.navigation-card').each((_i, el) => {
    const card = $(el);
    const link = card.find('a.navigation-card__primary-cta[href]').first();
    const url = absoluteUrl(link.attr('href'), pageUrl);
    const pathname = areaPathname(url);
    if (!AREA_PATH_RE.test(pathname)) return;

    const name =
      cleanText(card.find('.navigation-card__title').first().text()) ||
      cleanText(link.attr('title'));
    const slug = areaSlugFromUrl(url) || slugifyYuagArea(name);
    if (!name || !slug || seen.has(slug)) return;

    seen.add(slug);
    areas.push({ name, url, slug });
  });

  return areas;
}

function extractAreaDescription($: cheerio.CheerioAPI): string | undefined {
  let description = '';
  $('.body-text .field__item p, .content-block--text .body-text p').each((_i, el) => {
    if (description) return;
    const text = cleanText($(el).text());
    if (text.length >= 40) description = text;
  });
  return description || undefined;
}

function extractCuratorialLead($: cheerio.CheerioAPI): YuagCuratorialLead | undefined {
  let lead: YuagCuratorialLead | undefined;

  $('.staff-credit, .field--name-field-curator, .person-card').each((_i, el) => {
    if (lead) return;
    const container = $(el);
    const roleText = cleanText(
      container.find('.staff-role, .person-card__role, em').first().text(),
    );
    if (!CURATOR_ROLE_RE.test(roleText)) return;

    const name = cleanText(
      container.find('.staff-name, .person-card__name, strong').first().text(),
    );
    if (!name) return;

    const profileHref = cleanText(container.find('a[href]').first().attr('href'));
    const profileUrl =
      /^https?:\/\//i.test(profileHref) && /yale\.edu/i.test(profileHref)
        ? profileHref
        : undefined;

    lead = {
      name,
      role: 'director',
      ...(roleText ? { title: roleText } : {}),
      ...(profileUrl ? { profileUrl } : {}),
    };
  });

  return lead;
}

export function parseYuagAreaPage(html: string, area: YuagAreaLink): YuagArea {
  const $ = cheerio.load(html);
  const heading =
    cleanText($('h1.photo-hero__title').first().text()) || cleanText($('h1').first().text());
  const description = extractAreaDescription($);
  const lead = extractCuratorialLead($);

  return {
    ...area,
    name: heading || area.name,
    entityType: 'ARCHIVE_OR_MUSEUM_PROJECT',
    kind: 'group',
    ...(description ? { description } : {}),
    ...(lead ? { lead } : {}),
  };
}

export function leadToObservations(
  lead: YuagCuratorialLead,
  base: { entityType: 'researchEntity'; entityKey: string; sourceUrl: string },
): ObservationInput[] {
  const cleaned = normalizeName(lead.name);
  const { last } = splitName(cleaned);
  const fname = cleaned.split(/\s+/).filter(Boolean)[0] || '';
  if (!fname || !last || fname === last) return [];

  const observations: ObservationInput[] = [
    { ...base, field: 'inferredDirectorName', value: cleaned },
    { ...base, field: 'inferredDirectorUserName', value: { fname, lname: last } },
    { ...base, field: 'inferredDirectorRole', value: lead.role, confidenceOverride: 0.85 },
  ];
  if (lead.profileUrl) {
    observations.push({ ...base, field: 'inferredDirectorProfileUrl', value: lead.profileUrl });
  }
  if (lead.title) {
    observations.push({ ...base, field: 'inferredDirectorTitle', value: lead.title });
  }
  return observations;
}

export function areaToObservations(area: YuagArea): ObservationInput[] {
  const base = {
    entityType: 'researchEntity' as const,
    entityKey: area.slug,
    sourceUrl: area.url,
    confidenceOverride: 0.9,
  };

  const observations: ObservationInput[] = [
    { ...base, field: 'slug', value: area.slug },
    { ...base, field: 'name', value: area.name },
    { ...base, field: 'displayName', value: area.name },
    { ...base, field: 'kind', value: area.kind },
    { ...base, field: 'entityType', value: area.entityType },
    { ...base, field: 'websiteUrl', value: area.url },
    { ...base, field: 'sourceUrls', value: [area.url] },
  ];

  if (area.description) {
    observations.push({ ...base, field: 'fullDescription', value: area.description });
  }
  if (area.lead) {
    observations.push(
      ...leadToObservations(area.lead, {
        entityType: base.entityType,
        entityKey: base.entityKey,
        sourceUrl: base.sourceUrl,
      }),
    );
  }

  return observations;
}

export function createRenderedYuagHtmlFetcher(
  renderedFetcher: RenderedFetcher | null = createScraplingRenderedFetcher(),
): YuagHtmlFetcher {
  return async (url, useCache, sourceName) => {
    if (!renderedFetcher) return '';
    const cacheKey = `rendered-page:v1:${url}`;
    if (useCache) {
      const cached = await getCached<string>(sourceName, cacheKey);
      if (cached) return cached;
    }
    const result = await renderedFetcher({ url, mode: 'stealthy', timeoutMs: FETCH_TIMEOUT_MS });
    const html = result && !result.blocked ? result.html || '' : '';
    if (useCache && html) await setCached(sourceName, cacheKey, html);
    return html;
  };
}

export class YaleUniversityArtGalleryScraper implements IScraper {
  readonly name = SOURCE_NAME;
  readonly displayName = 'Yale University Art Gallery curatorial areas';

  constructor(
    private readonly indexUrl: string = DEFAULT_YUAG_CURATORIAL_AREAS_INDEX_URL,
    private readonly htmlFetcher: YuagHtmlFetcher = createRenderedYuagHtmlFetcher(),
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

    ctx.log(`[yuag] fetching curatorial-areas index ${this.indexUrl}`);
    const indexHtml = await this.htmlFetcher(this.indexUrl, ctx.options.useCache, SOURCE_NAME);
    if (!indexHtml) {
      ctx.log('[yuag] skipped - rendered index unavailable (headless fetcher disabled or blocked)');
      return { observationCount: 0, entitiesObserved: 0, notes: 'rendered-index-unavailable' };
    }
    const areas = parseYuagCuratorialAreasIndex(indexHtml, this.indexUrl);
    ctx.log(`[yuag] discovered ${areas.length} curatorial areas`);

    let totalObservations = 0;
    let totalEntities = 0;
    let withLead = 0;

    for (const link of areas) {
      if (totalEntities >= limit) break;
      if (
        onlyFilter &&
        !onlyFilter.has(link.slug.toLowerCase()) &&
        !onlyFilter.has(areaPathname(link.url).split('/').filter(Boolean).pop() || '')
      ) {
        continue;
      }

      ctx.log(`[yuag] fetching curatorial area ${link.url}`);
      const areaHtml = await this.htmlFetcher(link.url, ctx.options.useCache, SOURCE_NAME);
      if (!areaHtml) {
        ctx.log(`[yuag] skipped ${link.slug} - rendered page unavailable`);
        continue;
      }
      const area = parseYuagAreaPage(areaHtml, link);
      const observations = areaToObservations(area);
      await ctx.emit(observations);
      totalObservations += observations.length;
      totalEntities += 1;
      if (area.lead) withLead += 1;
    }

    ctx.log(
      `Emitted ${totalObservations} observations across ${totalEntities} YUAG curatorial areas (${withLead} with an identified curatorial lead)`,
    );

    return {
      observationCount: totalObservations,
      entitiesObserved: totalEntities,
      notes: `areas=${totalEntities}, withCuratorialLead=${withLead}`,
    };
  }
}
