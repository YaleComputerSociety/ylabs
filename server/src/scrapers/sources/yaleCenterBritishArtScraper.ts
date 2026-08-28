/**
 * YaleCenterBritishArtScraper
 *
 * Discovery-only scraper for the Yale Center for British Art (YCBA) curatorial
 * departments and museum-run research programs (Paintings and Sculpture, Prints
 * and Drawings, Rare Books and Manuscripts, the Reference Library and Photograph
 * Archives, the institutional Archives, Conservation, Research Initiatives, and
 * the Research Fellowships program). Each is a marquee, object-based,
 * undergraduate-accessible museum/collections research home. It is the flagship
 * art-museum peer of the Peabody producer (#1349/#1367) for the reserved
 * `ARCHIVE_OR_MUSEUM_PROJECT` entity type; the taxonomy, access materializer, and
 * product model already handle museum/collections homes.
 *
 * YCBA's own site publishes no single department index that lists these homes as
 * link cards (the "Collecting Areas" landing and the departments-and-staff roster
 * are contact-laden, non-enumerable pages), so this producer carries a curated
 * seed of each department's own official page rather than crawling an index root.
 * It fetches and cites each individual department's own page - never a museum
 * landing/index root - per the self-referential / index-page source guards
 * (#516/#549). It emits identity and the department's own official-page summary
 * description.
 *
 * Curatorial lead, verified live: YCBA department pages do not publish a
 * structured named-curator credit; department staff (and their contact emails and
 * phone numbers) live only on the separate, deliberately-unused
 * departments-and-staff roster page. `extractCuratorialLead` therefore reads only
 * a structured staff/credit block on the department's own page and never body
 * prose, so it fails closed on all current pages rather than promoting a name from
 * a contact-laden roster. Where a department ever publishes a structured named
 * curatorial lead on its own page, it is emitted as an entity-level
 * inferred-director observation and `materializeInferredDirectorMembership`
 * resolves that name to a unique canonical Researcher before promotion, introducing no new
 * access logic. Without a named director a museum home still earns the
 * organizational REACH_OUT_PLAUSIBLE ways-in from its official page. The scraper
 * never emits contact routes, undergraduate-access claims, or posted openings; it
 * fails closed on contact data, consistent with skills/scrapers/SKILL.md.
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import { getCached, setCached } from '../snapshotCache';
import type { IScraper, ObservationInput, ScraperContext, ScraperResult } from '../types';
import { normalizeName, splitName } from '../utils/scraperHelpers';
import { assertPublicHttpUrl, ssrfSafeAgents } from '../../utils/ssrfGuard';

const SOURCE_NAME = 'ycba-collections-research';
const USER_AGENT = 'ylabs-scraper/1.0 (+https://yalelabs.io)';
const FETCH_TIMEOUT_MS = 30_000;

const CURATOR_ROLE_RE = /\bcurator\b|\bhead of\b|\bkeeper\b/i;

export interface YcbaDepartmentSeed {
  name: string;
  url: string;
  slug: string;
}

export const YCBA_DEPARTMENT_SEEDS: YcbaDepartmentSeed[] = [
  {
    name: 'Paintings and Sculpture',
    url: 'https://britishart.yale.edu/paintings-and-sculpture',
    slug: 'ycba-paintings-and-sculpture',
  },
  {
    name: 'Prints and Drawings',
    url: 'https://britishart.yale.edu/prints-and-drawings',
    slug: 'ycba-prints-and-drawings',
  },
  {
    name: 'Rare Books and Manuscripts',
    url: 'https://britishart.yale.edu/rare-books-and-manuscripts',
    slug: 'ycba-rare-books-and-manuscripts',
  },
  {
    name: 'Reference Library and Photo Archives',
    url: 'https://britishart.yale.edu/reference-library-and-photo-archives',
    slug: 'ycba-reference-library-and-photo-archives',
  },
  {
    name: 'Archives',
    url: 'https://britishart.yale.edu/archives',
    slug: 'ycba-archives',
  },
  {
    name: 'Conservation',
    url: 'https://britishart.yale.edu/conservation',
    slug: 'ycba-conservation',
  },
  {
    name: 'Research Initiatives',
    url: 'https://britishart.yale.edu/research-initiatives',
    slug: 'ycba-research-initiatives',
  },
  {
    name: 'Research Fellowships',
    url: 'https://britishart.yale.edu/research-fellowships',
    slug: 'ycba-research-fellowships',
  },
];

export interface YcbaCuratorialLead {
  name: string;
  role: 'director';
  title?: string;
  profileUrl?: string;
}

export interface YcbaDepartment extends YcbaDepartmentSeed {
  entityType: 'ARCHIVE_OR_MUSEUM_PROJECT';
  kind: 'group';
  description?: string;
  lead?: YcbaCuratorialLead;
}

export type YcbaHtmlFetcher = (
  url: string,
  useCache: boolean,
  sourceName: string,
) => Promise<string>;

function cleanText(value: string | undefined | null): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractDepartmentDescription($: cheerio.CheerioAPI): string | undefined {
  let description = '';
  $('.x-article-introduction__text p').each((_i, el) => {
    if (description) return;
    const text = cleanText($(el).text());
    if (text.length >= 40) description = text;
  });
  return description || undefined;
}

function extractCuratorialLead($: cheerio.CheerioAPI): YcbaCuratorialLead | undefined {
  let lead: YcbaCuratorialLead | undefined;

  $('.x-staff-credit, .field--name-field-curator, .staff-info-container-table').each((_i, el) => {
    if (lead) return;
    const container = $(el);
    const roleText = cleanText(
      container.find('.staff-role, .field--name-field-role em, em').first().text(),
    );
    if (!CURATOR_ROLE_RE.test(roleText)) return;

    const name = cleanText(
      container.find('.staff-name, .field--name-field-person-name, strong').first().text(),
    );
    if (!name) return;

    const profileHref = cleanText(container.find('a[href]').first().attr('href'));
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

export function parseYcbaDepartmentPage(html: string, seed: YcbaDepartmentSeed): YcbaDepartment {
  const $ = cheerio.load(html);
  const heading =
    cleanText($('h1.x-header-title__title').first().text()) || cleanText($('h1').first().text());
  const description = extractDepartmentDescription($);
  const lead = extractCuratorialLead($);

  return {
    ...seed,
    name: heading || seed.name,
    entityType: 'ARCHIVE_OR_MUSEUM_PROJECT',
    kind: 'group',
    ...(description ? { description } : {}),
    ...(lead ? { lead } : {}),
  };
}

export function leadToObservations(
  lead: YcbaCuratorialLead,
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

export function departmentToObservations(department: YcbaDepartment): ObservationInput[] {
  const base = {
    entityType: 'researchEntity' as const,
    entityKey: department.slug,
    sourceUrl: department.url,
    confidenceOverride: 0.9,
  };

  const observations: ObservationInput[] = [
    { ...base, field: 'slug', value: department.slug },
    { ...base, field: 'name', value: department.name },
    { ...base, field: 'displayName', value: department.name },
    { ...base, field: 'kind', value: department.kind },
    { ...base, field: 'entityType', value: department.entityType },
    { ...base, field: 'websiteUrl', value: department.url },
    { ...base, field: 'sourceUrls', value: [department.url] },
  ];

  if (department.description) {
    observations.push({ ...base, field: 'fullDescription', value: department.description });
  }
  if (department.lead) {
    observations.push(
      ...leadToObservations(department.lead, {
        entityType: base.entityType,
        entityKey: base.entityKey,
        sourceUrl: base.sourceUrl,
      }),
    );
  }

  return observations;
}

export async function fetchYcbaHtml(
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

export class YaleCenterBritishArtScraper implements IScraper {
  readonly name = SOURCE_NAME;
  readonly displayName = 'Yale Center for British Art curatorial departments & research programs';

  constructor(
    private readonly departmentSeeds: YcbaDepartmentSeed[] = YCBA_DEPARTMENT_SEEDS,
    private readonly htmlFetcher: YcbaHtmlFetcher = fetchYcbaHtml,
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

    ctx.log(`[ycba] processing ${this.departmentSeeds.length} curatorial departments`);

    let totalObservations = 0;
    let totalEntities = 0;
    let withLead = 0;

    for (const seed of this.departmentSeeds) {
      if (totalEntities >= limit) break;
      if (onlyFilter && !onlyFilter.has(seed.slug.toLowerCase())) continue;

      ctx.log(`[ycba] fetching department ${seed.url}`);
      const html = await this.htmlFetcher(seed.url, ctx.options.useCache, SOURCE_NAME);
      if (!html) {
        ctx.log(`[ycba] skipped ${seed.slug} - page unavailable`);
        continue;
      }
      const department = parseYcbaDepartmentPage(html, seed);
      const observations = departmentToObservations(department);
      await ctx.emit(observations);
      totalObservations += observations.length;
      totalEntities += 1;
      if (department.lead) withLead += 1;
    }

    ctx.log(
      `Emitted ${totalObservations} observations across ${totalEntities} YCBA curatorial departments (${withLead} with an identified curatorial lead)`,
    );

    return {
      observationCount: totalObservations,
      entitiesObserved: totalEntities,
      notes: `departments=${totalEntities}, withCuratorialLead=${withLead}`,
    };
  }
}
