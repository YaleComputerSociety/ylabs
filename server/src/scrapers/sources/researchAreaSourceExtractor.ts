import axios from 'axios';
import * as cheerio from 'cheerio';
import mongoose from 'mongoose';
import { assertPublicHttpUrl, ssrfSafeAgents } from '../../utils/ssrfGuard';
import { ResearchEntity } from '../../models/researchEntity';
import { serializedDocumentId } from '../../utils/idSerialization';
import { sanitizeLogValue } from '../../utils/logSanitizer';
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
import {
  getResearchAreaCanonicalizer,
  type ResearchAreaCanonicalizer,
} from '../researchAreaCanonicalization';
import { extractLabHomepageDescription } from './ysmAtoZScraper';

const SOURCE_KEY = 'research-area-source-extractor';
const MAX_SCAN_CHARS = 40_000;
const MAX_AREAS_PER_ENTITY = 12;
const MAX_CANDIDATE_SCAN = 1000;
const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

export interface CandidateAreaEntity {
  _id?: unknown;
  slug?: string;
  name: string;
  websiteUrl: string;
  sourceUrls: string[];
  manuallyLockedFields?: string[];
}

export interface CandidateAreaEntityDoc {
  _id?: unknown;
  slug?: string;
  name?: string;
  displayName?: string;
  websiteUrl?: string;
  website?: string;
  sourceUrls?: string[];
  researchAreas?: unknown;
  manuallyLockedFields?: string[];
}

export interface FetchedAreaPage {
  url: string;
  html: string;
}

export type FetchAreaPageFn = (url: string) => Promise<FetchedAreaPage | null>;

export type AreaWorkPlanLoaderFn = (
  entity: CandidateAreaEntity,
  policy: WorkPlannerSourcePolicy,
  ctx: ScraperContext,
) => Promise<EntityWorkPlan>;

export interface ResearchAreaSourceExtractorDeps {
  fetchPage?: FetchAreaPageFn;
  canonicalizerLoader?: () => Promise<ResearchAreaCanonicalizer>;
  entityFinder?: (options?: {
    only?: string[];
    exhaustive?: boolean;
  }) => Promise<CandidateAreaEntity[]>;
  workPlanLoader?: AreaWorkPlanLoaderFn;
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

function parseRuntimeIntegerOption(
  value: number | undefined,
  flag: string,
  options: { min: number; label: 'positive' | 'non-negative'; fallback: number },
): number {
  if (value === undefined) return options.fallback;
  if (!Number.isSafeInteger(value) || value < options.min) {
    throw new Error(`${flag} must be a safe ${options.label} integer`);
  }
  return value;
}

const rejectedAreaSourcePatterns = [
  /(?:^|\.)orcid\.org/i,
  /(?:^|\.)doi\.org/i,
  /(?:^|\.)openalex\.org/i,
  /(?:^|\.)crossref\.org/i,
  /(?:^|\.)scholar\.google\./i,
  /reporter\.nih\.gov/i,
  /nsf\.gov/i,
  /api\.nsf\.gov/i,
];

export function isRejectedAreaSourceUrl(value: unknown): boolean {
  const urlText = textValue(value);
  if (!/^https?:\/\//i.test(urlText)) return true;
  try {
    const url = new URL(urlText);
    const hostPath = `${url.hostname}${url.pathname}`.replace(/\/+$/, '');
    return rejectedAreaSourcePatterns.some((pattern) => pattern.test(hostPath));
  } catch {
    return true;
  }
}

function areaSourceUrlPriority(value: string): number {
  try {
    const url = new URL(value);
    const path = url.pathname.toLowerCase();
    if (/\/(?:research|labs?|center|centers|institute|institutes)\b/.test(path)) return 0;
    if (/\/profile\//.test(path)) return 1;
    if (/\/people\//.test(path)) return 2;
  } catch {
    return 9;
  }
  return 3;
}

const idValue = (value: unknown): string => {
  const directId = serializedDocumentId(value);
  if (directId) return directId;
  if (typeof value === 'object' && value !== null && '_id' in value) {
    return idValue((value as Record<string, unknown>)._id);
  }
  return '';
};

const candidateKeyMatches = (candidate: CandidateAreaEntity, keys: string[]): boolean => {
  if (keys.length === 0) return true;
  const normalized = new Set(keys.map((key) => key.toLowerCase()));
  return [idValue(candidate._id), candidate.slug, candidate.name].some((value) => {
    const text = textValue(value).toLowerCase();
    return text.length > 0 && normalized.has(text);
  });
};

function hasEmptyResearchAreas(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (Array.isArray(value)) return value.filter((item) => textValue(item).length > 0).length === 0;
  return false;
}

export function candidateAreaUrlsForDoc(doc: CandidateAreaEntityDoc): string[] {
  return uniqueStrings([doc.websiteUrl, doc.website, ...(doc.sourceUrls || [])])
    .filter((url) => !isRejectedAreaSourceUrl(url))
    .sort((a, b) => areaSourceUrlPriority(a) - areaSourceUrlPriority(b) || a.localeCompare(b));
}

export function candidateAreaEntitiesFromDocs(
  docs: CandidateAreaEntityDoc[],
  options: { only?: string[] } = {},
): CandidateAreaEntity[] {
  const keys = uniqueStrings(options.only || []);
  return docs.flatMap((doc) => {
    if (!hasEmptyResearchAreas(doc.researchAreas)) return [];
    const urls = candidateAreaUrlsForDoc(doc);
    if (urls.length === 0) return [];
    const candidate: CandidateAreaEntity = {
      _id: doc._id,
      slug: doc.slug,
      name: textValue(doc.displayName || doc.name || doc.slug || idValue(doc._id)),
      websiteUrl: urls[0],
      sourceUrls: urls,
      manuallyLockedFields: doc.manuallyLockedFields || [],
    };
    return candidateKeyMatches(candidate, keys) ? [candidate] : [];
  });
}

/**
 * Element-text labels that introduce an explicit research-area list on a lab,
 * department, or faculty-profile page. Kept tight so only deliberate topic
 * declarations are read as labeled sections; free prose is handled separately
 * through the approved-registry phrase scan.
 */
const RESEARCH_AREA_LABEL_BODY =
  '(?:(?:primary|current|main|key|core)\\s+)?(?:research|scholarly|scientific|clinical|academic)\\s+(?:areas?|interests?|focus|foci|topics?|themes?)' +
  '|areas?\\s+of\\s+(?:research|interest|focus|expertise|specialization|specialisation|study|concentration)' +
  '|fields?\\s+of\\s+(?:interest|study|research|expertise)' +
  '|(?:research\\s+)?specialti(?:es|y)' +
  '|(?:areas?\\s+of\\s+)?expertise' +
  '|specializations?';

const RESEARCH_AREA_LABEL_RE = new RegExp(`^(?:${RESEARCH_AREA_LABEL_BODY})$`, 'i');
const RESEARCH_AREA_LABEL_PREFIX_RE = new RegExp(
  `^(?:${RESEARCH_AREA_LABEL_BODY})\\s*[:：]\\s*(.+)$`,
  'i',
);

function labelKey(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .replace(/[:：\-–—\s]+$/g, '')
    .trim();
}

function splitAreaItems(value: string): string[] {
  return value
    .split(/[,;•·|\n\r•]+|\s{2,}| and (?=[A-Z])/g)
    .map((item) => item.replace(/\s+/g, ' ').trim())
    .filter((item) => item.length > 1 && item.length <= 80);
}

/**
 * Site-chrome removed before any text scan. Beyond semantic `nav`/`footer` tags,
 * several Yale CMS templates (e.g. medicine.yale.edu) render their global mega-menu
 * as a `div`-based panel that is CSS-hidden until toggled rather than wrapped in a
 * `<nav>` element, so its link text (unrelated to the page's subject) would otherwise
 * leak into the prose scan and produce false-positive approved-area matches.
 */
const CHROME_REMOVAL_SELECTOR =
  'script, style, noscript, svg, iframe, nav, footer, [aria-hidden="true"], [hidden], [class*="--hidden"], [class*="navigation-panel"]';

/**
 * Reads discrete research-area strings declared under an explicit label on the
 * page (heading + following list/paragraph, definition list, or inline
 * "Research Interests: a, b, c"). Returns raw candidate strings; canonicalization
 * against the approved registry happens downstream so a non-approved item is
 * never emitted as an area.
 */
export function extractLabeledResearchAreaItems(html: string): string[] {
  if (!html) return [];
  const $ = cheerio.load(html);
  $(CHROME_REMOVAL_SELECTOR).remove();
  const items: string[] = [];

  $('*').each((_, el) => {
    const node = $(el);
    const ownText = labelKey(node.clone().children().remove().end().text());
    if (!ownText) return;

    const inlineMatch = ownText.match(RESEARCH_AREA_LABEL_PREFIX_RE);
    if (inlineMatch) {
      items.push(...splitAreaItems(inlineMatch[1]));
      return;
    }
    if (!RESEARCH_AREA_LABEL_RE.test(ownText)) return;

    const tag = (el as { tagName?: string }).tagName?.toLowerCase() || '';
    if (tag === 'dt') {
      items.push(...splitAreaItems(node.next('dd').text()));
      return;
    }

    const list = node.nextAll('ul, ol').first();
    if (list.length) {
      list.find('li').each((__, li) => {
        items.push(...splitAreaItems($(li).text()));
      });
      return;
    }
    const paragraph = node.nextAll('p, div, span').first();
    if (paragraph.length) {
      items.push(...splitAreaItems(paragraph.text()));
      return;
    }

    const parentRaw = node.parent().text().replace(/\s+/g, ' ').trim();
    const inlineParent = parentRaw.match(new RegExp(`^${ownText}\\s*[:：]\\s*(.+)$`, 'i'));
    if (inlineParent) items.push(...splitAreaItems(inlineParent[1]));
  });

  return uniqueStrings(items).slice(0, 60);
}

function htmlToText(html: string): string {
  if (!html) return '';
  const $ = cheerio.load(html);
  $(CHROME_REMOVAL_SELECTOR).remove();
  return textValue($('body').text() || $.root().text()).slice(0, MAX_SCAN_CHARS);
}

function proseTextFromPage(html: string): string {
  const embedded = extractLabHomepageDescription(html, { kind: 'organization' });
  return textValue([embedded?.description || '', htmlToText(html)].join(' ')).slice(
    0,
    MAX_SCAN_CHARS,
  );
}

export interface ResearchAreaExtraction {
  areas: string[];
  labeledBacked: boolean;
}

/**
 * Merges approved canonical areas recovered two ways from one page: exact-index
 * matches over explicitly labeled items (which recovers approved single-word
 * areas the prose scan intentionally excludes) and the approved-registry phrase
 * scan over page prose. Every returned area is an approved `TaxonomyTerm` name -
 * fail-closed, so an unapproved or invented topic is never produced.
 */
export function deriveCanonicalResearchAreasFromPage(
  canonicalizer: ResearchAreaCanonicalizer,
  html: string,
): ResearchAreaExtraction {
  const labeledItems = extractLabeledResearchAreaItems(html);
  const fromLabels = canonicalizer.matchCanonicalResearchAreas(labeledItems);
  const fromProse = canonicalizer.deriveResearchAreasFromText(proseTextFromPage(html));
  const areas: string[] = [];
  const seen = new Set<string>();
  for (const area of [...fromLabels, ...fromProse]) {
    const key = area.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    areas.push(area);
  }
  return { areas: areas.slice(0, MAX_AREAS_PER_ENTITY), labeledBacked: fromLabels.length > 0 };
}

export function researchAreaObservationsFromExtraction(
  extraction: ResearchAreaExtraction,
  context: { entityId?: string; entityKey?: string; sourceUrl: string },
): ObservationInput[] {
  if (isRejectedAreaSourceUrl(context.sourceUrl)) return [];
  if (extraction.areas.length === 0) return [];
  return [
    {
      entityType: 'researchEntity',
      entityId: context.entityId,
      entityKey: context.entityKey,
      sourceUrl: context.sourceUrl,
      field: 'researchAreas',
      value: extraction.areas,
      confidenceOverride: extraction.labeledBacked ? 0.72 : 0.6,
    },
  ];
}

async function defaultFetchPage(url: string): Promise<FetchedAreaPage | null> {
  // SSRF guard: url is a DB-sourced research-entity website - block private/metadata
  // hosts and validate redirect hops at connect time.
  const safeUrl = await assertPublicHttpUrl(url);
  const safeUrlText = safeUrl.toString();
  const agents = ssrfSafeAgents();
  const res = await axios.get(safeUrlText, {
    timeout: 10_000,
    headers: { 'User-Agent': 'ylabs-scraper/1.0 (+https://yalelabs.io)' },
    maxRedirects: 5,
    httpAgent: agents.httpAgent,
    httpsAgent: agents.httpsAgent,
  });
  return { url: res.request?.res?.responseUrl || safeUrlText, html: String(res.data || '') };
}

async function defaultEntityFinder(
  options: { only?: string[]; exhaustive?: boolean } = {},
): Promise<CandidateAreaEntity[]> {
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
  const emptyAreasFilter = {
    $or: [{ researchAreas: { $exists: false } }, { researchAreas: { $size: 0 } }],
  };
  const urlFilter = {
    $or: [
      { websiteUrl: /^https?:\/\//i },
      { website: /^https?:\/\//i },
      { sourceUrls: /^https?:\/\//i },
    ],
  };
  const query = ResearchEntity.find(
    { $and: [{ archived: { $ne: true } }, emptyAreasFilter, urlFilter, identityFilter] },
    {
      _id: 1,
      slug: 1,
      name: 1,
      displayName: 1,
      websiteUrl: 1,
      website: 1,
      sourceUrls: 1,
      researchAreas: 1,
      manuallyLockedFields: 1,
    },
  ).sort({ _id: 1 });
  if (!only.length && !options.exhaustive) {
    query.limit(MAX_CANDIDATE_SCAN);
  }
  const docs = await query.lean();
  return candidateAreaEntitiesFromDocs(docs as CandidateAreaEntityDoc[], { only });
}

async function defaultWorkPlanLoader(
  entity: CandidateAreaEntity,
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

export class ResearchAreaSourceExtractor implements IScraper {
  readonly name = SOURCE_KEY;
  readonly displayName = 'Research-area source extractor (empty-area entities)';

  private readonly fetchPage: FetchAreaPageFn;
  private readonly canonicalizerLoader: () => Promise<ResearchAreaCanonicalizer>;
  private readonly entityFinder: (options?: {
    only?: string[];
    exhaustive?: boolean;
  }) => Promise<CandidateAreaEntity[]>;
  private readonly workPlanLoader: AreaWorkPlanLoaderFn;

  constructor(deps: ResearchAreaSourceExtractorDeps = {}) {
    this.fetchPage = deps.fetchPage || defaultFetchPage;
    this.canonicalizerLoader = deps.canonicalizerLoader || getResearchAreaCanonicalizer;
    this.entityFinder = deps.entityFinder || defaultEntityFinder;
    this.workPlanLoader = deps.workPlanLoader || defaultWorkPlanLoader;
  }

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    const only = uniqueStrings(ctx.options.only || []);
    const offset = parseRuntimeIntegerOption(ctx.options.offset, '--offset', {
      min: 0,
      label: 'non-negative',
      fallback: 0,
    });
    const limit =
      ctx.options.exhaustive && ctx.options.limit === undefined
        ? Number.POSITIVE_INFINITY
        : parseRuntimeIntegerOption(ctx.options.limit, '--limit', {
            min: 1,
            label: 'positive',
            fallback: 100,
          });

    const canonicalizer = await this.canonicalizerLoader();
    const candidates = (await this.entityFinder({ only, exhaustive: ctx.options.exhaustive }))
      .filter(
        (candidate) =>
          candidateKeyMatches(candidate, only) &&
          candidate.websiteUrl &&
          !isRejectedAreaSourceUrl(candidate.websiteUrl),
      )
      .slice(offset, offset + limit);

    let observationCount = 0;
    let entitiesObserved = 0;
    const workPlannerPolicy = ctx.options.ignoreWorkPlanner
      ? undefined
      : getWorkPlannerSourcePolicy(this.name);
    const workPlannerMetrics = createWorkPlannerMetrics();

    for (const entity of candidates) {
      try {
        if (workPlannerPolicy) {
          if (!idValue(entity._id) && !entity.slug) {
            recordWorkPlannerNoIdentifier(workPlannerMetrics);
            ctx.log('[candidate] skipped by WorkPlanner - missing entity identifier.');
            continue;
          }
          const plan = await this.workPlanLoader(entity, workPlannerPolicy, ctx);
          recordWorkPlannerDecision(workPlannerMetrics, plan);
          if (!plan.shouldFetch) {
            const reasons = Array.from(new Set(plan.fields.map((field) => field.reason))).join(',');
            ctx.log(
              `[${entity.slug || 'candidate'}] skipped by WorkPlanner - ${reasons || 'fresh'}.`,
            );
            continue;
          }
        }

        const urls = uniqueStrings([entity.websiteUrl, ...(entity.sourceUrls || [])]).filter(
          (url) => !isRejectedAreaSourceUrl(url),
        );
        let observations: ObservationInput[] = [];
        for (const sourceUrl of urls) {
          let page: FetchedAreaPage | null = null;
          try {
            page = await this.fetchPage(sourceUrl);
          } catch (error) {
            ctx.log(
              `[${entity.slug || 'candidate'}] area source failed: ${sanitizeLogValue(error)}`,
            );
            continue;
          }
          if (!page?.html) continue;
          const extraction = deriveCanonicalResearchAreasFromPage(canonicalizer, page.html);
          observations = researchAreaObservationsFromExtraction(extraction, {
            entityId: serializedDocumentId(entity._id),
            entityKey: entity.slug,
            sourceUrl: page.url,
          });
          if (observations.length) break;
        }

        if (!observations.length) continue;
        await ctx.emit(observations);
        observationCount += observations.length;
        entitiesObserved += 1;
      } catch (error) {
        ctx.log(
          `[${entity.slug || 'candidate'}] skipping area extraction: ${sanitizeLogValue(error)}`,
        );
      }
    }

    return {
      observationCount,
      entitiesObserved,
      notes: `Recovered approved research areas for ${entitiesObserved} empty-area research entities.`,
      metrics: { workPlanner: workPlannerMetrics },
    };
  }
}
