/**
 * The classification behind `research-entity:audit-archive-attribution` (#2558).
 *
 * Archiving is a bulk state change that removes a row from every student surface,
 * and until `archivedReason` was modelled nothing on the row recorded which lane
 * decided it. An archive nobody can attribute cannot be reviewed, so the audit's
 * job is to make the unattributable set countable and one-way: it can only shrink,
 * because `archivedEntityUpdate` now refuses a write that does not name its lane.
 */
export type ArchiveAttributionState =
  | 'attributed'
  | 'inferable_merge'
  | 'inferable_suppression'
  | 'unattributable';

export interface ArchivedRowAttributionInput {
  entityType?: unknown;
  archivedReason?: unknown;
  canonicalGroupId?: unknown;
  studentVisibilitySuppressionReason?: unknown;
}

const presentText = (value: unknown): string =>
  typeof value === 'string'
    ? value.trim()
    : value === undefined || value === null
      ? ''
      : String(value);

/**
 * Inference is ranked below a recorded attribution and reported separately from it,
 * because a fingerprint is evidence that A lane ran rather than a record of which
 * one did: several lanes write `canonicalGroupId`. Timestamps deliberately play no
 * part. `updatedAt` is the row's last write of any kind, so a later materialize or
 * gate pass overwrites the moment the archive happened, and clustering on it
 * attributes a historical archive to whichever pass touched the row most recently.
 */
export function classifyArchiveAttribution(
  row: ArchivedRowAttributionInput,
): ArchiveAttributionState {
  if (presentText(row.archivedReason)) return 'attributed';
  if (presentText(row.canonicalGroupId)) return 'inferable_merge';
  if (presentText(row.studentVisibilitySuppressionReason)) return 'inferable_suppression';
  return 'unattributable';
}

export interface ArchiveAttributionEntityTypeSummary {
  total: number;
  attributed: number;
  inferableMerge: number;
  inferableSuppression: number;
  unattributable: number;
}

export interface ArchiveAttributionReport {
  archivedRows: number;
  byState: Record<ArchiveAttributionState, number>;
  byEntityType: Record<string, ArchiveAttributionEntityTypeSummary>;
  byReason: Record<string, number>;
  unattributableRows: number;
  status: 'clean' | 'unattributable-archives';
}

const STATE_TO_SUMMARY_KEY: Record<
  ArchiveAttributionState,
  keyof Omit<ArchiveAttributionEntityTypeSummary, 'total'>
> = {
  attributed: 'attributed',
  inferable_merge: 'inferableMerge',
  inferable_suppression: 'inferableSuppression',
  unattributable: 'unattributable',
};

export const ARCHIVE_ATTRIBUTION_ALARM_EXIT_CODE = 2;

export function summarizeArchiveAttribution(
  rows: readonly ArchivedRowAttributionInput[],
): ArchiveAttributionReport {
  const byState: Record<ArchiveAttributionState, number> = {
    attributed: 0,
    inferable_merge: 0,
    inferable_suppression: 0,
    unattributable: 0,
  };
  const byEntityType: Record<string, ArchiveAttributionEntityTypeSummary> = {};
  const byReason: Record<string, number> = {};

  for (const row of rows) {
    const state = classifyArchiveAttribution(row);
    byState[state] += 1;
    const entityType = presentText(row.entityType) || '(none)';
    const summary = (byEntityType[entityType] ||= {
      total: 0,
      attributed: 0,
      inferableMerge: 0,
      inferableSuppression: 0,
      unattributable: 0,
    });
    summary.total += 1;
    summary[STATE_TO_SUMMARY_KEY[state]] += 1;
    const reason = presentText(row.archivedReason);
    if (reason) byReason[reason] = (byReason[reason] || 0) + 1;
  }

  return {
    archivedRows: rows.length,
    byState,
    byEntityType,
    byReason,
    unattributableRows: byState.unattributable,
    status: byState.unattributable > 0 ? 'unattributable-archives' : 'clean',
  };
}
