/**
 * YseCentersScraper: scrapes Yale School of the Environment centers, programs, and initiatives index.
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import { getCached, setCached } from '../snapshotCache';
import type { IScraper, ScraperContext, ScraperResult, ObservationInput } from '../types';
import { assertPublicHttpUrl, ssrfSafeAgents } from '../../utils/ssrfGuard';

const PAGE_URL = 'https://environment.yale.edu/research/centers';
const SOURCE_KEY = 'yse-centers-index';
const USER_AGENT = 'ylabs-scraper/1.0 (+https://yalelabs.io)';
const FETCH_TIMEOUT_MS = 30000;

export type YseEntityKind = 'center' | 'program' | 'initiative' | 'institute' | 'group';

export interface RawYseEntity {
  name: string;
  url: string;
  slug: string;
  kind: YseEntityKind;
}

interface YseAccessDetailConfig {
  urls: string[];
  parse: (htmlByUrl: Map<string, string>) => ObservationInput[];
}

export function normalizeUrl(href: string): string | null {
  if (!href) return null;
  try {
    const abs = new URL(href, PAGE_URL).toString();
    if (!/^https?:\/\//i.test(abs)) return null;
    return abs;
  } catch {
    return null;
  }
}

export function slugifyFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const segments = u.pathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1];
    if (!last) return null;
    return `yse-${last.toLowerCase()}`;
  } catch {
    return null;
  }
}

export function slugifyFromName(name: string): string {
  return (
    'yse-' +
    name
      .toLowerCase()
      .replace(/['']s\b/g, '')
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80)
  );
}

export function cleanName(rawName: string): string {
  return rawName.replace(/^\s*affiliated\s*:\s*/i, '').trim();
}

export function inferKind(name: string, url: string): YseEntityKind {
  const haystack = `${name} ${url}`.toLowerCase();
  if (/\binstitute\b/.test(haystack)) return 'institute';
  if (/\binitiatives?\b/.test(haystack)) return 'initiative';
  if (/\bprograms?\b/.test(haystack)) return 'program';
  if (/\b(center|centre)\b/.test(haystack)) return 'center';
  if (/\b(forum|dialogue)\b/.test(haystack)) return 'group';
  return 'center';
}

async function fetchPage(useCache: boolean): Promise<string> {
  const safeUrl = await assertPublicHttpUrl(PAGE_URL);
  const agents = ssrfSafeAgents();
  if (useCache) {
    const cached = await getCached<string>(SOURCE_KEY, 'page');
    if (cached) return cached;
  }
  const res = await axios.get(safeUrl.toString(), {
    timeout: FETCH_TIMEOUT_MS,
    headers: { 'User-Agent': USER_AGENT },
    maxRedirects: 5,
    httpAgent: agents.httpAgent,
    httpsAgent: agents.httpsAgent,
  });
  const html = res.data as string;
  if (useCache) await setCached(SOURCE_KEY, 'page', html);
  return html;
}

async function fetchUrl(url: string, useCache: boolean): Promise<string> {
  const safeUrl = await assertPublicHttpUrl(url);
  const safeUrlText = safeUrl.toString();
  const cacheKey = `detail:${safeUrlText}`;
  if (useCache) {
    const cached = await getCached<string>(SOURCE_KEY, cacheKey);
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
  if (useCache) await setCached(SOURCE_KEY, cacheKey, html);
  return html;
}

export function parseCenters(html: string): RawYseEntity[] {
  const $ = cheerio.load(html);
  const out: RawYseEntity[] = [];
  const seenSlugs = new Set<string>();

  $('.wysiwyg ul li a').each((_i, a) => {
    const linkEl = $(a);
    const rawName = linkEl.text().trim();
    const href = linkEl.attr('href') || '';
    if (!rawName) return;

    const url = normalizeUrl(href);
    if (!url) return;

    const name = cleanName(rawName);
    if (!name) return;

    const slug = slugifyFromUrl(url) || slugifyFromName(name);
    if (!slug || seenSlugs.has(slug)) return;
    seenSlugs.add(slug);

    out.push({ name, url, slug, kind: inferKind(name, url) });
  });

  return out;
}

export function entityToObservations(entity: RawYseEntity, sourceUrl: string): ObservationInput[] {
  const base = { entityType: 'researchEntity' as const, entityKey: entity.slug, sourceUrl };
  return [
    { ...base, field: 'slug', value: entity.slug },
    { ...base, field: 'name', value: entity.name },
    { ...base, field: 'kind', value: entity.kind },
    { ...base, field: 'school', value: 'Yale School of the Environment' },
    { ...base, field: 'websiteUrl', value: entity.url },
    { ...base, field: 'sourceUrls', value: [sourceUrl, entity.url] },
    { ...base, field: 'openness', value: 'open' },
  ];
}

function pageText(html: string): string {
  const $ = cheerio.load(html);
  return $('body').text().replace(/\s+/g, ' ').trim();
}

export function yasspAccessObservations(htmlByUrl: Map<string, string>): ObservationInput[] {
  const sourceUrl = 'https://synthesis.yale.edu/research-team';
  const text = pageText(htmlByUrl.get(sourceUrl) || '');
  if (!/\bFormer Undergraduate Student Researcher\b/i.test(text)) return [];

  return [
    {
      entityType: 'researchEntity',
      entityKey: 'yse-yale-applied-science-synthesis-program-yassp',
      field: 'undergradEvidenceQuote',
      value: 'The YASSP research team page lists Nicole Gotthardt as a Former Undergraduate Student Researcher.',
      sourceUrl,
      confidenceOverride: 0.72,
    },
    {
      entityType: 'researchEntity',
      entityKey: 'yse-yale-applied-science-synthesis-program-yassp',
      field: 'pastUndergradAdvisees',
      value: [{ name: 'Nicole Gotthardt', role: 'Former Undergraduate Student Researcher', count: 1 }],
      sourceUrl,
      confidenceOverride: 0.72,
    },
  ];
}

export function ypcccAccessObservations(htmlByUrl: Map<string, string>): ObservationInput[] {
  const sourceUrl = 'https://climatecommunication.yale.edu/about/student-employment/';
  const text = pageText(htmlByUrl.get(sourceUrl) || '');
  if (!/\bcurrent Yale University students, both grad and undergrad\b/i.test(text)) return [];

  return [
    {
      entityType: 'researchEntity',
      entityKey: 'yse-climate-change-communication',
      field: 'undergradAccessEvidence',
      value: { openToUndergrads: 'yes', evidenceSource: 'official_student_employment_page' },
      sourceUrl,
      confidenceOverride: 0.86,
    },
    {
      entityType: 'researchEntity',
      entityKey: 'yse-climate-change-communication',
      field: 'undergradEvidenceQuote',
      value:
        'YPCCC says student jobs are intended for current Yale University students, both grad and undergrad.',
      sourceUrl,
      confidenceOverride: 0.86,
    },
    {
      entityType: 'researchEntity',
      entityKey: 'yse-climate-change-communication',
      field: 'undergradRoleEvidenceQuote',
      value:
        'The YPCCC Student Job List includes Data Team Research Assistant, Experiments Team Research Assistant, Survey Research Assistant, and Partnerships Research Assistant roles.',
      sourceUrl,
      confidenceOverride: 0.86,
    },
    {
      entityType: 'researchEntity',
      entityKey: 'yse-climate-change-communication',
      field: 'joinPageUrl',
      value: sourceUrl,
      sourceUrl,
      confidenceOverride: 0.86,
    },
    {
      entityType: 'researchEntity',
      entityKey: 'yse-climate-change-communication',
      field: 'contactInstructionsQuote',
      value:
        'YPCCC states that openings can be found on Yale Student Employment and that jobs listed on the page are not open unless posted there.',
      sourceUrl,
      confidenceOverride: 0.86,
    },
  ];
}

const ACCESS_DETAIL_CONFIGS: Record<string, YseAccessDetailConfig> = {
  'yse-yale-applied-science-synthesis-program-yassp': {
    urls: ['https://synthesis.yale.edu/research-team'],
    parse: yasspAccessObservations,
  },
  'yse-climate-change-communication': {
    urls: ['https://climatecommunication.yale.edu/about/student-employment/'],
    parse: ypcccAccessObservations,
  },
};

export async function accessObservationsForEntity(
  entity: RawYseEntity,
  useCache: boolean,
): Promise<ObservationInput[]> {
  const config = ACCESS_DETAIL_CONFIGS[entity.slug];
  if (!config) return [];
  const htmlByUrl = new Map<string, string>();
  for (const url of config.urls) {
    htmlByUrl.set(url, await fetchUrl(url, useCache));
  }
  return config.parse(htmlByUrl);
}

export class YseCentersScraper implements IScraper {
  readonly name = 'yse-centers-index';
  readonly displayName = 'YSE Centers, Programs & Initiatives';

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    const limitOption = ctx.options.limit;
    if (limitOption !== undefined && (!Number.isSafeInteger(limitOption) || limitOption < 1)) {
      throw new Error('--limit must be a safe positive integer');
    }

    ctx.log(`Fetching ${PAGE_URL}`);
    const html = await fetchPage(ctx.options.useCache);
    const entities = parseCenters(html);
    ctx.log(`Parsed ${entities.length} entities from index`);

    const limited =
      limitOption && limitOption > 0
        ? entities.slice(0, limitOption)
        : entities;

    let totalObs = 0;
    let accessObs = 0;
    for (const entity of limited) {
      const entityObservations = entityToObservations(entity, PAGE_URL);
      const entityAccessObservations = await accessObservationsForEntity(entity, ctx.options.useCache);
      const observations = [...entityObservations, ...entityAccessObservations];
      await ctx.emit(observations);
      totalObs += observations.length;
      accessObs += entityAccessObservations.length;
    }

    ctx.log(`Emitted ${totalObs} observations across ${limited.length} entities (${accessObs} access observations)`);

    return {
      observationCount: totalObs,
      entitiesObserved: limited.length,
      notes: `Discovered ${limited.length} YSE centers/programs/initiatives; emitted ${accessObs} access observations`,
    };
  }
}
