import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from '../../utils/axios';

type Tier = 'student_ready' | 'limited_but_safe' | 'operator_review' | 'suppressed';
type Risk = 'ok' | 'warn' | 'error';
type QueueKind = 'blocking' | 'evidence' | 'review';
type RepairStage =
  | 'source_description'
  | 'pi_identity'
  | 'action_evidence'
  | 'suppression'
  | 'review_exception';

interface TierCount {
  tier: Tier;
  count: number;
}

interface QueueSample {
  id: string;
  label: string;
  tier: Tier;
  reasons: string[];
  sourceUrl?: string;
  category?: string;
  summary?: string;
}

interface ReasonCount {
  reason: string;
  count: number;
  kind?: QueueKind;
}

interface QueueSummary {
  collection: 'research' | 'programs';
  reason: string;
  kind?: QueueKind;
  count: number;
  nextAction: string;
  samples: QueueSample[];
}

interface SourceHealthRow {
  sourceName: string;
  displayName: string;
  risk: Risk;
  action: string;
  latestRun?: {
    status: string;
    startedAt?: string;
    materializationErrors: number;
    materializationConflicts: number;
  };
}

interface SourceHealthReviewArtifactRollup {
  fieldCounts: Array<{
    field: string;
    count: number;
  }>;
  policyBucketCounts: Array<{
    policyBucket: string;
    count: number;
  }>;
}

interface SourceHealthReviewDecisionValidationStatus {
  total: number;
  available: number;
  missing: number;
  invalidDecisionCount?: number;
  unreviewedPlanCount?: number;
  missingCommands?: Array<{
    sourceName: string;
    command: string;
  }>;
}

interface SourceHealthAcceptedDecisionTemplate {
  outputPath?: string;
}

interface SourceHealthAcceptedDecisionValidation {
  outputPath?: string;
  artifactAvailable?: boolean;
  totalDecisions?: number;
  validDecisionCount?: number;
  invalidDecisionCount?: number;
  unreviewedPlanCount?: number;
}

interface SourceHealthObservationReviewHandoff {
  acceptedDecisionTemplate?: SourceHealthAcceptedDecisionTemplate;
  acceptedDecisionValidation?: SourceHealthAcceptedDecisionValidation;
}

interface DataQualityDuplicateNamePreflight {
  sharedWebsiteClusterCount?: number;
  sharedWebsiteArtifactPath?: string;
  requiredReviewerDecisions: string[];
  manualReviewCategories: Array<{
    category: string;
    clusterCount: number;
  }>;
  acceptedDecisionTemplate?: {
    outputPath?: string;
    command?: string;
  };
  acceptedDecisionValidation?: {
    inputPath?: string;
    outputPath?: string;
    expectedArtifactField?: string;
    command?: string;
    artifactAvailable?: boolean;
    totalDecisions?: number;
    validDecisionCount?: number;
    invalidDecisionCount?: number;
    unreviewedPlanCount?: number;
  };
}

interface DataQualitySamePiDedupeReview {
  applyBlocked: boolean;
  applyBlockedReason?: string;
  applyStatus?: string;
  artifactAvailable: boolean;
  reviewArtifactPath?: string;
  acceptedDecisionInputPath?: string;
  decisionTemplateOutputPath?: string;
  acceptedDecisionValidationOutputPath?: string;
  command?: string;
  plannedGroups?: number;
  plannedDuplicateEntities?: number;
  reviewBreakdown?: {
    totalGroups?: number;
    reviewedProfileAreaGroups?: number;
    fundingSourceGroups?: number;
    crossDepartmentGroups?: number;
    groupsWithMergedResearchAreas?: number;
    highResearchAreaMergeGroups?: number;
  };
  acceptedDecisionValidation: {
    artifactAvailable: boolean;
    totalDecisions?: number;
    validDecisionCount?: number;
    invalidDecisionCount?: number;
    unreviewedPlanCount?: number;
  };
  nextAction?: string;
}

interface DataQualitySuspiciousUserEmailCopy {
  count: number;
  lane?: string;
  sampledExcludedByDefault: number;
  sampledNeedsReviewBeforeCopy: number;
  sampledCoverageComplete: boolean;
  nextAction?: string;
}

interface LaunchReviewExceptionDecisionValidation {
  artifactAvailable: boolean;
  reviewExceptionCount?: number;
  plannedCount?: number;
  planTruncated?: boolean;
  totalDecisions?: number;
  validDecisionCount?: number;
  invalidDecisionCount?: number;
  unreviewedPlanCount?: number;
  artifactAgeHours?: number;
  note?: string;
}

interface ReleaseQueueSummary {
  openCount: number;
  statusCounts: Record<string, number>;
  topBlockers: Array<{ reason: string; count: number }>;
  sourcePressure: Array<{ sourceName: string; count: number }>;
  samples: Array<{
    id: string;
    collection: 'research' | 'programs';
    recordId: string;
    label: string;
    blockerReasons: string[];
    evidenceSignals: string[];
    sourceNames: string[];
    nextRepairAction: string;
  }>;
}

interface RepairQueueSummary {
  openCount: number;
  statusCounts: Record<string, number>;
  byStage: Array<{
    stage: RepairStage;
    status: string;
    count: number;
    nextAction: string;
  }>;
  samples: Array<{
    id: string;
    collection: 'research' | 'programs';
    recordId: string;
    label: string;
    repairStage: RepairStage;
    repairStatus: string;
    safeToAttempt: boolean;
    blockerReasons: string[];
    sourceNames: string[];
    nextRepairAction: string;
    attemptCount: number;
    lastAttemptAt?: string;
    appliedPatchSummary: string[];
    remainingBlockers: string[];
  }>;
}

interface OperatorBoard {
  generatedAt: string;
  recommendedNextActions?: string[];
  trustTiers: {
    research: TierCount[];
    programs: TierCount[];
  };
  reasonCounts: {
    research: ReasonCount[];
    programs: ReasonCount[];
  };
  queues: QueueSummary[];
  releaseQueue?: ReleaseQueueSummary;
  repairQueue?: RepairQueueSummary;
  gates: {
    repairQueue?: {
      status: string;
      command: string;
      note: string;
      openCount?: number;
      scanned?: number;
      repairableCount?: number;
	      blockedCount?: number;
	      blockedReasonCounts?: Array<{ reason: string; count: number }>;
	      options?: Record<string, string | number | boolean | undefined>;
	      patchSummaryCounts?: Array<{ summary: string; count: number }>;
	      repairSourceHosts?: Array<{ host: string; count: number }>;
	      artifactAgeHours?: number;
	    };
    dataQuality: {
      status: string;
      command: string;
      note: string;
      artifactAgeHours?: number;
      recommendedCommands?: string[];
      hardErrors?: Array<{
        name: string;
        count: number;
        owner?: string;
        nextCommand?: string;
      }>;
      blockersByOwner?: Array<{
        owner: string;
        count: number;
        blockerNames: string[];
      }>;
      duplicateNamePreflight?: DataQualityDuplicateNamePreflight;
      samePiDedupeReview?: DataQualitySamePiDedupeReview;
      suspiciousUserEmailCopy?: DataQualitySuspiciousUserEmailCopy;
    };
    scraperIntegrity: {
      status: string;
      command: string;
      note?: string;
      warningCount?: number;
      artifactAgeHours?: number;
      failureNames?: string[];
      recommendedCommands?: string[];
      latestRuns: Array<{
        sourceName: string;
        status: string;
        integrityStatus?: string;
        startedAt?: string;
        failureNames?: string[];
      }>;
    };
    launchTrust?: {
      status: string;
      command: string;
      note: string;
      heldCount?: number;
      publicVisibilityViolations?: number;
      repairLaneCount?: number;
      repairLaneCommands?: string[];
      reviewExceptionDecisionValidation?: LaunchReviewExceptionDecisionValidation;
      artifactAgeHours?: number;
    };
    launchAcquisition?: {
      status: string;
      command: string;
      note: string;
      scanned?: number;
      piBlockers?: number;
      actionBlockers?: number;
      exactPiMatches?: number;
      sourceBackedRouteCandidates?: number;
      missingOfficialProfileUrl?: number;
      ambiguousOrMismatchedUserMatch?: number;
      sourceObservationsWithoutUndergradAccess?: number;
      untrustedExternalRouteEvidence?: number;
      artifactAgeHours?: number;
    };
    productionCopy?: {
      status: string;
      command: string;
      note: string;
      applyBlockerCount?: number;
      excludedSyntheticUsers?: number;
      collectionCategoryCount?: number;
      artifactAgeHours?: number;
    };
  };
  sourceFreshness: {
    windowDays: number;
    riskCounts: Record<Risk, number>;
    reviewSummary?: {
      warningRows: number;
      materializationConflictRows: number;
      reportArtifacts: {
        available: number;
        missing: number;
        withConflictReview: number;
      };
      activeObservationConflictCount: number;
      actionableConflictCount: number;
      sameSourceConflictCount?: number;
      crossSourceConflictCount?: number;
      priorityReviewConflictCount?: number;
      contextReviewConflictCount?: number;
      metadataReviewConflictCount?: number;
      categoryCounts: Array<{
        category: string;
        count: number;
      }>;
      reviewQueues?: Array<{
        queue: string;
        label: string;
        count: number;
        categories: Array<{
          category: string;
          count: number;
        }>;
      }>;
      reviewArtifactRollups?: {
        staleObservationReview: SourceHealthReviewArtifactRollup;
        crossSourceObservationReview: SourceHealthReviewArtifactRollup;
      };
      reviewDecisionValidationStatus?: {
        staleObservationReview: SourceHealthReviewDecisionValidationStatus;
        crossSourceObservationReview: SourceHealthReviewDecisionValidationStatus;
      };
      rows?: Array<{
        sourceName: string;
        staleObservationReview?: SourceHealthObservationReviewHandoff;
        crossSourceObservationReview?: SourceHealthObservationReviewHandoff;
      }>;
    };
    rows: SourceHealthRow[];
  };
  artifactFreshness?: GateArtifactFreshness[];
}

interface GateArtifactFreshness {
  gate: string;
  path: string;
  exists: boolean;
  status: 'fresh' | 'stale' | 'missing' | 'unreadable';
  generatedAt?: string;
  ageMinutes?: number;
  db?: string;
  environment?: string;
  maxAgeHours: number;
}

const GATE_LABELS: Record<string, string> = {
  dataQuality: 'Data quality',
  scraperIntegrity: 'Scraper integrity',
  launchTrust: 'Launch trust',
  launchReviewExceptions: 'Review exceptions',
  launchAcquisition: 'Acquisition',
  betaRepairQueue: 'Repair queue',
  productionCopy: 'Production copy',
};

const formatAge = (ageMinutes?: number): string => {
  if (ageMinutes === undefined) return 'unknown age';
  if (ageMinutes < 1) return 'just now';
  if (ageMinutes < 60) return `${ageMinutes} min ago`;
  const hours = Math.floor(ageMinutes / 60);
  if (hours < 24) return `${hours}h ${ageMinutes % 60}m ago`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h ago`;
};

const ArtifactFreshnessStrip = ({ items }: { items: GateArtifactFreshness[] }) => {
  if (!items.length) return null;
  const anyStale = items.some((i) => i.status === 'stale' || i.status === 'missing' || i.status === 'unreadable');
  return (
    <div
      className={`mt-3 rounded-md border px-3 py-2 ${
        anyStale ? 'border-red-200 bg-red-50' : 'border-green-200 bg-green-50'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-600">
          Gate data freshness
        </span>
        {anyStale && (
          <span className="text-xs font-semibold text-red-700">
            Stale/missing inputs — rerun gates:refresh before trusting verdicts
          </span>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {items.map((item) => {
          const fresh = item.status === 'fresh';
          const tone = fresh
            ? 'border-green-200 bg-white text-green-800'
            : 'border-red-300 bg-white text-red-800';
          const detail =
            item.status === 'fresh'
              ? `${item.db || 'db?'} · ${formatAge(item.ageMinutes)}`
              : item.status === 'stale'
                ? `STALE · ${formatAge(item.ageMinutes)} (>${item.maxAgeHours}h)`
                : item.status === 'missing'
                  ? 'MISSING'
                  : 'UNREADABLE';
          return (
            <span
              key={item.gate}
              title={`${item.path}${item.generatedAt ? ` · generated ${item.generatedAt}` : ''}`}
              className={`rounded border px-2 py-1 text-xs ${tone}`}
            >
              <span className="font-semibold">{GATE_LABELS[item.gate] || item.gate}</span>{' '}
              <span className="opacity-80">{detail}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
};

const tierLabel: Record<Tier, string> = {
  student_ready: 'Ready',
  limited_but_safe: 'Limited',
  operator_review: 'Review',
  suppressed: 'Suppressed',
};

const riskStyles: Record<Risk, string> = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  warn: 'border-amber-200 bg-amber-50 text-amber-800',
  error: 'border-red-200 bg-red-50 text-red-800',
};

const evidenceReasons = new Set([
  'application_route',
  'concrete_next_step',
  'official_source',
  'source_backed_description',
  'undergraduate_relevant',
]);

const reviewDecisionReasons = new Set([
  'application_source_only',
  'archive_review',
  'duplicate_name_risk',
  'duplicate_risk',
  'exact_url_duplicate_risk',
  'formalization_only',
  'not_undergraduate_relevant',
]);

const classifyReason = (reason: string): QueueKind => {
  if (evidenceReasons.has(reason)) return 'evidence';
  if (reviewDecisionReasons.has(reason)) return 'review';
  if (
    reason.startsWith('missing_') ||
    [
      'content_page_risk',
      'inactive_at_yale',
      'pi_identity_conflict',
      'profile_fallback_only',
      'thin_description',
    ].includes(reason)
  ) {
    return 'blocking';
  }
  return 'review';
};

const uniqueReasons = (reasons: string[]) => [
  ...new Set(reasons.map((reason) => reason.trim()).filter(Boolean)),
];

const splitReasons = (reasons: string[], primaryReason: string) => {
  const normalizedPrimaryReason = primaryReason.trim().toLowerCase();
  const sampleReasons = uniqueReasons(reasons).filter(
    (reason) => reason.toLowerCase() !== normalizedPrimaryReason,
  );

  return {
    blockers: sampleReasons.filter((reason) => classifyReason(reason) === 'blocking'),
    signals: sampleReasons.filter((reason) => classifyReason(reason) === 'evidence'),
  };
};

const formatDate = (value?: string) => {
  if (!value) return 'No run';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString();
};

const sourceReviewCategoryText = (board: OperatorBoard) =>
  board.sourceFreshness.reviewSummary?.categoryCounts
    ?.slice(0, 2)
    .map((item) => `${item.category} ${item.count}`)
    .join(' · ');

const sourceReviewLaneCopy: Record<string, { label: string; description: string }> = {
  priority_review: {
    label: 'Priority review',
    description: 'Identity, access, or student-facing content',
  },
  context_review: {
    label: 'Context review',
    description: 'Funding or uncategorized context',
  },
  metadata_review: {
    label: 'Metadata review',
    description: 'Additive metadata merge review',
  },
};

const sourceReviewLanes = (board: OperatorBoard) => {
  const summary = board.sourceFreshness.reviewSummary;
  if (!summary) return [];
  const queueCounts = {
    priority_review: summary.priorityReviewConflictCount,
    context_review: summary.contextReviewConflictCount,
    metadata_review: summary.metadataReviewConflictCount,
  };
  const queues = summary.reviewQueues?.length
    ? summary.reviewQueues.map((queue) => ({
        queue: queue.queue,
        label: sourceReviewLaneCopy[queue.queue]?.label || queue.label,
        description: sourceReviewLaneCopy[queue.queue]?.description || 'Review source conflicts',
        count: queue.count,
        categories: queue.categories || [],
      }))
    : [
        {
          queue: 'priority_review',
          label: sourceReviewLaneCopy.priority_review.label,
          description: sourceReviewLaneCopy.priority_review.description,
          count: queueCounts.priority_review,
          categories: [],
        },
        {
          queue: 'context_review',
          label: sourceReviewLaneCopy.context_review.label,
          description: sourceReviewLaneCopy.context_review.description,
          count: queueCounts.context_review,
          categories: [],
        },
        {
          queue: 'metadata_review',
          label: sourceReviewLaneCopy.metadata_review.label,
          description: sourceReviewLaneCopy.metadata_review.description,
          count: queueCounts.metadata_review,
          categories: [],
        },
      ];

  return queues
    .filter(
      (queue): queue is {
        queue: string;
        label: string;
        description: string;
        count: number;
        categories: Array<{ category: string; count: number }>;
      } => typeof queue.count === 'number',
    );
};

const sourceConflictScopeText = (board: OperatorBoard) => {
  const summary = board.sourceFreshness.reviewSummary;
  if (
    typeof summary?.sameSourceConflictCount !== 'number' ||
    typeof summary.crossSourceConflictCount !== 'number'
  ) {
    return '';
  }
  return `Conflict scope: ${summary.sameSourceConflictCount} single-source · ${summary.crossSourceConflictCount} cross-source`;
};

const formatCountList = <T extends Record<K, string> & { count: number }, K extends keyof T>(
  items: T[] | undefined,
  key: K,
) =>
  items
    ?.slice(0, 2)
    .map((item) => `${item[key]} ${item.count}`)
    .join(' · ') || '';

const sourceReviewArtifactRollupLines = (board: OperatorBoard) => {
  const rollups = board.sourceFreshness.reviewSummary?.reviewArtifactRollups;
  if (!rollups) return [];
  return [
    {
      label: 'Stale fields',
      value: formatCountList(rollups.staleObservationReview.fieldCounts, 'field'),
    },
    {
      label: 'Stale policies',
      value: formatCountList(
        rollups.staleObservationReview.policyBucketCounts,
        'policyBucket',
      ),
    },
    {
      label: 'Cross-source fields',
      value: formatCountList(rollups.crossSourceObservationReview.fieldCounts, 'field'),
    },
    {
      label: 'Cross-source policies',
      value: formatCountList(
        rollups.crossSourceObservationReview.policyBucketCounts,
        'policyBucket',
      ),
    },
  ]
    .filter((line) => line.value)
    .map((line) => `${line.label}: ${line.value}`);
};

const sourceReviewDecisionValidationLines = (board: OperatorBoard) => {
  const status = board.sourceFreshness.reviewSummary?.reviewDecisionValidationStatus;
  if (!status) return [];
  return [
    sourceReviewDecisionValidationLine('Stale validation', status.staleObservationReview),
    sourceReviewDecisionValidationLine(
      'Cross-source validation',
      status.crossSourceObservationReview,
    ),
  ].filter((line): line is string => Boolean(line));
};

const sourceReviewDecisionValidationLine = (
  label: string,
  status?: SourceHealthReviewDecisionValidationStatus,
) => {
  if (!status || status.total <= 0) return undefined;
  return (
    `${label}: ${status.available}/${status.total} loaded` +
    ` · ${status.missing} missing` +
    ` · ${status.invalidDecisionCount || 0} invalid` +
    ` · ${status.unreviewedPlanCount || 0} unreviewed`
  );
};

const sourceReviewDecisionValidationProbeCommands = (board: OperatorBoard) => {
  const status = board.sourceFreshness.reviewSummary?.reviewDecisionValidationStatus;
  if (!status) return [];
  return [
    sourceReviewDecisionValidationProbeCommand(
      'stale',
      status.staleObservationReview,
    ),
    sourceReviewDecisionValidationProbeCommand(
      'cross-source',
      status.crossSourceObservationReview,
    ),
  ].filter(
    (
      item,
    ): item is {
      label: string;
      sourceName: string;
      command: string;
    } => Boolean(item),
  );
};

const sourceReviewDecisionValidationProbeCommand = (
  label: string,
  status?: SourceHealthReviewDecisionValidationStatus,
) => {
  const command = status?.missingCommands?.[0];
  if (!command) return undefined;
  return {
    label: `Next ${label} validation probe`,
    sourceName: command.sourceName,
    command: command.command,
  };
};

const sourceReviewDecisionHandoffs = (board: OperatorBoard) => {
  const rows = board.sourceFreshness.reviewSummary?.rows || [];
  const stale = rows.find(
    (row) =>
      row.staleObservationReview?.acceptedDecisionTemplate?.outputPath ||
      row.staleObservationReview?.acceptedDecisionValidation?.outputPath,
  );
  const crossSource = rows.find(
    (row) =>
      row.crossSourceObservationReview?.acceptedDecisionTemplate?.outputPath ||
      row.crossSourceObservationReview?.acceptedDecisionValidation?.outputPath,
  );

  return [
    stale
      ? {
          label: 'Stale decision handoff',
          sourceName: stale.sourceName,
          templatePath: stale.staleObservationReview?.acceptedDecisionTemplate?.outputPath,
          validationPath: stale.staleObservationReview?.acceptedDecisionValidation?.outputPath,
          validationStatus: sourceDecisionValidationStatusText(
            stale.staleObservationReview?.acceptedDecisionValidation,
          ),
        }
      : undefined,
    crossSource
      ? {
          label: 'Cross-source decision handoff',
          sourceName: crossSource.sourceName,
          templatePath:
            crossSource.crossSourceObservationReview?.acceptedDecisionTemplate?.outputPath,
          validationPath:
            crossSource.crossSourceObservationReview?.acceptedDecisionValidation?.outputPath,
          validationStatus: sourceDecisionValidationStatusText(
            crossSource.crossSourceObservationReview?.acceptedDecisionValidation,
          ),
        }
      : undefined,
  ].filter(
    (
      item,
    ): item is {
      label: string;
      sourceName: string;
      templatePath?: string;
      validationPath?: string;
      validationStatus?: string;
    } => Boolean(item),
  );
};

const sourceDecisionValidationStatusText = (
  validation?: SourceHealthAcceptedDecisionValidation,
) => {
  if (validation?.artifactAvailable === undefined) return undefined;
  if (!validation.artifactAvailable) return 'Validation artifact: missing';

  const counts = [
    typeof validation.validDecisionCount === 'number'
      ? `${validation.validDecisionCount} valid`
      : undefined,
    typeof validation.invalidDecisionCount === 'number'
      ? `${validation.invalidDecisionCount} invalid`
      : undefined,
    typeof validation.unreviewedPlanCount === 'number'
      ? `${validation.unreviewedPlanCount} unreviewed`
      : undefined,
  ].filter(Boolean);
  return ['Validation artifact: loaded', ...counts].join(' · ');
};

const total = (rows: TierCount[]) => rows.reduce((sum, row) => sum + row.count, 0);

const queueKindStyles: Record<QueueKind, string> = {
  blocking: 'border-red-200 bg-red-50 text-red-700',
  evidence: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  review: 'border-[var(--yr-line)] bg-[var(--yr-panel-muted)] text-gray-700',
};

const queueKindRank: Record<QueueKind, number> = {
  blocking: 0,
  review: 1,
  evidence: 2,
};

const decisionLaneCopy: Record<QueueKind, { title: string; eyebrow: string; description: string }> = {
  blocking: {
    title: 'Must Fix Before Promotion',
    eyebrow: 'Repair queue',
    description: 'Rows that need source-backed facts before they can safely move up.',
  },
  review: {
    title: 'Operator Decision Needed',
    eyebrow: 'Review signal',
    description: 'Rows that need an explicit keep, suppress, merge, or defer decision.',
  },
  evidence: {
    title: 'Promotion Evidence',
    eyebrow: 'Evidence signal',
    description: 'Positive signals operators can use when deciding whether a row is ready.',
  },
};

const queueDecisionPrompt = (reason: string): string => {
  switch (reason) {
    case 'missing_action_evidence':
      return 'Can this record show a source-backed next step?';
    case 'missing_lead':
    case 'pi_identity_conflict':
      return 'Can ownership or PI identity be verified?';
    case 'missing_description':
    case 'missing_card_description':
    case 'thin_description':
    case 'profile_fallback_only':
      return 'Can official source prose support student-facing copy?';
    case 'source_backed_description':
      return 'Is this ready to promote from evidence to student-facing copy?';
    case 'formalization_only':
    case 'application_source_only':
      return 'Should this stay capped, or is there evidence of a real entry route?';
    case 'archive_review':
    case 'not_undergraduate_relevant':
      return 'Should this remain hidden or be rewritten as a real undergraduate record?';
    case 'duplicate_risk':
    case 'exact_url_duplicate_risk':
      return 'Should this be merged, archived, or marked as a distinct research home?';
    default:
      return 'Review this signal and choose the next operator action.';
  }
};

const repairStageLabel: Record<RepairStage, string> = {
  source_description: 'Source & description',
  pi_identity: 'PI identity',
  action_evidence: 'Action evidence',
  suppression: 'Suppression',
  review_exception: 'Exception',
};

const GateStatus = ({ label, status }: { label: string; status: string }) => (
  <div className="mt-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
    {label} status: {status}
  </div>
);

const DataQualityOwnerBlockers = ({
  rows,
}: {
  rows?: Array<{ owner: string; count: number; blockerNames: string[] }>;
}) => {
  if (!rows?.length) return null;

  return (
    <div className="mt-3 space-y-2">
      {rows.slice(0, 4).map((row) => (
        <div key={row.owner} className="rounded-md border border-red-100 bg-red-50 px-2 py-1.5">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-red-800">{row.owner}</span>
            <span className="text-red-700">
              {row.count} {row.count === 1 ? 'blocker' : 'blockers'}
            </span>
          </div>
          {row.blockerNames.length > 0 && (
            <div className="mt-1 text-xs text-red-700">{row.blockerNames.join(', ')}</div>
          )}
        </div>
      ))}
    </div>
  );
};

const DataQualityDuplicateNamePreflightBlock = ({
  preflight,
}: {
  preflight?: DataQualityDuplicateNamePreflight;
}) => {
  if (!preflight) return null;

  const reviewerDecisions = preflight.requiredReviewerDecisions
    .slice(0, 3)
    .map((decision) => decision.trim())
    .filter(Boolean)
    .join(' ');
  const manualReviewText = preflight.manualReviewCategories
    .slice(0, 3)
    .map((item) => `${item.category} ${item.clusterCount}`)
    .join(' · ');

  return (
    <div className="mt-3 rounded-md border border-amber-100 bg-amber-50 px-2 py-1.5">
      <div className="text-xs font-semibold text-amber-900">Duplicate-name preflight</div>
      {typeof preflight.sharedWebsiteClusterCount === 'number' && (
        <div className="mt-1 text-xs text-amber-800">
          Shared-website clusters: {preflight.sharedWebsiteClusterCount}
        </div>
      )}
      {preflight.sharedWebsiteArtifactPath && (
        <code className="mt-1 block whitespace-pre-wrap text-[11px] text-amber-900">
          {preflight.sharedWebsiteArtifactPath}
        </code>
      )}
      {reviewerDecisions && (
        <div className="mt-1 text-xs text-amber-800">{reviewerDecisions}</div>
      )}
      {manualReviewText && (
        <div className="mt-1 text-xs text-amber-800">
          Manual review: {manualReviewText}
        </div>
      )}
      {preflight.acceptedDecisionTemplate?.outputPath && (
        <div className="mt-2">
          <div className="text-xs font-semibold text-amber-900">
            Duplicate-name decision template
          </div>
          <code className="mt-1 block whitespace-pre-wrap text-[11px] text-amber-900">
            {preflight.acceptedDecisionTemplate.outputPath}
          </code>
          {preflight.acceptedDecisionTemplate.command && (
            <code className="mt-1 block whitespace-pre-wrap text-[11px] text-amber-900">
              {preflight.acceptedDecisionTemplate.command}
            </code>
          )}
        </div>
      )}
      {preflight.acceptedDecisionValidation?.outputPath && (
        <div className="mt-2">
          <div className="text-xs font-semibold text-amber-900">
            Duplicate-name decision validation
          </div>
          <code className="mt-1 block whitespace-pre-wrap text-[11px] text-amber-900">
            {preflight.acceptedDecisionValidation.outputPath}
          </code>
          {preflight.acceptedDecisionValidation.command && (
            <code className="mt-1 block whitespace-pre-wrap text-[11px] text-amber-900">
              {preflight.acceptedDecisionValidation.command}
            </code>
          )}
          {typeof preflight.acceptedDecisionValidation.artifactAvailable === 'boolean' && (
            <div className="mt-1 text-xs text-amber-800">
              Duplicate-name validation:{' '}
              {preflight.acceptedDecisionValidation.artifactAvailable ? 'loaded' : 'missing'} ·{' '}
              {preflight.acceptedDecisionValidation.validDecisionCount ?? 0} valid ·{' '}
              {preflight.acceptedDecisionValidation.invalidDecisionCount ?? 0} invalid ·{' '}
              {preflight.acceptedDecisionValidation.unreviewedPlanCount ?? 0} unreviewed
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const DataQualitySamePiDedupeReviewBlock = ({
  review,
}: {
  review?: DataQualitySamePiDedupeReview;
}) => {
  if (!review) return null;

  const planParts = [
    typeof review.plannedGroups === 'number' ? `${review.plannedGroups} groups` : undefined,
    typeof review.plannedDuplicateEntities === 'number'
      ? `${review.plannedDuplicateEntities} duplicate entities`
      : undefined,
  ].filter(Boolean);
  const reviewFlags = [
    typeof review.reviewBreakdown?.crossDepartmentGroups === 'number'
      ? `${review.reviewBreakdown.crossDepartmentGroups} cross-department`
      : undefined,
    typeof review.reviewBreakdown?.highResearchAreaMergeGroups === 'number'
      ? `${review.reviewBreakdown.highResearchAreaMergeGroups} high research-area merges`
      : undefined,
    typeof review.reviewBreakdown?.fundingSourceGroups === 'number'
      ? `${review.reviewBreakdown.fundingSourceGroups} funding-source`
      : undefined,
  ].filter(Boolean);
  const validation = review.acceptedDecisionValidation;

  return (
    <div className="mt-3 rounded-md border border-amber-100 bg-amber-50 px-2 py-1.5">
      <div className="text-xs font-semibold text-amber-900">Same-PI dedupe review</div>
      {review.applyBlockedReason && (
        <div className="mt-1 text-xs text-amber-800">{review.applyBlockedReason}</div>
      )}
      {review.applyStatus && (
        <div className="mt-1 text-xs text-amber-800">{review.applyStatus}</div>
      )}
      {planParts.length > 0 && (
        <div className="mt-1 text-xs text-amber-800">
          Same-PI plans: {planParts.join(' · ')}
        </div>
      )}
      {reviewFlags.length > 0 && (
        <div className="mt-1 text-xs text-amber-800">
          Review flags: {reviewFlags.join(' · ')}
        </div>
      )}
      {review.reviewArtifactPath && (
        <code className="mt-1 block whitespace-pre-wrap text-[11px] text-amber-900">
          {review.reviewArtifactPath}
        </code>
      )}
      {review.decisionTemplateOutputPath && (
        <code className="mt-1 block whitespace-pre-wrap text-[11px] text-amber-900">
          {review.decisionTemplateOutputPath}
        </code>
      )}
      {review.command && (
        <code className="mt-1 block whitespace-pre-wrap text-[11px] text-amber-900">
          {review.command}
        </code>
      )}
      {typeof validation.artifactAvailable === 'boolean' && (
        <div className="mt-1 text-xs text-amber-800">
          Same-PI validation: {validation.artifactAvailable ? 'loaded' : 'missing'} ·{' '}
          {validation.validDecisionCount ?? 0} valid ·{' '}
          {validation.invalidDecisionCount ?? 0} invalid ·{' '}
          {validation.unreviewedPlanCount ?? 0} unreviewed
        </div>
      )}
      {review.nextAction && (
        <div className="mt-1 text-xs text-amber-800">{review.nextAction}</div>
      )}
    </div>
  );
};

const DataQualitySuspiciousUserEmailCopyBlock = ({
  copy,
}: {
  copy?: DataQualitySuspiciousUserEmailCopy;
}) => {
  if (!copy) return null;

  return (
    <div className="mt-3 rounded-md border border-amber-100 bg-amber-50 px-2 py-1.5">
      <div className="text-xs font-semibold text-amber-900">Synthetic-user copy posture</div>
      <div className="mt-1 text-xs text-amber-800">
        Suspicious users: {copy.count} · {copy.sampledExcludedByDefault} excluded by Lane A ·{' '}
        {copy.sampledNeedsReviewBeforeCopy} need review
      </div>
      <div className="mt-1 text-xs text-amber-800">
        Lane A sample coverage: {copy.sampledCoverageComplete ? 'complete' : 'needs review'}
      </div>
      {copy.nextAction && (
        <div className="mt-1 text-xs text-amber-800">{copy.nextAction}</div>
      )}
    </div>
  );
};

const DataQualityHardErrors = ({
  rows,
}: {
  rows?: Array<{ name: string; count: number; owner?: string; nextCommand?: string }>;
}) => {
  if (!rows?.length) return null;

  return (
    <div className="mt-3 space-y-2">
      {rows.slice(0, 4).map((row) => (
        <div key={row.name} className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-semibold text-red-900">{row.name}</span>
            <span className="text-red-700">
              {row.count} {row.count === 1 ? 'error' : 'errors'}
            </span>
          </div>
          {row.owner && <div className="mt-1 text-xs text-red-700">{row.owner}</div>}
          {row.nextCommand && (
            <code className="mt-1 block whitespace-pre-wrap text-[11px] text-red-800">
              {row.nextCommand}
            </code>
          )}
        </div>
      ))}
    </div>
  );
};

const ReasonList = ({
  label,
  reasons,
  tone,
}: {
  label: string;
  reasons: string[];
  tone: 'blocker' | 'signal';
}) => {
  if (reasons.length === 0) return null;

  const toneClass =
    tone === 'blocker'
      ? 'border-red-200 bg-red-50 text-red-700'
      : 'border-emerald-200 bg-emerald-50 text-emerald-700';

  return (
    <div className="mt-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1 flex flex-wrap gap-1">
        {reasons.map((reason) => (
          <span key={reason} className={`rounded-md border px-2 py-0.5 text-xs ${toneClass}`}>
            {reason}
          </span>
        ))}
      </div>
    </div>
  );
};

const AdminOperatorBoard = () => {
  const [board, setBoard] = useState<OperatorBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchBoard = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await axios.get<OperatorBoard>('/admin/operator-board', {
        withCredentials: true,
      });
      setBoard(response.data);
    } catch {
      console.error('Error fetching operator board.');
      setError('Failed to load operator board');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBoard();
  }, [fetchBoard]);

  const topQueues = useMemo(
    () =>
      [...(board?.queues || [])]
        .sort((a, b) => {
          const aKind = a.kind || classifyReason(a.reason);
          const bKind = b.kind || classifyReason(b.reason);
          return queueKindRank[aKind] - queueKindRank[bKind] || b.count - a.count;
        })
        .slice(0, 10),
    [board],
  );
  const decisionLanes = useMemo(
    () =>
      (['blocking', 'review', 'evidence'] as QueueKind[])
        .map((kind) => ({
          kind,
          queues: topQueues.filter((queue) => (queue.kind || classifyReason(queue.reason)) === kind),
        })),
    [topQueues],
  );
  const sourceLanes = useMemo(() => (board ? sourceReviewLanes(board) : []), [board]);

  if (loading) {
    return <div className="rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] p-6">Loading board...</div>;
  }

  if (error || !board) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 p-6 text-sm text-red-700">
        {error || 'Failed to load operator board.'}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-xl font-semibold text-gray-900">Data Quality Operator Board</h3>
          <p className="mt-1 text-sm text-gray-600">Updated {formatDate(board.generatedAt)}</p>
        </div>
        <button
          type="button"
          onClick={fetchBoard}
          className="min-h-10 rounded-md border border-[var(--yr-line-strong)] px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-[var(--yr-panel-muted)]"
        >
          Refresh
        </button>
      </div>

      {board.artifactFreshness && <ArtifactFreshnessStrip items={board.artifactFreshness} />}

      {Boolean(board.recommendedNextActions?.length) && (
        <section className="rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] p-4">
          <h4 className="font-semibold text-gray-900">Recommended Next Actions</h4>
          <ol className="mt-3 space-y-2 text-sm text-gray-700">
            {board.recommendedNextActions?.map((action, index) => (
              <li key={`${index}-${action}`} className="flex gap-2">
                <span className="min-w-5 font-semibold text-gray-900">{index + 1}.</span>
                <span>{action}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {[
          ['Research', board.trustTiers.research],
          ['Programs', board.trustTiers.programs],
        ].map(([label, rows]) => (
          <section key={label as string} className="rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] p-4">
            <div className="mb-3 flex items-center justify-between">
              <h4 className="font-semibold text-gray-900">{label as string}</h4>
              <span className="text-sm text-gray-500">{total(rows as TierCount[])} records</span>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(rows as TierCount[]).map((row) => (
                <div key={row.tier} className="rounded-md border border-[var(--yr-line)] p-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {tierLabel[row.tier]}
                  </div>
                  <div className="mt-1 text-2xl font-semibold text-gray-900">{row.count}</div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <section className="rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] p-4">
        <h4 className="mb-3 font-semibold text-gray-900">Gate Status</h4>
        <div className="grid gap-3 lg:grid-cols-4">
          {board.gates.repairQueue && (
            <div className="rounded-md border border-[var(--yr-line)] p-3">
              <div className="text-sm font-semibold text-gray-900">Automatic repair</div>
              <GateStatus label="Automatic repair" status={board.gates.repairQueue.status} />
              <code className="mt-2 block whitespace-pre-wrap text-xs text-gray-600">
                {board.gates.repairQueue.command}
              </code>
              <p className="mt-2 text-sm text-gray-600">{board.gates.repairQueue.note}</p>
              {typeof board.gates.repairQueue.openCount === 'number' && (
                <p className="mt-1 text-xs text-gray-600">
                  Open queue items: {board.gates.repairQueue.openCount}
                </p>
              )}
              {typeof board.gates.repairQueue.scanned === 'number' && (
                <p className="mt-1 text-xs text-gray-600">
                  Scanned: {board.gates.repairQueue.scanned}
                </p>
              )}
              {typeof board.gates.repairQueue.repairableCount === 'number' && (
                <p className="mt-1 text-xs text-emerald-700">
                  Repairable: {board.gates.repairQueue.repairableCount}
                </p>
              )}
              {typeof board.gates.repairQueue.blockedCount === 'number' && (
                <p className="mt-1 text-xs text-amber-700">
                  Blocked: {board.gates.repairQueue.blockedCount}
                </p>
              )}
              {board.gates.repairQueue.blockedReasonCounts?.length ? (
                <p className="mt-1 text-xs text-amber-700">
                  Blocked reasons:{' '}
                  {formatCountList(board.gates.repairQueue.blockedReasonCounts, 'reason')}
                </p>
              ) : null}
              {board.gates.repairQueue.options && (
                <p className="mt-1 text-xs text-gray-600">
                  Artifact options:{' '}
                  {[
                    board.gates.repairQueue.options.collection,
                    board.gates.repairQueue.options.stage,
                    board.gates.repairQueue.options.limit
                      ? `limit ${board.gates.repairQueue.options.limit}`
                      : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              )}
              {board.gates.repairQueue.patchSummaryCounts?.length ? (
                <p className="mt-1 text-xs text-emerald-700">
                  Repair summaries:{' '}
                  {formatCountList(board.gates.repairQueue.patchSummaryCounts, 'summary')}
                </p>
              ) : null}
              {board.gates.repairQueue.repairSourceHosts?.length ? (
                <p className="mt-1 text-xs text-gray-600">
                  Source hosts:{' '}
                  {formatCountList(board.gates.repairQueue.repairSourceHosts, 'host')}
                </p>
              ) : null}
              {typeof board.gates.repairQueue.artifactAgeHours === 'number' && (
                <p className="mt-1 text-xs text-amber-700">
                  Artifact age: {board.gates.repairQueue.artifactAgeHours} hours
                </p>
              )}
            </div>
          )}
          <div className="rounded-md border border-[var(--yr-line)] p-3">
            <div className="text-sm font-semibold text-gray-900">Data quality</div>
            <GateStatus label="Data quality" status={board.gates.dataQuality.status} />
            <code className="mt-2 block whitespace-pre-wrap text-xs text-gray-600">
              {board.gates.dataQuality.command}
            </code>
            <p className="mt-2 text-sm text-gray-600">{board.gates.dataQuality.note}</p>
            {typeof board.gates.dataQuality.artifactAgeHours === 'number' && (
              <p className="mt-1 text-xs text-amber-700">
                Artifact age: {board.gates.dataQuality.artifactAgeHours} hours
              </p>
            )}
            {Boolean(board.gates.dataQuality.recommendedCommands?.length) && (
              <div className="mt-3 rounded-md border border-amber-100 bg-amber-50 px-2 py-1.5">
                <div className="text-xs font-semibold text-amber-900">
                  Data quality recommendation
                </div>
                <code className="mt-1 block whitespace-pre-wrap text-[11px] text-amber-900">
                  {board.gates.dataQuality.recommendedCommands?.[0]}
                </code>
              </div>
            )}
            <DataQualityHardErrors rows={board.gates.dataQuality.hardErrors} />
            <DataQualityOwnerBlockers rows={board.gates.dataQuality.blockersByOwner} />
            <DataQualityDuplicateNamePreflightBlock
              preflight={board.gates.dataQuality.duplicateNamePreflight}
            />
            <DataQualitySamePiDedupeReviewBlock
              review={board.gates.dataQuality.samePiDedupeReview}
            />
            <DataQualitySuspiciousUserEmailCopyBlock
              copy={board.gates.dataQuality.suspiciousUserEmailCopy}
            />
          </div>
          <div className="rounded-md border border-[var(--yr-line)] p-3">
            <div className="text-sm font-semibold text-gray-900">Scraper integrity</div>
            <GateStatus label="Scraper integrity" status={board.gates.scraperIntegrity.status} />
            <code className="mt-2 block whitespace-pre-wrap text-xs text-gray-600">
              {board.gates.scraperIntegrity.command}
            </code>
            <p className="mt-2 text-sm text-gray-600">
              {board.gates.scraperIntegrity.note ||
                `Latest persisted integrity status: ${board.gates.scraperIntegrity.status}`}
            </p>
            {typeof board.gates.scraperIntegrity.warningCount === 'number' && (
              <p className="mt-1 text-xs text-amber-700">
                Warnings: {board.gates.scraperIntegrity.warningCount}
              </p>
            )}
            {typeof board.gates.scraperIntegrity.artifactAgeHours === 'number' && (
              <p className="mt-1 text-xs text-amber-700">
                Artifact age: {board.gates.scraperIntegrity.artifactAgeHours} hours
              </p>
            )}
            {Boolean(board.gates.scraperIntegrity.failureNames?.length) && (
              <p className="mt-1 text-xs text-red-700">
                Failures: {board.gates.scraperIntegrity.failureNames?.join(', ')}
              </p>
            )}
            {Boolean(board.gates.scraperIntegrity.recommendedCommands?.length) && (
              <div className="mt-3 rounded-md border border-amber-100 bg-amber-50 px-2 py-1.5">
                <div className="text-xs font-semibold text-amber-900">
                  Scraper integrity recommendation
                </div>
                <code className="mt-1 block whitespace-pre-wrap text-[11px] text-amber-900">
                  {board.gates.scraperIntegrity.recommendedCommands?.[0]}
                </code>
              </div>
            )}
          </div>
          {board.gates.launchTrust && (
            <div className="rounded-md border border-[var(--yr-line)] p-3">
              <div className="text-sm font-semibold text-gray-900">Launch trust</div>
              <GateStatus label="Launch trust" status={board.gates.launchTrust.status} />
              <code className="mt-2 block whitespace-pre-wrap text-xs text-gray-600">
                {board.gates.launchTrust.command}
              </code>
              <p className="mt-2 text-sm text-gray-600">{board.gates.launchTrust.note}</p>
              {typeof board.gates.launchTrust.heldCount === 'number' && (
                <p className="mt-1 text-xs text-amber-700">
                  Held rows: {board.gates.launchTrust.heldCount}
                </p>
              )}
              {typeof board.gates.launchTrust.publicVisibilityViolations === 'number' && (
                <p className="mt-1 text-xs text-red-700">
                  Public violations: {board.gates.launchTrust.publicVisibilityViolations}
                </p>
              )}
              {typeof board.gates.launchTrust.repairLaneCount === 'number' && (
                <p className="mt-1 text-xs text-gray-600">
                  Repair lanes: {board.gates.launchTrust.repairLaneCount}
                </p>
              )}
              {Boolean(board.gates.launchTrust.repairLaneCommands?.length) && (
                <div className="mt-3 rounded-md border border-amber-100 bg-amber-50 px-2 py-1.5">
                  <div className="text-xs font-semibold text-amber-900">
                    Launch trust recommendation
                  </div>
                  <code className="mt-1 block whitespace-pre-wrap text-[11px] text-amber-900">
                    {board.gates.launchTrust.repairLaneCommands?.[0]}
                  </code>
                </div>
              )}
              {board.gates.launchTrust.reviewExceptionDecisionValidation && (
                <div className="mt-3 rounded-md border border-amber-100 bg-amber-50 px-2 py-1.5">
                  <div className="text-xs font-semibold text-amber-900">
                    Launch review exceptions
                  </div>
                  {typeof board.gates.launchTrust.reviewExceptionDecisionValidation
                    .reviewExceptionCount === 'number' && (
                    <p className="mt-1 text-xs text-amber-900">
                      Review exceptions:{' '}
                      {
                        board.gates.launchTrust.reviewExceptionDecisionValidation
                          .reviewExceptionCount
                      }
                    </p>
                  )}
                  {typeof board.gates.launchTrust.reviewExceptionDecisionValidation
                    .unreviewedPlanCount === 'number' && (
                    <p className="text-xs text-amber-900">
                      Unreviewed decisions:{' '}
                      {
                        board.gates.launchTrust.reviewExceptionDecisionValidation
                          .unreviewedPlanCount
                      }
                    </p>
                  )}
                  {typeof board.gates.launchTrust.reviewExceptionDecisionValidation
                    .validDecisionCount === 'number' && (
                    <p className="text-xs text-amber-900">
                      Valid decisions:{' '}
                      {board.gates.launchTrust.reviewExceptionDecisionValidation.validDecisionCount}
                    </p>
                  )}
                  {typeof board.gates.launchTrust.reviewExceptionDecisionValidation
                    .invalidDecisionCount === 'number' && (
                    <p className="text-xs text-amber-900">
                      Invalid decisions:{' '}
                      {
                        board.gates.launchTrust.reviewExceptionDecisionValidation
                          .invalidDecisionCount
                      }
                    </p>
                  )}
                  {board.gates.launchTrust.reviewExceptionDecisionValidation.note && (
                    <p className="mt-1 text-xs text-amber-800">
                      {board.gates.launchTrust.reviewExceptionDecisionValidation.note}
                    </p>
                  )}
                </div>
              )}
              {typeof board.gates.launchTrust.artifactAgeHours === 'number' && (
                <p className="mt-1 text-xs text-amber-700">
                  Artifact age: {board.gates.launchTrust.artifactAgeHours} hours
                </p>
              )}
            </div>
          )}
          {board.gates.launchAcquisition && (
            <div className="rounded-md border border-[var(--yr-line)] p-3">
              <div className="text-sm font-semibold text-gray-900">Launch acquisition</div>
              <GateStatus
                label="Launch acquisition"
                status={board.gates.launchAcquisition.status}
              />
              <code className="mt-2 block whitespace-pre-wrap text-xs text-gray-600">
                {board.gates.launchAcquisition.command}
              </code>
              <p className="mt-2 text-sm text-gray-600">{board.gates.launchAcquisition.note}</p>
              {typeof board.gates.launchAcquisition.scanned === 'number' && (
                <p className="mt-1 text-xs text-gray-600">
                  Scanned blockers: {board.gates.launchAcquisition.scanned}
                </p>
              )}
              {typeof board.gates.launchAcquisition.piBlockers === 'number' && (
                <p className="mt-1 text-xs text-gray-600">
                  PI blockers: {board.gates.launchAcquisition.piBlockers}
                </p>
              )}
              {typeof board.gates.launchAcquisition.actionBlockers === 'number' && (
                <p className="mt-1 text-xs text-gray-600">
                  Action blockers: {board.gates.launchAcquisition.actionBlockers}
                </p>
              )}
              {typeof board.gates.launchAcquisition.exactPiMatches === 'number' && (
                <p className="mt-1 text-xs text-emerald-700">
                  Exact PI matches: {board.gates.launchAcquisition.exactPiMatches}
                </p>
              )}
              {typeof board.gates.launchAcquisition.sourceBackedRouteCandidates === 'number' && (
                <p className="mt-1 text-xs text-emerald-700">
                  Route candidates: {board.gates.launchAcquisition.sourceBackedRouteCandidates}
                </p>
              )}
              {typeof board.gates.launchAcquisition.missingOfficialProfileUrl === 'number' && (
                <p className="mt-1 text-xs text-amber-700">
                  Missing official profile URLs:{' '}
                  {board.gates.launchAcquisition.missingOfficialProfileUrl}
                </p>
              )}
              {typeof board.gates.launchAcquisition.ambiguousOrMismatchedUserMatch ===
                'number' && (
                <p className="mt-1 text-xs text-amber-700">
                  Ambiguous/mismatched user cases:{' '}
                  {board.gates.launchAcquisition.ambiguousOrMismatchedUserMatch}
                </p>
              )}
              {typeof board.gates.launchAcquisition.artifactAgeHours === 'number' && (
                <p className="mt-1 text-xs text-amber-700">
                  Artifact age: {board.gates.launchAcquisition.artifactAgeHours} hours
                </p>
              )}
            </div>
          )}
          {board.gates.productionCopy && (
            <div className="rounded-md border border-[var(--yr-line)] p-3">
              <div className="text-sm font-semibold text-gray-900">Production copy</div>
              <GateStatus label="Production copy" status={board.gates.productionCopy.status} />
              <code className="mt-2 block whitespace-pre-wrap text-xs text-gray-600">
                {board.gates.productionCopy.command}
              </code>
              <p className="mt-2 text-sm text-gray-600">{board.gates.productionCopy.note}</p>
              {typeof board.gates.productionCopy.applyBlockerCount === 'number' && (
                <p className="mt-1 text-xs text-amber-700">
                  Apply blockers: {board.gates.productionCopy.applyBlockerCount}
                </p>
              )}
              {typeof board.gates.productionCopy.excludedSyntheticUsers === 'number' && (
                <p className="mt-1 text-xs text-gray-600">
                  Excluded synthetic users: {board.gates.productionCopy.excludedSyntheticUsers}
                </p>
              )}
              {typeof board.gates.productionCopy.collectionCategoryCount === 'number' && (
                <p className="mt-1 text-xs text-gray-600">
                  Collection categories: {board.gates.productionCopy.collectionCategoryCount}
                </p>
              )}
              {typeof board.gates.productionCopy.artifactAgeHours === 'number' && (
                <p className="mt-1 text-xs text-amber-700">
                  Artifact age: {board.gates.productionCopy.artifactAgeHours} hours
                </p>
              )}
            </div>
          )}
        </div>
      </section>

      {board.repairQueue && (
        <section className="rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h4 className="font-semibold text-gray-900">Automatic Repair Queue</h4>
            <span className="text-sm text-gray-500">
              {board.repairQueue.openCount} open · {board.repairQueue.statusCounts.repaired || 0}{' '}
              repaired
            </span>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-md border border-[var(--yr-line)] p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Repair lanes
              </div>
              <div className="mt-2 space-y-2">
                {board.repairQueue.byStage.slice(0, 8).map((row) => (
                  <div
                    key={`${row.stage}-${row.status}`}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <div>
                      <div className="font-medium text-gray-800">
                        {repairStageLabel[row.stage] || row.stage}
                      </div>
                      <div className="text-xs text-gray-500">{row.status}</div>
                    </div>
                    <span className="font-semibold text-gray-900">{row.count}</span>
                  </div>
                ))}
                {board.repairQueue.byStage.length === 0 && (
                  <div className="text-sm text-gray-500">No queued repairs</div>
                )}
              </div>
            </div>
            <div className="rounded-md border border-[var(--yr-line)] p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Recent automatic work
              </div>
              <div className="mt-2 space-y-3">
                {board.repairQueue.samples.slice(0, 4).map((sample) => (
                  <div key={sample.id}>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-semibold text-gray-900">{sample.label}</div>
                      <span className="rounded-md border border-[var(--yr-line)] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-gray-600">
                        {repairStageLabel[sample.repairStage] || sample.repairStage}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      {sample.safeToAttempt ? 'Safe auto-repair' : 'Needs more evidence'} ·{' '}
                      {sample.repairStatus} · {sample.attemptCount} attempts
                    </div>
                    <div className="mt-1 text-sm text-gray-600">{sample.nextRepairAction}</div>
                  </div>
                ))}
                {board.repairQueue.samples.length === 0 && (
                  <div className="text-sm text-gray-500">No repair samples</div>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {board.releaseQueue && (
        <section className="rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h4 className="font-semibold text-gray-900">Release Queue</h4>
            <span className="text-sm text-gray-500">
              {board.releaseQueue.openCount} open ·{' '}
              {board.releaseQueue.statusCounts.resolved || 0} resolved
            </span>
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            <div className="rounded-md border border-[var(--yr-line)] p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Top blockers
              </div>
              <div className="mt-2 space-y-2">
                {board.releaseQueue.topBlockers.slice(0, 5).map((row) => (
                  <div key={row.reason} className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-gray-700">{row.reason}</span>
                    <span className="font-semibold text-gray-900">{row.count}</span>
                  </div>
                ))}
                {board.releaseQueue.topBlockers.length === 0 && (
                  <div className="text-sm text-gray-500">No open blockers</div>
                )}
              </div>
            </div>
            <div className="rounded-md border border-[var(--yr-line)] p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Source pressure
              </div>
              <div className="mt-2 space-y-2">
                {board.releaseQueue.sourcePressure.slice(0, 5).map((row) => (
                  <div key={row.sourceName} className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-gray-700">{row.sourceName}</span>
                    <span className="font-semibold text-gray-900">{row.count}</span>
                  </div>
                ))}
                {board.releaseQueue.sourcePressure.length === 0 && (
                  <div className="text-sm text-gray-500">No source pressure</div>
                )}
              </div>
            </div>
            <div className="rounded-md border border-[var(--yr-line)] p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Recent holds
              </div>
              <div className="mt-2 space-y-3">
                {board.releaseQueue.samples.slice(0, 3).map((sample) => (
                  <div key={sample.id}>
                    <div className="text-sm font-semibold text-gray-900">{sample.label}</div>
                    <div className="mt-1 text-xs text-gray-500">{sample.collection}</div>
                    <div className="mt-1 text-sm text-gray-600">{sample.nextRepairAction}</div>
                  </div>
                ))}
                {board.releaseQueue.samples.length === 0 && (
                  <div className="text-sm text-gray-500">No held samples</div>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] p-4">
        <h4 className="mb-1 font-semibold text-gray-900">Decision Lanes</h4>
        <p className="mb-3 text-sm text-gray-600">
          Visibility queues grouped by the decision an operator needs to make.
        </p>
        <div className="grid gap-3 lg:grid-cols-3">
          {decisionLanes.map((lane) => {
            const copy = decisionLaneCopy[lane.kind];
            return (
              <div key={lane.kind} className="rounded-md border border-[var(--yr-line)] p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      {copy.eyebrow}
                    </div>
                    <h5 className="mt-1 font-semibold text-gray-900">{copy.title}</h5>
                    <p className="mt-1 text-xs text-gray-600">{copy.description}</p>
                  </div>
                  <span
                    className={`shrink-0 rounded-md border px-2 py-0.5 text-xs font-semibold ${queueKindStyles[lane.kind]}`}
                  >
                    {lane.queues.reduce((sum, queue) => sum + queue.count, 0)}
                  </span>
                </div>

                <div className="mt-3 space-y-3">
                  {lane.queues.length === 0 && (
                    <div className="rounded-md bg-[var(--yr-panel-muted)] p-3 text-sm text-gray-500">
                      No current rows
                    </div>
                  )}
                  {lane.queues.map((queue) => (
                    <div key={`${queue.collection}-${queue.reason}`} className="rounded-md bg-[var(--yr-panel-muted)] p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-medium text-gray-900">
                            {queueDecisionPrompt(queue.reason)}
                          </div>
                          <div className="mt-1 text-xs text-gray-500">
                            <span>{queue.reason}</span>
                            <span className="mx-1">·</span>
                            <span className="capitalize">{queue.collection}</span>
                          </div>
                        </div>
                        <span className="shrink-0 text-sm font-semibold text-gray-900">
                          {queue.count}
                        </span>
                      </div>
                      <div className="mt-2 text-sm text-gray-700">{queue.nextAction}</div>

                      <div className="mt-3 text-sm text-gray-600">
                        {queue.samples.length === 0
                          ? 'No samples'
                          : queue.samples.slice(0, 3).map((sample) => {
                              const { blockers, signals } = splitReasons(sample.reasons, queue.reason);

                              return (
                                <div key={sample.id} className="mb-3 last:mb-0">
                                  <div className="font-medium text-gray-900">{sample.label}</div>
                                  <ReasonList
                                    label="Likely blockers"
                                    reasons={blockers}
                                    tone="blocker"
                                  />
                                  <ReasonList
                                    label="Evidence signals"
                                    reasons={signals}
                                    tone="signal"
                                  />
                                </div>
                              );
                            })}
                        {queue.samples.length > 3 && (
                          <div className="mt-2 text-xs text-gray-500">
                            +{queue.samples.length - 3} more samples
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-md border border-[var(--yr-line)] bg-[var(--yr-panel)] p-4">
        <div className="mb-3 flex items-center justify-between">
          <h4 className="font-semibold text-gray-900">Source Freshness</h4>
          <span className="text-sm text-gray-500">
            {board.sourceFreshness.windowDays} days · {board.sourceFreshness.riskCounts.ok} ok ·{' '}
            {board.sourceFreshness.riskCounts.warn} warn · {board.sourceFreshness.riskCounts.error}{' '}
            error
          </span>
        </div>
        {board.sourceFreshness.reviewSummary && (
          <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <p>
              Source review: {board.sourceFreshness.reviewSummary.reportArtifacts.available}/
              {board.sourceFreshness.reviewSummary.materializationConflictRows} report artifacts
              available · {board.sourceFreshness.reviewSummary.actionableConflictCount} actionable
              conflicts
            </p>
            {sourceReviewCategoryText(board) && (
              <p className="mt-1 text-xs text-amber-800">{sourceReviewCategoryText(board)}</p>
            )}
            {sourceLanes.length > 0 && (
              <div className="mt-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-amber-900">
                  Source Conflict Decision Lanes
                </div>
                <div className="mt-2 grid gap-2 md:grid-cols-3">
                  {sourceLanes.map((lane) => (
                    <div
                      key={lane.queue}
                      className="rounded-md border border-amber-200 bg-white/50 px-2 py-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-xs font-semibold text-amber-950">
                            {lane.label}
                          </div>
                          <div className="mt-0.5 text-[11px] text-amber-800">
                            {lane.description}
                          </div>
                        </div>
                        <span className="shrink-0 text-sm font-semibold text-amber-950">
                          {lane.count}
                        </span>
                      </div>
                      {lane.categories.length > 0 && (
                        <div className="mt-1 text-[11px] text-amber-800">
                          {lane.categories
                            .slice(0, 2)
                            .map((category) => `${category.category} ${category.count}`)
                            .join(' · ')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {sourceConflictScopeText(board) && (
              <p className="mt-1 text-xs text-amber-800">{sourceConflictScopeText(board)}</p>
            )}
            {sourceReviewArtifactRollupLines(board).map((line) => (
              <p key={line} className="mt-1 text-xs text-amber-800">
                {line}
              </p>
            ))}
            {sourceReviewDecisionValidationLines(board).map((line) => (
              <p key={line} className="mt-1 text-xs text-amber-800">
                {line}
              </p>
            ))}
            {sourceReviewDecisionValidationProbeCommands(board).map((probe) => (
              <div
                key={`${probe.label}-${probe.sourceName}`}
                className="mt-2 rounded-md border border-amber-200 bg-white/50 px-2 py-1.5"
              >
                <div className="text-xs font-semibold text-amber-900">
                  {probe.label}: {probe.sourceName}
                </div>
                <code className="mt-1 block whitespace-pre-wrap text-[11px] text-amber-900">
                  {probe.command}
                </code>
              </div>
            ))}
            {sourceReviewDecisionHandoffs(board).map((handoff) => (
              <div
                key={`${handoff.label}-${handoff.sourceName}`}
                className="mt-2 rounded-md border border-amber-200 bg-white/50 px-2 py-1.5"
              >
                <div className="text-xs font-semibold text-amber-900">
                  {handoff.label}: {handoff.sourceName}
                </div>
                {handoff.templatePath && (
                  <code className="mt-1 block whitespace-pre-wrap text-[11px] text-amber-900">
                    {handoff.templatePath}
                  </code>
                )}
                {handoff.validationPath && (
                  <code className="mt-1 block whitespace-pre-wrap text-[11px] text-amber-900">
                    {handoff.validationPath}
                  </code>
                )}
                {handoff.validationStatus && (
                  <div className="mt-1 text-[11px] font-medium text-amber-900">
                    {handoff.validationStatus}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="grid gap-3 lg:grid-cols-2">
          {board.sourceFreshness.rows.slice(0, 8).map((row) => (
            <div key={row.sourceName} className="rounded-md border border-[var(--yr-line)] p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold text-gray-900">{row.displayName}</div>
                  <div className="text-xs text-gray-500">{row.sourceName}</div>
                </div>
                <span
                  className={`rounded-md border px-2 py-1 text-xs font-semibold ${riskStyles[row.risk]}`}
                >
                  {row.risk}
                </span>
              </div>
              <p className="mt-2 text-sm text-gray-600">{row.action}</p>
              <p className="mt-2 text-xs text-gray-500">
                Latest run: {formatDate(row.latestRun?.startedAt)}
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

export default AdminOperatorBoard;
