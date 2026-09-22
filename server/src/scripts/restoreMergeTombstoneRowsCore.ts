export const MERGE_TOMBSTONE_RESTORE_ACTIONS = [
  'restore_deleted_shell',
  'mint_stranded_key_tombstone',
  'stamp_missing_tombstone',
] as const;
export type MergeTombstoneRestoreAction = (typeof MERGE_TOMBSTONE_RESTORE_ACTIONS)[number];

export const MERGE_TOMBSTONE_SKIP_REASONS = [
  'tombstone_already_correct',
  'live_row_holds_slug',
  'no_live_canonical',
  'no_merged_slug',
] as const;
export type MergeTombstoneSkipReason = (typeof MERGE_TOMBSTONE_SKIP_REASONS)[number];

export interface MergeRedirectRecord {
  mergedSlug?: string;
  mergedEntityId?: string;
  canonicalEntityId?: string;
  reason?: string;
}

export interface ExistingRowProbe {
  id: string;
  archived: boolean;
  canonicalGroupId?: string;
}

/**
 * Every arm keys on a PROBE of current state rather than on the redirect row's own
 * bookkeeping, so a second run re-derives the same decision instead of going blind
 * once the first run has changed the corpus (#2858).
 */
export interface MergeTombstoneProbes {
  rowBySlug: (slug: string) => ExistingRowProbe | undefined;
  idIsFree: (id: string) => boolean;
  liveCanonicalIdFor: (redirect: MergeRedirectRecord) => string | undefined;
}

export interface MergeTombstonePlan {
  mergedSlug: string;
  action: MergeTombstoneRestoreAction;
  canonicalEntityId: string;
  restoreEntityId?: string;
  existingRowId?: string;
  reason?: string;
}

export interface MergeTombstoneSkip {
  mergedSlug: string;
  reason: MergeTombstoneSkipReason;
  existingRowId?: string;
}

export interface MergeTombstoneRestorePlanSummary {
  scanned: number;
  plans: MergeTombstonePlan[];
  skipped: MergeTombstoneSkip[];
  plannedByAction: Record<MergeTombstoneRestoreAction, number>;
  skippedByReason: Record<MergeTombstoneSkipReason, number>;
}

function emptyActionCounts(): Record<MergeTombstoneRestoreAction, number> {
  return MERGE_TOMBSTONE_RESTORE_ACTIONS.reduce(
    (counts, action) => ({ ...counts, [action]: 0 }),
    {} as Record<MergeTombstoneRestoreAction, number>,
  );
}

function emptySkipCounts(): Record<MergeTombstoneSkipReason, number> {
  return MERGE_TOMBSTONE_SKIP_REASONS.reduce(
    (counts, reason) => ({ ...counts, [reason]: 0 }),
    {} as Record<MergeTombstoneSkipReason, number>,
  );
}

export function tombstoneNameFromSlug(slug: string): string {
  const words = slug
    .split('-')
    .map((word) => word.trim())
    .filter(Boolean);
  if (words.length === 0) return slug;
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

export function buildMergeTombstoneRestorePlan(input: {
  redirects: MergeRedirectRecord[];
  probes: MergeTombstoneProbes;
}): MergeTombstoneRestorePlanSummary {
  const plans: MergeTombstonePlan[] = [];
  const skipped: MergeTombstoneSkip[] = [];
  const plannedByAction = emptyActionCounts();
  const skippedByReason = emptySkipCounts();
  const claimedSlugs = new Set<string>();

  const skip = (mergedSlug: string, reason: MergeTombstoneSkipReason, existingRowId?: string) => {
    skipped.push({ mergedSlug, reason, ...(existingRowId ? { existingRowId } : {}) });
    skippedByReason[reason] += 1;
  };

  for (const redirect of input.redirects) {
    const mergedSlug = redirect.mergedSlug?.trim() ?? '';
    if (!mergedSlug) {
      skip('', 'no_merged_slug');
      continue;
    }

    const canonicalEntityId = input.probes.liveCanonicalIdFor(redirect);
    if (!canonicalEntityId) {
      skip(mergedSlug, 'no_live_canonical');
      continue;
    }

    const existing = input.probes.rowBySlug(mergedSlug);

    if (existing && !existing.archived) {
      skip(mergedSlug, 'live_row_holds_slug', existing.id);
      continue;
    }

    if (existing?.canonicalGroupId) {
      skip(mergedSlug, 'tombstone_already_correct', existing.id);
      continue;
    }

    if (existing) {
      plans.push({
        mergedSlug,
        action: 'stamp_missing_tombstone',
        canonicalEntityId,
        existingRowId: existing.id,
        ...(redirect.reason ? { reason: redirect.reason } : {}),
      });
      plannedByAction.stamp_missing_tombstone += 1;
      continue;
    }

    if (claimedSlugs.has(mergedSlug)) {
      skip(mergedSlug, 'tombstone_already_correct');
      continue;
    }
    claimedSlugs.add(mergedSlug);

    const restoreEntityId =
      redirect.mergedEntityId && input.probes.idIsFree(redirect.mergedEntityId)
        ? redirect.mergedEntityId
        : undefined;
    const action: MergeTombstoneRestoreAction = redirect.mergedEntityId
      ? 'restore_deleted_shell'
      : 'mint_stranded_key_tombstone';

    plans.push({
      mergedSlug,
      action,
      canonicalEntityId,
      ...(restoreEntityId ? { restoreEntityId } : {}),
      ...(redirect.reason ? { reason: redirect.reason } : {}),
    });
    plannedByAction[action] += 1;
  }

  return {
    scanned: input.redirects.length,
    plans,
    skipped,
    plannedByAction,
    skippedByReason,
  };
}
