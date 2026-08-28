/**
 * PeabodyCollectionsResearchScraper
 *
 * Discovery-only scraper for the Yale Peabody Museum "Collections & Research"
 * divisions catalog. Each division (Anthropology, Botany, Vertebrate
 * Paleontology, ...) is a marquee, undergraduate-accessible museum/collections
 * research home led by a named curator. This is the pilot producer for the
 * reserved `ARCHIVE_OR_MUSEUM_PROJECT` entity type: the taxonomy, access
 * materializer, and product model already handle museum homes, but no source
 * minted one until now.
 *
 * The scraper walks the divisions index only to enumerate divisions, then fetches
 * and cites each individual division's own page - never the index root - per the
 * self-referential / index-page source guards (#516/#549). It emits identity,
 * an official-page description, and the single "Curator-in-charge" as an
 * entity-level inferred-director observation. The existing
 * `materializeInferredDirectorMembership` resolves that name to a unique Yale
 * User before promoting a lead, so no new access logic is introduced and the
 * museum home lands on the identified-lead ways-in path. It never emits
 * contact routes, undergraduate-access claims, or posted openings: it fails
 * closed on contact data, consistent with skills/scrapers/SKILL.md.
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import { getCached, setCached } from '../snapshotCache';
import type { IScraper, ObservationInput, ScraperContext, ScraperResult } from '../types';
import { normalizeName, slugify, splitName } from '../utils/scraperHelpers';
import { assertPublicHttpUrl, ssrfSafeAgents } from '../../utils/ssrfGuard';

const SOURCE_NAME = 'peabody-collections-research';
const USER_AGENT = 'ylabs-scraper/1.0 (+https://yalelabs.io)';
const FETCH_TIMEOUT_MS = 30_000;

export const DEFAULT_PEABODY_DIVISIONS_INDEX_URL = 'https://peabody.yale.edu/explore/collections';

const DIVISION_PATH_RE = /^\/explore\/collections\/[a-z0-9-]+$/i;

const NON_CURATORIAL_DIVISION_SLUGS = new Set(['information-science']);

const CURATOR_IN_CHARGE_RE = /curator[-\s]?in[-\s]?charge/i;

export interface PeabodyCuratorialLead {
  name: string;
  role: 'director';
  title?: string;
  profileUrl?: string;
}

export interface PeabodyDivisionLink {
  name: string;
  url: string;
  slug: string;
}

export interface PeabodyDivision extends PeabodyDivisionLink {
  entityType: 'ARCHIVE_OR_MUSEUM_PROJECT';
  kind: 'group';
  description?: string;
  lead?: PeabodyCuratorialLead;
}

export type PeabodyHtmlFetcher = (
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

function divisionPathname(url: string): string {
  try {
    return new URL(url).pathname.replace(/\/$/, '');
  } catch {
    return '';
  }
}

function divisionSlugFromUrl(url: string): string {
  const pathname = divisionPathname(url);
  const lastSegment = pathname.split('/').filter(Boolean).pop() || '';
  return lastSegment ? `peabody-${lastSegment}`.slice(0, 100) : '';
}

export function slugifyPeabodyDivision(name: string): string {
  return `peabody-${slugify(name)}`.slice(0, 100);
}

export function parsePeabodyDivisionsIndex(html: string, pageUrl: string): PeabodyDivisionLink[] {
  const $ = cheerio.load(html);
  const seen = new Set<string>();
  const divisions: PeabodyDivisionLink[] = [];

  $('a.whole-card-link[href]').each((_i, el) => {
    const link = $(el);
    const url = absoluteUrl(link.attr('href'), pageUrl);
    const pathname = divisionPathname(url);
    if (!DIVISION_PATH_RE.test(pathname)) return;

    const lastSegment = pathname.split('/').filter(Boolean).pop() || '';
    if (NON_CURATORIAL_DIVISION_SLUGS.has(lastSegment.toLowerCase())) return;

    const name =
      cleanText(link.find('.box-header').first().text()) ||
      cleanText(link.attr('title')) ||
      cleanText(link.text());
    const slug = divisionSlugFromUrl(url) || slugifyPeabodyDivision(name);
    if (!name || !slug || seen.has(slug)) return;

    seen.add(slug);
    divisions.push({ name, url, slug });
  });

  return divisions;
}

function extractDivisionDescription($: cheerio.CheerioAPI): string | undefined {
  const candidates = $(
    '.field--name-field-text-demo .field__item p, .paragraph--type--text .field__item p',
  );
  let description = '';
  candidates.each((_i, el) => {
    if (description) return;
    const text = cleanText($(el).text());
    if (text.length >= 40) description = text;
  });
  return description || undefined;
}

function extractCuratorialLead($: cheerio.CheerioAPI): PeabodyCuratorialLead | undefined {
  let lead: PeabodyCuratorialLead | undefined;

  $('.staff-info-container-table').each((_i, el) => {
    if (lead) return;
    const container = $(el);
    const roleText = cleanText(container.find('.staff-info-text-collections em').first().text());
    if (!CURATOR_IN_CHARGE_RE.test(roleText)) return;

    const name = cleanText(container.find('.staff-info-text-title strong').first().text());
    if (!name) return;

    const profileHref = cleanText(
      container.find('.staff-info-text-website a[href]').first().attr('href'),
    );
    const profileUrl =
      /^https?:\/\//i.test(profileHref) && /yale\.edu/i.test(profileHref) ? profileHref : undefined;

    lead = {
      name,
      role: 'director',
      ...(roleText ? { title: roleText } : {}),
      ...(profileUrl ? { profileUrl } : {}),
    };
  });

  return lead;
}

export function parsePeabodyDivisionPage(
  html: string,
  division: PeabodyDivisionLink,
): PeabodyDivision {
  const $ = cheerio.load(html);
  const heading = cleanText($('h1').first().text());
  const description = extractDivisionDescription($);
  const lead = extractCuratorialLead($);

  return {
    ...division,
    name: heading || division.name,
    entityType: 'ARCHIVE_OR_MUSEUM_PROJECT',
    kind: 'group',
    ...(description ? { description } : {}),
    ...(lead ? { lead } : {}),
  };
}

export function leadToObservations(
  lead: PeabodyCuratorialLead,
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

export function divisionToObservations(division: PeabodyDivision): ObservationInput[] {
  const base = {
    entityType: 'researchEntity' as const,
    entityKey: division.slug,
    sourceUrl: division.url,
    confidenceOverride: 0.9,
  };

  const observations: ObservationInput[] = [
    { ...base, field: 'slug', value: division.slug },
    { ...base, field: 'name', value: division.name },
    { ...base, field: 'displayName', value: division.name },
    { ...base, field: 'kind', value: division.kind },
    { ...base, field: 'entityType', value: division.entityType },
    { ...base, field: 'websiteUrl', value: division.url },
    { ...base, field: 'sourceUrls', value: [division.url] },
  ];

  if (division.description) {
    observations.push({ ...base, field: 'fullDescription', value: division.description });
  }
  if (division.lead) {
    observations.push(
      ...leadToObservations(division.lead, {
        entityType: base.entityType,
        entityKey: base.entityKey,
        sourceUrl: base.sourceUrl,
      }),
    );
  }

  return observations;
}

export async function fetchPeabodyHtml(
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

export class PeabodyCollectionsResearchScraper implements IScraper {
  readonly name = SOURCE_NAME;
  readonly displayName = 'Yale Peabody Museum collections & research divisions';

  constructor(
    private readonly indexUrl: string = DEFAULT_PEABODY_DIVISIONS_INDEX_URL,
    private readonly htmlFetcher: PeabodyHtmlFetcher = fetchPeabodyHtml,
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

    ctx.log(`[peabody] fetching divisions index ${this.indexUrl}`);
    const indexHtml = await this.htmlFetcher(this.indexUrl, ctx.options.useCache, SOURCE_NAME);
    const divisions = parsePeabodyDivisionsIndex(indexHtml, this.indexUrl);
    ctx.log(`[peabody] discovered ${divisions.length} collections divisions`);

    let totalObservations = 0;
    let totalEntities = 0;
    let withLead = 0;

    for (const link of divisions) {
      if (totalEntities >= limit) break;
      if (
        onlyFilter &&
        !onlyFilter.has(link.slug.toLowerCase()) &&
        !onlyFilter.has(divisionPathname(link.url).split('/').filter(Boolean).pop() || '')
      ) {
        continue;
      }

      ctx.log(`[peabody] fetching division ${link.url}`);
      const divisionHtml = await this.htmlFetcher(link.url, ctx.options.useCache, SOURCE_NAME);
      const division = parsePeabodyDivisionPage(divisionHtml, link);
      const observations = divisionToObservations(division);
      await ctx.emit(observations);
      totalObservations += observations.length;
      totalEntities += 1;
      if (division.lead) withLead += 1;
    }

    ctx.log(
      `Emitted ${totalObservations} observations across ${totalEntities} Peabody divisions (${withLead} with an identified curatorial lead)`,
    );

    return {
      observationCount: totalObservations,
      entitiesObserved: totalEntities,
      notes: `divisions=${totalEntities}, withCuratorialLead=${withLead}`,
    };
  }
}
