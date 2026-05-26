import { AccessSignal } from '../models/accessSignal';
import { EntryPathway } from '../models/entryPathway';
import { Fellowship } from '../models/fellowship';
import { ContactRoute } from '../models/contactRoute';
import { PostedOpportunity } from '../models/postedOpportunity';
import { ResearchEntity } from '../models/researchEntity';
import { ResearchGroupMember } from '../models/researchGroupMember';
import {
  publicStudentVisibilityTiers,
  type StudentVisibilityTier,
} from '../models/studentVisibility';
import {
  VisibilityReleaseQueueItem,
  type VisibilityReleaseQueueCollection,
} from '../models/visibilityReleaseQueueItem';
import {
  computeProgramStudentVisibility,
  computeResearchEntityStudentVisibility,
  STUDENT_VISIBILITY_VERSION,
} from './studentVisibilityTier';
import {
  buildChangedTierSummary,
  nextRepairActionForReasons,
} from '../scripts/studentVisibilityBackfillReport';

export type StudentVisibilityGateMode = 'dry-run' | 'apply';
export type StudentVisibilityGateCollection = VisibilityReleaseQueueCollection | 'all';

export interface StudentVisibilityGateOptions {
  collection: StudentVisibilityGateCollection;
  mode: StudentVisibilityGateMode;
  sourceName?: string;
  recordIds?: string[];
  limit?: number;
}

export interface StudentVisibilityGatePlan {
  collection: VisibilityReleaseQueueCollection;
  recordId: string;
  label: string;
  id?: string;
  slug?: string;
  entityType?: string;
  kind?: string;
  currentTier?: string;
  computedTier: StudentVisibilityTier;
  tier: StudentVisibilityTier;
  reasons: string[];
  sourceNames: string[];
  nextRepairAction: string;
}

export interface VisibilityQueueUpsert {
  collection: VisibilityReleaseQueueCollection;
  recordId: string;
  label: string;
  currentTier?: string;
  computedTier: StudentVisibilityTier;
  targetTier: StudentVisibilityTier;
  blockerReasons: string[];
  evidenceSignals: string[];
  sourceNames: string[];
  nextRepairAction: string;
  status: 'open';
}

export interface StudentVisibilityGateDeps {
  updateRecordVisibility: (
    collection: VisibilityReleaseQueueCollection,
    recordId: string,
    patch: Record<string, any>,
  ) => Promise<void>;
  upsertOpenQueueItem: (item: VisibilityQueueUpsert) => Promise<void>;
  resolveQueueItem: (
    collection: VisibilityReleaseQueueCollection,
    recordId: string,
    metadata: { resolvedByTier: StudentVisibilityTier },
  ) => Promise<void>;
}

export interface StudentVisibilityGateReport {
  mode: StudentVisibilityGateMode;
  collection: StudentVisibilityGateCollection;
  scanned: number;
  counts: {
    scanned: number;
    promoted: number;
    held: number;
    resolved: number;
    changed: number;
  };
  reasonCounts: Record<string, number>;
  blockerCounts: Record<string, number>;
  sourceCounts: Record<string, number>;
  changedTierSummary: ReturnType<typeof buildChangedTierSummary>;
  samples: StudentVisibilityGatePlan[];
}

const PUBLIC_TIERS = new Set<string>(publicStudentVisibilityTiers);

const FORMALIZATION_ONLY_ENTRY_PATHWAY_TYPES = [
  'COURSE_CREDIT',
  'SENIOR_THESIS',
  'FELLOWSHIP_FUNDED_PROJECT',
];

const evidenceReasons = new Set([
  'application_route',
  'concrete_next_step',
  'official_source',
  'source_backed_description',
  'undergraduate_relevant',
]);

export function isBlockingVisibilityReason(reason: string): boolean {
  if (evidenceReasons.has(reason)) return false;
  return (
    reason.startsWith('missing_') ||
    reason.endsWith('_only') ||
    [
      'application_source_only',
      'archive_review',
      'content_page_risk',
      'duplicate_name_risk',
      'duplicate_risk',
      'inactive_at_yale',
      'not_undergraduate_relevant',
      'profile_fallback_only',
      'thin_description',
    ].includes(reason)
  );
}

const uniqueStrings = (values: unknown[]): string[] =>
  Array.from(
    new Set(
      values
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );

const increment = (counts: Record<string, number>, key: string) => {
  counts[key] = (counts[key] || 0) + 1;
};

const countByEntityId = (rows: Array<{ _id: unknown; count: number }>) =>
  new Map(rows.map((row) => [String(row._id), row.count]));

const defaultGateDeps: StudentVisibilityGateDeps = {
  async updateRecordVisibility(collection, recordId, patch) {
    if (collection === 'research') {
      await ResearchEntity.updateOne({ _id: recordId }, { $set: patch });
      return;
    }
    await Fellowship.updateOne({ _id: recordId }, { $set: patch });
  },
  async upsertOpenQueueItem(item) {
    const now = new Date();
    await VisibilityReleaseQueueItem.updateOne(
      { collection: item.collection, recordId: item.recordId, status: 'open' },
      {
        $set: {
          ...item,
          lastSeenAt: now,
          resolvedAt: undefined,
          resolvedByTier: '',
        },
        $setOnInsert: { firstSeenAt: now },
      },
      { upsert: true },
    );
  },
  async resolveQueueItem(collection, recordId, metadata) {
    const now = new Date();
    await VisibilityReleaseQueueItem.updateMany(
      { collection, recordId, status: 'open' },
      {
        $set: {
          status: 'resolved',
          resolvedAt: now,
          resolvedByTier: metadata.resolvedByTier,
          lastSeenAt: now,
        },
      },
    );
  },
};

export async function runStudentVisibilityGateForPlans(
  plans: StudentVisibilityGatePlan[],
  options: {
    mode: StudentVisibilityGateMode;
    collection?: StudentVisibilityGateCollection;
    deps?: StudentVisibilityGateDeps;
  },
): Promise<StudentVisibilityGateReport> {
  const deps = options.deps || defaultGateDeps;
  const reasonCounts: Record<string, number> = {};
  const blockerCounts: Record<string, number> = {};
  const sourceCounts: Record<string, number> = {};
  const counts = {
    scanned: plans.length,
    promoted: 0,
    held: 0,
    resolved: 0,
    changed: 0,
  };

  for (const plan of plans) {
    const publicSafe = PUBLIC_TIERS.has(plan.tier);
    if (publicSafe) {
      counts.promoted += 1;
      counts.resolved += 1;
    } else {
      counts.held += 1;
    }
    if (plan.currentTier !== plan.tier) counts.changed += 1;
    for (const reason of plan.reasons) {
      increment(reasonCounts, reason);
      if (isBlockingVisibilityReason(reason)) increment(blockerCounts, reason);
    }
    for (const sourceName of plan.sourceNames) increment(sourceCounts, sourceName);

    if (options.mode !== 'apply') continue;

    await deps.updateRecordVisibility(plan.collection, plan.recordId, {
      studentVisibilityTier: plan.tier,
      studentVisibilityComputedTier: plan.computedTier,
      studentVisibilityReasons: plan.reasons,
      studentVisibilityComputedAt: new Date(),
      studentVisibilityVersion: STUDENT_VISIBILITY_VERSION,
    });

    if (publicSafe) {
      await deps.resolveQueueItem(plan.collection, plan.recordId, { resolvedByTier: plan.tier });
    } else {
      const blockerReasons = plan.reasons.filter(isBlockingVisibilityReason);
      await deps.upsertOpenQueueItem({
        collection: plan.collection,
        recordId: plan.recordId,
        label: plan.label,
        currentTier: plan.currentTier,
        computedTier: plan.computedTier,
        targetTier: plan.tier,
        blockerReasons,
        evidenceSignals: plan.reasons.filter((reason) => !isBlockingVisibilityReason(reason)),
        sourceNames: plan.sourceNames,
        nextRepairAction: plan.nextRepairAction,
        status: 'open',
      });
    }
  }

  return {
    mode: options.mode,
    collection: options.collection || 'all',
    scanned: plans.length,
    counts,
    reasonCounts,
    blockerCounts,
    sourceCounts,
    changedTierSummary: buildChangedTierSummary(
      plans.map((plan) => ({
        id: plan.id || plan.recordId,
        label: plan.label,
        slug: plan.slug,
        entityType: plan.entityType || plan.collection,
        kind: plan.kind,
        currentTier: plan.currentTier,
        tier: plan.tier,
        computedTier: plan.computedTier,
        reasons: plan.reasons,
      })),
    ),
    samples: plans.slice(0, 20),
  };
}

async function planResearchEntityGateUpdates(
  options: Pick<StudentVisibilityGateOptions, 'sourceName' | 'recordIds' | 'limit'>,
): Promise<StudentVisibilityGatePlan[]> {
  const match: Record<string, any> = { archived: { $ne: true } };
  if (options.recordIds?.length) match._id = { $in: options.recordIds };
  if (options.sourceName) {
    const sourceEntityIds = await AccessSignal.distinct('researchEntityId', {
      sourceName: options.sourceName,
      archived: false,
    });
    match._id = match._id
      ? { $in: sourceEntityIds.filter((id: any) => options.recordIds?.includes(String(id))) }
      : { $in: sourceEntityIds };
  }

  const query = ResearchEntity.find(match).sort({ name: 1 });
  if (options.limit && Number.isFinite(options.limit)) query.limit(options.limit);
  const entities = await query.lean();
  const entityIds = entities.map((entity: any) => entity._id);

  const [leadRows, accessRows, pathwayRows, contactRows, postedRows] = await Promise.all([
    ResearchGroupMember.find({
      researchEntityId: { $in: entityIds },
      isCurrentMember: { $ne: false },
      role: { $in: ['pi', 'co-pi', 'director', 'co-director'] },
    })
      .select('researchEntityId userId name role')
      .lean(),
    AccessSignal.aggregate([
      { $match: { researchEntityId: { $in: entityIds }, archived: false } },
      {
        $group: {
          _id: '$researchEntityId',
          count: { $sum: 1 },
          sourceNames: { $addToSet: '$sourceName' },
          types: { $addToSet: '$signalType' },
        },
      },
    ]),
    EntryPathway.aggregate([
      {
        $match: {
          researchEntityId: { $in: entityIds },
          archived: false,
          pathwayType: { $nin: FORMALIZATION_ONLY_ENTRY_PATHWAY_TYPES },
        },
      },
      { $group: { _id: '$researchEntityId', count: { $sum: 1 }, types: { $addToSet: '$pathwayType' } } },
    ]),
    ContactRoute.aggregate([
      {
        $match: {
          researchEntityId: { $in: entityIds },
          archived: false,
          visibility: 'PUBLIC',
        },
      },
      { $group: { _id: '$researchEntityId', count: { $sum: 1 }, types: { $addToSet: '$routeType' } } },
    ]),
    PostedOpportunity.aggregate([
      {
        $match: {
          researchEntityId: { $in: entityIds },
          archived: false,
          status: { $in: ['OPEN', 'ROLLING'] },
        },
      },
      { $group: { _id: '$researchEntityId', count: { $sum: 1 } } },
    ]),
  ]);

  const leadsByEntityId = new Map<string, any[]>();
  for (const row of leadRows as any[]) {
    const key = String(row.researchEntityId);
    leadsByEntityId.set(key, [...(leadsByEntityId.get(key) || []), row]);
  }
  const accessCounts = countByEntityId(accessRows as any[]);
  const pathwayCounts = countByEntityId(pathwayRows as any[]);
  const contactCounts = countByEntityId(contactRows as any[]);
  const postedCounts = countByEntityId(postedRows as any[]);
  const typeMap = (rows: any[]) =>
    new Map(rows.map((row) => [String(row._id), uniqueStrings(row.types || [])]));
  const accessTypes = typeMap(accessRows as any[]);
  const pathwayTypes = typeMap(pathwayRows as any[]);
  const contactTypes = typeMap(contactRows as any[]);
  const sourceNamesByEntityId = new Map(
    (accessRows as any[]).map((row) => [String(row._id), uniqueStrings(row.sourceNames || [])]),
  );

  return entities.map((entity: any) => {
    const recordId = String(entity._id);
    const result = computeResearchEntityStudentVisibility({
      entity,
      leadMembers: leadsByEntityId.get(recordId) || [],
      accessSignalCount: accessCounts.get(recordId) || 0,
      accessSignalTypes: accessTypes.get(recordId) || [],
      actionablePathwayCount: pathwayCounts.get(recordId) || 0,
      actionablePathwayTypes: pathwayTypes.get(recordId) || [],
      publicContactRouteCount: contactCounts.get(recordId) || 0,
      publicContactRouteTypes: contactTypes.get(recordId) || [],
      openPostedOpportunityCount: postedCounts.get(recordId) || 0,
    });
    return {
      collection: 'research' as const,
      recordId,
      id: recordId,
      label: entity.displayName || entity.name || entity.slug || recordId,
      slug: entity.slug,
      entityType: entity.entityType,
      kind: entity.kind,
      currentTier: entity.studentVisibilityTier,
      tier: result.tier,
      computedTier: result.computedTier,
      reasons: result.reasons,
      sourceNames: sourceNamesByEntityId.get(recordId) || [],
      nextRepairAction: nextRepairActionForReasons(result.reasons),
    };
  });
}

async function planProgramGateUpdates(
  options: Pick<StudentVisibilityGateOptions, 'sourceName' | 'recordIds' | 'limit'>,
): Promise<StudentVisibilityGatePlan[]> {
  const match: Record<string, any> = { archived: false };
  if (options.recordIds?.length) match._id = { $in: options.recordIds };
  if (options.sourceName) match.sourceName = options.sourceName;
  const query = Fellowship.find(match).sort({ title: 1 });
  if (options.limit && Number.isFinite(options.limit)) query.limit(options.limit);
  const programs = await query.lean();

  return programs.map((program: any) => {
    const recordId = String(program._id);
    const result = computeProgramStudentVisibility(program);
    return {
      collection: 'programs' as const,
      recordId,
      id: recordId,
      label: program.title || recordId,
      slug: program.slug,
      entityType: 'program',
      currentTier: program.studentVisibilityTier,
      tier: result.tier,
      computedTier: result.computedTier,
      reasons: result.reasons,
      sourceNames: uniqueStrings([program.sourceName]),
      nextRepairAction: nextRepairActionForReasons(result.reasons),
    };
  });
}

export async function planStudentVisibilityGate(
  options: StudentVisibilityGateOptions,
): Promise<StudentVisibilityGatePlan[]> {
  const [research, programs] = await Promise.all([
    options.collection === 'all' || options.collection === 'research'
      ? planResearchEntityGateUpdates(options)
      : Promise.resolve([]),
    options.collection === 'all' || options.collection === 'programs'
      ? planProgramGateUpdates(options)
      : Promise.resolve([]),
  ]);
  return [...research, ...programs];
}

export async function runStudentVisibilityGate(
  options: StudentVisibilityGateOptions,
): Promise<StudentVisibilityGateReport> {
  const plans = await planStudentVisibilityGate(options);
  return runStudentVisibilityGateForPlans(plans, {
    mode: options.mode,
    collection: options.collection,
  });
}

export async function listVisibilityReleaseQueue(input: {
  collection?: VisibilityReleaseQueueCollection;
  reason?: string;
  sourceName?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}) {
  const page = Math.max(1, Math.floor(input.page || 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(input.pageSize || 25)));
  const filter: Record<string, any> = {};
  if (input.collection === 'research' || input.collection === 'programs') {
    filter.collection = input.collection;
  }
  filter.status = input.status || 'open';
  if (input.reason) filter.blockerReasons = input.reason;
  if (input.sourceName) filter.sourceNames = input.sourceName;

  const [items, total] = await Promise.all([
    VisibilityReleaseQueueItem.find(filter)
      .sort({ lastSeenAt: -1, _id: 1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    VisibilityReleaseQueueItem.countDocuments(filter),
  ]);

  return {
    items,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}
