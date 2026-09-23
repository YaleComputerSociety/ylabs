import { studentVisibilityFields } from './studentVisibility';

type StudentVisibilityField = keyof typeof studentVisibilityFields;

/**
 * "Live" is spelled `$ne: true`, which is what every serve path and product
 * aggregation already uses. Four scripts had copy-pasted an `$or` form instead;
 * the two agree on a row whose `archived` is true or false and disagree on one
 * where it is null, so a single owner removes a latent split (#2896).
 */
export const LIVE_ENTITY_FILTER: Record<string, unknown> = { archived: { $ne: true } };

export const liveEntityFilter = <T extends Record<string, unknown>>(
  match?: T,
): Record<string, unknown> => ({ ...(match || {}), ...LIVE_ENTITY_FILTER });

/**
 * The gate refuses to look at an archived row, so a verdict stored on one is
 * never recomputed and never withdrawn. These four fields are the verdict and
 * are cleared when a row is archived; the override, reviewer and suppression
 * fields are operator intent rather than a derived verdict, so they survive.
 */
export const ARCHIVED_CLEARED_STUDENT_VISIBILITY_FIELDS: readonly StudentVisibilityField[] = [
  'studentVisibilityTier',
  'studentVisibilityComputedTier',
  'studentVisibilityReasons',
  'studentVisibilityComputedAt',
];

export const clearedStudentVisibilityVerdict = (): Record<string, ''> =>
  Object.fromEntries(ARCHIVED_CLEARED_STUDENT_VISIBILITY_FIELDS.map((field) => [field, '']));

export const archivedStudentVisibilityVerdictFilter = (): Record<string, unknown> => ({
  archived: true,
  $or: ARCHIVED_CLEARED_STUDENT_VISIBILITY_FIELDS.map((field) => ({ [field]: { $exists: true } })),
});

/**
 * The fields that record who archived a row and when. Modelled rather than written
 * ad hoc, because an unmodelled path is silently stripped from a write through the
 * model: that is how 374 archived `LAB` rows came to carry no trace of any archiver
 * at all, which makes a bulk state change unattributable after the fact (#2558).
 */
export const ARCHIVE_ATTRIBUTION_FIELDS = ['archivedReason', 'archivedAt'] as const;

export const archiveAttributionFields = {
  archivedReason: {
    type: String,
    default: '',
  },
  archivedAt: {
    type: Date,
    required: false,
  },
} as const;

/**
 * The attributions the two bulk archivers record. Named here rather than at each
 * call site so the attribution audit can recognize them without restating a
 * string literal that would drift from the writer (#2558).
 */
export const DEPT_ROSTER_SHELL_FOLD_ARCHIVE_REASON = 'materialize:fold-dept-roster-shell';
export const PI_DEDUPE_ARCHIVE_REASON = 'research-entity:dedupe-by-pi';

/**
 * The one update document that archives a row. Callers pass the lane or rule that
 * decided to archive, plus the fields their own lane records (a canonical id, a
 * timestamp), and never restate `archived` or the verdict clearing, so a new
 * archive site cannot reintroduce a stale tier.
 *
 * The attribution is a required argument rather than an optional field, so a new
 * archive site cannot be unattributable by omission (#2558).
 */
export const archivedEntityUpdate = (
  archivedReason: string,
  set: Record<string, unknown> = {},
): { $set: Record<string, unknown>; $unset: Record<string, ''> } => {
  const reason = typeof archivedReason === 'string' ? archivedReason.trim() : '';
  if (!reason) {
    throw new Error('archivedEntityUpdate requires a non-empty archivedReason attribution.');
  }
  return {
    $set: { archived: true, archivedReason: reason, archivedAt: new Date(), ...set },
    $unset: clearedStudentVisibilityVerdict(),
  };
};
