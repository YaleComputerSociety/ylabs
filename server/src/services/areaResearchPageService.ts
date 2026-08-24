/**
 * Canonical per-research-area and per-research-field page aggregation
 * (issue #1696).
 *
 * Composes already-materialized, already-gated ResearchEntity records for one
 * research area (or one top-level `ResearchField` rollup) into a single view:
 * the area's heterogeneous footprint grouped by the shared research-type
 * buckets, plus the documented ways in that the access-evidence model already
 * supports. It mints no new signal and changes no gating; it only reshapes what
 * browse already serves.
 *
 * Area matching is an exact string match against the canonical `ResearchArea`
 * name, gated by the identical servable predicate the `/research` area facet
 * uses (`publicStudentVisibilityTiers` + `researchEntityServesPublicDetail`), so
 * an area page's total reconciles with that area's facet-distribution count
 * rather than diverging. The read is a direct, index-backed Mongo query, not a
 * Meili query: a canonical page wants deterministic completeness over one known
 * area and must not depend on the search index being synced.
 */
import { ResearchArea, ResearchField, fieldColorKeys } from '../models/researchArea';
import { ResearchEntity } from '../models/researchEntity';
import { publicStudentVisibilityTiers } from '../models/studentVisibility';
import { researchEntityServesPublicDetail } from './researchEntityPublicDescription';
import {
  listAccessSummariesForResearchEntities,
  type AccessSummary,
} from './accessSummaryService';
import {
  publicResearchEntityId,
  toPublicResearchEntityDto,
  type PublicResearchEntityDto,
} from './researchEntityDto';
import { disambiguateCollidingResearchEntityNames } from '../utils/researchEntityDisplayNameDisambiguation';
import {
  RESEARCH_TYPE_BUCKETS,
  OTHER_RESEARCH_TYPE_BUCKET_KEY,
  researchTypeBucketKeyForEntityType,
} from '../utils/researchTypeBuckets';
import { normalizeResearchTaxonomySlug, toResearchTaxonomySlug } from '../utils/researchAreaSlug';

const MAX_ENTITIES_PER_BUCKET = 60;
const MAX_WAY_IN_ENTITIES = 60;
const ACCESS_SUMMARY_BATCH_SIZE = 100;

const DOCUMENTED_WAY_IN_ACCESS_STATUSES = new Set<AccessSummary['status']>([
  'posted-opening',
  'evidence-backed',
]);

export interface AreaResearchPageScope {
  kind: 'area' | 'field';
  slug: string;
  name: string;
  colorKey: string;
  field?: string;
}

export interface AreaResearchEntityBucket {
  key: string;
  label: string;
  researchEntities: PublicResearchEntityDto[];
  totalCount: number;
}

export interface AreaResearchWayIn {
  researchEntities: PublicResearchEntityDto[];
  totalCount: number;
}

export interface AreaResearchPage {
  scope: AreaResearchPageScope;
  buckets: AreaResearchEntityBucket[];
  totalCount: number;
  waysIn: AreaResearchWayIn;
}

interface ResolvedAreaScope {
  scope: AreaResearchPageScope;
  areaNames: string[];
}

const OTHER_BUCKET_LABEL = 'Other research homes';

const bucketLabelByKey = new Map<string, string>(
  RESEARCH_TYPE_BUCKETS.map((bucket) => [bucket.key, bucket.label]),
);
bucketLabelByKey.set(OTHER_RESEARCH_TYPE_BUCKET_KEY, OTHER_BUCKET_LABEL);

const BUCKET_ORDER = [
  ...RESEARCH_TYPE_BUCKETS.map((bucket) => bucket.key),
  OTHER_RESEARCH_TYPE_BUCKET_KEY,
];

async function resolveAreaScope(rawSlug: unknown): Promise<ResolvedAreaScope | null> {
  const normalized = normalizeResearchTaxonomySlug(rawSlug);
  if (!normalized) return null;

  const areas = (await ResearchArea.find()
    .select('name field colorKey')
    .lean()) as Array<{ name?: unknown; field?: unknown; colorKey?: unknown }>;

  const match = areas.find(
    (area) => typeof area.name === 'string' && toResearchTaxonomySlug(area.name) === normalized,
  );
  if (!match || typeof match.name !== 'string') return null;

  const field = typeof match.field === 'string' ? match.field : undefined;
  const colorKey =
    (typeof match.colorKey === 'string' && match.colorKey.trim()) ||
    (field ? fieldColorKeys[field as ResearchField] : undefined) ||
    'gray';

  return {
    scope: {
      kind: 'area',
      slug: normalized,
      name: match.name.trim(),
      colorKey,
      ...(field ? { field } : {}),
    },
    areaNames: [match.name.trim()],
  };
}

async function resolveFieldScope(rawSlug: unknown): Promise<ResolvedAreaScope | null> {
  const normalized = normalizeResearchTaxonomySlug(rawSlug);
  if (!normalized) return null;

  const fieldName = Object.values(ResearchField).find(
    (field) => toResearchTaxonomySlug(field) === normalized,
  );
  if (!fieldName) return null;

  const areas = (await ResearchArea.find({ field: fieldName })
    .select('name')
    .lean()) as Array<{ name?: unknown }>;

  const areaNames = Array.from(
    new Set(
      areas
        .map((area) => (typeof area.name === 'string' ? area.name.trim() : ''))
        .filter((name): name is string => Boolean(name)),
    ),
  );

  return {
    scope: {
      kind: 'field',
      slug: normalized,
      name: fieldName,
      colorKey: fieldColorKeys[fieldName],
      field: fieldName,
    },
    areaNames,
  };
}

interface EntityLike extends Record<string, unknown> {
  entityType?: unknown;
}

function documentedWayInEntities(
  dtos: PublicResearchEntityDto[],
  accessSummaries: Map<string, AccessSummary>,
): PublicResearchEntityDto[] {
  return dtos.filter((dto) => {
    const summary = accessSummaries.get(String(dto.id));
    return Boolean(summary && DOCUMENTED_WAY_IN_ACCESS_STATUSES.has(summary.status));
  });
}

/**
 * Pure aggregation over already-fetched, already-servable entity docs. Kept
 * separate from the Mongo read so bucket grouping, the ways-in cross-cut, and
 * the empty-state shape are unit-testable without a database.
 */
export function buildAreaResearchPage(
  scope: AreaResearchPageScope,
  docs: EntityLike[],
  accessSummaries: Map<string, AccessSummary>,
): AreaResearchPage {
  const dtos = disambiguateCollidingResearchEntityNames(
    docs.map((doc) => toPublicResearchEntityDto(doc, { forList: true })),
  );

  const byBucket = new Map<string, PublicResearchEntityDto[]>();
  for (const dto of dtos) {
    const key = researchTypeBucketKeyForEntityType(
      typeof dto.entityType === 'string' ? dto.entityType : undefined,
    );
    const existing = byBucket.get(key);
    if (existing) existing.push(dto);
    else byBucket.set(key, [dto]);
  }

  const buckets: AreaResearchEntityBucket[] = [];
  for (const key of BUCKET_ORDER) {
    const entities = byBucket.get(key);
    if (!entities || entities.length === 0) continue;
    entities.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    buckets.push({
      key,
      label: bucketLabelByKey.get(key) ?? OTHER_BUCKET_LABEL,
      researchEntities: entities.slice(0, MAX_ENTITIES_PER_BUCKET),
      totalCount: entities.length,
    });
  }

  const wayInDtos = documentedWayInEntities(dtos, accessSummaries).map((dto) => ({
    ...dto,
    accessSummary: accessSummaries.get(String(dto.id)),
  }));

  return {
    scope,
    buckets,
    totalCount: dtos.length,
    waysIn: {
      researchEntities: wayInDtos.slice(0, MAX_WAY_IN_ENTITIES),
      totalCount: wayInDtos.length,
    },
  };
}

async function aggregateResearchPage(
  resolved: ResolvedAreaScope | null,
): Promise<AreaResearchPage | null> {
  if (!resolved) return null;
  if (resolved.areaNames.length === 0) {
    return buildAreaResearchPage(resolved.scope, [], new Map());
  }

  // No fetch cap here: the area facet distribution this page must reconcile with
  // counts over every matching servable entity, so the page has to see the same
  // full set. One area is a small slice of the corpus, so the read stays bounded
  // in practice.
  const docs = (await ResearchEntity.find({
    archived: { $ne: true },
    studentVisibilityTier: { $in: publicStudentVisibilityTiers },
    researchAreas: { $in: resolved.areaNames },
  }).lean()) as Record<string, any>[];

  const servableDocs = docs.filter(researchEntityServesPublicDetail);

  const summariesByDtoId = new Map<string, AccessSummary>();
  for (let start = 0; start < servableDocs.length; start += ACCESS_SUMMARY_BATCH_SIZE) {
    const batch = servableDocs.slice(start, start + ACCESS_SUMMARY_BATCH_SIZE);
    const summariesByEntityId = await listAccessSummariesForResearchEntities(
      batch.map((doc) => doc._id),
    );
    for (const doc of batch) {
      const summary = summariesByEntityId.get(String(doc._id));
      if (summary) summariesByDtoId.set(publicResearchEntityId(doc), summary);
    }
  }

  return buildAreaResearchPage(resolved.scope, servableDocs as EntityLike[], summariesByDtoId);
}

/**
 * Resolve a research-area slug and aggregate its servable footprint. Returns
 * null only when the slug does not resolve to a canonical research area; a
 * resolved area with no servable coverage returns an honest empty page.
 */
export async function getAreaResearchPage(rawSlug: unknown): Promise<AreaResearchPage | null> {
  return aggregateResearchPage(await resolveAreaScope(rawSlug));
}

/**
 * Resolve a research-field slug and aggregate the footprint across every
 * canonical area in that field. Returns null only when the slug does not
 * resolve to a top-level `ResearchField`.
 */
export async function getFieldResearchPage(rawSlug: unknown): Promise<AreaResearchPage | null> {
  return aggregateResearchPage(await resolveFieldScope(rawSlug));
}
