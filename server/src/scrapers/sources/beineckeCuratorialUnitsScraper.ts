/**
 * BeineckeCuratorialUnitsScraper
 *
 * Discovery-only scraper for the Beinecke Rare Book & Manuscript Library
 * curatorial-units catalog (Americana, the Osborn Collection, the Yale
 * Collection of American Literature, ...). Each unit is a marquee,
 * undergraduate-accessible rare-book/manuscript and archival research home. It
 * is the next producer for the reserved `ARCHIVE_OR_MUSEUM_PROJECT` entity type,
 * reusing the proven Yale Peabody Museum path (#1349/#1367): the taxonomy,
 * access materializer, and product model already handle museum/archive homes.
 *
 * The scraper walks the curatorial-units index only to enumerate units, then
 * fetches and cites each individual unit's own page - never the index root - per
 * the self-referential / index-page source guards (#516/#549). It emits identity
 * and the unit's own official-page summary description.
 *
 * Curatorial lead, verified live: the migrated Beinecke site (now under
 * library.yale.edu/beinecke) publishes no structured named-curator credit on the
 * unit pages - every "curator" mention is historical body prose ("former curator
 * ...", "served as curator ..."). `extractCuratorialLead` therefore reads only a
 * structured staff/contact credit block and never body prose, so it fails closed
 * on all current unit pages rather than promoting a prose name. Where a unit ever
 * publishes a structured named curatorial lead, it is emitted as an entity-level
 * inferred-director observation and `materializeInferredDirectorMembership`
 * resolves that name to a unique canonical Researcher before promotion, introducing no new
 * access logic. Without a named director an archive/museum home still earns the
 * organizational REACH_OUT_PLAUSIBLE ways-in from its official page. The scraper
 * never emits contact routes, undergraduate-access claims, or posted openings; it
 * fails closed on contact data, consistent with skills/scrapers/SKILL.md.
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import { getCached, setCached } from '../snapshotCache';
import type { IScraper, ObservationInput, ScraperContext, ScraperResult } from '../types';
import { normalizeName, slugify, splitName } from '../utils/scraperHelpers';
import { assertPublicHttpUrl, ssrfSafeAgents } from '../../utils/ssrfGuard';

const SOURCE_NAME = 'beinecke-curatorial-units';
const USER_AGENT = 'ylabs-scraper/1.0 (+https://yalelabs.io)';
const FETCH_TIMEOUT_MS = 30_000;

export const DEFAULT_BEINECKE_CURATORIAL_UNITS_INDEX_URL =
  'https://beinecke.library.yale.edu/beinecke/collections';

const UNIT_PATH_RE = /^\/beinecke\/collections\/[a-z0-9-]+$/i;

const NON_CURATORIAL_UNIT_SLUGS = new Set(['about-collections']);

const CURATOR_ROLE_RE = /\bcurator\b/i;

export interface BeineckeCuratorialLead {
  name: string;
  role: 'director';
  title?: string;
  profileUrl?: string;
}

export interface BeineckeUnitLink {
  name: string;
  url: string;
  slug: string;
}

export interface BeineckeUnit extends BeineckeUnitLink {
  entityType: 'ARCHIVE_OR_MUSEUM_PROJECT';
  kind: 'group';
  description?: string;
  lead?: BeineckeCuratorialLead;
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

function unitPathname(url: string): string {
  try {
    return new URL(url).pathname.replace(/\/$/, '');
  } catch {
    return '';
  }
}

function unitSlugFromUrl(url: string): string {
  const pathname = unitPathname(url);
  const lastSegment = pathname.split('/').filter(Boolean).pop() || '';
  return lastSegment ? `beinecke-${lastSegment}`.slice(0, 100) : '';
}

export function slugifyBeineckeUnit(name: string): string {
  return `beinecke-${slugify(name)}`.slice(0, 100);
}

export function parseBeineckeCuratorialUnitsIndex(
  html: string,
  pageUrl: string,
): BeineckeUnitLink[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const units: BeineckeUnitLink[] = [];

  $('.link-card.custom-card a[href]').each((_i, el) => {
    const link = $(el);
    const url = absoluteUrl(link.attr('href'), pageUrl);
    const pathname = unitPathname(url);
    if (!UNIT_PATH_RE.test(pathname)) return;

    const lastSegment = pathname.split('/').filter(Boolean).pop() || '';
    if (NON_CURATORIAL_UNIT_SLUGS.has(lastSegment.toLowerCase())) return;

    const name =
      cleanText(link.find('.custom-card-title').first().text()) ||
      cleanText(link.attr('title')) ||
      cleanText(link.text());
    const slug = unitSlugFromUrl(url) || slugifyBeineckeUnit(name);
    if (!name || !slug || seen.has(slug)) return;

    seen.add(slug);
    units.push({ name, url, slug });
  });

  return units;
}

function extractUnitDescription($: cheerio.CheerioAPI): string | undefined {
  const intro = cleanText($('h2.intro').first().text());
  return intro.length >= 40 ? intro : undefined;
}

function extractCuratorialLead($: cheerio.CheerioAPI): BeineckeCuratorialLead | undefined {
  let lead: BeineckeCuratorialLead | undefined;

  $('.staff-info-container-table, .contact-person, .field--name-field-curator').each(
    (_i, el) => {
      if (lead) return;
      const container = $(el);
      const roleText = cleanText(container.find('.staff-role, .field--name-field-role em, em').first().text());
      if (!CURATOR_ROLE_RE.test(roleText)) return;

      const name = cleanText(
        container.find('.staff-name, .field--name-field-person-name, strong').first().text(),
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
    },
  );

  return lead;
}

export function parseBeineckeUnitPage(html: string, unit: BeineckeUnitLink): BeineckeUnit {
  const $ = cheerio.load(html);
  const heading = cleanText($('h1.field--name-title').first().text()) || cleanText($('h1').first().text());
  const description = extractUnitDescription($);
  const lead = extractCuratorialLead($);

  return {
    ...unit,
    name: heading || unit.name,
    entityType: 'ARCHIVE_OR_MUSEUM_PROJECT',
    kind: 'group',
    ...(description ? { description } : {}),
    ...(lead ? { lead } : {}),
  };
}

export function leadToObservations(
  lead: BeineckeCuratorialLead,
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

export function unitToObservations(unit: BeineckeUnit): ObservationInput[] {
  const base = {
    entityType: 'researchEntity' as const,
    entityKey: unit.slug,
    sourceUrl: unit.url,
    confidenceOverride: 0.9,
  };

  const observations: ObservationInput[] = [
    { ...base, field: 'slug', value: unit.slug },
    { ...base, field: 'name', value: unit.name },
    { ...base, field: 'displayName', value: unit.name },
    { ...base, field: 'kind', value: unit.kind },
    { ...base, field: 'entityType', value: unit.entityType },
    { ...base, field: 'websiteUrl', value: unit.url },
    { ...base, field: 'sourceUrls', value: [unit.url] },
  ];

  if (unit.description) {
    observations.push({ ...base, field: 'fullDescription', value: unit.description });
  }
  if (unit.lead) {
    observations.push(
      ...leadToObservations(unit.lead, {
        entityType: base.entityType,
        entityKey: base.entityKey,
        sourceUrl: base.sourceUrl,
      }),
    );
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

export class BeineckeCuratorialUnitsScraper implements IScraper {
  readonly name = SOURCE_NAME;
  readonly displayName = 'Beinecke Rare Book & Manuscript Library curatorial units';

  constructor(
    private readonly indexUrl: string = DEFAULT_BEINECKE_CURATORIAL_UNITS_INDEX_URL,
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

    ctx.log(`[beinecke] fetching curatorial-units index ${this.indexUrl}`);
    const indexHtml = await this.htmlFetcher(this.indexUrl, ctx.options.useCache, SOURCE_NAME);
    const units = parseBeineckeCuratorialUnitsIndex(indexHtml, this.indexUrl);
    ctx.log(`[beinecke] discovered ${units.length} curatorial units`);

    let totalObservations = 0;
    let totalEntities = 0;
    let withLead = 0;

    for (const link of units) {
      if (totalEntities >= limit) break;
      if (
        onlyFilter &&
        !onlyFilter.has(link.slug.toLowerCase()) &&
        !onlyFilter.has(unitPathname(link.url).split('/').filter(Boolean).pop() || '')
      ) {
        continue;
      }

      ctx.log(`[beinecke] fetching unit ${link.url}`);
      const unitHtml = await this.htmlFetcher(link.url, ctx.options.useCache, SOURCE_NAME);
      const unit = parseBeineckeUnitPage(unitHtml, link);
      const observations = unitToObservations(unit);
      await ctx.emit(observations);
      totalObservations += observations.length;
      totalEntities += 1;
      if (unit.lead) withLead += 1;
    }

    ctx.log(
      `Emitted ${totalObservations} observations across ${totalEntities} Beinecke curatorial units (${withLead} with an identified curatorial lead)`,
    );

    return {
      observationCount: totalObservations,
      entitiesObserved: totalEntities,
      notes: `units=${totalEntities}, withCuratorialLead=${withLead}`,
    };
  }
}
