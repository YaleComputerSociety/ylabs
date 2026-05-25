/**
 * Official research.yale.edu source ingestion.
 *
 * This source is discovery-only: it records official Yale research structures,
 * cores, and infrastructure resources, but never undergraduate access claims.
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import { getCached, setCached } from '../snapshotCache';
import type { IScraper, ObservationInput, ScraperContext, ScraperResult } from '../types';
import type { ResearchEntityType, ResearchGroupKind } from '../../models/researchAccessTypes';

export const CENTERS_LISTING_URL = 'https://research.yale.edu/centers-institutes';
export const CORE_LISTING_URL = 'https://research.yale.edu/cores';
export const RESOURCES_LISTING_URL = 'https://research.yale.edu/resources';

const USER_AGENT = 'ylabs-scraper/1.0 (+https://yalelabs.io)';
const FETCH_TIMEOUT_MS = 30_000;
const SOURCE_NAME = 'yale-research-official';

type OfficialResearchEntityKind = Exclude<ResearchGroupKind, 'individual' | 'solo'>;
export type YaleResearchOfficialFetchHtml = (url: string, useCache: boolean) => Promise<string>;

export interface YaleResearchOfficialScraperDeps {
  fetchHtml?: YaleResearchOfficialFetchHtml;
}

export interface YaleResearchOfficialEntity {
  name: string;
  url: string;
  slug: string;
  kind: OfficialResearchEntityKind;
  entityType: ResearchEntityType;
  description: string;
  researchAreas: string[];
  sourceUrl: string;
  sourceUrls?: string[];
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function absoluteUrl(href: string, baseUrl: string): string | null {
  const raw = href.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw, baseUrl);
    if (!/^https?:$/i.test(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
}

function uniqueValues(values: string[]): string[] {
  return Array.from(new Set(values.map(normalizeText).filter(Boolean)));
}

export function inferCenterKind(name: string): {
  kind: OfficialResearchEntityKind;
  entityType: ResearchEntityType;
} {
  const lower = name.toLowerCase();
  if (/\binstitute\b/.test(lower)) return { kind: 'institute', entityType: 'INSTITUTE' };
  if (/\b(initiative|project)\b/.test(lower)) {
    return { kind: 'initiative', entityType: 'INITIATIVE' };
  }
  if (/\bprogram\b/.test(lower)) return { kind: 'program', entityType: 'PROGRAM' };
  if (/\b(group|forum|dialogue)\b/.test(lower)) return { kind: 'group', entityType: 'GROUP' };
  return { kind: 'center', entityType: 'CENTER' };
}

function entitySlug(prefix: string, name: string): string {
  return `${prefix}-${slugify(name)}`.slice(0, 100);
}

export function parseCenterDirectory(
  html: string,
  sourceUrl: string = CENTERS_LISTING_URL,
): YaleResearchOfficialEntity[] {
  const $ = cheerio.load(html);
  const entities: YaleResearchOfficialEntity[] = [];
  const seen = new Set<string>();

  $('ol.listing-items li.item').each((_i, el) => {
    const item = $(el);
    const link = item.find('h3 a').first();
    const name = normalizeText(link.text());
    const url = absoluteUrl(link.attr('href') || '', sourceUrl);
    if (!name || !url) return;
    const slug = entitySlug('yale-research-center', name);
    if (seen.has(slug)) return;
    seen.add(slug);
    const { kind, entityType } = inferCenterKind(name);
    const description = normalizeText(item.find('.item__summary').first().text());
    const researchAreas = uniqueValues(
      item.find('.item__type').toArray().map((node) => $(node).text()),
    );

    entities.push({
      name,
      url,
      slug,
      kind,
      entityType,
      description,
      researchAreas,
      sourceUrl,
    });
  });

  return entities;
}

export function parseCoreDirectory(
  html: string,
  sourceUrl: string = CORE_LISTING_URL,
): YaleResearchOfficialEntity[] {
  const $ = cheerio.load(html);
  const bySlug = new Map<string, YaleResearchOfficialEntity>();

  $('.cores-card.listing-item').each((_i, el) => {
    const card = $(el);
    const typeLabel = normalizeText(card.find('.card__type').first().text());
    const link = card.find('.card__content__inner h2 a').first();
    const itemName = normalizeText(link.text());
    const itemUrl = absoluteUrl(link.attr('href') || '', sourceUrl);
    if (!itemName || !itemUrl) return;

    const parentLink = card.find('.card__content__parent-facility a').first();
    const parentName = normalizeText(parentLink.text());
    const parentUrl = absoluteUrl(parentLink.attr('href') || '', sourceUrl);
    const isFacility = /core\/facility/i.test(typeLabel) || !parentName;

    const entityName = isFacility ? itemName : parentName;
    const entityUrl = isFacility ? itemUrl : parentUrl;
    if (!entityName || !entityUrl) return;

    const slug = entitySlug('yale-research-core', entityName);
    const existing = bySlug.get(slug);
    const description = isFacility
      ? normalizeText(card.find('.card__content__inner > p').first().text())
      : '';
    const sourceUrls = uniqueValues([
      ...(existing?.sourceUrls || []),
      sourceUrl,
      entityUrl,
      itemUrl,
    ]);
    const researchAreas = uniqueValues([
      ...(existing?.researchAreas || []),
      ...(isFacility ? [] : [itemName]),
    ]);

    bySlug.set(slug, {
      name: existing?.name || entityName,
      url: existing?.url || entityUrl,
      slug,
      kind: 'center',
      entityType: 'CORE_FACILITY',
      description: existing?.description || description,
      researchAreas,
      sourceUrl,
      sourceUrls,
    });
  });

  return Array.from(bySlug.values());
}

function isDurableResearchResource(name: string, types: string[]): boolean {
  const lower = name.toLowerCase();
  if (!/\b(center|institute|program|initiative)\b/.test(lower)) return false;
  return types.some((type) =>
    /faculty resources|research administration|funding|awards|grants|computing/i.test(type),
  );
}

export function parseResourceDirectory(
  html: string,
  sourceUrl: string = RESOURCES_LISTING_URL,
): YaleResearchOfficialEntity[] {
  const $ = cheerio.load(html);
  const entities: YaleResearchOfficialEntity[] = [];
  const seen = new Set<string>();

  $('ol.listing-items li.item').each((_i, el) => {
    const item = $(el);
    const link = item.find('h3 a').first();
    const name = normalizeText(link.text());
    const url = absoluteUrl(link.attr('href') || '', sourceUrl);
    const researchAreas = uniqueValues(
      item.find('.item__type').toArray().map((node) => $(node).text()),
    );
    if (!name || !url || !isDurableResearchResource(name, researchAreas)) return;
    const slug = entitySlug('yale-research-resource', name);
    if (seen.has(slug)) return;
    seen.add(slug);
    const { kind, entityType } = inferCenterKind(name);

    entities.push({
      name,
      url,
      slug,
      kind,
      entityType,
      description: normalizeText(item.find('.item__summary').first().text()),
      researchAreas,
      sourceUrl,
    });
  });

  return entities;
}

function entityToObservations(entity: YaleResearchOfficialEntity): ObservationInput[] {
  const sourceUrls = uniqueValues([...(entity.sourceUrls || []), entity.sourceUrl, entity.url]);
  const base = {
    entityType: 'researchEntity' as const,
    entityKey: entity.slug,
    sourceUrl: entity.sourceUrl,
  };
  const observations: ObservationInput[] = [
    { ...base, field: 'slug', value: entity.slug },
    { ...base, field: 'name', value: entity.name },
    { ...base, field: 'kind', value: entity.kind },
    { ...base, field: 'entityType', value: entity.entityType },
    { ...base, field: 'websiteUrl', value: entity.url },
    { ...base, field: 'sourceUrls', value: sourceUrls },
  ];
  if (entity.description) {
    observations.push({ ...base, field: 'fullDescription', value: entity.description });
    observations.push({ ...base, field: 'shortDescription', value: entity.description });
  }
  if (entity.researchAreas.length > 0) {
    observations.push({ ...base, field: 'researchAreas', value: entity.researchAreas });
  }
  return observations;
}

export function centerDirectoryEntitiesToObservations(
  entities: YaleResearchOfficialEntity[],
): ObservationInput[] {
  return entities.flatMap(entityToObservations);
}

export function coreDirectoryEntitiesToObservations(
  entities: YaleResearchOfficialEntity[],
): ObservationInput[] {
  return entities.flatMap(entityToObservations);
}

export function resourceDirectoryEntitiesToObservations(
  entities: YaleResearchOfficialEntity[],
): ObservationInput[] {
  return entities.flatMap(entityToObservations);
}

async function defaultFetchHtml(url: string, useCache: boolean): Promise<string> {
  const cacheKey = `page:${url}`;
  if (useCache) {
    const cached = await getCached<string>(SOURCE_NAME, cacheKey);
    if (cached) return cached;
  }
  const response = await axios.get(url, {
    timeout: FETCH_TIMEOUT_MS,
    headers: { 'User-Agent': USER_AGENT },
    maxRedirects: 5,
  });
  const html = response.data as string;
  if (useCache) await setCached(SOURCE_NAME, cacheKey, html);
  return html;
}

export class YaleResearchOfficialScraper implements IScraper {
  readonly name = SOURCE_NAME;
  readonly displayName = 'Yale Research official directory';
  private readonly fetchHtml: YaleResearchOfficialFetchHtml;

  constructor(deps: YaleResearchOfficialScraperDeps = {}) {
    this.fetchHtml = deps.fetchHtml || defaultFetchHtml;
  }

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    const pageSpecs = [
      {
        key: 'centers',
        url: CENTERS_LISTING_URL,
        parse: parseCenterDirectory,
        toObservations: centerDirectoryEntitiesToObservations,
      },
      {
        key: 'cores',
        url: CORE_LISTING_URL,
        parse: parseCoreDirectory,
        toObservations: coreDirectoryEntitiesToObservations,
      },
      {
        key: 'resources',
        url: RESOURCES_LISTING_URL,
        parse: parseResourceDirectory,
        toObservations: resourceDirectoryEntitiesToObservations,
      },
    ];
    const only =
      ctx.options.only && ctx.options.only.length > 0
        ? new Set(ctx.options.only.map((value) => value.trim().toLowerCase()).filter(Boolean))
        : null;
    const limit = ctx.options.limit && ctx.options.limit > 0 ? ctx.options.limit : Infinity;
    let totalObs = 0;
    let totalEntities = 0;
    const summaries: string[] = [];

    for (const page of pageSpecs) {
      if (only && !only.has(page.key)) continue;
      if (totalEntities >= limit) break;
      const remaining = limit - totalEntities;
      ctx.log(`Fetching ${page.url}`);
      const html = await this.fetchHtml(page.url, ctx.options.useCache);
      const entities = page.parse(html, page.url).slice(0, remaining);
      const observations = page.toObservations(entities);
      if (observations.length > 0) await ctx.emit(observations);
      totalObs += observations.length;
      totalEntities += entities.length;
      summaries.push(`${new URL(page.url).pathname}=${entities.length}`);
    }

    return {
      observationCount: totalObs,
      entitiesObserved: totalEntities,
      notes: `Official Yale Research discovery rows: ${summaries.join(', ')}`,
    };
  }
}
