import mongoose from 'mongoose';
import { createHash } from 'crypto';
import {
  ADMIN_ACCESS_REVIEW_PROJECTION_SCHEMA_VERSION,
  ADMIN_ACCESS_REVIEW_PROJECTION_STATE_ID,
  AdminAccessReviewProjection,
  AdminAccessReviewProjectionState,
} from '../models/adminAccessReviewProjection';
import { AccessSignal } from '../models/accessSignal';
import { ContactRoute } from '../models/contactRoute';
import { EntryPathway } from '../models/entryPathway';
import { PostedOpportunity } from '../models/postedOpportunity';
import { ResearchEntity } from '../models/researchEntity';

export interface AdminAccessReviewProjectionCounts {
  entryPathways: number;
  accessSignals: number;
  contactRoutes: number;
  postedOpportunities: number;
}

export interface AdminAccessReviewProjectionValue {
  researchEntityId: mongoose.Types.ObjectId;
  searchPrefixes: string[];
  counts: AdminAccessReviewProjectionCounts;
  unreviewedCounts: AdminAccessReviewProjectionCounts;
  totalUnreviewed: number;
  hasOfficialApplication: boolean;
  sortUpdatedAt: Date;
  computedAt: Date;
  schemaVersion: number;
}

interface ProjectionModelDeps {
  researchEntityModel?: typeof ResearchEntity;
  entryPathwayModel?: typeof EntryPathway;
  accessSignalModel?: typeof AccessSignal;
  contactRouteModel?: typeof ContactRoute;
  postedOpportunityModel?: typeof PostedOpportunity;
  projectionModel?: typeof AdminAccessReviewProjection;
}

interface ProjectionInvalidationDeps {
  projectionModel?: typeof AdminAccessReviewProjection;
  session?: mongoose.ClientSession;
}

export interface AdminAccessReviewProjectionRebuildSummary {
  mode: 'dry-run' | 'apply';
  scanned: number;
  missing: number;
  changed: number;
  unchanged: number;
  orphaned: number;
  writesPlanned: number;
  writesApplied: number;
  planFingerprint: string;
}

export class AdminAccessReviewProjectionUnavailableError extends Error {
  constructor() {
    super('Admin access-review projection is unavailable or stale');
    this.name = 'AdminAccessReviewProjectionUnavailableError';
  }
}

const EMPTY_COUNTS = Object.freeze({
  entryPathways: 0,
  accessSignals: 0,
  contactRoutes: 0,
  postedOpportunities: 0,
});

const MAX_SEARCH_PREFIXES = 500;
const MAX_SEARCH_PREFIX_LENGTH = 60;

function normalizedSearchPrefixes(entity: Record<string, unknown>): string[] {
  const words = [
    entity.name,
    entity.displayName,
    entity.slug,
    ...(Array.isArray(entity.departments) ? entity.departments : []),
    ...(Array.isArray(entity.researchAreas) ? entity.researchAreas : []),
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ')
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const suffixes = new Set<string>();
  for (const word of words) {
    const boundedWord = word.slice(0, MAX_SEARCH_PREFIX_LENGTH);
    for (let offset = 0; offset < boundedWord.length; offset += 1) {
      suffixes.add(boundedWord.slice(offset));
      if (suffixes.size >= MAX_SEARCH_PREFIXES) return Array.from(suffixes).sort();
    }
  }
  return Array.from(suffixes).sort();
}

function reviewAggregatePipeline(
  researchEntityId: mongoose.Types.ObjectId,
  extraMatch: Record<string, unknown> = {},
  includeOfficialApplication = false,
): mongoose.PipelineStage[] {
  return [
    { $match: { researchEntityId, ...extraMatch } },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        unreviewed: {
          $sum: {
            $cond: [
              { $in: [{ $ifNull: ['$review.status', 'unreviewed'] }, ['unreviewed', null]] },
              1,
              0,
            ],
          },
        },
        ...(includeOfficialApplication
          ? {
              officialApplications: {
                $sum: {
                  $cond: [{ $gt: [{ $strLenCP: { $ifNull: ['$applicationUrl', ''] } }, 0] }, 1, 0],
                },
              },
            }
          : {}),
      },
    },
  ];
}

async function aggregateReviewCounts(
  model: typeof EntryPathway | typeof AccessSignal | typeof ContactRoute | typeof PostedOpportunity,
  researchEntityId: mongoose.Types.ObjectId,
  extraMatch: Record<string, unknown> = {},
  includeOfficialApplication = false,
): Promise<{ count: number; unreviewed: number; officialApplications: number }> {
  const rows = await model
    .aggregate(reviewAggregatePipeline(researchEntityId, extraMatch, includeOfficialApplication))
    .exec();
  return {
    count: Number(rows[0]?.count || 0),
    unreviewed: Number(rows[0]?.unreviewed || 0),
    officialApplications: Number(rows[0]?.officialApplications || 0),
  };
}

function projectionValueFromParts(
  researchEntityId: mongoose.Types.ObjectId,
  entity: Record<string, unknown>,
  rows: {
    pathways: { count: number; unreviewed: number };
    signals: { count: number; unreviewed: number };
    routes: { count: number; unreviewed: number };
    opportunities: { count: number; unreviewed: number; officialApplications: number };
  },
): AdminAccessReviewProjectionValue {
  const counts = {
    entryPathways: rows.pathways.count,
    accessSignals: rows.signals.count,
    contactRoutes: rows.routes.count,
    postedOpportunities: rows.opportunities.count,
  };
  const unreviewedCounts = {
    entryPathways: rows.pathways.unreviewed,
    accessSignals: rows.signals.unreviewed,
    contactRoutes: rows.routes.unreviewed,
    postedOpportunities: rows.opportunities.unreviewed,
  };
  const updatedAt = entity.updatedAt;
  return {
    researchEntityId,
    searchPrefixes: normalizedSearchPrefixes(entity),
    counts,
    unreviewedCounts,
    totalUnreviewed: Object.values(unreviewedCounts).reduce((sum, count) => sum + count, 0),
    hasOfficialApplication: rows.opportunities.officialApplications > 0,
    sortUpdatedAt:
      updatedAt instanceof Date && !Number.isNaN(updatedAt.getTime()) ? updatedAt : new Date(0),
    computedAt: new Date(),
    schemaVersion: ADMIN_ACCESS_REVIEW_PROJECTION_SCHEMA_VERSION,
  };
}

export async function buildAdminAccessReviewProjection(
  researchEntityId: mongoose.Types.ObjectId,
  deps: ProjectionModelDeps = {},
): Promise<AdminAccessReviewProjectionValue | null> {
  const researchEntityModel = deps.researchEntityModel || ResearchEntity;
  const entity = await researchEntityModel
    .findById(researchEntityId)
    .select('name displayName slug departments researchAreas updatedAt')
    .lean();
  if (!entity) return null;

  const [pathways, signals, routes, opportunities] = await Promise.all([
    aggregateReviewCounts(deps.entryPathwayModel || EntryPathway, researchEntityId, {
      derivationKey: { $not: /^faculty-opportunity:/ },
    }),
    aggregateReviewCounts(deps.accessSignalModel || AccessSignal, researchEntityId),
    aggregateReviewCounts(deps.contactRouteModel || ContactRoute, researchEntityId),
    aggregateReviewCounts(
      deps.postedOpportunityModel || PostedOpportunity,
      researchEntityId,
      { submissionStatus: { $ne: 'DRAFT' } },
      true,
    ),
  ]);
  return projectionValueFromParts(researchEntityId, entity as Record<string, unknown>, {
    pathways,
    signals,
    routes,
    opportunities,
  });
}

export async function invalidateAdminAccessReviewProjection(
  researchEntityId: unknown,
  deps: ProjectionInvalidationDeps = {},
): Promise<number | null> {
  const id = mongoose.isObjectIdOrHexString(researchEntityId)
    ? new mongoose.Types.ObjectId(String(researchEntityId))
    : null;
  if (!id) return null;
  const projectionModel = deps.projectionModel || AdminAccessReviewProjection;
  const projection = await projectionModel
    .findOneAndUpdate(
      { researchEntityId: id },
      {
        $setOnInsert: {
          searchPrefixes: [],
          counts: EMPTY_COUNTS,
          unreviewedCounts: EMPTY_COUNTS,
          totalUnreviewed: 0,
          hasOfficialApplication: false,
          sortUpdatedAt: new Date(0),
          computedAt: new Date(0),
          schemaVersion: ADMIN_ACCESS_REVIEW_PROJECTION_SCHEMA_VERSION,
        },
        $set: { stale: true },
        $inc: { generation: 1 },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true, session: deps.session },
    )
    .select('generation')
    .lean();
  return Number((projection as any)?.generation || 0);
}

export async function mutateAndRefreshAdminAccessReviewProjection<T>(
  researchEntityId: unknown,
  mutate: (session: mongoose.ClientSession) => Promise<T>,
): Promise<T> {
  let result: T | undefined;
  let generation: number | null = null;
  await mongoose.connection.transaction(async (session) => {
    result = await mutate(session);
    generation = await invalidateAdminAccessReviewProjection(researchEntityId, { session });
  });
  if (generation !== null) {
    await refreshAdminAccessReviewProjection(researchEntityId, generation);
  }
  return result as T;
}

export async function refreshAdminAccessReviewProjection(
  researchEntityId: unknown,
  expectedGeneration?: number,
  deps: ProjectionModelDeps = {},
): Promise<boolean> {
  const id = mongoose.isObjectIdOrHexString(researchEntityId)
    ? new mongoose.Types.ObjectId(String(researchEntityId))
    : null;
  if (!id) return false;
  const projectionModel = deps.projectionModel || AdminAccessReviewProjection;
  const value = await buildAdminAccessReviewProjection(id, deps);
  if (!value) {
    await projectionModel.deleteOne({ researchEntityId: id });
    return true;
  }

  const filter: Record<string, unknown> = { researchEntityId: id };
  if (expectedGeneration !== undefined) filter.generation = expectedGeneration;
  const result = await projectionModel.updateOne(
    filter,
    {
      $set: { ...value, stale: false },
      $setOnInsert: { generation: expectedGeneration ?? 0 },
    },
    { upsert: expectedGeneration === undefined },
  );
  return Number((result as any).matchedCount || (result as any).upsertedCount || 0) > 0;
}

export async function assertAdminAccessReviewProjectionReady(
  session?: mongoose.ClientSession,
): Promise<void> {
  const state = await AdminAccessReviewProjectionState.findById(
    ADMIN_ACCESS_REVIEW_PROJECTION_STATE_ID,
  )
    .select('schemaVersion ready rebuilding')
    .session(session || null)
    .lean();
  const stale = await AdminAccessReviewProjection.findOne({ stale: true })
    .select('_id')
    .session(session || null)
    .lean();
  if (
    !state ||
    (state as any).ready !== true ||
    (state as any).rebuilding === true ||
    (state as any).schemaVersion !== ADMIN_ACCESS_REVIEW_PROJECTION_SCHEMA_VERSION ||
    stale
  ) {
    throw new AdminAccessReviewProjectionUnavailableError();
  }
}

function projectionComparable(value: Record<string, any> | null | undefined): unknown {
  if (!value) return null;
  return {
    researchEntityId: String(value.researchEntityId),
    searchPrefixes: Array.isArray(value.searchPrefixes) ? value.searchPrefixes : [],
    counts: value.counts || EMPTY_COUNTS,
    unreviewedCounts: value.unreviewedCounts || EMPTY_COUNTS,
    totalUnreviewed: Number(value.totalUnreviewed || 0),
    hasOfficialApplication: value.hasOfficialApplication === true,
    sortUpdatedAt:
      value.sortUpdatedAt instanceof Date
        ? value.sortUpdatedAt.toISOString()
        : new Date(value.sortUpdatedAt || 0).toISOString(),
    schemaVersion: Number(value.schemaVersion || 0),
    stale: value.stale === true,
  };
}

function projectionValuesEqual(
  current: Record<string, any> | null,
  desired: AdminAccessReviewProjectionValue,
): boolean {
  return (
    JSON.stringify(projectionComparable(current)) ===
    JSON.stringify(projectionComparable({ ...desired, stale: false }))
  );
}

type AggregateReviewCount = {
  count: number;
  unreviewed: number;
  officialApplications: number;
};

const ZERO_REVIEW_COUNT: AggregateReviewCount = Object.freeze({
  count: 0,
  unreviewed: 0,
  officialApplications: 0,
});

async function loadReviewCountMap(
  model: typeof EntryPathway | typeof AccessSignal | typeof ContactRoute | typeof PostedOpportunity,
  batchSize: number,
  extraMatch: Record<string, unknown> = {},
  includeOfficialApplication = false,
  session?: mongoose.ClientSession,
): Promise<Map<string, AggregateReviewCount>> {
  const pipeline: mongoose.PipelineStage[] = [
    { $match: { researchEntityId: { $ne: null }, ...extraMatch } },
    {
      $group: {
        _id: '$researchEntityId',
        count: { $sum: 1 },
        unreviewed: {
          $sum: {
            $cond: [
              { $in: [{ $ifNull: ['$review.status', 'unreviewed'] }, ['unreviewed', null]] },
              1,
              0,
            ],
          },
        },
        ...(includeOfficialApplication
          ? {
              officialApplications: {
                $sum: {
                  $cond: [{ $gt: [{ $strLenCP: { $ifNull: ['$applicationUrl', ''] } }, 0] }, 1, 0],
                },
              },
            }
          : {}),
      },
    },
  ];
  const result = new Map<string, AggregateReviewCount>();
  const aggregate = model.aggregate(pipeline).allowDiskUse(false);
  if (session) aggregate.session(session);
  const cursor = aggregate.cursor({ batchSize });
  for await (const row of cursor) {
    if (!row?._id) continue;
    result.set(String(row._id), {
      count: Number(row.count || 0),
      unreviewed: Number(row.unreviewed || 0),
      officialApplications: Number(row.officialApplications || 0),
    });
  }
  return result;
}

export async function rebuildAdminAccessReviewProjection(
  options: {
    apply?: boolean;
    expectedPlanFingerprint?: string;
    batchSize?: number;
  } = {},
): Promise<AdminAccessReviewProjectionRebuildSummary> {
  const apply = options.apply === true;
  const batchSize = Math.min(500, Math.max(1, Math.floor(options.batchSize || 100)));
  const plans: Array<{
    id: mongoose.Types.ObjectId;
    desired: AdminAccessReviewProjectionValue;
    generation?: number;
    changed: boolean;
  }> = [];
  const parentIds = new Set<string>();
  const currentByEntityId = new Map<string, Record<string, any>>();
  const malformedProjectionIds: mongoose.Types.ObjectId[] = [];
  await mongoose.connection.transaction(
    async (session) => {
      const pathwayCounts = await loadReviewCountMap(
        EntryPathway,
        batchSize,
        { derivationKey: { $not: /^faculty-opportunity:/ } },
        false,
        session,
      );
      const signalCounts = await loadReviewCountMap(AccessSignal, batchSize, {}, false, session);
      const routeCounts = await loadReviewCountMap(ContactRoute, batchSize, {}, false, session);
      const opportunityCounts = await loadReviewCountMap(
        PostedOpportunity,
        batchSize,
        { submissionStatus: { $ne: 'DRAFT' } },
        true,
        session,
      );
      const projectionCursor = AdminAccessReviewProjection.find({})
        .session(session)
        .lean()
        .cursor({ batchSize });
      for await (const projection of projectionCursor) {
        if ((projection as any).researchEntityId) {
          currentByEntityId.set(String((projection as any).researchEntityId), projection as any);
        } else if ((projection as any)._id) {
          malformedProjectionIds.push((projection as any)._id);
        }
      }
      const cursor = ResearchEntity.find({})
        .select('name displayName slug departments researchAreas updatedAt')
        .sort({ _id: 1 })
        .session(session)
        .lean()
        .cursor({ batchSize });

      for await (const entity of cursor) {
        const id = new mongoose.Types.ObjectId(String((entity as any)._id));
        const key = id.toHexString();
        parentIds.add(key);
        const current = currentByEntityId.get(key) || null;
        const desired = projectionValueFromParts(id, entity as any, {
          pathways: pathwayCounts.get(key) || ZERO_REVIEW_COUNT,
          signals: signalCounts.get(key) || ZERO_REVIEW_COUNT,
          routes: routeCounts.get(key) || ZERO_REVIEW_COUNT,
          opportunities: opportunityCounts.get(key) || ZERO_REVIEW_COUNT,
        });
        plans.push({
          id,
          desired,
          ...(current ? { generation: Number((current as any).generation || 0) } : {}),
          changed: !projectionValuesEqual(current as any, desired),
        });
      }
    },
    { readConcern: { level: 'snapshot' } },
  );

  const orphanIds = [
    ...malformedProjectionIds,
    ...Array.from(currentByEntityId.entries())
      .filter(([researchEntityId]) => !parentIds.has(researchEntityId))
      .map(([, projection]) => projection._id as mongoose.Types.ObjectId),
  ];

  const fingerprintInput = plans
    .filter((plan) => plan.changed)
    .map((plan) => projectionComparable({ ...plan.desired, stale: false }));
  const planFingerprint = createHash('sha256')
    .update(JSON.stringify({ changes: fingerprintInput, orphanIds: orphanIds.map(String).sort() }))
    .digest('hex');
  const missing = plans.filter((plan) => plan.generation === undefined).length;
  const changed = plans.filter((plan) => plan.changed && plan.generation !== undefined).length;
  const unchanged = plans.length - missing - changed;
  const writesPlanned = plans.filter((plan) => plan.changed).length + orphanIds.length;
  const summary: AdminAccessReviewProjectionRebuildSummary = {
    mode: apply ? 'apply' : 'dry-run',
    scanned: plans.length,
    missing,
    changed,
    unchanged,
    orphaned: orphanIds.length,
    writesPlanned,
    writesApplied: 0,
    planFingerprint,
  };

  if (!apply) return summary;
  if (!options.expectedPlanFingerprint || options.expectedPlanFingerprint !== planFingerprint) {
    throw new Error(
      'Projection rebuild plan drifted. Generate and review a fresh dry-run artifact.',
    );
  }

  await AdminAccessReviewProjectionState.findByIdAndUpdate(
    ADMIN_ACCESS_REVIEW_PROJECTION_STATE_ID,
    {
      $set: {
        schemaVersion: ADMIN_ACCESS_REVIEW_PROJECTION_SCHEMA_VERSION,
        ready: false,
        rebuilding: true,
      },
    },
    { upsert: true, setDefaultsOnInsert: true },
  );

  try {
    const changedPlans = plans.filter((plan) => plan.changed);
    for (let offset = 0; offset < changedPlans.length; offset += batchSize) {
      const batch = changedPlans.slice(offset, offset + batchSize);
      const operations = batch.map((plan) => ({
        updateOne: {
          filter: {
            researchEntityId: plan.id,
            generation: plan.generation === undefined ? { $exists: false } : plan.generation,
          },
          update:
            plan.generation === undefined
              ? {
                  $setOnInsert: {
                    ...plan.desired,
                    stale: false,
                    generation: 0,
                  },
                }
              : { $set: { ...plan.desired, stale: false } },
          upsert: plan.generation === undefined,
        },
      }));
      const result = await AdminAccessReviewProjection.bulkWrite(operations, { ordered: true });
      const applied = Number(result.matchedCount || 0) + Number(result.upsertedCount || 0);
      summary.writesApplied += applied;
      if (applied !== batch.length) {
        throw new Error('Projection changed during rebuild. Generate a fresh dry-run artifact.');
      }
    }
    if (orphanIds.length > 0) {
      const result = await AdminAccessReviewProjection.deleteMany({ _id: { $in: orphanIds } });
      summary.writesApplied += Number(result.deletedCount || 0);
    }
    const [stale, projected] = await Promise.all([
      AdminAccessReviewProjection.countDocuments({ stale: true }),
      AdminAccessReviewProjection.countDocuments({}),
    ]);
    if (stale > 0 || projected !== parentIds.size) {
      throw new Error('Projection verification found drift. The queue remains unavailable.');
    }
    await AdminAccessReviewProjectionState.findByIdAndUpdate(
      ADMIN_ACCESS_REVIEW_PROJECTION_STATE_ID,
      {
        $set: {
          schemaVersion: ADMIN_ACCESS_REVIEW_PROJECTION_SCHEMA_VERSION,
          ready: true,
          rebuilding: false,
          reconciledAt: new Date(),
        },
      },
      { upsert: true, setDefaultsOnInsert: true },
    );
    return summary;
  } catch (error) {
    await AdminAccessReviewProjectionState.findByIdAndUpdate(
      ADMIN_ACCESS_REVIEW_PROJECTION_STATE_ID,
      { $set: { ready: false, rebuilding: false } },
      { upsert: true, setDefaultsOnInsert: true },
    ).catch(() => undefined);
    throw error;
  }
}
