import { Fellowship } from '../models/fellowship';
import { ResearchEntity } from '../models/researchEntity';
import { ScrapeRun } from '../models/scrapeRun';
import { Source } from '../models/source';
import type { StudentVisibilityTier } from '../models/studentVisibility';
import { buildSourceHealthRows } from './sourceHealthService';

const tierOrder: StudentVisibilityTier[] = [
  'student_ready',
  'limited_but_safe',
  'operator_review',
  'suppressed',
];

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

const evidenceReasons = new Set([
  'application_route',
  'concrete_next_step',
  'official_source',
  'source_backed_description',
  'undergraduate_relevant',
]);

export type QueueKind = 'blocking' | 'evidence' | 'review';

export function classifyOperatorQueueReason(reason: string): QueueKind {
  if (evidenceReasons.has(reason)) return 'evidence';
  if (
    reason.startsWith('missing_') ||
    reason.endsWith('_only') ||
    reason === 'application_source_only' ||
    reason === 'archive_review' ||
    reason === 'content_page_risk' ||
    reason === 'duplicate_name_risk' ||
    reason === 'duplicate_risk' ||
    reason === 'inactive_at_yale' ||
    reason === 'missing_application_route' ||
    reason === 'missing_source_route' ||
    reason === 'not_undergraduate_relevant' ||
    reason === 'thin_description'
  ) {
    return 'blocking';
  }
  return 'review';
}

const tierAction: Record<StudentVisibilityTier, string> = {
  student_ready: 'Sample for false positives and copy quality before prominent browse.',
  limited_but_safe: 'Promote only after source-backed action/contact evidence is added.',
  operator_review: 'Repair the blocking reason or keep hidden from public browse.',
  suppressed: 'Keep hidden unless source evidence proves undergraduate relevance.',
};

interface AggregateCount {
  _id: string;
  count: number;
}

const normalizeCounts = (rows: AggregateCount[]) =>
  tierOrder.map((tier) => ({
    tier,
    count: rows.find((row) => row._id === tier)?.count || 0,
  }));

async function countByTier(model: any, match: Record<string, unknown>) {
  const rows = await model.aggregate([
    { $match: match },
    { $group: { _id: '$studentVisibilityTier', count: { $sum: 1 } } },
  ]);
  return normalizeCounts(rows);
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

async function sampleResearch(match: Record<string, unknown>, limit = 5) {
  return ResearchEntity.find({ archived: { $ne: true }, ...match })
    .select(
      'name slug studentVisibilityTier studentVisibilityReasons sourceUrls websiteUrl shortDescription',
    )
    .sort({ name: 1 })
    .limit(limit)
    .lean();
}

async function samplePrograms(match: Record<string, unknown>, limit = 5) {
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
      samples: (await sampleResearch({ studentVisibilityReasons: row.reason }, 3)).map(
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
      samples: (await samplePrograms({ studentVisibilityReasons: row.reason }, 3)).map(
        compactProgramSample,
      ),
    })),
  );

  const tierQueues = await Promise.all(
    tierOrder.map(async (tier) => ({
      tier,
      nextAction: tierAction[tier],
      researchSamples: (await sampleResearch({ studentVisibilityTier: tier }, 2)).map(
        compactResearchSample,
      ),
      programSamples: (await samplePrograms({ studentVisibilityTier: tier }, 2)).map(
        compactProgramSample,
      ),
    })),
  );

  return {
    reasonCounts: {
      research: researchReasons,
      programs: programReasons,
    },
    queues: [...researchQueues, ...programQueues],
    tierQueues,
  };
}

async function buildSourceFreshness() {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [sources, runs, latestIntegrityRuns] = await Promise.all([
    Source.find({}).select('name displayName enabled cadence coverage').lean(),
    ScrapeRun.find({ startedAt: { $gte: since } })
      .select(
        'sourceName status startedAt finishedAt observationCount materializationErrors materializationConflicts invalidated options',
      )
      .sort({ startedAt: -1 })
      .lean(),
    ScrapeRun.find({ postMaterializationIntegrity: { $exists: true } })
      .select('sourceName status startedAt finishedAt postMaterializationIntegrity')
      .sort({ startedAt: -1 })
      .limit(5)
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
    rows: rows.slice(0, 12),
    latestIntegrityRuns: latestIntegrityRuns.map((run: any) => ({
      id: String(run._id),
      sourceName: run.sourceName,
      status: run.status,
      startedAt: run.startedAt?.toISOString?.() || run.startedAt,
      finishedAt: run.finishedAt?.toISOString?.() || run.finishedAt,
      integrityStatus: run.postMaterializationIntegrity?.status,
      failureNames: run.postMaterializationIntegrity?.failureNames || [],
    })),
  };
}

export async function buildAdminOperatorBoard() {
  const [researchTierCounts, programTierCounts, queueSummaries, sourceFreshness] =
    await Promise.all([
      countByTier(ResearchEntity, { archived: { $ne: true } }),
      countByTier(Fellowship, { archived: false }),
      buildQueueSummaries(),
      buildSourceFreshness(),
    ]);

  return {
    generatedAt: new Date().toISOString(),
    trustTiers: {
      research: researchTierCounts,
      programs: programTierCounts,
    },
    ...queueSummaries,
    gates: {
      dataQuality: {
        status: 'manual',
        command: 'yarn --cwd server beta:data-quality --include-samples',
        note: 'CLI gate output is not persisted yet; run before promotion and compare with this board.',
      },
      scraperIntegrity: {
        status:
          sourceFreshness.latestIntegrityRuns[0]?.integrityStatus ||
          (sourceFreshness.riskCounts.error > 0 ? 'error' : 'watch'),
        command: 'yarn --cwd server scraper:integrity-gate --include-samples',
        latestRuns: sourceFreshness.latestIntegrityRuns,
      },
    },
    sourceFreshness,
  };
}
