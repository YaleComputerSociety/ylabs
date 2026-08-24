/**
 * DhLabProjectsScraper: acquires Yale Digital Humanities Lab (DHLab) research
 * projects as DIGITAL_HUMANITIES_PROJECT research homes.
 *
 * Sourcing note (#1345): the DHLab migrated under the Yale Library web presence
 * (library.yale.edu/digital-humanities-laboratory) and the rendered per-project
 * catalog was retired in that move - dhlab.yale.edu and every /projects/<slug>
 * path now meta-refresh to the services page, so no live rendered catalog with
 * per-project URLs survives. The canonical curated project catalog does survive
 * as the Jekyll source of the old site (YaleDHLab/dhlab-site `_projects/*.md`):
 * each entry carries the project's own still-published official URL. This walker
 * treats that `_projects` catalog as the crawl seed (never cited) and cites each
 * project's own official page (`project_url`) as the source, per the
 * self-referential / index-page source guards (#516, #549). It fails closed on
 * projects without a citable own-page URL rather than minting an uncitable home.
 */
import axios from 'axios';
import { getCached, setCached } from '../snapshotCache';
import type { IScraper, ScraperContext, ScraperResult, ObservationInput } from '../types';
import { assertPublicHttpUrl, ssrfSafeAgents } from '../../utils/ssrfGuard';

const LISTING_API =
  'https://api.github.com/repos/YaleDHLab/dhlab-site/contents/_projects?ref=master';
const RAW_BASE =
  'https://raw.githubusercontent.com/YaleDHLab/dhlab-site/master/_projects/';
const SOURCE_KEY = 'dh-lab-projects';
const USER_AGENT = 'ylabs-scraper/1.0 (+https://yalelabs.io)';
const FETCH_TIMEOUT_MS = 30000;

export interface DhCatalogEntry {
  name: string;
  downloadUrl: string;
}

export interface RawDhProject {
  slug: string;
  name: string;
  projectUrl: string;
  topics: string[];
  methods: string[];
  description: string;
}

export interface ParsedFrontMatter {
  scalars: Record<string, string>;
  lists: Record<string, string[]>;
}

export function parseProjectListing(json: string): DhCatalogEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const entries: DhCatalogEntry[] = [];
  for (const item of parsed) {
    const record = item as Record<string, unknown>;
    const name = typeof record.name === 'string' ? record.name : '';
    if (!name.toLowerCase().endsWith('.md')) continue;
    const downloadUrl =
      typeof record.download_url === 'string' && /^https?:\/\//i.test(record.download_url)
        ? record.download_url
        : `${RAW_BASE}${name}`;
    entries.push({ name, downloadUrl });
  }
  return entries;
}

function stripQuotes(value: string): string {
  return value.replace(/^['"]|['"]$/g, '').trim();
}

export function parseFrontMatter(markdown: string): ParsedFrontMatter {
  const scalars: Record<string, string> = {};
  const lists: Record<string, string[]> = {};
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { scalars, lists };

  let currentListKey: string | null = null;
  for (const rawLine of match[1].split(/\r?\n/)) {
    const listItem = rawLine.match(/^\s+-\s+(.+)$/);
    if (listItem && currentListKey) {
      const item = listItem[1].trim();
      if (!/^[A-Za-z_][\w-]*:\s/.test(item)) {
        lists[currentListKey].push(stripQuotes(item));
      }
      continue;
    }
    const keyed = rawLine.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (keyed) {
      const key = keyed[1];
      const value = keyed[2].trim();
      if (value === '') {
        currentListKey = key;
        lists[key] = lists[key] || [];
      } else {
        currentListKey = null;
        scalars[key] = stripQuotes(value);
      }
      continue;
    }
    if (!/^\s+\S/.test(rawLine)) currentListKey = null;
  }
  return { scalars, lists };
}

export function slugFromFrontMatter(fm: ParsedFrontMatter, fileName: string): string {
  const permalink = fm.scalars.permalink || '';
  const segments = permalink.split('/').filter(Boolean);
  const last = segments[segments.length - 1];
  const base = last || fileName.replace(/\.md$/i, '');
  const normalized = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `dh-${normalized}`;
}

export function isCitableProjectUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value)) return false;
  let hostname: string;
  try {
    hostname = new URL(value).hostname;
  } catch {
    return false;
  }
  if (!hostname.includes('.')) return false;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return false;
  return true;
}

export function extractOverviewDescription(markdown: string): string {
  const body = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  const cleaned = body
    .replace(/<[^>]+>/g, ' ')
    .replace(/\{\{[^}]*\}\}/g, ' ')
    .replace(/\{%[^%]*%\}/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');

  const paragraphs: string[] = [];
  let current: string[] = [];
  const flush = (): void => {
    if (current.length) {
      paragraphs.push(current.join(' '));
      current = [];
    }
  };
  for (const line of cleaned.split(/\r?\n/)) {
    if (/^\s*#{1,6}\s/.test(line) || /^\s*$/.test(line)) {
      flush();
      continue;
    }
    current.push(line.trim());
  }
  flush();

  const normalized = paragraphs
    .map((p) => p.replace(/[*_`>]/g, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  let out = '';
  for (const paragraph of normalized) {
    if (!out) out = paragraph;
    else if (out.length < 300) out = `${out} ${paragraph}`;
    else break;
  }
  return out.slice(0, 900).trim();
}

export function extractProjectFromMarkdown(
  markdown: string,
  fileName: string,
): RawDhProject | null {
  const fm = parseFrontMatter(markdown);
  const name = fm.scalars.title || '';
  const projectUrl = fm.scalars.project_url || '';
  if (!name || !isCitableProjectUrl(projectUrl)) return null;

  return {
    slug: slugFromFrontMatter(fm, fileName),
    name,
    projectUrl,
    topics: fm.lists.tags || [],
    methods: fm.lists.categories || [],
    description: extractOverviewDescription(markdown),
  };
}

export function projectToObservations(project: RawDhProject): ObservationInput[] {
  const base = { entityType: 'researchEntity' as const, entityKey: project.slug, sourceUrl: project.projectUrl };
  const observations: ObservationInput[] = [
    { ...base, field: 'slug', value: project.slug },
    { ...base, field: 'name', value: project.name },
    { ...base, field: 'kind', value: 'group' },
    { ...base, field: 'entityType', value: 'DIGITAL_HUMANITIES_PROJECT' },
    { ...base, field: 'websiteUrl', value: project.projectUrl },
    { ...base, field: 'sourceUrls', value: [project.projectUrl] },
  ];
  if (project.topics.length > 0) {
    observations.push({ ...base, field: 'researchAreas', value: project.topics });
  }
  if (project.methods.length > 0) {
    observations.push({ ...base, field: 'methods', value: project.methods });
  }
  if (project.description) {
    observations.push({ ...base, field: 'fullDescription', value: project.description });
  }
  return observations;
}

async function fetchText(url: string, cacheKey: string, useCache: boolean): Promise<string> {
  const safeUrl = await assertPublicHttpUrl(url);
  if (useCache) {
    const cached = await getCached<string>(SOURCE_KEY, cacheKey);
    if (cached) return cached;
  }
  const agents = ssrfSafeAgents();
  const res = await axios.get(safeUrl.toString(), {
    timeout: FETCH_TIMEOUT_MS,
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json' },
    maxRedirects: 5,
    httpAgent: agents.httpAgent,
    httpsAgent: agents.httpsAgent,
  });
  const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
  if (useCache) await setCached(SOURCE_KEY, cacheKey, text);
  return text;
}

export class DhLabProjectsScraper implements IScraper {
  readonly name = 'dh-lab-projects';
  readonly displayName = 'Yale DHLab Projects Catalog';

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    const limitOption = ctx.options.limit;
    if (limitOption !== undefined && (!Number.isSafeInteger(limitOption) || limitOption < 1)) {
      throw new Error('--limit must be a safe positive integer');
    }

    ctx.log(`Fetching ${LISTING_API}`);
    const listingJson = await fetchText(LISTING_API, 'listing', ctx.options.useCache);
    const catalog = parseProjectListing(listingJson);
    ctx.log(`Discovered ${catalog.length} project files in the DHLab catalog seed`);

    const limited =
      limitOption && limitOption > 0 ? catalog.slice(0, limitOption) : catalog;

    let totalObs = 0;
    let emittedEntities = 0;
    let skipped = 0;
    for (const entry of limited) {
      const markdown = await fetchText(entry.downloadUrl, `project:${entry.name}`, ctx.options.useCache);
      const project = extractProjectFromMarkdown(markdown, entry.name);
      if (!project) {
        skipped += 1;
        continue;
      }
      const observations = projectToObservations(project);
      await ctx.emit(observations);
      totalObs += observations.length;
      emittedEntities += 1;
    }

    ctx.log(
      `Emitted ${totalObs} observations across ${emittedEntities} DHLab projects (${skipped} skipped for no citable own-page URL)`,
    );

    return {
      observationCount: totalObs,
      entitiesObserved: emittedEntities,
      notes: `Minted ${emittedEntities} DIGITAL_HUMANITIES_PROJECT homes from the DHLab catalog; skipped ${skipped} without a citable own-page URL`,
    };
  }
}
