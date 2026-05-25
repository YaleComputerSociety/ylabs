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

export function incrementCount(counts: Record<string, number>, key: string | undefined) {
  const countKey = key || 'unset';
  counts[countKey] = (counts[countKey] || 0) + 1;
}

export function nextRepairActionForReasons(reasons: string[]): string {
  if (reasons.includes('inactive_at_yale')) return 'Suppress or repair active-at-Yale evidence.';
  if (reasons.includes('duplicate_risk')) return 'Resolve duplicate or disambiguation risk.';
  if (reasons.includes('content_page_risk')) return 'Suppress content pages or remap to a real research home.';
  if (reasons.includes('missing_lead')) return 'Attach a source-backed PI, director, or lead member.';
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
  const reasonSampleSize = Math.max(1, Math.floor(options.reasonSampleSize || 3));
  const minimumPublicCount = Math.max(0, Math.floor(options.minimumPublicCount ?? 1));
  const maxPublicCollapseRatio = Math.max(0, options.maxPublicCollapseRatio ?? 0.5);
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
