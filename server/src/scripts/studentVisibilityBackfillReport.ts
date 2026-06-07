import { publicStudentVisibilityTiers, type StudentVisibilityTier } from '../models/studentVisibility';

export interface StudentVisibilityPlannedUpdate {
  id: string;
  label: string;
  currentTier?: string;
  tier: StudentVisibilityTier;
  computedTier: StudentVisibilityTier;
  reasons: string[];
}

export interface StudentVisibilityBackfillCollectionReport {
  scanned: number;
  counts: Record<string, number>;
  computedCounts: Record<string, number>;
  currentCounts: Record<string, number>;
  reasonCounts: Record<string, number>;
  changedCount: number;
  publicCount: number;
  currentPublicCount: number;
  applySafety: {
    safeToApply: boolean;
    recommendation: 'apply' | 'do_not_apply' | 'repair_source_materialization_first';
    blockers: string[];
  };
  samplesByReason: Array<{
    reason: string;
    count: number;
    samples: Array<StudentVisibilityPlannedUpdate & { nextRepairAction: string }>;
  }>;
}

const PUBLIC_TIERS = new Set<string>(publicStudentVisibilityTiers);
const DEFAULT_REASON_SAMPLE_SIZE = 3;
const DEFAULT_MINIMUM_PUBLIC_COUNT = 1;
const DEFAULT_MAX_PUBLIC_COLLAPSE_RATIO = 0.5;

export function incrementCount(counts: Record<string, number>, key: string | undefined) {
  const countKey = key || 'unset';
  counts[countKey] = (counts[countKey] || 0) + 1;
}

function normalizeReasonSampleSize(reasonSampleSize: number | undefined): number {
  if (reasonSampleSize === undefined) return DEFAULT_REASON_SAMPLE_SIZE;
  if (!Number.isSafeInteger(reasonSampleSize) || reasonSampleSize < 1) {
    throw new Error('--reason-sample-size must be a safe positive integer');
  }
  return reasonSampleSize;
}

function normalizeMinimumPublicCount(minimumPublicCount: number | undefined): number {
  if (minimumPublicCount === undefined) return DEFAULT_MINIMUM_PUBLIC_COUNT;
  if (!Number.isSafeInteger(minimumPublicCount) || minimumPublicCount < 0) {
    throw new Error('--minimum-public-count must be a safe non-negative integer');
  }
  return minimumPublicCount;
}

function normalizeMaxPublicCollapseRatio(maxPublicCollapseRatio: number | undefined): number {
  if (maxPublicCollapseRatio === undefined) return DEFAULT_MAX_PUBLIC_COLLAPSE_RATIO;
  if (!Number.isFinite(maxPublicCollapseRatio) || maxPublicCollapseRatio < 0) {
    throw new Error('--max-public-collapse-ratio must be a finite non-negative number');
  }
  return maxPublicCollapseRatio;
}

export function nextRepairActionForReasons(reasons: string[]): string {
  if (reasons.includes('inactive_at_yale')) return 'Suppress or repair active-at-Yale evidence.';
  if (reasons.includes('formalization_only')) {
    return 'Keep capped unless source evidence shows mentor matching, project placement, internship, RA program, or another real entry route.';
  }
  if (reasons.includes('exact_url_duplicate_risk')) {
    return 'Suppress the duplicate shell; preserve the stronger canonical research profile.';
  }
  if (reasons.includes('generic_directory_shell')) {
    return 'Suppress the directory-only shell unless a specific source profile can be attached.';
  }
  if (reasons.includes('profile_biography_shell')) {
    return 'Suppress the profile-only biography shell unless a real research home, lead, or access route can be attached.';
  }
  if (reasons.includes('non_owner_grant_shell')) {
    return 'Suppress the grant shell unless a durable PI-owned research home or student access route is found.';
  }
  if (reasons.includes('duplicate_risk')) return 'Resolve duplicate or disambiguation risk.';
  if (reasons.includes('content_page_risk')) return 'Suppress content pages or remap to a real research home.';
  if (reasons.includes('pi_identity_conflict')) return 'Resolve mismatched PI identity before promotion.';
  if (reasons.includes('missing_lead')) return 'Attach a source-backed PI, director, or lead member.';
  if (reasons.includes('missing_card_description')) {
    return 'Backfill a student-facing short description from source-backed research text.';
  }
  if (reasons.includes('missing_description')) return 'Backfill a source-backed research description.';
  if (reasons.includes('thin_description')) return 'Replace thin copy with a useful source-backed description.';
  if (reasons.includes('profile_fallback_only')) return 'Verify the profile-derived description against an entity source.';
  if (reasons.includes('missing_source_url')) return 'Attach an official source URL.';
  if (reasons.includes('missing_action_evidence')) {
    return 'Add source-backed access or pathway evidence only if it exists.';
  }
  return 'Operator review.';
}

export function buildCollectionReport(
  updates: StudentVisibilityPlannedUpdate[],
  options: {
    collectionName: 'research' | 'programs';
    reasonSampleSize?: number;
    minimumPublicCount?: number;
    maxPublicCollapseRatio?: number;
  },
): StudentVisibilityBackfillCollectionReport {
  const reasonSampleSize = normalizeReasonSampleSize(options.reasonSampleSize);
  const minimumPublicCount = normalizeMinimumPublicCount(options.minimumPublicCount);
  const maxPublicCollapseRatio = normalizeMaxPublicCollapseRatio(options.maxPublicCollapseRatio);
  const counts: Record<string, number> = {};
  const computedCounts: Record<string, number> = {};
  const currentCounts: Record<string, number> = {};
  const reasonCounts: Record<string, number> = {};
  const reasonSamples = new Map<
    string,
    Array<StudentVisibilityPlannedUpdate & { nextRepairAction: string }>
  >();
  let changedCount = 0;
  let publicCount = 0;
  let currentPublicCount = 0;

  for (const update of updates) {
    incrementCount(counts, update.tier);
    incrementCount(computedCounts, update.computedTier);
    incrementCount(currentCounts, update.currentTier);
    if (update.currentTier !== update.tier) changedCount += 1;
    if (PUBLIC_TIERS.has(update.tier)) publicCount += 1;
    if (PUBLIC_TIERS.has(update.currentTier || '')) currentPublicCount += 1;

    for (const reason of update.reasons) {
      incrementCount(reasonCounts, reason);
      const samples = reasonSamples.get(reason) || [];
      if (samples.length < reasonSampleSize) {
        samples.push({
          ...update,
          nextRepairAction: nextRepairActionForReasons(update.reasons),
        });
        reasonSamples.set(reason, samples);
      }
    }
  }

  const blockers: string[] = [];
  if (updates.length > 0 && publicCount < minimumPublicCount) {
    blockers.push(
      `${options.collectionName} computed public tier count ${publicCount} is below minimum ${minimumPublicCount}`,
    );
  }
  if (
    currentPublicCount > 0 &&
    publicCount < Math.ceil(currentPublicCount * maxPublicCollapseRatio)
  ) {
    blockers.push(
      `${options.collectionName} computed public tier count ${publicCount} would collapse current public count ${currentPublicCount}`,
    );
  }

  const safeToApply = blockers.length === 0;
  const recommendation = safeToApply
    ? 'apply'
    : options.collectionName === 'research'
      ? 'repair_source_materialization_first'
      : 'do_not_apply';

  return {
    scanned: updates.length,
    counts,
    computedCounts,
    currentCounts,
    reasonCounts,
    changedCount,
    publicCount,
    currentPublicCount,
    applySafety: {
      safeToApply,
      recommendation,
      blockers,
    },
    samplesByReason: Object.entries(reasonCounts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([reason, count]) => ({
        reason,
        count,
        samples: reasonSamples.get(reason) || [],
      })),
  };
}
