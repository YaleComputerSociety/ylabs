import type mongoose from 'mongoose';

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
 * never recomputed and never withdrawn. These five fields are the verdict the
 * gate writes, and they are cleared when a row is archived; the override,
 * reviewer and suppression fields are operator intent rather than a derived
 * verdict, so they survive (#2896).
 *
 * The two lists partition `studentVisibilityFields`, and a test asserts it, so a
 * field added to the schema fails until someone decides which side it is on
 * rather than defaulting to surviving.
 */
export const ARCHIVED_CLEARED_STUDENT_VISIBILITY_FIELDS: readonly StudentVisibilityField[] = [
  'studentVisibilityTier',
  'studentVisibilityComputedTier',
  'studentVisibilityReasons',
  'studentVisibilityComputedAt',
  'studentVisibilityEvaluatedAt',
];

export const ARCHIVED_PRESERVED_STUDENT_VISIBILITY_FIELDS: readonly StudentVisibilityField[] = [
  'studentVisibilityOverrideTier',
  'studentVisibilitySuppressionReason',
  'studentVisibilityReviewedAt',
  'studentVisibilityReviewedByAccountId',
];

export const studentVisibilityFieldNames = (): StudentVisibilityField[] =>
  Object.keys(studentVisibilityFields) as StudentVisibilityField[];

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
export const PROGRAM_LIVES_ON_PROGRAMS_ARCHIVE_REASON = 'materialize:program-lives-on-programs';
export const PI_DEDUPE_ARCHIVE_REASON = 'research-entity:dedupe-by-pi';
export const SAME_LEAD_DUPLICATE_MERGE_ARCHIVE_REASON =
  'Merged into the corroborated survivor of its duplicate-url group: same lead person plus a corroborating name or shell asymmetry (#3326).';

export const PI_DEDUPE_SELF_RELATIONSHIP_ARCHIVE_REASON =
  'research-entity:dedupe-by-pi:self-relationship';
export const SUPERSEDED_RELATIONSHIP_TYPE_ARCHIVE_REASON =
  'materialize:relationship-type-superseded';

export const GRANT_SHELL_FACULTY_PORT_ARCHIVE_REASON =
  'research-entity:port-grant-shells-to-faculty-profiles';

/**
 * A grant enriches a research row and never creates one (#3145), so a faculty-typed row
 * whose every citation is a grant record exists only because a grant lane minted it.
 */
export const GRANT_ONLY_ROW_ARCHIVE_REASON =
  'research-entity:port-grant-shells-to-faculty-profiles:grant-only';

/**
 * The archivers that fold a row into a canonical one automatically. The eval harness reads
 * this to tell a merge a script decided from one an operator did, because a label produced
 * by the system under measurement caps its recall at what that system already found (#3514).
 */
export const AUTOMATED_MERGE_ARCHIVE_REASONS: readonly string[] = [
  PI_DEDUPE_ARCHIVE_REASON,
  DEPT_ROSTER_SHELL_FOLD_ARCHIVE_REASON,
  SAME_LEAD_DUPLICATE_MERGE_ARCHIVE_REASON,
  GRANT_SHELL_FACULTY_PORT_ARCHIVE_REASON,
];

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
  return {
    $set: attributedArchiveSet(archivedReason, set),
    $unset: clearedStudentVisibilityVerdict(),
  };
};

export const attributedArchiveSet = (
  archivedReason: string,
  set: Record<string, unknown> = {},
): Record<string, unknown> => {
  const reason = typeof archivedReason === 'string' ? archivedReason.trim() : '';
  if (!reason) {
    throw new Error('An archive requires a non-empty archivedReason attribution.');
  }
  return { archived: true, archivedReason: reason, archivedAt: new Date(), ...set };
};

const ARCHIVE_GUARDED_UPDATES: mongoose.MongooseQueryMiddleware[] = [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
];

const updateSetFields = (update: Record<string, unknown>): Record<string, unknown> => ({
  ...Object.fromEntries(Object.entries(update).filter(([key]) => !key.startsWith('$'))),
  ...((update.$set as Record<string, unknown> | undefined) ?? {}),
});

/**
 * Refuses an update that archives a row without saying why, and withdraws the old
 * attribution from a row an update revives, so a live row never reads as archived
 * by a lane that no longer holds it (#3935). Raw collection writes bypass this, so
 * they must build their update with `attributedArchiveSet`.
 */
export const enforceArchiveAttribution = (schema: mongoose.Schema): void => {
  schema.pre(ARCHIVE_GUARDED_UPDATES, function (this: mongoose.Query<unknown, unknown>) {
    const update = this.getUpdate() as Record<string, unknown> | null;
    if (!update || Array.isArray(update)) return;
    const set = updateSetFields(update);
    if (set.archived === true) {
      const reason = typeof set.archivedReason === 'string' ? set.archivedReason.trim() : '';
      if (!reason) {
        throw new Error('An archive requires a non-empty archivedReason attribution.');
      }
      return;
    }
    if (set.archived === false) {
      const unset = (update.$unset as Record<string, unknown> | undefined) ?? {};
      for (const field of ARCHIVE_ATTRIBUTION_FIELDS) {
        if (!(field in set)) unset[field] = '';
      }
      update.$unset = unset;
    }
  });
};
