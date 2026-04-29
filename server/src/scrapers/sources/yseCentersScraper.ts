/**
 * YseCentersScraper: scrapes Yale School of the Environment centers, programs, and initiatives index.
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import { getCached, setCached } from '../snapshotCache';
import type { IScraper, ScraperContext, ScraperResult, ObservationInput } from '../types';

const PAGE_URL = 'https://environment.yale.edu/research/centers';
const SOURCE_KEY = 'yse-centers-index';

export type YseEntityKind = 'center' | 'program' | 'initiative' | 'institute' | 'group';

export interface RawYseEntity {
  name: string;
  url: string;
  slug: string;
  kind: YseEntityKind;
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
  if (useCache) {
    const cached = await getCached<string>(SOURCE_KEY, 'page');
    if (cached) return cached;
  }
  const res = await axios.get(PAGE_URL, {
    timeout: 30000,
    headers: { 'User-Agent': 'ylabs-scraper/1.0 (+https://yalelabs.io)' },
  });
  const html = res.data as string;
  if (useCache) await setCached(SOURCE_KEY, 'page', html);
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
  const base = { entityType: 'researchGroup' as const, entityKey: entity.slug, sourceUrl };
  return [
    { ...base, field: 'slug', value: entity.slug },
    { ...base, field: 'name', value: entity.name },
    { ...base, field: 'kind', value: entity.kind },
    { ...base, field: 'school', value: 'Yale School of the Environment' },
    { ...base, field: 'websiteUrl', value: entity.url },
    { ...base, field: 'sourceUrls', value: [sourceUrl, entity.url] },
    { ...base, field: 'openness', value: 'open' },
    { ...base, field: 'acceptingUndergrads', value: true },
  ];
}

export class YseCentersScraper implements IScraper {
  readonly name = 'yse-centers-index';
  readonly displayName = 'YSE Centers, Programs & Initiatives';

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    ctx.log(`Fetching ${PAGE_URL}`);
    const html = await fetchPage(ctx.options.useCache);
    const entities = parseCenters(html);
    ctx.log(`Parsed ${entities.length} entities from index`);

    const limited =
      ctx.options.limit && ctx.options.limit > 0
        ? entities.slice(0, ctx.options.limit)
        : entities;

    let totalObs = 0;
    for (const entity of limited) {
      const observations = entityToObservations(entity, PAGE_URL);
      await ctx.emit(observations);
      totalObs += observations.length;
    }

    ctx.log(`Emitted ${totalObs} observations across ${limited.length} entities`);

    return {
      observationCount: totalObs,
      entitiesObserved: limited.length,
      notes: `Discovered ${limited.length} YSE centers/programs/initiatives`,
    };
  }
}
