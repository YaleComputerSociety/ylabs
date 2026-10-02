import axios from 'axios';
import * as cheerio from 'cheerio';
import mongoose from 'mongoose';
import { assertPublicHttpUrl, ssrfSafeAgents } from '../../utils/ssrfGuard';
import { isListingOrIndexUrl } from '../../utils/researchHomeWebsiteUrl';
import {
  evidenceUrlCiterCounts,
  normalizeEvidenceUrl,
  type EvidenceCitingRow,
} from '../utils/sharedEvidenceUrls';
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
  admissibleResearchAreas,
  getResearchAreaCanonicalizer,
  type ResearchAreaCanonicalizer,
} from '../researchAreaCanonicalization';
import {
  loadResearchAreaEvidenceBackedRowIds,
  researchAreasAreManuallyLocked,
} from '../researchAreaEvidence';
import { extractLabHomepageDescription } from './ysmAtoZScraper';
import { removeNonSelfDeclaringContent } from '../utils/nonSelfDeclaringPageContent';
import {
  DEFAULT_SOURCE_CONCURRENCY,
  mapWithConcurrency,
  resolveSourceConcurrency,
} from '../utils/mapWithConcurrency';

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
  departments?: string[];
  manuallyLockedFields?: string[];
  refusedSharedDirectoryUrls?: string[];
}

export interface CandidateAreaEntityDoc {
  _id?: unknown;
  slug?: string;
  name?: string;
  displayName?: string;
  websiteUrl?: string;
  website?: string;
  sourceUrls?: string[];
  departments?: string[];
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
  if (isListingOrIndexUrl(urlText)) return true;
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

const PEOPLE_DIRECTORY_SEGMENT = /^(?:faculty-directory|directory|people|faculty)$/i;

export const MIN_SHARED_AREA_DIRECTORY_CITERS = 3;

const slugTokens = (value: unknown): string[] =>
  textValue(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

/**
 * A people directory filtered to one area, such as `/faculty-directory/finance`, lists many
 * people, so its page-level topics would be grafted onto every row that cites it (#4030, the
 * #1663 shape). It has the same path shape as a person's own `/faculty-directory/<name>`
 * profile, so the shape alone cannot refuse it: it is refused only when three or more rows
 * cite it and its leaf does not name the row being read.
 */
export function isSharedAreaFilteredDirectoryUrl(
  url: string,
  doc: Pick<CandidateAreaEntityDoc, 'slug' | 'name' | 'displayName'>,
  citerCounts: ReadonlyMap<string, number>,
): boolean {
  if ((citerCounts.get(normalizeEvidenceUrl(url)) || 0) < MIN_SHARED_AREA_DIRECTORY_CITERS) {
    return false;
  }
  let segments: string[];
  try {
    segments = new URL(url).pathname.split('/').filter(Boolean);
  } catch {
    return false;
  }
  const leaf = segments[segments.length - 1] || '';
  if (segments.length < 2 || /\.[a-z0-9]{2,5}$/i.test(leaf)) return false;
  if (!PEOPLE_DIRECTORY_SEGMENT.test(segments[segments.length - 2])) return false;
  const ownTokens = new Set([doc.slug, doc.name, doc.displayName].flatMap(slugTokens));
  const leafTokens = slugTokens(leaf);
  return !leafTokens.every((token) => ownTokens.has(token));
}

export function candidateAreaUrlsForDoc(
  doc: CandidateAreaEntityDoc,
  citerCounts?: ReadonlyMap<string, number>,
): string[] {
  return uniqueStrings([doc.websiteUrl, doc.website, ...(doc.sourceUrls || [])])
    .filter((url) => !isRejectedAreaSourceUrl(url))
    .filter((url) => !citerCounts || !isSharedAreaFilteredDirectoryUrl(url, doc, citerCounts))
    .sort((a, b) => areaSourceUrlPriority(a) - areaSourceUrlPriority(b) || a.localeCompare(b));
}

function refusedSharedDirectoryUrlsForDoc(
  doc: CandidateAreaEntityDoc,
  citerCounts: ReadonlyMap<string, number> | undefined,
): string[] {
  if (!citerCounts) return [];
  return uniqueStrings([doc.websiteUrl, doc.website, ...(doc.sourceUrls || [])]).filter(
    (url) =>
      !isRejectedAreaSourceUrl(url) && isSharedAreaFilteredDirectoryUrl(url, doc, citerCounts),
  );
}

export interface CandidateAreaSelectionOptions {
  only?: string[];
  evidenceBackedRowIds?: ReadonlySet<string>;
  citerCounts?: ReadonlyMap<string, number>;
}

function hasResearchAreasToRead(
  doc: CandidateAreaEntityDoc,
  evidenceBackedRowIds: ReadonlySet<string> | undefined,
): boolean {
  if (hasEmptyResearchAreas(doc.researchAreas)) return true;
  if (!evidenceBackedRowIds || researchAreasAreManuallyLocked(doc)) return false;
  const rowId = idValue(doc._id);
  return rowId.length > 0 && !evidenceBackedRowIds.has(rowId);
}

export function candidateAreaEntitiesFromDocs(
  docs: CandidateAreaEntityDoc[],
  options: CandidateAreaSelectionOptions = {},
): CandidateAreaEntity[] {
  const keys = uniqueStrings(options.only || []);
  return docs.flatMap((doc) => {
    if (!hasResearchAreasToRead(doc, options.evidenceBackedRowIds)) return [];
    const urls = candidateAreaUrlsForDoc(doc, options.citerCounts);
    const refusedSharedDirectoryUrls = refusedSharedDirectoryUrlsForDoc(doc, options.citerCounts);
    if (urls.length === 0 && refusedSharedDirectoryUrls.length === 0) return [];
    const candidate: CandidateAreaEntity = {
      _id: doc._id,
      slug: doc.slug,
      name: textValue(doc.displayName || doc.name || doc.slug || idValue(doc._id)),
      websiteUrl: urls[0] || '',
      sourceUrls: urls,
      departments: doc.departments || [],
      manuallyLockedFields: doc.manuallyLockedFields || [],
      refusedSharedDirectoryUrls,
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
 * Listing items that summarize a DIFFERENT subject than the page is about: a
 * dated news or event teaser, one result row of a faculty directory or site
 * search, another core facility's card, a publication teaser, a contact-list
 * entry. Each is a link to somewhere else with its own title and blurb, so its
 * topics belong to that other page and are not this page's declaration about
 * itself (#2734).
 *
 * Removing them is the same rule as the mega-menu removal above, applied to
 * syndicated body content rather than to site chrome, and it is the prose scan
 * that needs it: a labeled section is a deliberate declaration, while the prose
 * scan is a bare whole-page phrase match, so one mention anywhere on the page
 * mints an area. Measured against the 235 Development rows this lane had
 * supplied prose-derived areas for, it withdraws 190 areas across 54 rows,
 * including 22 harvested onto one person from every other professor's card on a
 * shared faculty directory, and it withdraws no labeled-section area at all.
 */
const OTHER_SUBJECT_LISTING_ITEM_SELECTOR =
  '[class*="teaser"], [class*="views-row"], [class*="view__row"], [class*="listing-item"]';

const NON_SUBJECT_CONTENT_SELECTOR = `${CHROME_REMOVAL_SELECTOR}, ${OTHER_SUBJECT_LISTING_ITEM_SELECTOR}`;

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
  $(NON_SUBJECT_CONTENT_SELECTOR).remove();
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
  $(NON_SUBJECT_CONTENT_SELECTOR).remove();
  removeNonSelfDeclaringContent($);
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
 * fail-closed, so an unapproved or invented topic is never produced. Areas the row
 * itself rejects (its own department, a division-level label) are removed with the
 * materializer's own rule, so a page that names only those asserts nothing (#3836).
 */
export function deriveCanonicalResearchAreasFromPage(
  canonicalizer: ResearchAreaCanonicalizer,
  html: string,
  departments: unknown = [],
): ResearchAreaExtraction {
  const admitted = (areas: string[]) => admissibleResearchAreas(canonicalizer, areas, departments);
  const labeledItems = extractLabeledResearchAreaItems(html);
  const fromLabels = admitted(canonicalizer.matchCanonicalResearchAreas(labeledItems));
  const fromProse = admitted(canonicalizer.deriveResearchAreasFromText(proseTextFromPage(html)));
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

// Only a scoped run reaches a row whose stored areas no live evidence backs: an unscoped
// sweep would otherwise fan out to a live fetch for every such row on every run (#3836).
export async function findResearchAreaCandidateEntities(
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
  const emptyAreasFilter = only.length
    ? {}
    : { $or: [{ researchAreas: { $exists: false } }, { researchAreas: { $size: 0 } }] };
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
      departments: 1,
      researchAreas: 1,
      manuallyLockedFields: 1,
    },
  ).sort({ _id: 1 });
  if (!only.length && !options.exhaustive) {
    query.limit(MAX_CANDIDATE_SCAN);
  }
  const docs = (await query.lean()) as CandidateAreaEntityDoc[];
  const evidenceBackedRowIds = only.length
    ? await loadResearchAreaEvidenceBackedRowIds(
        docs.filter((doc) => !hasEmptyResearchAreas(doc.researchAreas)),
      )
    : undefined;
  const citerCounts = await loadEvidenceUrlCiterCounts();
  return candidateAreaEntitiesFromDocs(docs, { only, evidenceBackedRowIds, citerCounts });
}

export async function loadEvidenceUrlCiterCounts(): Promise<Map<string, number>> {
  const rows = (await ResearchEntity.find(
    { archived: { $ne: true } },
    { _id: 0, websiteUrl: 1, website: 1, sourceUrls: 1 },
  ).lean()) as EvidenceCitingRow[];
  return evidenceUrlCiterCounts(rows);
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
    this.entityFinder = deps.entityFinder || findResearchAreaCandidateEntities;
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
    const found = (await this.entityFinder({ only, exhaustive: ctx.options.exhaustive })).filter(
      (candidate) => candidateKeyMatches(candidate, only),
    );
    const refusedSharedDirectoryUrls = new Set(
      found.flatMap((candidate) => candidate.refusedSharedDirectoryUrls || []),
    );
    const candidates = found
      .filter((candidate) => candidate.websiteUrl && !isRejectedAreaSourceUrl(candidate.websiteUrl))
      .slice(offset, offset + limit);

    let observationCount = 0;
    let entitiesObserved = 0;
    const workPlannerPolicy = ctx.options.ignoreWorkPlanner
      ? undefined
      : getWorkPlannerSourcePolicy(this.name);
    const workPlannerMetrics = createWorkPlannerMetrics();
    const concurrency = resolveSourceConcurrency(
      ctx.options.sourceConcurrency,
      DEFAULT_SOURCE_CONCURRENCY,
    );

    await mapWithConcurrency(candidates, concurrency, async (entity) => {
      try {
        if (workPlannerPolicy) {
          if (!idValue(entity._id) && !entity.slug) {
            recordWorkPlannerNoIdentifier(workPlannerMetrics);
            ctx.log('[candidate] skipped by WorkPlanner - missing entity identifier.');
            return;
          }
          const plan = await this.workPlanLoader(entity, workPlannerPolicy, ctx);
          recordWorkPlannerDecision(workPlannerMetrics, plan);
          if (!plan.shouldFetch) {
            const reasons = Array.from(new Set(plan.fields.map((field) => field.reason))).join(',');
            ctx.log(
              `[${entity.slug || 'candidate'}] skipped by WorkPlanner - ${reasons || 'fresh'}.`,
            );
            return;
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
          const extraction = deriveCanonicalResearchAreasFromPage(
            canonicalizer,
            page.html,
            entity.departments,
          );
          observations = researchAreaObservationsFromExtraction(extraction, {
            entityId: serializedDocumentId(entity._id),
            entityKey: entity.slug,
            sourceUrl: page.url,
          });
          if (observations.length) break;
        }

        if (!observations.length) return;
        await ctx.emit(observations);
        observationCount += observations.length;
        entitiesObserved += 1;
      } catch (error) {
        ctx.log(
          `[${entity.slug || 'candidate'}] skipping area extraction: ${sanitizeLogValue(error)}`,
        );
      }
    });

    return {
      observationCount,
      entitiesObserved,
      notes: `Recovered approved research areas for ${entitiesObserved} empty-area research entities. Refused ${refusedSharedDirectoryUrls.size} shared area-filtered directory page(s) as a topic source.`,
      metrics: { workPlanner: workPlannerMetrics },
    };
  }
}
