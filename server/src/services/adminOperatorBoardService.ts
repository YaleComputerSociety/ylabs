import { Fellowship } from '../models/fellowship';
import { AccessSignal } from '../models/accessSignal';
import { ContactRoute } from '../models/contactRoute';
import { Listing } from '../models/listing';
import { Observation } from '../models/observation';
import { ResearchEntity } from '../models/researchEntity';
import { ResearchGroupMember } from '../models/researchGroupMember';
import { ScrapeRun } from '../models/scrapeRun';
import { Source } from '../models/source';
import type { StudentVisibilityTier } from '../models/studentVisibility';
import { VisibilityReleaseQueueItem } from '../models/visibilityReleaseQueueItem';
import { workPlannerSourcePolicies } from '../scrapers/workPlanner';
import {
  assessResearchEntityEvidenceCoverage,
  type EvidenceCoverageAssessment,
} from './researchEntityEvidenceCoverage';
import { buildSourceHealthRows, type SourceHealthRisk } from './sourceHealthService';

export type QueueKind = 'blocking' | 'evidence' | 'review';
export type PromotionStatus = 'ready' | 'watch' | 'blocked';

const evidenceReasons = new Set([
  'application_route',
  'concrete_next_step',
  'official_source',
  'source_backed_description',
  'undergraduate_relevant',
]);

export function classifyOperatorQueueReason(reason: string): QueueKind {
  if (evidenceReasons.has(reason)) return 'evidence';
  if (
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
      'thin_description',
    ].includes(reason)
  ) {
    return 'blocking';
  }
  return 'review';
}

export function summarizeDryRunPosture(runs: any[]) {
  const sorted = [...runs].sort(
    (a, b) => new Date(b.startedAt || 0).getTime() - new Date(a.startedAt || 0).getTime(),
  );
  const compact = (run: any | undefined) =>
    run
      ? {
          id: String(run._id),
          sourceName: run.sourceName,
          status: run.status,
          startedAt: run.startedAt?.toISOString?.() || run.startedAt,
          observationCount: run.observationCount || 0,
          entitiesObserved: run.entitiesObserved || 0,
        }
      : null;

  return {
    latestDryRun: compact(sorted.find((run) => run.options?.dryRun === true)),
    latestWriteRun: compact(sorted.find((run) => run.options?.dryRun !== true)),
  };
}

export function derivePromotionStatus(input: {
  sourceRiskCounts: Record<SourceHealthRisk, number>;
  integrityStatus: 'pass' | 'watch' | 'failure' | 'unknown';
  meiliStatus: PromotionStatus | 'unknown';
}): PromotionStatus {
  if (
    input.sourceRiskCounts.error > 0 ||
    input.integrityStatus === 'failure' ||
    input.meiliStatus === 'blocked'
  ) {
    return 'blocked';
  }
  if (
    input.sourceRiskCounts.warn > 0 ||
    input.integrityStatus === 'watch' ||
    input.integrityStatus === 'unknown' ||
    input.meiliStatus === 'watch' ||
    input.meiliStatus === 'unknown'
  ) {
    return 'watch';
  }
  return 'ready';
}

export function buildRecommendedNextActions(input: {
  promotionStatus: PromotionStatus;
  sourceRiskCounts: Record<SourceHealthRisk, number>;
  pendingMeiliSync?: boolean;
}) {
  const actions: string[] = [];
  if (input.sourceRiskCounts.error > 0) {
    actions.push('Inspect failed source runs before promotion.');
  }
  if (input.sourceRiskCounts.warn > 0) {
    actions.push('Run bounded dry runs for warning sources before promotion.');
  }
  if (input.pendingMeiliSync) {
    actions.push('Rebuild Meili after the latest accepted write run.');
  }
  actions.push('Run scraper integrity and data-quality gates before any production promotion.');
  actions.push('Rebuild Meili indexes after accepted data repairs.');
  if (input.promotionStatus === 'ready') actions.push('Confirm backup and rollback notes.');
  return actions;
}

export function buildGstackNextLane(input: {
  sourceRiskCounts: Record<SourceHealthRisk, number>;
}) {
  if (input.sourceRiskCounts.warn === 0) return null;

  return {
    lane: 'source-conflict-review',
    command: 'yarn --cwd server source:health',
    rationale: 'Warning sources need materialization conflict review before broad writes.',
  };
}

export interface EvidenceCoverageBoardRow {
  id: string;
  label: string;
  slug?: string;
  assessment: EvidenceCoverageAssessment;
}

const incrementCount = (counts: Record<string, number>, key: string) => {
  counts[key] = (counts[key] || 0) + 1;
};

const sortedCountRows = <TName extends string>(
  counts: Record<string, number>,
  keyName: TName,
  limit = 8,
): Array<Record<TName, string> & { count: number }> =>
  Object.entries(counts)
    .sort(([aKey, aCount], [bKey, bCount]) => bCount - aCount || aKey.localeCompare(bKey))
    .slice(0, limit)
    .map(([key, count]) => ({ [keyName]: key, count }) as Record<TName, string> & { count: number });

export function buildEvidenceCoverageBoardSummary(rows: EvidenceCoverageBoardRow[]) {
  const blockerCounts: Record<string, number> = {};
  const suggestedSourceTypeCounts: Record<string, number> = {};
  let thinResearchEntities = 0;
  let partialResearchEntities = 0;
  let readyCandidateResearchEntities = 0;

  for (const row of rows) {
    if (row.assessment.coverageTier === 'thin') thinResearchEntities++;
    if (row.assessment.coverageTier === 'partial') partialResearchEntities++;
    if (row.assessment.coverageTier === 'ready_candidate') readyCandidateResearchEntities++;
    for (const blocker of row.assessment.blockers) incrementCount(blockerCounts, blocker);
    for (const sourceType of row.assessment.suggestedSourceTypes) {
      incrementCount(suggestedSourceTypeCounts, sourceType);
    }
  }

  return {
    assessedResearchEntities: rows.length,
    thinResearchEntities,
    partialResearchEntities,
    readyCandidateResearchEntities,
    topBlockers: sortedCountRows(blockerCounts, 'blocker'),
    suggestedSourceTypes: sortedCountRows(suggestedSourceTypeCounts, 'sourceType'),
    samples: rows
      .filter((row) => row.assessment.coverageTier !== 'ready_candidate')
      .slice(0, 8)
      .map((row) => ({
        id: row.id,
        label: row.label,
        slug: row.slug,
        coverageTier: row.assessment.coverageTier,
        blockers: row.assessment.blockers,
        suggestedSourceTypes: row.assessment.suggestedSourceTypes,
        publicSummary: row.assessment.publicSummary,
        rejectedFields: row.assessment.rejectedFields,
      })),
  };
}

const tierOrder: StudentVisibilityTier[] = [
  'student_ready',
  'limited_but_safe',
  'operator_review',
  'suppressed',
];

const normalizeTierCounts = (rows: Array<{ _id: string; count: number }>) =>
  tierOrder.map((tier) => ({
    tier,
    count: rows.find((row) => row._id === tier)?.count || 0,
  }));

async function countByTier(model: any, match: Record<string, unknown>) {
  const rows = await model.aggregate([
    { $match: match },
    { $group: { _id: '$studentVisibilityTier', count: { $sum: 1 } } },
  ]);
  return normalizeTierCounts(rows);
}

async function reasonCounts(model: any, match: Record<string, unknown>, limit = 12) {
  const rows = await model.aggregate([
    { $match: match },
    { $unwind: '$studentVisibilityReasons' },
    { $group: { _id: '$studentVisibilityReasons', count: { $sum: 1 } } },
    { $sort: { count: -1, _id: 1 } },
    { $limit: limit },
    { $project: { _id: 0, reason: '$_id', count: 1 } },
  ]);

  return rows.map((row: { reason: string; count: number }) => ({
    ...row,
    kind: classifyOperatorQueueReason(row.reason),
  }));
}

const researchReasonActions: Record<string, string> = {
  missing_action_evidence:
    'Add source-backed access signals, entry pathways, contact routes, or posted opportunities before promotion.',
  missing_description: 'Repair with official source-backed description text.',
  missing_lead:
    'Attach PI, director, or owner evidence, or mark a reviewed non-person-owner exception.',
  missing_source_url: 'Attach an official source URL before public promotion.',
  thin_description: 'Replace thin text with a fuller source-backed description.',
  profile_fallback_only:
    'Verify entity/lab context instead of relying only on faculty profile synthesis.',
};

const programReasonActions: Record<string, string> = {
  missing_official_source: 'Find and attach the official source URL, then rerun Trust Tier.',
  application_source_only:
    'Find a richer non-portal official source page before promoting above limited visibility.',
  archive_review: 'Keep hidden or rewrite as a real recurring planning record.',
  not_undergraduate_relevant: 'Suppress unless an undergraduate-specific child record exists.',
  official_source: 'Review for possible promotion if audience and route are student-safe.',
  application_route: 'Verify the route is the official next step, not a generic catalog link.',
};

async function sampleResearch(match: Record<string, unknown>, limit = 3) {
  return ResearchEntity.find({ archived: { $ne: true }, ...match })
    .select(
      'name slug studentVisibilityTier studentVisibilityReasons sourceUrls websiteUrl shortDescription',
    )
    .sort({ name: 1 })
    .limit(limit)
    .lean();
}

async function samplePrograms(match: Record<string, unknown>, limit = 3) {
  return Fellowship.find({ archived: false, ...match })
    .select(
      'title studentVisibilityTier studentVisibilityReasons sourceUrl summary studentFacingCategory',
    )
    .sort({ title: 1 })
    .limit(limit)
    .lean();
}

function compactResearchSample(row: any) {
  return {
    id: String(row._id),
    label: row.name || row.slug || String(row._id),
    tier: row.studentVisibilityTier,
    reasons: row.studentVisibilityReasons || [],
    sourceUrl: row.websiteUrl || row.sourceUrls?.[0] || '',
    summary: row.shortDescription || '',
  };
}

function compactProgramSample(row: any) {
  return {
    id: String(row._id),
    label: row.title || String(row._id),
    tier: row.studentVisibilityTier,
    reasons: row.studentVisibilityReasons || [],
    sourceUrl: row.sourceUrl || '',
    category: row.studentFacingCategory || '',
    summary: row.summary || '',
  };
}

async function buildQueueSummaries() {
  const [researchReasons, programReasons] = await Promise.all([
    reasonCounts(ResearchEntity, { archived: { $ne: true } }),
    reasonCounts(Fellowship, { archived: false }),
  ]);

  const researchQueues = await Promise.all(
    researchReasons.slice(0, 8).map(async (row: { reason: string; count: number }) => ({
      collection: 'research' as const,
      reason: row.reason,
      kind: classifyOperatorQueueReason(row.reason),
      count: row.count,
      nextAction: researchReasonActions[row.reason] || 'Review samples and decide repair action.',
      samples: (await sampleResearch({ studentVisibilityReasons: row.reason })).map(
        compactResearchSample,
      ),
    })),
  );

  const programQueues = await Promise.all(
    programReasons.slice(0, 8).map(async (row: { reason: string; count: number }) => ({
      collection: 'programs' as const,
      reason: row.reason,
      kind: classifyOperatorQueueReason(row.reason),
      count: row.count,
      nextAction: programReasonActions[row.reason] || 'Review samples and decide repair action.',
      samples: (await samplePrograms({ studentVisibilityReasons: row.reason })).map(
        compactProgramSample,
      ),
    })),
  );

  const queues = [...researchQueues, ...programQueues];
  const queueKindCounts = queues.reduce(
    (acc, queue) => {
      acc[queue.kind] += queue.count;
      return acc;
    },
    { blocking: 0, evidence: 0, review: 0 },
  );

  return {
    reasonCounts: {
      research: researchReasons,
      programs: programReasons,
    },
    queueKindCounts,
    discoveryCandidates: queues
      .filter((queue) => queue.kind === 'evidence' || queue.reason.includes('official_source'))
      .slice(0, 6)
      .map((queue) => ({
        collection: queue.collection,
        reason: queue.reason,
        count: queue.count,
        nextAction: queue.nextAction,
        samples: queue.samples.slice(0, 2),
      })),
    queues,
  };
}

async function buildReleaseQueueSummary() {
  const [statusRows, blockerRows, sourceRows, samples] = await Promise.all([
    VisibilityReleaseQueueItem.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
    ]),
    VisibilityReleaseQueueItem.aggregate([
      { $match: { status: 'open' } },
      { $unwind: '$blockerReasons' },
      { $group: { _id: '$blockerReasons', count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
      { $limit: 12 },
      { $project: { _id: 0, reason: '$_id', count: 1 } },
    ]),
    VisibilityReleaseQueueItem.aggregate([
      { $match: { status: 'open' } },
      { $unwind: '$sourceNames' },
      { $group: { _id: '$sourceNames', count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
      { $limit: 12 },
      { $project: { _id: 0, sourceName: '$_id', count: 1 } },
    ]),
    VisibilityReleaseQueueItem.find({ status: 'open' })
      .select(
        'collection recordId label currentTier computedTier targetTier blockerReasons evidenceSignals sourceNames nextRepairAction lastSeenAt',
      )
      .sort({ lastSeenAt: -1, _id: 1 })
      .limit(8)
      .lean(),
  ]);

  const statusCounts = statusRows.reduce<Record<string, number>>((acc, row: any) => {
    acc[row._id || 'unknown'] = row.count;
    return acc;
  }, {});

  return {
    statusCounts,
    openCount: statusCounts.open || 0,
    topBlockers: blockerRows,
    sourcePressure: sourceRows,
    samples: samples.map((sample: any) => ({
      id: String(sample._id),
      collection: sample.collection,
      recordId: sample.recordId,
      label: sample.label,
      currentTier: sample.currentTier,
      computedTier: sample.computedTier,
      targetTier: sample.targetTier,
      blockerReasons: sample.blockerReasons || [],
      evidenceSignals: sample.evidenceSignals || [],
      sourceNames: sample.sourceNames || [],
      nextRepairAction: sample.nextRepairAction || '',
      lastSeenAt: sample.lastSeenAt?.toISOString?.() || sample.lastSeenAt,
    })),
  };
}

async function buildEvidenceCoverageSummary() {
  const entities = await ResearchEntity.find({
    archived: { $ne: true },
    $or: [
      { studentVisibilityTier: { $in: ['operator_review', 'suppressed'] } },
      { studentVisibilityTier: { $exists: false } },
      { studentVisibilityTier: null },
    ],
  })
    .select('_id name slug description shortDescription fullDescription profileSynthesisDescription sourceUrls websiteUrl website')
    .sort({ updatedAt: -1, _id: 1 })
    .limit(60)
    .lean();

  const rows: EvidenceCoverageBoardRow[] = [];
  for (const entity of entities as any[]) {
    const id = String(entity._id);
    const [listings, members, accessSignals, contactRoutes, observations] = await Promise.all([
      Listing.find({ researchEntityId: id, archived: { $ne: true } }).limit(8).lean(),
      ResearchGroupMember.find({ researchEntityId: id, isCurrentMember: { $ne: false } })
        .limit(8)
        .lean(),
      AccessSignal.find({ researchEntityId: id, archived: { $ne: true } }).limit(12).lean(),
      ContactRoute.find({ researchEntityId: id, archived: { $ne: true } }).limit(12).lean(),
      Observation.find({
        entityType: 'researchEntity',
        superseded: { $ne: true },
        $or: [{ entityId: id }, ...(entity.slug ? [{ entityKey: entity.slug }] : [])],
      })
        .select('sourceName field value sourceUrl observedAt confidence')
        .sort({ observedAt: -1 })
        .limit(40)
        .lean(),
    ]);
    const assessment = assessResearchEntityEvidenceCoverage({
      entity,
      listings,
      members,
      accessSignals,
      contactRoutes,
      observations,
    });
    rows.push({
      id,
      label: entity.name || entity.slug || id,
      slug: entity.slug,
      assessment,
    });
  }

  return buildEvidenceCoverageBoardSummary(rows);
}

const freshnessWindowDays = (windowMs: number) => Math.round(windowMs / (24 * 60 * 60 * 1000));

async function buildSourceFreshness() {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [sources, runs] = await Promise.all([
    Source.find({}).select('name displayName enabled cadence coverage').lean(),
    ScrapeRun.find({ startedAt: { $gte: since } })
      .select(
        'sourceName status startedAt finishedAt observationCount entitiesObserved materializationErrors materializationConflicts invalidated options',
      )
      .sort({ startedAt: -1 })
      .lean(),
  ]);
  const rows = buildSourceHealthRows(sources as any[], runs as any[]);
  const riskCounts = rows.reduce(
    (acc, row) => {
      acc[row.risk] += 1;
      return acc;
    },
    { ok: 0, warn: 0, error: 0 },
  );

  return {
    windowDays: 30,
    riskCounts,
    latestRunSummary: summarizeDryRunPosture(runs),
    freshnessPolicies: workPlannerSourcePolicies.map((policy) => ({
      sourceName: policy.sourceName,
      entityType: policy.entityType,
      targetFields: policy.targetFields,
      windowDays: freshnessWindowDays(policy.freshnessWindowMs),
      cadence: policy.defaultRecurringCadence || 'manual',
      paid: Boolean(policy.paid),
      notes: policy.notes || '',
    })),
    readinessRows: rows.slice(0, 12).map((row) => ({
      sourceName: row.sourceName,
      displayName: row.displayName,
      status:
        row.risk === 'error'
          ? 'blocked'
          : row.latestRun
            ? row.risk === 'warn'
              ? 'needs_review'
              : 'ready'
            : 'needs_dry_run',
      nextAction: row.action,
      expectedArtifactTypes: row.expectedArtifactTypes,
      latestRun: row.latestRun,
    })),
    rows: rows.slice(0, 12),
  };
}

export async function buildAdminOperatorBoard() {
  const [
    sourceFreshness,
    researchTierCounts,
    programTierCounts,
    queueSummaries,
    releaseQueue,
    evidenceCoverage,
  ] =
    await Promise.all([
      buildSourceFreshness(),
      countByTier(ResearchEntity, { archived: { $ne: true } }),
      countByTier(Fellowship, { archived: false }),
      buildQueueSummaries(),
      buildReleaseQueueSummary(),
      buildEvidenceCoverageSummary(),
    ]);
  const integrityStatus: 'unknown' = 'unknown';
  const pendingMeiliSync = Boolean(sourceFreshness.latestRunSummary.latestWriteRun);
  const meiliStatus: PromotionStatus | 'unknown' = pendingMeiliSync ? 'watch' : 'unknown';
  const promotionStatus = derivePromotionStatus({
    sourceRiskCounts: sourceFreshness.riskCounts,
    integrityStatus,
    meiliStatus,
  });

  return {
    generatedAt: new Date().toISOString(),
    promotionStatus,
    recommendedNextActions: buildRecommendedNextActions({
      promotionStatus,
      sourceRiskCounts: sourceFreshness.riskCounts,
      pendingMeiliSync,
    }),
    gstackNextLane: buildGstackNextLane({
      sourceRiskCounts: sourceFreshness.riskCounts,
    }),
    trustTiers: {
      research: researchTierCounts,
      programs: programTierCounts,
    },
    releaseQueue,
    evidenceCoverage,
    ...queueSummaries,
    gates: {
      dataQuality: {
        status: 'manual',
        command: 'yarn --cwd server beta:data-quality --include-samples',
        note: 'Gate output is not persisted in this branch yet; run before promotion.',
      },
      scraperIntegrity: {
        status: integrityStatus,
        command: 'yarn --cwd server scraper:integrity-gate --include-samples',
        note: 'Gate output is not persisted in this branch yet; run before promotion.',
      },
      meili: {
        status: meiliStatus,
        pendingSync: pendingMeiliSync,
        note: pendingMeiliSync
          ? 'A recent non-dry scraper run exists; confirm Mongo changes were rebuilt into Meili before promotion.'
          : 'Meili index stats are not persisted in this branch yet.',
      },
    },
    sourceFreshness,
  };
}
