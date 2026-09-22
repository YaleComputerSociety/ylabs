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
 * The one update document that archives a row. Callers pass the fields their own
 * lane records (a canonical id, a timestamp) and never restate `archived` or the
 * verdict clearing, so a new archive site cannot reintroduce a stale tier.
 */
export const archivedEntityUpdate = (
  set: Record<string, unknown> = {},
): { $set: Record<string, unknown>; $unset: Record<string, ''> } => ({
  $set: { archived: true, ...set },
  $unset: clearedStudentVisibilityVerdict(),
});
