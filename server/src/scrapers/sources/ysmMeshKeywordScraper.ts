import axios from 'axios';
import * as cheerio from 'cheerio';
import mongoose from 'mongoose';
import { ResearchEntity } from '../../models/researchEntity';
import { RoleAssignment } from '../../models/roleAssignment';
import { serializedDocumentId } from '../../utils/idSerialization';
import { sanitizeLogValue } from '../../utils/logSanitizer';
import { assertPublicHttpUrl, ssrfSafeAgents } from '../../utils/ssrfGuard';
import { getCached, setCached } from '../snapshotCache';
import { slugify } from '../utils/scraperHelpers';
import type { IScraper, ObservationInput, ScraperContext, ScraperResult } from '../types';
import {
  createWorkPlannerMetrics,
  getWorkPlannerSourcePolicy,
  loadEntityWorkPlan,
  recordWorkPlannerDecision,
  recordWorkPlannerNoIdentifier,
  type EntityWorkPlan,
  type WorkPlannerSourcePolicy,
} from '../workPlanner';

const SOURCE_KEY = 'ysm-mesh-keyword';
const YSM_ORG_ID = '113592';
const YSM_HOST = 'medicine.yale.edu';
const KEYWORD_INDEX_URL = 'https://medicine.yale.edu/research/research-by-keyword/';
const RESULTS_PAGE_SSR_SIZE = 20;
const MAX_AREAS_PER_ENTITY = 24;
const MAX_CANDIDATE_SCAN = 1000;
const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;
const LEAD_ROLES = ['PI', 'CO_PI', 'DIRECTOR', 'CO_DIRECTOR'] as const;

export interface YsmMeshKeyword {
  meshId: string;
  term: string;
}

export interface YsmFacultyRef {
  name: string;
  profileSlug: string;
  profileUrl: string;
}

export interface YsmProfileResearch {
  profileUrl: string;
  fullName: string;
  meshTerms: string[];
}

export interface YsmMeshCandidateEntity {
  _id?: unknown;
  slug?: string;
  name: string;
  contactName?: string;
  profileUrls: string[];
  manuallyLockedFields?: string[];
}

export interface YsmMeshCandidateEntityDoc {
  _id?: unknown;
  slug?: string;
  name?: string;
  displayName?: string;
  contactName?: string;
  websiteUrl?: string;
  website?: string;
  sourceUrls?: string[];
  researchAreas?: unknown;
  manuallyLockedFields?: string[];
}

export interface FetchedYsmPage {
  url: string;
  html: string;
}

export type FetchYsmPageFn = (url: string) => Promise<FetchedYsmPage | null>;

export interface YsmFacultyDirectory {
  keywords: YsmMeshKeyword[];
  profileUrlByNameKey: Map<string, string>;
}

export type YsmDirectoryLoaderFn = (ctx: ScraperContext) => Promise<YsmFacultyDirectory>;

export type YsmEntityFinderFn = (options?: {
  only?: string[];
  exhaustive?: boolean;
}) => Promise<YsmMeshCandidateEntity[]>;

export type YsmLeadProfileUrlLoaderFn = (entity: YsmMeshCandidateEntity) => Promise<string[]>;

export type YsmWorkPlanLoaderFn = (
  entity: YsmMeshCandidateEntity,
  policy: WorkPlannerSourcePolicy,
  ctx: ScraperContext,
) => Promise<EntityWorkPlan>;

export interface YsmMeshKeywordScraperDeps {
  fetchPage?: FetchYsmPageFn;
  directoryLoader?: YsmDirectoryLoaderFn;
  entityFinder?: YsmEntityFinderFn;
  leadProfileUrlLoader?: YsmLeadProfileUrlLoaderFn;
  workPlanLoader?: YsmWorkPlanLoaderFn;
}

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const uniqueStrings = (values: unknown[]): string[] =>
  Array.from(
    new Set(
      values
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );

const idValue = (value: unknown): string => {
  const directId = serializedDocumentId(value);
  if (directId) return directId;
  if (typeof value === 'object' && value !== null && '_id' in value) {
    return idValue((value as Record<string, unknown>)._id);
  }
  return '';
};

function decodeEmbeddedJson(raw: string): unknown | null {
  const decoded = cheerio.load(`<textarea>${raw}</textarea>`)('textarea').text();
  try {
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

function parsePageData(html: string): Record<string, unknown> | null {
  if (!html) return null;
  const $ = cheerio.load(html);
  const targeted = $('script#page-data').first().html();
  if (targeted) {
    const parsed = decodeEmbeddedJson(targeted);
    if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
  }
  let found: Record<string, unknown> | null = null;
  $('script[type="application/json"]').each((_i, el) => {
    if (found) return;
    const raw = $(el).html() || '';
    if (!raw.includes('mainComponents')) return;
    const parsed = decodeEmbeddedJson(raw);
    if (parsed && typeof parsed === 'object') found = parsed as Record<string, unknown>;
  });
  return found;
}

function mainComponents(pageData: Record<string, unknown> | null): Record<string, unknown>[] {
  const components = pageData?.mainComponents;
  return Array.isArray(components) ? (components as Record<string, unknown>[]) : [];
}

export function isYsmProfileUrl(value: unknown): boolean {
  const urlText = textValue(value);
  if (!/^https?:\/\//i.test(urlText)) return false;
  try {
    const url = new URL(urlText);
    if (url.hostname.toLowerCase() !== YSM_HOST) return false;
    if (url.search) return false;
    return /^\/profile\/[^/]+\/?$/i.test(url.pathname);
  } catch {
    return false;
  }
}

export function isYsmListingOrFacetUrl(value: unknown): boolean {
  const urlText = textValue(value);
  if (!/^https?:\/\//i.test(urlText)) return false;
  try {
    const url = new URL(urlText);
    if (url.hostname.toLowerCase() !== YSM_HOST) return false;
    if (url.searchParams.has('meshId') || url.searchParams.has('orgId')) return true;
    const path = url.pathname.replace(/\/+$/, '').toLowerCase();
    return (
      path === '/research-profiles' ||
      path === '/research/research-by-keyword' ||
      path === '/research/researchbydept'
    );
  } catch {
    return false;
  }
}

export function normalizeYsmProfileUrl(href: string, base?: string): string {
  const trimmed = textValue(href);
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed, base || `https://${YSM_HOST}/`);
    const match = url.pathname.match(/\/profile\/([^/]+)\/?/i);
    if (!match?.[1]) return '';
    const host = url.hostname.toLowerCase() === YSM_HOST ? YSM_HOST : url.hostname.toLowerCase();
    if (host !== YSM_HOST) return '';
    return `https://${YSM_HOST}/profile/${match[1].toLowerCase()}/`;
  } catch {
    return '';
  }
}

function profileSlugFromUrl(url: string): string {
  const match = url.match(/\/profile\/([^/]+)\/?$/i);
  return match?.[1]?.toLowerCase() || '';
}

export function facultyNameMatchKey(value: unknown): string {
  const cleaned = textValue(value);
  const withoutSuffix = cleaned.replace(
    /\b(?:jr|sr|ii|iii|iv|md|phd|mbchb|mph|ms|msc|dphil)\b/gi,
    '',
  );
  return slugify(withoutSuffix);
}

export function parseYsmMeshKeywordIndex(html: string): YsmMeshKeyword[] {
  if (!html) return [];
  const $ = cheerio.load(html);
  const byMeshId = new Map<string, string>();
  $('a[href*="meshId="]').each((_i, el) => {
    const href = $(el).attr('href') || '';
    let url: URL;
    try {
      url = new URL(href, `https://${YSM_HOST}/`);
    } catch {
      return;
    }
    if (url.searchParams.get('orgId') !== YSM_ORG_ID) return;
    const meshId = url.searchParams.get('meshId') || '';
    if (!/^\d+$/.test(meshId)) return;
    const term = textValue($(el).text());
    if (!term) return;
    if (!byMeshId.has(meshId)) byMeshId.set(meshId, term);
  });
  return Array.from(byMeshId.entries()).map(([meshId, term]) => ({ meshId, term }));
}

export function parseYsmResultsPageFaculty(html: string): YsmFacultyRef[] {
  const pageData = parsePageData(html);
  const listing = mainComponents(pageData).find(
    (component) => component?.key === 'ResearchProfileListing',
  );
  const model = (listing?.model || {}) as Record<string, unknown>;
  const profiles = (model.profiles || {}) as Record<string, unknown>;
  const collection = Array.isArray(profiles.collection) ? profiles.collection : [];
  const byUrl = new Map<string, YsmFacultyRef>();
  for (const raw of collection) {
    const item = (raw || {}) as Record<string, unknown>;
    const name = textValue(item.name);
    const profileUrl = normalizeYsmProfileUrl(textValue(item.url));
    if (!name || !profileUrl) continue;
    byUrl.set(profileUrl, {
      name,
      profileUrl,
      profileSlug: profileSlugFromUrl(profileUrl),
    });
  }
  return Array.from(byUrl.values());
}

export function parseYsmProfileResearch(
  html: string,
  profileUrl: string,
): YsmProfileResearch | null {
  const pageData = parsePageData(html);
  const profileDetails = mainComponents(pageData).find(
    (component) => component?.key === 'ProfileDetails',
  );
  const model = (profileDetails?.model || {}) as Record<string, unknown>;
  const sections = Array.isArray(model.sections) ? model.sections : [];
  const research = sections
    .map((section) => (section || {}) as Record<string, unknown>)
    .find((section) => section.sectionType === 'research');
  if (!research) return null;
  const meshKeywords = Array.isArray(research.meshKeywords) ? research.meshKeywords : [];
  const meshTerms = uniqueStrings(
    meshKeywords.map((entry) => {
      const record = (entry || {}) as Record<string, unknown>;
      return textValue(record.name) || textValue(record.text);
    }),
  );
  if (meshTerms.length === 0) return null;
  const fullName = textValue(model.fullName) || textValue(research.fullName);
  return { profileUrl, fullName, meshTerms };
}

export function ysmMeshResearchAreaObservations(
  research: YsmProfileResearch,
  context: { entityId?: string; entityKey?: string },
): ObservationInput[] {
  if (!isYsmProfileUrl(research.profileUrl)) return [];
  if (isYsmListingOrFacetUrl(research.profileUrl)) return [];
  const areas = research.meshTerms.slice(0, MAX_AREAS_PER_ENTITY);
  if (areas.length === 0) return [];
  if (!context.entityId && !context.entityKey) return [];
  return [
    {
      entityType: 'researchEntity',
      entityId: context.entityId,
      entityKey: context.entityKey,
      sourceUrl: research.profileUrl,
      field: 'researchAreas',
      value: areas,
      confidenceOverride: 0.7,
    },
  ];
}

function hasEmptyResearchAreas(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (Array.isArray(value)) return value.filter((item) => textValue(item).length > 0).length === 0;
  return false;
}

export function candidateEntityFromDoc(doc: YsmMeshCandidateEntityDoc): YsmMeshCandidateEntity {
  const profileUrls = uniqueStrings([
    doc.websiteUrl,
    doc.website,
    ...(doc.sourceUrls || []),
  ]).filter(isYsmProfileUrl);
  return {
    _id: doc._id,
    slug: doc.slug,
    name: textValue(doc.displayName || doc.name || doc.slug || idValue(doc._id)),
    contactName: textValue(doc.contactName),
    profileUrls,
    manuallyLockedFields: doc.manuallyLockedFields || [],
  };
}

async function defaultFetchPage(url: string): Promise<FetchedYsmPage | null> {
  const safeUrl = await assertPublicHttpUrl(url);
  const safeUrlText = safeUrl.toString();
  const agents = ssrfSafeAgents();
  const res = await axios.get(safeUrlText, {
    timeout: 20_000,
    headers: { 'User-Agent': 'ylabs-scraper/1.0 (+https://yalelabs.io)' },
    maxRedirects: 5,
    httpAgent: agents.httpAgent,
    httpsAgent: agents.httpsAgent,
  });
  return { url: res.request?.res?.responseUrl || safeUrlText, html: String(res.data || '') };
}

async function fetchCachedPage(fetchPage: FetchYsmPageFn, url: string, useCache: boolean) {
  if (useCache) {
    const cached = await getCached<FetchedYsmPage>(SOURCE_KEY, `page:${url}`);
    if (cached) return cached;
  }
  const page = await fetchPage(url);
  if (useCache && page) await setCached(SOURCE_KEY, `page:${url}`, page);
  return page;
}

function resultsPageUrl(meshId: string): string {
  return `https://${YSM_HOST}/research-profiles/?orgId=${YSM_ORG_ID}&meshId=${meshId}`;
}

async function defaultDirectoryLoader(
  fetchPage: FetchYsmPageFn,
  ctx: ScraperContext,
): Promise<YsmFacultyDirectory> {
  const index = await fetchCachedPage(fetchPage, KEYWORD_INDEX_URL, ctx.options.useCache);
  const keywords = index ? parseYsmMeshKeywordIndex(index.html) : [];
  ctx.log(`[directory] parsed ${keywords.length} YSM MeSH keywords from the keyword index`);
  const profileUrlByNameKey = new Map<string, string>();
  const cappedTermCount =
    ctx.options.exhaustive || ctx.options.limit === undefined
      ? keywords.length
      : Math.min(keywords.length, ctx.options.limit);
  let cappedFacultyCount = 0;
  for (const keyword of keywords.slice(0, cappedTermCount)) {
    let page: FetchedYsmPage | null = null;
    try {
      page = await fetchCachedPage(fetchPage, resultsPageUrl(keyword.meshId), ctx.options.useCache);
    } catch (error) {
      ctx.log(
        `[directory] mesh ${keyword.meshId} results fetch failed: ${sanitizeLogValue(error)}`,
      );
      continue;
    }
    if (!page?.html) continue;
    const faculty = parseYsmResultsPageFaculty(page.html);
    if (faculty.length >= RESULTS_PAGE_SSR_SIZE) cappedFacultyCount += 1;
    for (const ref of faculty) {
      const key = facultyNameMatchKey(ref.name);
      if (!key) continue;
      const existing = profileUrlByNameKey.get(key);
      if (existing && existing !== ref.profileUrl) {
        profileUrlByNameKey.set(key, '');
        continue;
      }
      if (existing === undefined) profileUrlByNameKey.set(key, ref.profileUrl);
    }
  }
  ctx.log(
    `[directory] indexed ${profileUrlByNameKey.size} YSM faculty names; ` +
      `${cappedFacultyCount} keyword pages hit the ${RESULTS_PAGE_SSR_SIZE}-faculty SSR cap ` +
      `(faculty ranked past that on every term they hold are not name-indexed).`,
  );
  return { keywords, profileUrlByNameKey };
}

async function defaultEntityFinder(
  options: { only?: string[]; exhaustive?: boolean } = {},
): Promise<YsmMeshCandidateEntity[]> {
  const only = uniqueStrings(options.only || []);
  const onlyObjectIds = only
    .filter((value) => OBJECT_ID_RE.test(value))
    .map((value) => new mongoose.Types.ObjectId(value));
  const identityFilter = only.length
    ? {
        $or: [
          ...(onlyObjectIds.length ? [{ _id: { $in: onlyObjectIds } }] : []),
          { slug: { $in: only } },
          { name: { $in: only } },
          { displayName: { $in: only } },
        ],
      }
    : {};
  const ysmFilter = {
    $or: [
      { school: 'Yale School of Medicine' },
      { schools: 'Yale School of Medicine' },
      { slug: /^ysm-/i },
    ],
  };
  const emptyAreasFilter =
    !only.length && !options.exhaustive
      ? { $or: [{ researchAreas: { $exists: false } }, { researchAreas: { $size: 0 } }] }
      : {};
  const query = ResearchEntity.find(
    { $and: [{ archived: { $ne: true } }, ysmFilter, emptyAreasFilter, identityFilter] },
    {
      _id: 1,
      slug: 1,
      name: 1,
      displayName: 1,
      contactName: 1,
      websiteUrl: 1,
      website: 1,
      sourceUrls: 1,
      researchAreas: 1,
      manuallyLockedFields: 1,
    },
  ).sort({ _id: 1 });
  if (!only.length && !options.exhaustive) query.limit(MAX_CANDIDATE_SCAN);
  const docs = (await query.lean()) as YsmMeshCandidateEntityDoc[];
  const emptyAreaFirst = [
    ...docs.filter((doc) => hasEmptyResearchAreas(doc.researchAreas)),
    ...docs.filter((doc) => !hasEmptyResearchAreas(doc.researchAreas)),
  ];
  return emptyAreaFirst.map(candidateEntityFromDoc);
}

async function defaultLeadProfileUrlLoader(entity: YsmMeshCandidateEntity): Promise<string[]> {
  const entityId = idValue(entity._id);
  if (!entityId) return [];
  const assignments = await RoleAssignment.find(
    {
      'target.kind': 'RESEARCH_ENTITY',
      'target.id': new mongoose.Types.ObjectId(entityId),
      role: { $in: [...LEAD_ROLES] },
      archived: { $ne: true },
    },
    { 'rosterProvenance.profileUrl': 1 },
  ).lean<Array<{ rosterProvenance?: { profileUrl?: string } }>>();
  return uniqueStrings(
    assignments.map((assignment) => assignment.rosterProvenance?.profileUrl),
  ).filter(isYsmProfileUrl);
}

async function defaultWorkPlanLoader(
  entity: YsmMeshCandidateEntity,
  policy: WorkPlannerSourcePolicy,
  _ctx: ScraperContext,
): Promise<EntityWorkPlan> {
  return loadEntityWorkPlan({
    entityType: policy.entityType,
    entityId: idValue(entity._id) || undefined,
    entityKey: entity.slug,
    sourceName: policy.sourceName,
    targetFields: policy.targetFields,
    manuallyLockedFields: entity.manuallyLockedFields,
    freshnessWindowMs: policy.freshnessWindowMs,
    now: new Date(),
  });
}

export class YsmMeshKeywordScraper implements IScraper {
  readonly name = SOURCE_KEY;
  readonly displayName = 'YSM research-by-keyword (MeSH) research-area signal';

  private readonly fetchPage: FetchYsmPageFn;
  private readonly directoryLoader: YsmDirectoryLoaderFn;
  private readonly entityFinder: YsmEntityFinderFn;
  private readonly leadProfileUrlLoader: YsmLeadProfileUrlLoaderFn;
  private readonly workPlanLoader: YsmWorkPlanLoaderFn;

  constructor(deps: YsmMeshKeywordScraperDeps = {}) {
    this.fetchPage = deps.fetchPage || defaultFetchPage;
    this.directoryLoader =
      deps.directoryLoader || ((ctx) => defaultDirectoryLoader(this.fetchPage, ctx));
    this.entityFinder = deps.entityFinder || defaultEntityFinder;
    this.leadProfileUrlLoader = deps.leadProfileUrlLoader || defaultLeadProfileUrlLoader;
    this.workPlanLoader = deps.workPlanLoader || defaultWorkPlanLoader;
  }

  private async resolveProfileUrls(
    entity: YsmMeshCandidateEntity,
    loadDirectory: () => Promise<YsmFacultyDirectory>,
  ): Promise<string[]> {
    const direct = entity.profileUrls.filter(isYsmProfileUrl);
    if (direct.length) return direct;
    const leadUrls = (await this.leadProfileUrlLoader(entity)).filter(isYsmProfileUrl);
    if (leadUrls.length) return leadUrls;
    const nameKey = facultyNameMatchKey(entity.contactName || entity.name);
    if (!nameKey) return [];
    const directory = await loadDirectory();
    const matched = directory.profileUrlByNameKey.get(nameKey);
    return matched ? [matched] : [];
  }

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    const only = uniqueStrings(ctx.options.only || []);
    const candidates = await this.entityFinder({ only, exhaustive: ctx.options.exhaustive });

    let directory: YsmFacultyDirectory | null = null;
    let keywordsEnumerated = 0;
    const loadDirectory = async (): Promise<YsmFacultyDirectory> => {
      if (!directory) {
        directory = await this.directoryLoader(ctx);
        keywordsEnumerated = directory.keywords.length;
      }
      return directory;
    };

    let observationCount = 0;
    let entitiesObserved = 0;
    let profilesResolved = 0;
    const workPlannerPolicy = ctx.options.ignoreWorkPlanner
      ? undefined
      : getWorkPlannerSourcePolicy(this.name);
    const workPlannerMetrics = createWorkPlannerMetrics();

    for (const entity of candidates) {
      try {
        if (workPlannerPolicy) {
          if (!idValue(entity._id) && !entity.slug) {
            recordWorkPlannerNoIdentifier(workPlannerMetrics);
            continue;
          }
          const plan = await this.workPlanLoader(entity, workPlannerPolicy, ctx);
          recordWorkPlannerDecision(workPlannerMetrics, plan);
          if (!plan.shouldFetch) continue;
        }

        const profileUrls = await this.resolveProfileUrls(entity, loadDirectory);
        if (!profileUrls.length) continue;
        profilesResolved += 1;

        let observations: ObservationInput[] = [];
        for (const profileUrl of profileUrls) {
          let page: FetchedYsmPage | null = null;
          try {
            page = await fetchCachedPage(this.fetchPage, profileUrl, ctx.options.useCache);
          } catch (error) {
            ctx.log(
              `[${entity.slug || 'entity'}] profile fetch failed: ${sanitizeLogValue(error)}`,
            );
            continue;
          }
          if (!page?.html) continue;
          const research = parseYsmProfileResearch(page.html, profileUrl);
          if (!research) continue;
          observations = ysmMeshResearchAreaObservations(research, {
            entityId: serializedDocumentId(entity._id),
            entityKey: entity.slug,
          });
          if (observations.length) break;
        }

        if (!observations.length) continue;
        await ctx.emit(observations);
        observationCount += observations.length;
        entitiesObserved += 1;
      } catch (error) {
        ctx.log(
          `[${entity.slug || 'entity'}] skipping MeSH area extraction: ${sanitizeLogValue(error)}`,
        );
      }
    }

    return {
      observationCount,
      entitiesObserved,
      notes:
        `Attached governed MeSH research areas to ${entitiesObserved} YSM entities ` +
        `(${profilesResolved} resolved to an individual profile of ${candidates.length} scanned; ` +
        `${keywordsEnumerated} MeSH keywords enumerated).`,
      metrics: { workPlanner: workPlannerMetrics },
    };
  }
}
