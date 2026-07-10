import fs from 'fs';
import { Fellowship } from '../models/fellowship';
import { ResearchEntity } from '../models/researchEntity';
import { ScrapeRun } from '../models/scrapeRun';
import { Source } from '../models/source';
import type { StudentVisibilityTier } from '../models/studentVisibility';
import { VisibilityReleaseQueueItem } from '../models/visibilityReleaseQueueItem';
import { buildSourceHealthReviewSummary } from '../scripts/sourceHealth';
import { workPlannerSourcePolicies } from '../scrapers/workPlanner';
import { buildSourceHealthRows, type SourceHealthRisk } from './sourceHealthService';
import {
  buildVisibilityRepairPlan,
  repairActionForStage,
  type VisibilityRepairPlan,
} from './visibilityRepairQueueService';
import { resolveSafeJsonReportOutputPath } from '../scripts/scriptWriteGuards';
import { serializedDocumentId } from '../utils/idSerialization';

export type QueueKind = 'blocking' | 'evidence' | 'review';
export type PromotionStatus = 'ready' | 'watch' | 'blocked';

export const DEFAULT_DATA_QUALITY_SCORECARD_PATH = '/tmp/ylabs-beta-quality.json';
export const DEFAULT_SCRAPER_INTEGRITY_SCORECARD_PATH = '/tmp/ylabs-scraper-integrity.json';
export const DEFAULT_LAUNCH_TRUST_SCORECARD_PATH = '/tmp/ylabs-launch-trust-contract.json';
export const DEFAULT_LAUNCH_REVIEW_EXCEPTIONS_REPORT_PATH =
  '/tmp/ylabs-launch-review-exceptions.json';
export const DEFAULT_LAUNCH_ACQUISITION_REPORT_PATH =
  '/tmp/ylabs-launch-acquisition-report.json';
export const DEFAULT_BETA_REPAIR_QUEUE_REPORT_PATH = '/tmp/ylabs-beta-repair-source-description.json';
export const DEFAULT_PROMOTION_COPY_DRY_RUN_REPORT_PATH =
  '/tmp/ylabs-lane-a-promotion-dry-run.json';
/**
 * Max age before a saved gate scorecard is treated as stale (status downgraded to "rerun",
 * never shown as a live verdict). This must be tight enough that a status that has materially
 * moved on cannot masquerade as current: the previous 48h window let a ~2-day-old "BLOCKED"
 * render as the live gate. Tune via env GATE_SCORECARD_MAX_AGE_HOURS to match the refresh
 * cadence (e.g. an hourly refresh wants a 2-3h tolerance so a single missed run flags stale).
 */
function resolveGateScorecardMaxAgeHours(): number {
  const raw = Number(process.env.GATE_SCORECARD_MAX_AGE_HOURS);
  return Number.isFinite(raw) && raw > 0 ? raw : 3;
}

export const GATE_SCORECARD_MAX_AGE_HOURS = resolveGateScorecardMaxAgeHours();
// Per-gate constants retained as named exports for back-compat; all derive from the single TTL.
export const DATA_QUALITY_SCORECARD_MAX_AGE_HOURS = GATE_SCORECARD_MAX_AGE_HOURS;
export const SCRAPER_INTEGRITY_SCORECARD_MAX_AGE_HOURS = GATE_SCORECARD_MAX_AGE_HOURS;
export const LAUNCH_TRUST_SCORECARD_MAX_AGE_HOURS = GATE_SCORECARD_MAX_AGE_HOURS;
export const LAUNCH_REVIEW_EXCEPTIONS_REPORT_MAX_AGE_HOURS = GATE_SCORECARD_MAX_AGE_HOURS;
export const LAUNCH_ACQUISITION_REPORT_MAX_AGE_HOURS = GATE_SCORECARD_MAX_AGE_HOURS;
export const BETA_REPAIR_QUEUE_REPORT_MAX_AGE_HOURS = GATE_SCORECARD_MAX_AGE_HOURS;
export const PROMOTION_COPY_DRY_RUN_REPORT_MAX_AGE_HOURS = GATE_SCORECARD_MAX_AGE_HOURS;

const BETA_COMMAND_PREFIX = 'SCRAPER_ENV=beta ';
const SAVED_ARTIFACT_READ_ERROR = 'Saved artifact is not readable';
const UNSAFE_ARTIFACT_PATH = '[unsafe artifact path]';
const MAX_GATE_ARTIFACT_BYTES = 2 * 1024 * 1024;

function operatorBoardDocumentId(value: unknown): string {
  return serializedDocumentId(value) || '';
}

function resolveGateArtifactReadPath(artifactPath: string): string | undefined {
  try {
    return resolveSafeJsonReportOutputPath(artifactPath, 'artifact path');
  } catch {
    return undefined;
  }
}

function invalidArtifactPath() {
  return {
    artifactStatus: 'invalid' as const,
    artifactPath: UNSAFE_ARTIFACT_PATH,
    error: 'Saved artifact path is outside the allowed report artifact roots',
  };
}

function readGateArtifactJson(safeArtifactPath: string): any {
  const stat = fs.statSync(safeArtifactPath);
  if (!stat.isFile() || stat.size > MAX_GATE_ARTIFACT_BYTES) {
    throw new Error(SAVED_ARTIFACT_READ_ERROR);
  }
  return JSON.parse(fs.readFileSync(safeArtifactPath, 'utf8'));
}

function betaTargetCommand(command: string): string {
  const trimmed = command.trim();
  if (!trimmed || trimmed.startsWith(BETA_COMMAND_PREFIX)) return trimmed;
  if (/^[A-Z_][A-Z0-9_]*=/.test(trimmed)) return trimmed;
  if (trimmed.includes(' production:') || trimmed.includes(' smoke:production-promotion')) {
    return trimmed;
  }
  if (trimmed.startsWith('yarn --cwd server ') || trimmed.startsWith('yarn scrape ')) {
    return `${BETA_COMMAND_PREFIX}${trimmed}`;
  }
  return trimmed;
}

export interface DataQualityBlockerOwnerSummary {
  owner: string;
  count: number;
  blockerNames: string[];
}

export interface DataQualityHardErrorSummary {
  name: string;
  count: number;
  owner?: string;
  nextCommand?: string;
}

export interface DataQualityDuplicateNamePreflightSummary {
  sharedWebsiteClusterCount?: number;
  sharedWebsiteArtifactPath?: string;
  requiredReviewerDecisions: string[];
  manualReviewCategories: Array<{ category: string; clusterCount: number }>;
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

export interface DataQualitySamePiDedupeReviewBreakdown {
  totalGroups?: number;
  reviewedProfileAreaGroups?: number;
  fundingSourceGroups?: number;
  crossDepartmentGroups?: number;
  groupsWithMergedResearchAreas?: number;
  highResearchAreaMergeGroups?: number;
}

export interface DataQualitySamePiDedupeReviewSummary {
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
  reviewBreakdown?: DataQualitySamePiDedupeReviewBreakdown;
  acceptedDecisionValidation: {
    artifactAvailable: boolean;
    totalDecisions?: number;
    validDecisionCount?: number;
    invalidDecisionCount?: number;
    unreviewedPlanCount?: number;
  };
  nextAction?: string;
}

export interface DataQualitySuspiciousUserEmailCopySummary {
  count: number;
  lane?: string;
  sampledExcludedByDefault: number;
  sampledNeedsReviewBeforeCopy: number;
  sampledCoverageComplete: boolean;
  nextAction?: string;
}

export type DataQualityGateArtifact =
  | {
      artifactStatus: 'loaded';
      artifactPath: string;
      generatedAt?: string;
      promotionReady: boolean;
      promotionBlockerCount: number;
      hardErrors: DataQualityHardErrorSummary[];
      promotionBlockersByOwner: DataQualityBlockerOwnerSummary[];
      recommendedCommands: string[];
      duplicateNamePreflight?: DataQualityDuplicateNamePreflightSummary;
      samePiDedupeReview?: DataQualitySamePiDedupeReviewSummary;
      suspiciousUserEmailCopy?: DataQualitySuspiciousUserEmailCopySummary;
    }
  | {
      artifactStatus: 'missing' | 'invalid';
      artifactPath: string;
      error?: string;
    }
  | {
      artifactStatus: 'stale';
      artifactPath: string;
      generatedAt?: string;
      ageHours: number;
    };

export type ScraperIntegrityGateArtifact =
  | {
      artifactStatus: 'loaded';
      artifactPath: string;
      generatedAt?: string;
      integrityStatus: 'pass' | 'failure';
      failureNames: string[];
      warningCount: number;
      recommendedCommands: string[];
    }
  | {
      artifactStatus: 'missing' | 'invalid';
      artifactPath: string;
      error?: string;
    }
  | {
      artifactStatus: 'stale';
      artifactPath: string;
      generatedAt?: string;
      ageHours: number;
    };

export type LaunchTrustGateArtifact =
  | {
      artifactStatus: 'loaded';
      artifactPath: string;
      generatedAt?: string;
      pass: boolean;
      heldCount: number;
      publicVisibilityViolations: number;
      repairLaneCount: number;
      repairLaneCommands: string[];
    }
  | {
      artifactStatus: 'missing' | 'invalid';
      artifactPath: string;
      error?: string;
    }
  | {
      artifactStatus: 'stale';
      artifactPath: string;
      generatedAt?: string;
      ageHours: number;
    };

export type LaunchReviewExceptionsArtifact =
  | {
      artifactStatus: 'loaded';
      artifactPath: string;
      generatedAt?: string;
      reviewExceptionCount: number;
      plannedCount: number;
      planTruncated: boolean;
      totalDecisions: number;
      validDecisionCount: number;
      invalidDecisionCount: number;
      unreviewedPlanCount: number;
    }
  | {
      artifactStatus: 'missing' | 'invalid';
      artifactPath: string;
      error?: string;
    }
  | {
      artifactStatus: 'stale';
      artifactPath: string;
      generatedAt?: string;
      ageHours: number;
    };

export type LaunchAcquisitionGateArtifact =
  | {
      artifactStatus: 'loaded';
      artifactPath: string;
      generatedAt?: string;
      scanned: number;
      piBlockers: number;
      actionBlockers: number;
      exactPiMatches: number;
      sourceBackedRouteCandidates: number;
      missingOfficialProfileUrl: number;
      ambiguousOrMismatchedUserMatch: number;
      sourceObservationsWithoutUndergradAccess: number;
      untrustedExternalRouteEvidence: number;
    }
  | {
      artifactStatus: 'missing' | 'invalid';
      artifactPath: string;
      error?: string;
    }
  | {
      artifactStatus: 'stale';
      artifactPath: string;
      generatedAt?: string;
      ageHours: number;
    };

export type BetaRepairQueueGateArtifact =
  | {
      artifactStatus: 'loaded';
      artifactPath: string;
      generatedAt?: string;
      ageHours?: number;
      mode: 'dry-run' | 'apply';
      scanned: number;
      repaired: number;
      blocked: number;
      blockedReasonCounts?: Array<{ reason: string; count: number }>;
      options?: Record<string, unknown>;
      patchSummaryCounts?: Array<{ summary: string; count: number }>;
      repairSourceHosts?: Array<{ host: string; count: number }>;
    }
  | {
      artifactStatus: 'missing' | 'invalid';
      artifactPath: string;
      error?: string;
    }
  | {
      artifactStatus: 'stale';
      artifactPath: string;
      generatedAt?: string;
      ageHours: number;
    };

export type PromotionCopyDryRunArtifact =
  | {
      artifactStatus: 'loaded';
      artifactPath: string;
      datasetVersion: string;
      syntheticReferenceBlockersClear: boolean;
      applyBlockerCount: number;
      excludedSyntheticUsers: number;
      collectionCategoryCount: number;
    }
  | {
      artifactStatus: 'missing' | 'invalid';
      artifactPath: string;
      error?: string;
    }
  | {
      artifactStatus: 'stale';
      artifactPath: string;
      ageHours: number;
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

export function classifyOperatorQueueReason(reason: string): QueueKind {
  if (evidenceReasons.has(reason)) return 'evidence';
  if (reviewDecisionReasons.has(reason)) return 'review';
  if (
    reason.startsWith('missing_') ||
    [
      'content_page_risk',
      'inactive_at_yale',
      'missing_card_description',
      'pi_identity_conflict',
      'profile_fallback_only',
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
          id: operatorBoardDocumentId(run._id),
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
  dataQualityPromotionReady?: boolean;
}): PromotionStatus {
  if (
    input.sourceRiskCounts.error > 0 ||
    input.integrityStatus === 'failure' ||
    input.meiliStatus === 'blocked' ||
    input.dataQualityPromotionReady === false
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
  dataQualityPromotionBlockerCount?: number;
  duplicateNameUnreviewedPlanCount?: number;
  samePiDedupeUnreviewedPlanCount?: number;
  launchHeldCount?: number;
  launchReviewExceptionUnreviewedCount?: number;
  sourceReviewUnreviewedPlanCount?: number;
}) {
  const actions: string[] = [];
  if (input.sourceRiskCounts.error > 0) {
    actions.push('Inspect failed source runs before promotion.');
  }
  if ((input.dataQualityPromotionBlockerCount || 0) > 0) {
    actions.push(
      `Resolve ${input.dataQualityPromotionBlockerCount} data-quality promotion blockers before production promotion.`,
    );
  }
  if ((input.launchHeldCount || 0) > 0) {
    actions.push(
      `Resolve ${input.launchHeldCount} launch-trust held rows before production promotion.`,
    );
  }
  if ((input.launchReviewExceptionUnreviewedCount || 0) > 0) {
    actions.push(
      `Review ${input.launchReviewExceptionUnreviewedCount} launch review-exception plans before claiming launch trust readiness.`,
    );
  }
  if ((input.sourceReviewUnreviewedPlanCount || 0) > 0) {
    actions.push(
      `Review ${input.sourceReviewUnreviewedPlanCount} source-health conflict plans before accepting source-health warnings.`,
    );
  }
  if ((input.duplicateNameUnreviewedPlanCount || 0) > 0) {
    actions.push(
      `Review ${input.duplicateNameUnreviewedPlanCount} duplicate-name decisions before designing a guarded merge/archive path.`,
    );
  }
  if ((input.samePiDedupeUnreviewedPlanCount || 0) > 0) {
    actions.push(
      `Review ${input.samePiDedupeUnreviewedPlanCount} same-PI dedupe decisions before clearing scraper-integrity same-PI blockers.`,
    );
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

export function deriveDataQualityGate(input?: {
  artifactStatus?: 'loaded' | 'missing' | 'invalid' | 'stale';
  artifactPath?: string;
  generatedAt?: string;
  ageHours?: number;
  promotionReady?: boolean;
  promotionBlockerCount?: number;
  hardErrors?: DataQualityHardErrorSummary[];
  promotionBlockersByOwner?: DataQualityBlockerOwnerSummary[];
  recommendedCommands?: string[];
  duplicateNamePreflight?: DataQualityDuplicateNamePreflightSummary;
  samePiDedupeReview?: DataQualitySamePiDedupeReviewSummary;
  suspiciousUserEmailCopy?: DataQualitySuspiciousUserEmailCopySummary;
}) {
  const command = betaTargetCommand('yarn --cwd server beta:data-quality --include-samples');
  if (!input) {
    return {
      status: 'manual' as const,
      command,
      note: 'Gate output is not persisted in this branch yet; run before promotion.',
    };
  }

  if (input.artifactStatus === 'invalid') {
    return {
      status: 'manual' as const,
      command,
      note: 'Saved data-quality artifact is not readable; rerun the gate before promotion.',
    };
  }

  if (input.artifactStatus === 'stale') {
    return {
      status: 'manual' as const,
      command,
      note: 'Saved data-quality artifact is stale; rerun the gate before promotion.',
      artifactAgeHours: input.ageHours,
    };
  }

  if (input.promotionReady === false) {
    const count = input.promotionBlockerCount || 0;
    const hardErrorCount = input.hardErrors?.length || 0;
    const hardErrorText =
      hardErrorCount === 1 ? '1 hard error' : `${hardErrorCount} hard errors`;
    const blockerText =
      count === 1 ? '1 must-fix promotion blocker' : `${count} must-fix promotion blockers`;
    const note =
      hardErrorCount > 0 && count > 0
        ? `Data-quality gate has ${hardErrorText} and ${blockerText}.`
        : hardErrorCount > 0
          ? `Data-quality gate has ${hardErrorText}.`
          : `Data-quality gate has ${blockerText}.`;
    return {
      status: 'blocked' as const,
      command,
      note,
      hardErrors: input.hardErrors || [],
      blockersByOwner: input.promotionBlockersByOwner || [],
      recommendedCommands: input.recommendedCommands || [],
      duplicateNamePreflight: input.duplicateNamePreflight,
      samePiDedupeReview: input.samePiDedupeReview,
      suspiciousUserEmailCopy: input.suspiciousUserEmailCopy,
    };
  }

  return {
    status: 'ready' as const,
    command,
    note: 'Latest data-quality gate has no must-fix promotion blockers.',
    hardErrors: input.hardErrors || [],
    blockersByOwner: input.promotionBlockersByOwner || [],
    recommendedCommands: input.recommendedCommands || [],
    duplicateNamePreflight: input.duplicateNamePreflight,
    samePiDedupeReview: input.samePiDedupeReview,
    suspiciousUserEmailCopy: input.suspiciousUserEmailCopy,
  };
}

export function deriveRepairQueueGate(
  openCount: number,
  input?: BetaRepairQueueGateArtifact,
) {
  const command = betaTargetCommand(
    'yarn --cwd server beta:repair-queue --collection=all --stage=source_description --mode=dry-run --retry-blocked --limit=500',
  );

  if (!input) {
    return {
      status: openCount > 0 ? 'active' : 'ready',
      command,
      note:
        openCount > 0
          ? 'Automatic beta repair queue has open items; safe repairs can be applied before re-gating.'
          : 'No open automatic repair queue items.',
      openCount,
    };
  }

  if (input.artifactStatus === 'invalid') {
    return {
      status: openCount > 0 ? 'active' : 'manual',
      command,
      note: 'Saved beta repair-queue artifact is not readable; rerun the dry-run before applying repairs.',
      openCount,
    };
  }

  if (input.artifactStatus === 'stale') {
    return {
      status: 'manual',
      command,
      note: 'Saved beta repair-queue artifact is stale; rerun the dry-run before applying repairs.',
      openCount,
      artifactAgeHours: input.ageHours,
    };
  }

  if (input.artifactStatus !== 'loaded') {
    return {
      status: openCount > 0 ? 'active' : 'ready',
      command,
      note:
        openCount > 0
          ? 'Automatic beta repair queue has open items; safe repairs can be applied before re-gating.'
          : 'No open automatic repair queue items.',
      openCount,
    };
  }

  const status =
    input.repaired > 0 ? 'active' : input.blocked > 0 || openCount > 0 ? 'watch' : 'ready';

  return {
    status,
    command,
    note: `Latest beta repair ${input.mode} found ${input.repaired} repairable rows and ${input.blocked} blocked rows.`,
    openCount,
    scanned: input.scanned,
    repairableCount: input.repaired,
    blockedCount: input.blocked,
    ...(input.blockedReasonCounts?.length
      ? { blockedReasonCounts: input.blockedReasonCounts }
      : {}),
    ...(input.options ? { options: input.options } : {}),
    ...(input.patchSummaryCounts?.length ? { patchSummaryCounts: input.patchSummaryCounts } : {}),
    ...(input.repairSourceHosts?.length ? { repairSourceHosts: input.repairSourceHosts } : {}),
    artifactAgeHours: input.ageHours,
  };
}

export function derivePromotionCopyGate(input?: PromotionCopyDryRunArtifact) {
  const command =
    'yarn --cwd server production:promote-beta-copy --output /tmp/ylabs-lane-a-promotion-dry-run.json';

  if (!input) {
    return {
      status: 'manual' as const,
      command,
      note: 'Saved Lane A dry-run artifact is not present; run and review it against the real Production target before copy.',
    };
  }

  if (input.artifactStatus === 'invalid') {
    return {
      status: 'manual' as const,
      command,
      note: 'Saved Lane A dry-run artifact is not readable; rerun the guarded dry-run before promotion review.',
    };
  }

  if (input.artifactStatus === 'stale') {
    return {
      status: 'manual' as const,
      command,
      note: 'Saved Lane A dry-run artifact is stale; rerun the guarded dry-run before promotion review.',
      artifactAgeHours: input.ageHours,
    };
  }

  if (input.artifactStatus !== 'loaded') {
    return {
      status: 'manual' as const,
      command,
      note: 'Saved Lane A dry-run artifact is not present; run and review it against the real Production target before copy.',
    };
  }

  if (!input.syntheticReferenceBlockersClear || input.applyBlockerCount > 0) {
    const blockerWord = input.applyBlockerCount === 1 ? 'blocker' : 'blockers';
    return {
      status: 'blocked' as const,
      command,
      note: `Latest Lane A dry-run artifact has ${input.applyBlockerCount} apply ${blockerWord}.`,
      applyBlockerCount: input.applyBlockerCount,
      excludedSyntheticUsers: input.excludedSyntheticUsers,
      collectionCategoryCount: input.collectionCategoryCount,
    };
  }

  return {
    status: 'review_required' as const,
    command,
    note:
      'Latest Lane A dry-run artifact has no apply blockers; operator review, restore point, rollback test, and smoke gates are still required.',
    applyBlockerCount: input.applyBlockerCount,
    excludedSyntheticUsers: input.excludedSyntheticUsers,
    collectionCategoryCount: input.collectionCategoryCount,
  };
}

export function readPromotionCopyDryRunArtifact(
  artifactPath = DEFAULT_PROMOTION_COPY_DRY_RUN_REPORT_PATH,
  now = new Date(),
): PromotionCopyDryRunArtifact | undefined {
  const safeArtifactPath = resolveGateArtifactReadPath(artifactPath);
  if (!safeArtifactPath) return invalidArtifactPath();
  if (!fs.existsSync(safeArtifactPath)) {
    return undefined;
  }

  try {
    const stat = fs.statSync(safeArtifactPath);
    const ageHours = Math.floor((now.getTime() - stat.mtime.getTime()) / (60 * 60 * 1000));
    if (ageHours > PROMOTION_COPY_DRY_RUN_REPORT_MAX_AGE_HOURS) {
      return {
        artifactStatus: 'stale',
        artifactPath: safeArtifactPath,
        ageHours,
      };
    }

    const parsed = readGateArtifactJson(safeArtifactPath);
    if (parsed?.mode !== 'dry-run') {
      return {
        artifactStatus: 'invalid',
        artifactPath: safeArtifactPath,
        error: 'mode must be dry-run',
      };
    }
    if (typeof parsed.datasetVersion !== 'string') {
      return {
        artifactStatus: 'invalid',
        artifactPath: safeArtifactPath,
        error: 'datasetVersion is required',
      };
    }
    if (typeof parsed.syntheticReferenceBlockersClear !== 'boolean') {
      return {
        artifactStatus: 'invalid',
        artifactPath: safeArtifactPath,
        error: 'syntheticReferenceBlockersClear is required',
      };
    }
    if (!Array.isArray(parsed.applyBlockers)) {
      return {
        artifactStatus: 'invalid',
        artifactPath: safeArtifactPath,
        error: 'applyBlockers must be an array',
      };
    }

    return {
      artifactStatus: 'loaded',
      artifactPath: safeArtifactPath,
      datasetVersion: parsed.datasetVersion,
      syntheticReferenceBlockersClear: parsed.syntheticReferenceBlockersClear,
      applyBlockerCount: parsed.applyBlockers.length,
      excludedSyntheticUsers: Number(parsed.excludedSyntheticUsers || 0),
      collectionCategoryCount: Array.isArray(parsed.collectionCategories)
        ? parsed.collectionCategories.length
        : 0,
    };
  } catch (error) {
    return {
      artifactStatus: 'invalid',
      artifactPath: safeArtifactPath,
      error: SAVED_ARTIFACT_READ_ERROR,
    };
  }
}

export function readBetaRepairQueueGateArtifact(
  artifactPath = DEFAULT_BETA_REPAIR_QUEUE_REPORT_PATH,
  now = new Date(),
): BetaRepairQueueGateArtifact | undefined {
  const safeArtifactPath = resolveGateArtifactReadPath(artifactPath);
  if (!safeArtifactPath) return invalidArtifactPath();
  if (!fs.existsSync(safeArtifactPath)) {
    return undefined;
  }

  try {
    const parsed = readGateArtifactJson(safeArtifactPath);
    if (parsed?.mode !== 'dry-run' && parsed?.mode !== 'apply') {
      return {
        artifactStatus: 'invalid',
        artifactPath: safeArtifactPath,
        error: 'mode must be dry-run or apply',
      };
    }

    const generatedAt = typeof parsed.generatedAt === 'string' ? parsed.generatedAt : undefined;
    let ageHours: number | undefined;
    if (generatedAt) {
      const generatedAtTime = new Date(generatedAt).getTime();
      if (Number.isNaN(generatedAtTime)) {
        return {
          artifactStatus: 'invalid',
          artifactPath: safeArtifactPath,
          error: 'generatedAt must be an ISO timestamp when present',
        };
      }
      ageHours = Math.floor((now.getTime() - generatedAtTime) / (60 * 60 * 1000));
      if (ageHours > BETA_REPAIR_QUEUE_REPORT_MAX_AGE_HOURS) {
        return {
          artifactStatus: 'stale',
          artifactPath: safeArtifactPath,
          generatedAt,
          ageHours,
        };
      }
    }

    return {
      artifactStatus: 'loaded',
      artifactPath: safeArtifactPath,
      generatedAt,
      ageHours,
      mode: parsed.mode,
      scanned: Number(parsed.scanned || 0),
      repaired: Number(parsed.repaired || 0),
      blocked: Number(parsed.blocked || 0),
      ...normalizeBlockedReasonCounts(parsed.blockedReasonCounts),
      ...normalizeRepairArtifactOptions(parsed.options),
      ...summarizePatchSummaries(parsed.attempts),
      ...summarizeRepairSourceHosts(parsed.attempts),
    };
  } catch (error) {
    return {
      artifactStatus: 'invalid',
      artifactPath: safeArtifactPath,
      error: SAVED_ARTIFACT_READ_ERROR,
    };
  }
}

function normalizeRepairArtifactOptions(value: unknown): { options?: Record<string, unknown> } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const options: Record<string, unknown> = {};
  for (const key of ['mode', 'collection', 'stage', 'limit', 'retryBlocked']) {
    if (record[key] !== undefined) options[key] = record[key];
  }
  return Object.keys(options).length > 0 ? { options } : {};
}

function summarizePatchSummaries(
  attempts: unknown,
): { patchSummaryCounts?: Array<{ summary: string; count: number }> } {
  if (!Array.isArray(attempts)) return {};
  const counts = new Map<string, number>();
  for (const attempt of attempts) {
    if (!attempt || typeof attempt !== 'object') continue;
    const patchSummary = (attempt as Record<string, unknown>).patchSummary;
    if (!Array.isArray(patchSummary)) continue;
    for (const item of patchSummary) {
      const summary = typeof item === 'string' ? item.trim() : '';
      if (!summary) continue;
      counts.set(summary, (counts.get(summary) || 0) + 1);
    }
  }
  const rows = [...counts.entries()]
    .map(([summary, count]) => ({ summary, count }))
    .sort((a, b) => b.count - a.count || a.summary.localeCompare(b.summary))
    .slice(0, 5);
  return rows.length > 0 ? { patchSummaryCounts: rows } : {};
}

function summarizeRepairSourceHosts(
  attempts: unknown,
): { repairSourceHosts?: Array<{ host: string; count: number }> } {
  if (!Array.isArray(attempts)) return {};
  const counts = new Map<string, number>();
  for (const attempt of attempts) {
    if (!attempt || typeof attempt !== 'object') continue;
    const repairSource = (attempt as Record<string, unknown>).repairSource;
    const sourceText = typeof repairSource === 'string' ? repairSource.trim() : '';
    if (!sourceText) continue;
    try {
      const host = new URL(sourceText).hostname;
      counts.set(host, (counts.get(host) || 0) + 1);
    } catch {
      // Ignore non-URL repair source labels.
    }
  }
  const rows = [...counts.entries()]
    .map(([host, count]) => ({ host, count }))
    .sort((a, b) => b.count - a.count || a.host.localeCompare(b.host))
    .slice(0, 5);
  return rows.length > 0 ? { repairSourceHosts: rows } : {};
}

function normalizeBlockedReasonCounts(
  value: unknown,
): { blockedReasonCounts?: Array<{ reason: string; count: number }> } {
  if (!Array.isArray(value)) return {};

  const counts = value.flatMap((item): Array<{ reason: string; count: number }> => {
    if (!item || typeof item !== 'object') return [];
    const record = item as Record<string, unknown>;
    const reason = typeof record.reason === 'string' ? record.reason.trim() : '';
    const count = typeof record.count === 'number' ? record.count : NaN;
    return reason && Number.isFinite(count) ? [{ reason, count }] : [];
  });

  return counts.length > 0 ? { blockedReasonCounts: counts } : {};
}

function normalizeDataQualityBlockersByOwner(value: unknown): DataQualityBlockerOwnerSummary[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => {
      const owner = typeof row?.owner === 'string' ? row.owner : '';
      const count = typeof row?.count === 'number' ? row.count : 0;
      const blockerNames = Array.isArray(row?.blockerNames)
        ? row.blockerNames.filter((name: unknown): name is string => typeof name === 'string')
        : [];
      return owner && count > 0
        ? {
            owner,
            count,
            blockerNames,
          }
        : null;
    })
    .filter((row): row is DataQualityBlockerOwnerSummary => Boolean(row));
}

function normalizeDataQualityHardErrors(value: unknown): DataQualityHardErrorSummary[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row): DataQualityHardErrorSummary | null => {
      if (!row || typeof row !== 'object') return null;
      const candidate = row as Record<string, unknown>;
      if (typeof candidate.name !== 'string' || typeof candidate.count !== 'number') {
        return null;
      }
      return {
        name: candidate.name,
        count: candidate.count,
        ...(typeof candidate.owner === 'string' ? { owner: candidate.owner } : {}),
        ...(typeof candidate.nextCommand === 'string'
          ? { nextCommand: betaTargetCommand(candidate.nextCommand) }
          : {}),
      };
    })
    .filter((row): row is DataQualityHardErrorSummary => Boolean(row));
}

function normalizeRecommendedCommands(value: unknown, preferredKeys: string[] = []): string[] {
  const candidates: unknown[] = [];
  if (Array.isArray(value)) {
    candidates.push(...value);
  } else if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const usedKeys = new Set<string>();
    for (const key of preferredKeys) {
      candidates.push(record[key]);
      usedKeys.add(key);
    }
    for (const [key, command] of Object.entries(record)) {
      if (!usedKeys.has(key)) candidates.push(command);
    }
  }

  return candidates
    .filter((command): command is string => typeof command === 'string' && command.trim().length > 0)
    .map(betaTargetCommand);
}

export function readDataQualityGateArtifact(
  artifactPath = DEFAULT_DATA_QUALITY_SCORECARD_PATH,
  now = new Date(),
): DataQualityGateArtifact | undefined {
  const safeArtifactPath = resolveGateArtifactReadPath(artifactPath);
  if (!safeArtifactPath) return invalidArtifactPath();
  if (!fs.existsSync(safeArtifactPath)) {
    return undefined;
  }

  try {
    const parsed = readGateArtifactJson(safeArtifactPath);
    const summary = parsed?.summary;
    if (
      typeof summary?.promotionReady !== 'boolean' ||
      typeof summary?.promotionBlockerCount !== 'number'
    ) {
      return {
        artifactStatus: 'invalid',
        artifactPath: safeArtifactPath,
        error: 'summary.promotionReady and summary.promotionBlockerCount are required',
      };
    }
    const generatedAt = typeof parsed.generatedAt === 'string' ? parsed.generatedAt : undefined;
    if (generatedAt) {
      const generatedAtTime = new Date(generatedAt).getTime();
      if (Number.isNaN(generatedAtTime)) {
        return {
          artifactStatus: 'invalid',
          artifactPath: safeArtifactPath,
          error: 'generatedAt must be an ISO timestamp when present',
        };
      }
      const ageHours = Math.floor((now.getTime() - generatedAtTime) / (60 * 60 * 1000));
      if (ageHours > DATA_QUALITY_SCORECARD_MAX_AGE_HOURS) {
        return {
          artifactStatus: 'stale',
          artifactPath: safeArtifactPath,
          generatedAt,
          ageHours,
        };
      }
    }
    return {
      artifactStatus: 'loaded',
      artifactPath: safeArtifactPath,
      generatedAt,
      promotionReady: summary.promotionReady,
      promotionBlockerCount: summary.promotionBlockerCount,
      hardErrors: normalizeDataQualityHardErrors(summary.errors),
      promotionBlockersByOwner: normalizeDataQualityBlockersByOwner(
        summary.promotionBlockersByOwner,
      ),
      recommendedCommands: normalizeRecommendedCommands(parsed.recommendedCommands, [
        'weeklyAudit',
        'strictAudit',
        'retentionDryRun',
      ]),
      ...normalizeDuplicateNamePreflight(parsed?.duplicateEntityNames?.planReview?.preflightGuidance),
      ...normalizeSamePiDedupeReview(parsed?.samePiDedupeReview),
      ...normalizeSuspiciousUserEmailCopy(
        parsed?.hygiene?.emails?.suspiciousUserEmails,
      ),
    };
  } catch (error) {
    return {
      artifactStatus: 'invalid',
      artifactPath: safeArtifactPath,
      error: SAVED_ARTIFACT_READ_ERROR,
    };
  }
}

function normalizeSuspiciousUserEmailCopy(
  value: unknown,
): { suspiciousUserEmailCopy?: DataQualitySuspiciousUserEmailCopySummary } {
  if (!value || typeof value !== 'object') {
    return {};
  }
  const record = value as Record<string, unknown>;
  const count = record.count;
  const productionCopyExclusion =
    record.productionCopyExclusion && typeof record.productionCopyExclusion === 'object'
      ? (record.productionCopyExclusion as Record<string, unknown>)
      : undefined;
  if (typeof count !== 'number' || !Number.isFinite(count) || !productionCopyExclusion) {
    return {};
  }

  const sampledExcludedByDefault = productionCopyExclusion.sampledExcludedByDefault;
  const sampledNeedsReviewBeforeCopy = productionCopyExclusion.sampledNeedsReviewBeforeCopy;
  const sampledCoverageComplete = productionCopyExclusion.sampledCoverageComplete;
  if (
    typeof sampledExcludedByDefault !== 'number' ||
    !Number.isFinite(sampledExcludedByDefault) ||
    typeof sampledNeedsReviewBeforeCopy !== 'number' ||
    !Number.isFinite(sampledNeedsReviewBeforeCopy) ||
    typeof sampledCoverageComplete !== 'boolean'
  ) {
    return {};
  }

  const lane = productionCopyExclusion.lane;
  const nextAction = productionCopyExclusion.nextAction;
  return {
    suspiciousUserEmailCopy: {
      count,
      ...(typeof lane === 'string' && lane.trim() ? { lane } : {}),
      sampledExcludedByDefault,
      sampledNeedsReviewBeforeCopy,
      sampledCoverageComplete,
      ...(typeof nextAction === 'string' && nextAction.trim() ? { nextAction } : {}),
    },
  };
}

function normalizeDuplicateNamePreflight(
  value: unknown,
): { duplicateNamePreflight?: DataQualityDuplicateNamePreflightSummary } {
  if (!value || typeof value !== 'object') {
    return {};
  }
  const record = value as Record<string, unknown>;
  const sharedWebsiteReview =
    record.sharedWebsiteReview && typeof record.sharedWebsiteReview === 'object'
      ? (record.sharedWebsiteReview as Record<string, unknown>)
      : undefined;
  const manualReviewCategories = Array.isArray(record.manualReviewCategories)
    ? record.manualReviewCategories.flatMap(
        (item): Array<{ category: string; clusterCount: number }> => {
          if (!item || typeof item !== 'object') return [];
          const category = (item as Record<string, unknown>).category;
          const clusterCount = (item as Record<string, unknown>).clusterCount;
          if (
            typeof category !== 'string' ||
            typeof clusterCount !== 'number' ||
            !Number.isFinite(clusterCount)
          ) {
            return [];
          }
          return [{ category, clusterCount }];
        },
      )
    : [];
  const requiredReviewerDecisions = Array.isArray(
    sharedWebsiteReview?.requiredReviewerDecisions,
  )
    ? sharedWebsiteReview.requiredReviewerDecisions.filter(
        (item): item is string => typeof item === 'string' && item.trim().length > 0,
      )
    : [];

  const sharedWebsiteClusterCount = sharedWebsiteReview?.clusterCount;
  const sharedWebsiteArtifactPath = sharedWebsiteReview?.outputPath;
  const acceptedDecisionTemplate = normalizeDecisionHandoff(record.acceptedDecisionTemplate, [
    'outputPath',
    'command',
  ]);
  const acceptedDecisionValidation = normalizeAcceptedDecisionValidation(
    record.acceptedDecisionValidation,
  );
  const preflight: DataQualityDuplicateNamePreflightSummary = {
    ...(typeof sharedWebsiteClusterCount === 'number' &&
    Number.isFinite(sharedWebsiteClusterCount)
      ? { sharedWebsiteClusterCount }
      : {}),
    ...(typeof sharedWebsiteArtifactPath === 'string' && sharedWebsiteArtifactPath.trim()
      ? { sharedWebsiteArtifactPath }
      : {}),
    requiredReviewerDecisions,
    manualReviewCategories,
    ...(acceptedDecisionTemplate ? { acceptedDecisionTemplate } : {}),
    ...(acceptedDecisionValidation ? { acceptedDecisionValidation } : {}),
  };

  return requiredReviewerDecisions.length > 0 ||
    manualReviewCategories.length > 0 ||
    acceptedDecisionTemplate ||
    acceptedDecisionValidation
    ? { duplicateNamePreflight: preflight }
    : {};
}

function normalizeSamePiDedupeReview(
  value: unknown,
): { samePiDedupeReview?: DataQualitySamePiDedupeReviewSummary } {
  if (!value || typeof value !== 'object') {
    return {};
  }
  const record = value as Record<string, unknown>;
  const handoff = normalizeDecisionHandoff(record, [
    'applyBlockedReason',
    'applyStatus',
    'reviewArtifactPath',
    'acceptedDecisionInputPath',
    'decisionTemplateOutputPath',
    'acceptedDecisionValidationOutputPath',
    'command',
    'nextAction',
  ]);
  const artifactAvailable =
    typeof record.artifactAvailable === 'boolean' ? record.artifactAvailable : false;
  const acceptedDecisionValidation =
    record.acceptedDecisionValidation && typeof record.acceptedDecisionValidation === 'object'
      ? (record.acceptedDecisionValidation as Record<string, unknown>)
      : {};

  const summary: DataQualitySamePiDedupeReviewSummary = {
    applyBlocked: record.applyBlocked === true,
    artifactAvailable,
    ...(handoff || {}),
    ...copyFiniteNumber(record, 'plannedGroups'),
    ...copyFiniteNumber(record, 'plannedDuplicateEntities'),
    ...normalizeSamePiDedupeReviewBreakdown(record.reviewBreakdown),
    acceptedDecisionValidation: {
      artifactAvailable:
        typeof acceptedDecisionValidation.artifactAvailable === 'boolean'
          ? acceptedDecisionValidation.artifactAvailable
          : false,
      ...copyFiniteNumber(acceptedDecisionValidation, 'totalDecisions'),
      ...copyFiniteNumber(acceptedDecisionValidation, 'validDecisionCount'),
      ...copyFiniteNumber(acceptedDecisionValidation, 'invalidDecisionCount'),
      ...copyFiniteNumber(acceptedDecisionValidation, 'unreviewedPlanCount'),
    },
  };

  return summary.artifactAvailable ||
    summary.reviewArtifactPath ||
    summary.command ||
    typeof summary.plannedGroups === 'number'
    ? { samePiDedupeReview: summary }
    : {};
}

function normalizeSamePiDedupeReviewBreakdown(
  value: unknown,
): { reviewBreakdown?: DataQualitySamePiDedupeReviewBreakdown } {
  if (!value || typeof value !== 'object') {
    return {};
  }
  const record = value as Record<string, unknown>;
  const reviewBreakdown = {
    ...copyFiniteNumber(record, 'totalGroups'),
    ...copyFiniteNumber(record, 'reviewedProfileAreaGroups'),
    ...copyFiniteNumber(record, 'fundingSourceGroups'),
    ...copyFiniteNumber(record, 'crossDepartmentGroups'),
    ...copyFiniteNumber(record, 'groupsWithMergedResearchAreas'),
    ...copyFiniteNumber(record, 'highResearchAreaMergeGroups'),
  };
  return Object.keys(reviewBreakdown).length > 0 ? { reviewBreakdown } : {};
}

function normalizeDecisionHandoff(
  value: unknown,
  fields: string[],
): Record<string, string> | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const normalized = fields.reduce<Record<string, string>>((acc, field) => {
    const fieldValue = record[field];
    if (typeof fieldValue === 'string' && fieldValue.trim()) {
      acc[field] = field === 'command' ? betaTargetCommand(fieldValue) : fieldValue;
    }
    return acc;
  }, {});
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeAcceptedDecisionValidation(
  value: unknown,
): DataQualityDuplicateNamePreflightSummary['acceptedDecisionValidation'] | undefined {
  const handoff = normalizeDecisionHandoff(value, [
    'inputPath',
    'outputPath',
    'expectedArtifactField',
    'command',
  ]);
  if (!handoff) return undefined;

  const outputPath = handoff.outputPath;
  if (!outputPath) return handoff;
  const safeOutputPath = resolveGateArtifactReadPath(outputPath);
  if (!safeOutputPath) {
    return { ...handoff, artifactAvailable: false };
  }
  if (!fs.existsSync(safeOutputPath)) {
    return { ...handoff, artifactAvailable: false };
  }

  try {
    const parsed = readGateArtifactJson(safeOutputPath);
    const validation = parsed?.reviewDecisionValidation;
    if (!validation || typeof validation !== 'object') {
      return { ...handoff, artifactAvailable: false };
    }
    return {
      ...handoff,
      artifactAvailable: true,
      ...copyFiniteNumber(validation, 'totalDecisions'),
      ...copyFiniteNumber(validation, 'validDecisionCount'),
      ...copyFiniteNumber(validation, 'invalidDecisionCount'),
      ...copyFiniteNumber(validation, 'unreviewedPlanCount'),
    };
  } catch {
    return { ...handoff, artifactAvailable: false };
  }
}

function copyFiniteNumber(
  value: Record<string, unknown>,
  field: string,
): Record<string, number> {
  const raw = value[field];
  return typeof raw === 'number' && Number.isFinite(raw) ? { [field]: raw } : {};
}

export function deriveScraperIntegrityGate(input?: ScraperIntegrityGateArtifact) {
  const command = betaTargetCommand('yarn --cwd server scraper:integrity-gate --include-samples');
  if (!input) {
    return {
      status: 'manual' as const,
      command,
      note: 'Gate output is not persisted in this branch yet; run before promotion.',
    };
  }

  if (input.artifactStatus === 'invalid') {
    return {
      status: 'manual' as const,
      command,
      note: 'Saved scraper integrity artifact is not readable; rerun the gate before promotion.',
    };
  }

  if (input.artifactStatus === 'stale') {
    return {
      status: 'manual' as const,
      command,
      note: 'Saved scraper integrity artifact is stale; rerun the gate before promotion.',
      artifactAgeHours: input.ageHours,
    };
  }

  if (input.artifactStatus !== 'loaded') {
    return {
      status: 'manual' as const,
      command,
      note: 'Gate output is not persisted in this branch yet; run before promotion.',
    };
  }

  if (input.integrityStatus === 'failure') {
    return {
      status: 'failure' as const,
      command,
      note: `Latest scraper integrity gate failed with ${input.failureNames.length} failure types.`,
      failureNames: input.failureNames,
      warningCount: input.warningCount,
      recommendedCommands: input.recommendedCommands,
    };
  }

  return {
    status: input.warningCount > 0 ? ('watch' as const) : ('pass' as const),
    command,
    note: `Latest scraper integrity gate artifact passed with ${input.warningCount} warnings.`,
    failureNames: input.failureNames,
    warningCount: input.warningCount,
    recommendedCommands: input.recommendedCommands,
  };
}

export function readScraperIntegrityGateArtifact(
  artifactPath = DEFAULT_SCRAPER_INTEGRITY_SCORECARD_PATH,
  now = new Date(),
): ScraperIntegrityGateArtifact | undefined {
  const safeArtifactPath = resolveGateArtifactReadPath(artifactPath);
  if (!safeArtifactPath) return invalidArtifactPath();
  if (!fs.existsSync(safeArtifactPath)) {
    return undefined;
  }

  try {
    const parsed = readGateArtifactJson(safeArtifactPath);
    if (parsed?.status !== 'pass' && parsed?.status !== 'failure') {
      return {
        artifactStatus: 'invalid',
        artifactPath: safeArtifactPath,
        error: 'status must be pass or failure',
      };
    }

    const generatedAt = typeof parsed.generatedAt === 'string' ? parsed.generatedAt : undefined;
    if (generatedAt) {
      const generatedAtTime = new Date(generatedAt).getTime();
      if (Number.isNaN(generatedAtTime)) {
        return {
          artifactStatus: 'invalid',
          artifactPath: safeArtifactPath,
          error: 'generatedAt must be an ISO timestamp when present',
        };
      }
      const ageHours = Math.floor((now.getTime() - generatedAtTime) / (60 * 60 * 1000));
      if (ageHours > SCRAPER_INTEGRITY_SCORECARD_MAX_AGE_HOURS) {
        return {
          artifactStatus: 'stale',
          artifactPath: safeArtifactPath,
          generatedAt,
          ageHours,
        };
      }
    }

    return {
      artifactStatus: 'loaded',
      artifactPath: safeArtifactPath,
      generatedAt,
      integrityStatus: parsed.status,
      failureNames: Array.isArray(parsed.failureNames)
        ? parsed.failureNames.filter((name: unknown): name is string => typeof name === 'string')
        : [],
      warningCount: Array.isArray(parsed.warnings) ? parsed.warnings.length : 0,
      recommendedCommands: Array.isArray(parsed.recommendedCommands)
        ? parsed.recommendedCommands.filter(
            (command: unknown): command is string => typeof command === 'string',
          ).map(betaTargetCommand)
        : [],
    };
  } catch (error) {
    return {
      artifactStatus: 'invalid',
      artifactPath: safeArtifactPath,
      error: SAVED_ARTIFACT_READ_ERROR,
    };
  }
}

function launchReviewExceptionDecisionValidationForGate(
  artifact?: LaunchReviewExceptionsArtifact,
) {
  if (!artifact) return undefined;
  if (artifact.artifactStatus === 'loaded') {
    return {
      artifactAvailable: true,
      reviewExceptionCount: artifact.reviewExceptionCount,
      plannedCount: artifact.plannedCount,
      planTruncated: artifact.planTruncated,
      totalDecisions: artifact.totalDecisions,
      validDecisionCount: artifact.validDecisionCount,
      invalidDecisionCount: artifact.invalidDecisionCount,
      unreviewedPlanCount: artifact.unreviewedPlanCount,
    };
  }
  if (artifact.artifactStatus === 'stale') {
    return {
      artifactAvailable: false,
      artifactAgeHours: artifact.ageHours,
      note: 'Saved launch review-exception artifact is stale; rerun the validation command.',
    };
  }
  if (artifact.artifactStatus === 'invalid') {
    return {
      artifactAvailable: false,
      note: 'Saved launch review-exception artifact is not readable; rerun the validation command.',
    };
  }
  return undefined;
}

export function deriveLaunchTrustGate(
  input?: LaunchTrustGateArtifact,
  reviewExceptionArtifact?: LaunchReviewExceptionsArtifact,
) {
  const command = betaTargetCommand(
    'yarn --cwd server launch:trust-contract --collection=all --mode=student-ready-only --include-research-activity --include-paper-quality --strict',
  );
  const reviewExceptionDecisionValidation =
    launchReviewExceptionDecisionValidationForGate(reviewExceptionArtifact);
  const reviewExceptionPayload = reviewExceptionDecisionValidation
    ? { reviewExceptionDecisionValidation }
    : {};
  if (!input) {
    return {
      status: 'manual' as const,
      command,
      note: 'Gate output is not persisted in this branch yet; run before promotion.',
      ...reviewExceptionPayload,
    };
  }

  if (input.artifactStatus === 'invalid') {
    return {
      status: 'manual' as const,
      command,
      note: 'Saved launch trust artifact is not readable; rerun the gate before promotion.',
      ...reviewExceptionPayload,
    };
  }

  if (input.artifactStatus === 'stale') {
    return {
      status: 'manual' as const,
      command,
      note: 'Saved launch trust artifact is stale; rerun the gate before promotion.',
      artifactAgeHours: input.ageHours,
      ...reviewExceptionPayload,
    };
  }

  if (input.artifactStatus !== 'loaded') {
    return {
      status: 'manual' as const,
      command,
      note: 'Gate output is not persisted in this branch yet; run before promotion.',
      ...reviewExceptionPayload,
    };
  }

  if (!input.pass) {
    return {
      status: 'blocked' as const,
      command,
      note: `Latest launch trust contract artifact has ${input.heldCount} held rows and ${input.publicVisibilityViolations} public visibility violations.`,
      heldCount: input.heldCount,
      publicVisibilityViolations: input.publicVisibilityViolations,
      repairLaneCount: input.repairLaneCount,
      repairLaneCommands: input.repairLaneCommands,
      ...reviewExceptionPayload,
    };
  }

  return {
    status: 'ready' as const,
    command,
    note: 'Latest launch trust contract artifact passed.',
    heldCount: input.heldCount,
    publicVisibilityViolations: input.publicVisibilityViolations,
    repairLaneCount: input.repairLaneCount,
    repairLaneCommands: input.repairLaneCommands,
    ...reviewExceptionPayload,
  };
}

export function readLaunchTrustGateArtifact(
  artifactPath = DEFAULT_LAUNCH_TRUST_SCORECARD_PATH,
  now = new Date(),
): LaunchTrustGateArtifact | undefined {
  const safeArtifactPath = resolveGateArtifactReadPath(artifactPath);
  if (!safeArtifactPath) return invalidArtifactPath();
  if (!fs.existsSync(safeArtifactPath)) {
    return undefined;
  }

  try {
    const parsed = readGateArtifactJson(safeArtifactPath);
    if (typeof parsed?.pass !== 'boolean' || typeof parsed?.counts !== 'object') {
      return {
        artifactStatus: 'invalid',
        artifactPath: safeArtifactPath,
        error: 'pass and counts are required',
      };
    }

    const generatedAt = typeof parsed.generatedAt === 'string' ? parsed.generatedAt : undefined;
    if (generatedAt) {
      const generatedAtTime = new Date(generatedAt).getTime();
      if (Number.isNaN(generatedAtTime)) {
        return {
          artifactStatus: 'invalid',
          artifactPath: safeArtifactPath,
          error: 'generatedAt must be an ISO timestamp when present',
        };
      }
      const ageHours = Math.floor((now.getTime() - generatedAtTime) / (60 * 60 * 1000));
      if (ageHours > LAUNCH_TRUST_SCORECARD_MAX_AGE_HOURS) {
        return {
          artifactStatus: 'stale',
          artifactPath: safeArtifactPath,
          generatedAt,
          ageHours,
        };
      }
    }

    return {
      artifactStatus: 'loaded',
      artifactPath: safeArtifactPath,
      generatedAt,
      pass: parsed.pass,
      heldCount: Number(parsed.counts.held || 0),
      publicVisibilityViolations: Number(parsed.counts.publicVisibilityViolations || 0),
      repairLaneCount: Array.isArray(parsed.repairLanes) ? parsed.repairLanes.length : 0,
      repairLaneCommands: Array.isArray(parsed.repairLanes)
        ? parsed.repairLanes
            .map((lane: unknown) =>
              typeof (lane as { command?: unknown })?.command === 'string'
                ? (lane as { command: string }).command
                : '',
            )
            .filter(Boolean)
            .map(betaTargetCommand)
        : [],
    };
  } catch (error) {
    return {
      artifactStatus: 'invalid',
      artifactPath: safeArtifactPath,
      error: SAVED_ARTIFACT_READ_ERROR,
    };
  }
}

export function readLaunchReviewExceptionsArtifact(
  artifactPath = DEFAULT_LAUNCH_REVIEW_EXCEPTIONS_REPORT_PATH,
  now = new Date(),
): LaunchReviewExceptionsArtifact | undefined {
  const safeArtifactPath = resolveGateArtifactReadPath(artifactPath);
  if (!safeArtifactPath) return invalidArtifactPath();
  if (!fs.existsSync(safeArtifactPath)) {
    return undefined;
  }

  try {
    const parsed = readGateArtifactJson(safeArtifactPath);
    if (
      typeof parsed?.reviewExceptionCount !== 'number' ||
      typeof parsed?.planSummary !== 'object' ||
      typeof parsed?.reviewDecisionValidation !== 'object'
    ) {
      return {
        artifactStatus: 'invalid',
        artifactPath: safeArtifactPath,
        error: 'reviewExceptionCount, planSummary, and reviewDecisionValidation are required',
      };
    }

    const generatedAt = typeof parsed.generatedAt === 'string' ? parsed.generatedAt : undefined;
    if (generatedAt) {
      const generatedAtTime = new Date(generatedAt).getTime();
      if (Number.isNaN(generatedAtTime)) {
        return {
          artifactStatus: 'invalid',
          artifactPath: safeArtifactPath,
          error: 'generatedAt must be an ISO timestamp when present',
        };
      }
      const ageHours = Math.floor((now.getTime() - generatedAtTime) / (60 * 60 * 1000));
      if (ageHours > LAUNCH_REVIEW_EXCEPTIONS_REPORT_MAX_AGE_HOURS) {
        return {
          artifactStatus: 'stale',
          artifactPath: safeArtifactPath,
          generatedAt,
          ageHours,
        };
      }
    }

    return {
      artifactStatus: 'loaded',
      artifactPath: safeArtifactPath,
      generatedAt,
      reviewExceptionCount: Number(parsed.reviewExceptionCount || 0),
      plannedCount: Number(parsed.planSummary.plannedCount || 0),
      planTruncated: Boolean(parsed.planSummary.planTruncated),
      totalDecisions: Number(parsed.reviewDecisionValidation.totalDecisions || 0),
      validDecisionCount: Number(parsed.reviewDecisionValidation.validDecisionCount || 0),
      invalidDecisionCount: Number(parsed.reviewDecisionValidation.invalidDecisionCount || 0),
      unreviewedPlanCount: Number(parsed.reviewDecisionValidation.unreviewedPlanCount || 0),
    };
  } catch (error) {
    return {
      artifactStatus: 'invalid',
      artifactPath: safeArtifactPath,
      error: SAVED_ARTIFACT_READ_ERROR,
    };
  }
}

export function deriveLaunchAcquisitionGate(input?: LaunchAcquisitionGateArtifact) {
  const command = betaTargetCommand(
    'yarn --cwd server launch:acquisition-report --stage=all --limit=250 --sample-limit=10 --output /tmp/ylabs-launch-acquisition-report.json',
  );
  if (!input) {
    return {
      status: 'manual' as const,
      command,
      note: 'Launch acquisition report is not persisted in this branch yet; run the read-only report before applying repair lanes.',
    };
  }

  if (input.artifactStatus === 'invalid') {
    return {
      status: 'manual' as const,
      command,
      note: 'Saved launch acquisition artifact is not readable; rerun the read-only report before applying repair lanes.',
    };
  }

  if (input.artifactStatus === 'stale') {
    return {
      status: 'manual' as const,
      command,
      note: 'Saved launch acquisition artifact is stale; rerun the read-only report before applying repair lanes.',
      artifactAgeHours: input.ageHours,
    };
  }

  if (input.artifactStatus !== 'loaded') {
    return {
      status: 'manual' as const,
      command,
      note: 'Launch acquisition report is not persisted in this branch yet; run the read-only report before applying repair lanes.',
    };
  }

  const deterministicCandidates = input.exactPiMatches + input.sourceBackedRouteCandidates;
  const base = {
    command,
    scanned: input.scanned,
    piBlockers: input.piBlockers,
    actionBlockers: input.actionBlockers,
    exactPiMatches: input.exactPiMatches,
    sourceBackedRouteCandidates: input.sourceBackedRouteCandidates,
    missingOfficialProfileUrl: input.missingOfficialProfileUrl,
    ambiguousOrMismatchedUserMatch: input.ambiguousOrMismatchedUserMatch,
    sourceObservationsWithoutUndergradAccess: input.sourceObservationsWithoutUndergradAccess,
    untrustedExternalRouteEvidence: input.untrustedExternalRouteEvidence,
  };

  if (deterministicCandidates > 0) {
    return {
      status: 'active' as const,
      note: `Launch acquisition report has ${deterministicCandidates} deterministic PI/action repair candidates; run the matching bounded repair dry-run before any apply.`,
      ...base,
    };
  }

  return {
    status: 'blocked' as const,
    note:
      'Launch acquisition report has no deterministic PI/action repair candidates; remaining rows need new source evidence, materializer logic, or manual disambiguation.',
    ...base,
  };
}

export function readLaunchAcquisitionGateArtifact(
  artifactPath = DEFAULT_LAUNCH_ACQUISITION_REPORT_PATH,
  now = new Date(),
): LaunchAcquisitionGateArtifact | undefined {
  const safeArtifactPath = resolveGateArtifactReadPath(artifactPath);
  if (!safeArtifactPath) return invalidArtifactPath();
  if (!fs.existsSync(safeArtifactPath)) {
    return undefined;
  }

  try {
    const parsed = readGateArtifactJson(safeArtifactPath);
    if (parsed?.mode !== 'read-only' || typeof parsed?.scanned !== 'number') {
      return {
        artifactStatus: 'invalid',
        artifactPath: safeArtifactPath,
        error: 'mode=read-only and scanned are required',
      };
    }

    const generatedAt = typeof parsed.generatedAt === 'string' ? parsed.generatedAt : undefined;
    if (generatedAt) {
      const generatedAtTime = new Date(generatedAt).getTime();
      if (Number.isNaN(generatedAtTime)) {
        return {
          artifactStatus: 'invalid',
          artifactPath: safeArtifactPath,
          error: 'generatedAt must be an ISO timestamp when present',
        };
      }
      const ageHours = Math.floor((now.getTime() - generatedAtTime) / (60 * 60 * 1000));
      if (ageHours > LAUNCH_ACQUISITION_REPORT_MAX_AGE_HOURS) {
        return {
          artifactStatus: 'stale',
          artifactPath: safeArtifactPath,
          generatedAt,
          ageHours,
        };
      }
    }

    const piGroups = parsed.piIdentity?.groups || {};
    const actionGroups = parsed.actionEvidence?.groups || {};
    return {
      artifactStatus: 'loaded',
      artifactPath: safeArtifactPath,
      generatedAt,
      scanned: Number(parsed.scanned || 0),
      piBlockers: Number(parsed.piIdentity?.total || 0),
      actionBlockers: Number(parsed.actionEvidence?.total || 0),
      exactPiMatches: groupCount(piGroups, 'exactSingleUserMatch'),
      sourceBackedRouteCandidates: groupCount(actionGroups, 'sourceBackedRouteNotLaunchMaterialized'),
      missingOfficialProfileUrl: groupCount(piGroups, 'missingOfficialProfileUrl'),
      ambiguousOrMismatchedUserMatch: groupCount(piGroups, 'ambiguousOrMismatchedUserMatch'),
      sourceObservationsWithoutUndergradAccess: groupCount(
        actionGroups,
        'sourceObservationsWithoutUndergradAccess',
      ),
      untrustedExternalRouteEvidence: groupCount(actionGroups, 'untrustedExternalRouteEvidence'),
    };
  } catch (error) {
    return {
      artifactStatus: 'invalid',
      artifactPath: safeArtifactPath,
      error: SAVED_ARTIFACT_READ_ERROR,
    };
  }
}

function groupCount(groups: Record<string, unknown>, key: string): number {
  const row = groups[key];
  if (!row || typeof row !== 'object') return 0;
  const count = (row as Record<string, unknown>).count;
  return typeof count === 'number' && Number.isFinite(count) ? count : 0;
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
  missing_card_description:
    'Derive or backfill a student-facing short description from the source-backed full description.',
  missing_lead:
    'Attach PI, director, or owner evidence, or mark a reviewed non-person-owner exception.',
  pi_identity_conflict:
    'Resolve mismatched User and FacultyMember identity before student visibility promotion.',
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
  const id = operatorBoardDocumentId(row._id);
  return {
    id,
    label: row.name || row.slug || id || '[unknown research]',
    tier: row.studentVisibilityTier,
    reasons: row.studentVisibilityReasons || [],
    sourceUrl: row.websiteUrl || row.sourceUrls?.[0] || '',
    summary: row.shortDescription || '',
  };
}

function compactProgramSample(row: any) {
  const id = operatorBoardDocumentId(row._id);
  return {
    id,
    label: row.title || id || '[unknown program]',
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
      id: operatorBoardDocumentId(sample._id),
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

async function buildRepairQueueSummary() {
  const [stageRows, statusRows, samples] = await Promise.all([
    VisibilityReleaseQueueItem.aggregate([
      { $match: { status: 'open' } },
      {
        $group: {
          _id: { stage: '$repairStage', status: '$repairStatus' },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.stage': 1, '_id.status': 1 } },
    ]),
    VisibilityReleaseQueueItem.aggregate([
      { $match: { status: 'open' } },
      { $group: { _id: '$repairStatus', count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
    ]),
    VisibilityReleaseQueueItem.find({ status: 'open' })
      .select(
        'collection recordId label blockerReasons sourceNames nextRepairAction repairStage repairStatus attemptCount lastAttemptAt appliedPatchSummary remainingBlockers',
      )
      .sort({ repairStage: 1, lastSeenAt: -1, _id: 1 })
      .limit(8)
      .lean(),
  ]);

  const statusCounts = statusRows.reduce<Record<string, number>>((acc, row: any) => {
    acc[row._id || 'queued'] = row.count;
    return acc;
  }, {});
  const plannedSamples: VisibilityRepairPlan[] = samples.map((sample: any) =>
    buildVisibilityRepairPlan(sample),
  );
  const openCount = stageRows.reduce((sum: number, row: any) => sum + row.count, 0);

  return {
    openCount,
    statusCounts,
    byStage: stageRows.map((row: any) => ({
      stage: row._id.stage || 'review_exception',
      status: row._id.status || 'queued',
      count: row.count,
      nextAction: repairActionForStage(row._id.stage || 'review_exception'),
    })),
    samples: samples.map((sample: any, index: number) => {
      const plan = plannedSamples[index];
      return {
        id: operatorBoardDocumentId(sample._id),
        collection: sample.collection,
        recordId: sample.recordId,
        label: sample.label,
        repairStage: plan.repairStage,
        repairStatus: sample.repairStatus || 'queued',
        safeToAttempt: plan.safeToAttempt,
        blockerReasons: sample.blockerReasons || [],
        sourceNames: sample.sourceNames || [],
        nextRepairAction: plan.nextRepairAction,
        attemptCount: sample.attemptCount || 0,
        lastAttemptAt: sample.lastAttemptAt?.toISOString?.() || sample.lastAttemptAt,
        appliedPatchSummary: sample.appliedPatchSummary || [],
        remainingBlockers: sample.remainingBlockers || [],
      };
    }),
  };
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
    reviewSummary: buildSourceHealthReviewSummary(rows),
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

export type GateArtifactFreshnessStatus = 'fresh' | 'stale' | 'missing' | 'unreadable';

export interface GateArtifactFreshness {
  gate: string;
  path: string;
  exists: boolean;
  status: GateArtifactFreshnessStatus;
  generatedAt?: string;
  ageMinutes?: number;
  db?: string;
  environment?: string;
  maxAgeHours: number;
}

const GATE_ARTIFACT_SOURCES: Array<{ gate: string; envVar: string; defaultPath: string }> = [
  {
    gate: 'dataQuality',
    envVar: 'BETA_DATA_QUALITY_SCORECARD_PATH',
    defaultPath: DEFAULT_DATA_QUALITY_SCORECARD_PATH,
  },
  {
    gate: 'scraperIntegrity',
    envVar: 'SCRAPER_INTEGRITY_SCORECARD_PATH',
    defaultPath: DEFAULT_SCRAPER_INTEGRITY_SCORECARD_PATH,
  },
  {
    gate: 'launchTrust',
    envVar: 'LAUNCH_TRUST_SCORECARD_PATH',
    defaultPath: DEFAULT_LAUNCH_TRUST_SCORECARD_PATH,
  },
  {
    gate: 'launchReviewExceptions',
    envVar: 'LAUNCH_REVIEW_EXCEPTIONS_REPORT_PATH',
    defaultPath: DEFAULT_LAUNCH_REVIEW_EXCEPTIONS_REPORT_PATH,
  },
  {
    gate: 'launchAcquisition',
    envVar: 'LAUNCH_ACQUISITION_REPORT_PATH',
    defaultPath: DEFAULT_LAUNCH_ACQUISITION_REPORT_PATH,
  },
  {
    gate: 'betaRepairQueue',
    envVar: 'BETA_REPAIR_QUEUE_REPORT_PATH',
    defaultPath: DEFAULT_BETA_REPAIR_QUEUE_REPORT_PATH,
  },
  {
    gate: 'productionCopy',
    envVar: 'PROMOTION_COPY_DRY_RUN_REPORT_PATH',
    defaultPath: DEFAULT_PROMOTION_COPY_DRY_RUN_REPORT_PATH,
  },
];

/**
 * Uniform provenance for every gate scorecard the board reads: where it came from, when it was
 * generated, against which DB, and whether it is now stale. This is what makes the board honest —
 * the UI can always show "Beta · 7 min ago" instead of presenting a possibly-stale verdict as live.
 */
export function buildGateArtifactFreshness(now = new Date()): GateArtifactFreshness[] {
  const maxAgeHours = GATE_SCORECARD_MAX_AGE_HOURS;
  return GATE_ARTIFACT_SOURCES.map(({ gate, envVar, defaultPath }) => {
    const configuredPath = process.env[envVar] || defaultPath;
    const path = resolveGateArtifactReadPath(configuredPath);
    if (!path) {
      return {
        gate,
        path: UNSAFE_ARTIFACT_PATH,
        maxAgeHours,
        exists: false,
        status: 'unreadable' as const,
      };
    }
    const base = { gate, path, maxAgeHours };
    if (!fs.existsSync(path)) {
      return { ...base, exists: false, status: 'missing' as const };
    }
    try {
      const stat = fs.statSync(path);
      const parsed = readGateArtifactJson(path);
      const generatedAt = typeof parsed.generatedAt === 'string' ? parsed.generatedAt : undefined;
      const generatedAtTime = generatedAt ? new Date(generatedAt).getTime() : stat.mtime.getTime();
      const resolvedTime = Number.isNaN(generatedAtTime) ? stat.mtime.getTime() : generatedAtTime;
      const ageMinutes = Math.max(0, Math.floor((now.getTime() - resolvedTime) / 60000));
      const stale = ageMinutes > maxAgeHours * 60;
      return {
        ...base,
        exists: true,
        status: stale ? ('stale' as const) : ('fresh' as const),
        generatedAt,
        ageMinutes,
        // Audits write `db` inconsistently (some "Beta", some the full mongo URI); show just the
        // database name so the badge reads uniformly.
        db:
          typeof parsed.db === 'string'
            ? parsed.db.split('/').pop() || parsed.db
            : undefined,
        environment: typeof parsed.environment === 'string' ? parsed.environment : undefined,
      };
    } catch {
      return { ...base, exists: true, status: 'unreadable' as const };
    }
  });
}

export async function buildAdminOperatorBoard() {
  const dataQualityArtifact = readDataQualityGateArtifact(
    process.env.BETA_DATA_QUALITY_SCORECARD_PATH || DEFAULT_DATA_QUALITY_SCORECARD_PATH,
  );
  const scraperIntegrityArtifact = readScraperIntegrityGateArtifact(
    process.env.SCRAPER_INTEGRITY_SCORECARD_PATH || DEFAULT_SCRAPER_INTEGRITY_SCORECARD_PATH,
  );
  const launchTrustArtifact = readLaunchTrustGateArtifact(
    process.env.LAUNCH_TRUST_SCORECARD_PATH || DEFAULT_LAUNCH_TRUST_SCORECARD_PATH,
  );
  const launchReviewExceptionsArtifact = readLaunchReviewExceptionsArtifact(
    process.env.LAUNCH_REVIEW_EXCEPTIONS_REPORT_PATH ||
      DEFAULT_LAUNCH_REVIEW_EXCEPTIONS_REPORT_PATH,
  );
  const launchAcquisitionArtifact = readLaunchAcquisitionGateArtifact(
    process.env.LAUNCH_ACQUISITION_REPORT_PATH || DEFAULT_LAUNCH_ACQUISITION_REPORT_PATH,
  );
  const betaRepairQueueArtifact = readBetaRepairQueueGateArtifact(
    process.env.BETA_REPAIR_QUEUE_REPORT_PATH || DEFAULT_BETA_REPAIR_QUEUE_REPORT_PATH,
  );
  const promotionCopyArtifact = readPromotionCopyDryRunArtifact(
    process.env.PROMOTION_COPY_DRY_RUN_REPORT_PATH || DEFAULT_PROMOTION_COPY_DRY_RUN_REPORT_PATH,
  );
  const [
    sourceFreshness,
    researchTierCounts,
    programTierCounts,
    queueSummaries,
    releaseQueue,
    repairQueue,
  ] =
    await Promise.all([
      buildSourceFreshness(),
      countByTier(ResearchEntity, { archived: { $ne: true } }),
      countByTier(Fellowship, { archived: false }),
      buildQueueSummaries(),
      buildReleaseQueueSummary(),
      buildRepairQueueSummary(),
    ]);
  const integrityStatus =
    scraperIntegrityArtifact?.artifactStatus === 'loaded'
      ? scraperIntegrityArtifact.integrityStatus
      : 'unknown';
  const pendingMeiliSync = Boolean(sourceFreshness.latestRunSummary.latestWriteRun);
  const meiliStatus: PromotionStatus | 'unknown' = pendingMeiliSync ? 'watch' : 'unknown';
  const sourceReviewValidationStatus =
    sourceFreshness.reviewSummary?.reviewDecisionValidationStatus;
  const sourceReviewUnreviewedPlanCount =
    (sourceReviewValidationStatus?.staleObservationReview?.unreviewedPlanCount || 0) +
    (sourceReviewValidationStatus?.crossSourceObservationReview?.unreviewedPlanCount || 0);
  const promotionStatus = derivePromotionStatus({
    sourceRiskCounts: sourceFreshness.riskCounts,
    integrityStatus,
    meiliStatus,
    dataQualityPromotionReady:
      dataQualityArtifact?.artifactStatus === 'loaded'
        ? dataQualityArtifact.promotionReady
        : undefined,
  });

  return {
    generatedAt: new Date().toISOString(),
    promotionStatus,
    recommendedNextActions: buildRecommendedNextActions({
      promotionStatus,
      sourceRiskCounts: sourceFreshness.riskCounts,
      pendingMeiliSync,
      dataQualityPromotionBlockerCount:
        dataQualityArtifact?.artifactStatus === 'loaded'
          ? dataQualityArtifact.promotionBlockerCount
          : undefined,
      duplicateNameUnreviewedPlanCount:
        dataQualityArtifact?.artifactStatus === 'loaded'
          ? dataQualityArtifact.duplicateNamePreflight?.acceptedDecisionValidation
              ?.unreviewedPlanCount
          : undefined,
      samePiDedupeUnreviewedPlanCount:
        dataQualityArtifact?.artifactStatus === 'loaded'
          ? dataQualityArtifact.samePiDedupeReview?.acceptedDecisionValidation
              .unreviewedPlanCount
          : undefined,
      launchHeldCount:
        launchTrustArtifact?.artifactStatus === 'loaded' ? launchTrustArtifact.heldCount : undefined,
      launchReviewExceptionUnreviewedCount:
        launchReviewExceptionsArtifact?.artifactStatus === 'loaded'
          ? launchReviewExceptionsArtifact.unreviewedPlanCount
          : undefined,
      sourceReviewUnreviewedPlanCount:
        sourceReviewUnreviewedPlanCount > 0 ? sourceReviewUnreviewedPlanCount : undefined,
    }),
    trustTiers: {
      research: researchTierCounts,
      programs: programTierCounts,
    },
    releaseQueue,
    repairQueue,
    ...queueSummaries,
    gates: {
      repairQueue: deriveRepairQueueGate(repairQueue.openCount, betaRepairQueueArtifact),
      dataQuality: deriveDataQualityGate(dataQualityArtifact),
      scraperIntegrity: deriveScraperIntegrityGate(scraperIntegrityArtifact),
      launchTrust: deriveLaunchTrustGate(launchTrustArtifact, launchReviewExceptionsArtifact),
      launchAcquisition: deriveLaunchAcquisitionGate(launchAcquisitionArtifact),
      productionCopy: derivePromotionCopyGate(promotionCopyArtifact),
      meili: {
        status: meiliStatus,
        pendingSync: pendingMeiliSync,
        note: pendingMeiliSync
          ? 'A recent non-dry scraper run exists; confirm Mongo changes were rebuilt into Meili before promotion.'
          : 'Meili index stats are not persisted in this branch yet.',
      },
    },
    sourceFreshness,
    artifactFreshness: buildGateArtifactFreshness(),
  };
}
