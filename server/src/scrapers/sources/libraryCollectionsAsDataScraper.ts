import axios from 'axios';
import * as cheerio from 'cheerio';
import { getCached, setCached } from '../snapshotCache';
import type { IScraper, ObservationInput, ScraperContext, ScraperResult } from '../types';
import { normalizeName, slugify, splitName } from '../utils/scraperHelpers';
import { assertPublicHttpUrl, ssrfSafeAgents } from '../../utils/ssrfGuard';

const SOURCE_NAME = 'library-collections-as-data';
const USER_AGENT = 'ylabs-scraper/1.0 (+https://yalelabs.io)';
const FETCH_TIMEOUT_MS = 30_000;

export const DEFAULT_ONLINE_EXHIBITS_BASE_URL =
  'https://onlineexhibits.library.yale.edu';

const SITES_API_PATH = '/api/sites?per_page=200';

const NON_EXHIBIT_SITE_SLUGS = new Set(['browse-yul-exhibits', 'more']);

const CURATOR_CREDIT_RE = /(?:curated|organized)\s+by:?\s+([^,<]+)/i;

const CURATOR_TITLE_WORDS =
  /\b(dr|drs|prof|professor|lecturer|librarian|curator|director|fellow|archivist|dean|chair|phd|ph\.d|m\.?d|candidate|student|department|university|college|school|collection|library|program|office|committee|staff|team)\b/i;

export interface LibraryCuratorialLead {
  name: string;
  role: 'director';
  title?: string;
}

export interface OnlineExhibitLink {
  slug: string;
  title: string;
  summary: string;
  entityKey: string;
  url: string;
}

export interface OnlineExhibit extends OnlineExhibitLink {
  entityType: 'COLLECTIONS_INITIATIVE';
  kind: 'group';
  lead?: LibraryCuratorialLead;
}

export type TextFetcher = (
  url: string,
  useCache: boolean,
  sourceName: string,
) => Promise<string>;

function cleanText(value: string | undefined | null): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function exhibitEntityKey(slug: string): string {
  return `yul-exhibit-${slugify(slug)}`.slice(0, 100);
}

export function exhibitUrl(slug: string, baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, '')}/s/${slug}`;
}

export function parseExhibitsIndex(
  json: string,
  baseUrl: string,
): OnlineExhibitLink[] {
  let sites: unknown;
  try {
    sites = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(sites)) return [];

  const seen = new Set<string>();
  const exhibits: OnlineExhibitLink[] = [];

  for (const site of sites) {
    if (!site || typeof site !== 'object') continue;
    const record = site as Record<string, unknown>;
    if (record['o:is_public'] === false) continue;

    const slug = cleanText(record['o:slug'] as string);
    const title = cleanText(record['o:title'] as string);
    const summary = cleanText(record['o:summary'] as string);
    if (!slug || !title || !summary) continue;
    if (NON_EXHIBIT_SITE_SLUGS.has(slug.toLowerCase())) continue;

    const entityKey = exhibitEntityKey(slug);
    if (!entityKey || seen.has(entityKey)) continue;
    seen.add(entityKey);

    exhibits.push({
      slug,
      title,
      summary,
      entityKey,
      url: exhibitUrl(slug, baseUrl),
    });
  }

  return exhibits;
}

function isPlausiblePersonName(name: string): boolean {
  const tokens = name.split(/\s+/).filter(Boolean);
  if (tokens.length < 2 || tokens.length > 4) return false;
  if (CURATOR_TITLE_WORDS.test(name)) return false;
  return tokens.every((token) => /^[A-Z][A-Za-z.'’-]*$/.test(token) || /^[A-Z]\.?$/.test(token));
}

export function extractCuratorialLead(bodyText: string): LibraryCuratorialLead | undefined {
  const text = cleanText(bodyText);
  const match = text.match(CURATOR_CREDIT_RE);
  if (!match) return undefined;

  const firstCurator = cleanText(match[1]).split(/\s+(?:and|with|&)\s+/i)[0];
  const name = normalizeName(firstCurator);
  if (!isPlausiblePersonName(name)) return undefined;

  const { first, last } = splitName(name);
  if (!first || !last) return undefined;

  return { name, role: 'director' };
}

export function parseExhibitPage(html: string, link: OnlineExhibitLink): OnlineExhibit {
  const $ = cheerio.load(html);
  $('script, style, nav, header, footer').remove();
  const heading = cleanText($('h1').first().text());
  const bodyText = $('body').text();
  const lead = extractCuratorialLead(bodyText);

  return {
    ...link,
    title: heading || link.title,
    entityType: 'COLLECTIONS_INITIATIVE',
    kind: 'group',
    ...(lead ? { lead } : {}),
  };
}

export function leadToObservations(
  lead: LibraryCuratorialLead,
  base: { entityType: 'researchEntity'; entityKey: string; sourceUrl: string },
): ObservationInput[] {
  const cleaned = normalizeName(lead.name);
  const { last } = splitName(cleaned);
  const fname = cleaned.split(/\s+/).filter(Boolean)[0] || '';
  if (!fname || !last || fname === last) return [];

  const observations: ObservationInput[] = [
    { ...base, field: 'inferredDirectorName', value: cleaned },
    { ...base, field: 'inferredDirectorUserName', value: { fname, lname: last } },
    { ...base, field: 'inferredDirectorRole', value: lead.role, confidenceOverride: 0.8 },
  ];
  if (lead.title) {
    observations.push({ ...base, field: 'inferredDirectorTitle', value: lead.title });
  }
  return observations;
}

export function exhibitToObservations(exhibit: OnlineExhibit): ObservationInput[] {
  const base = {
    entityType: 'researchEntity' as const,
    entityKey: exhibit.entityKey,
    sourceUrl: exhibit.url,
    confidenceOverride: 0.9,
  };

  const observations: ObservationInput[] = [
    { ...base, field: 'slug', value: exhibit.entityKey },
    { ...base, field: 'name', value: exhibit.title },
    { ...base, field: 'displayName', value: exhibit.title },
    { ...base, field: 'kind', value: exhibit.kind },
    { ...base, field: 'entityType', value: exhibit.entityType },
    { ...base, field: 'websiteUrl', value: exhibit.url },
    { ...base, field: 'sourceUrls', value: [exhibit.url] },
    { ...base, field: 'fullDescription', value: exhibit.summary },
  ];

  if (exhibit.lead) {
    observations.push(
      ...leadToObservations(exhibit.lead, {
        entityType: base.entityType,
        entityKey: base.entityKey,
        sourceUrl: base.sourceUrl,
      }),
    );
  }

  return observations;
}

export async function fetchOnlineExhibitsText(
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
    responseType: 'text',
    transformResponse: (value) => value,
    httpAgent: agents.httpAgent,
    httpsAgent: agents.httpsAgent,
  });
  const text = res.data as string;
  if (useCache) await setCached(sourceName, cacheKey, text);
  return text;
}

export class LibraryCollectionsAsDataScraper implements IScraper {
  readonly name = SOURCE_NAME;
  readonly displayName = 'Yale University Library online exhibitions';

  constructor(
    private readonly baseUrl: string = DEFAULT_ONLINE_EXHIBITS_BASE_URL,
    private readonly textFetcher: TextFetcher = fetchOnlineExhibitsText,
  ) {}

  private get indexUrl(): string {
    return `${this.baseUrl.replace(/\/$/, '')}${SITES_API_PATH}`;
  }

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

    ctx.log(`[library-collections] fetching exhibitions index ${this.indexUrl}`);
    const indexJson = await this.textFetcher(this.indexUrl, ctx.options.useCache, SOURCE_NAME);
    const exhibits = parseExhibitsIndex(indexJson, this.baseUrl);
    ctx.log(`[library-collections] discovered ${exhibits.length} online exhibitions`);

    let totalObservations = 0;
    let totalEntities = 0;
    let withLead = 0;

    for (const link of exhibits) {
      if (totalEntities >= limit) break;
      if (
        onlyFilter &&
        !onlyFilter.has(link.slug.toLowerCase()) &&
        !onlyFilter.has(link.entityKey.toLowerCase())
      ) {
        continue;
      }

      ctx.log(`[library-collections] fetching exhibition ${link.url}`);
      const exhibitHtml = await this.textFetcher(link.url, ctx.options.useCache, SOURCE_NAME);
      const exhibit = parseExhibitPage(exhibitHtml, link);
      const observations = exhibitToObservations(exhibit);
      await ctx.emit(observations);
      totalObservations += observations.length;
      totalEntities += 1;
      if (exhibit.lead) withLead += 1;
    }

    ctx.log(
      `Emitted ${totalObservations} observations across ${totalEntities} Yale Library exhibitions (${withLead} with an identified curatorial lead)`,
    );

    return {
      observationCount: totalObservations,
      entitiesObserved: totalEntities,
      notes: `exhibitions=${totalEntities}, withCuratorialLead=${withLead}`,
    };
  }
}
