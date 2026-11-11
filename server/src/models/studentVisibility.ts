import mongoose from 'mongoose';

export const studentVisibilityTiers = [
  'student_ready',
  'limited_but_safe',
  'operator_review',
  'suppressed',
] as const;

export type StudentVisibilityTier = (typeof studentVisibilityTiers)[number];

export const publicStudentVisibilityTiers: StudentVisibilityTier[] = ['student_ready'];

export const publicSafeStudentVisibilityTiers: StudentVisibilityTier[] = [
  'student_ready',
  'limited_but_safe',
];

export const studentVisibilityFields = {
  studentVisibilityTier: {
    type: String,
    enum: studentVisibilityTiers,
    default: 'operator_review',
  },
  studentVisibilityComputedTier: {
    type: String,
    enum: studentVisibilityTiers,
    default: 'operator_review',
  },
  studentVisibilityOverrideTier: {
    type: String,
    enum: studentVisibilityTiers,
    required: false,
  },
  studentVisibilityReasons: {
    type: [String],
    default: [],
  },
  studentVisibilitySuppressionReason: {
    type: String,
    default: '',
  },
  studentVisibilityComputedAt: {
    type: Date,
    required: false,
  },
  /**
   * When the gate last DECIDED this row, whether or not the decision changed it.
   * `studentVisibilityComputedAt` only moves on a material change, so it cannot tell
   * "re-decided, unchanged" from "never re-decided" and a re-gate cannot be verified
   * from it (#2604). Only the gate writes this field, so it is not operator-settable.
   */
  studentVisibilityEvaluatedAt: {
    type: Date,
    required: false,
  },
  studentVisibilityReviewedAt: {
    type: Date,
    required: false,
  },
  studentVisibilityReviewedByAccountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Account',
    required: false,
  },
  /**
   * Who reviewed the row, by netid. Accounts are environment-local and never
   * promoted (#5088), so an account `_id` written here would name nobody once the
   * row reaches another environment; the netid names the same person everywhere.
   */
  studentVisibilityReviewedByNetid: {
    type: String,
    trim: true,
    lowercase: true,
    maxlength: 32,
    required: false,
  },
};

export const isStudentVisibilityTier = (value: unknown): value is StudentVisibilityTier =>
  typeof value === 'string' && studentVisibilityTiers.includes(value as StudentVisibilityTier);

export const holdingStudentVisibilityOverrideTiers: readonly StudentVisibilityTier[] = [
  'operator_review',
  'suppressed',
];

const isHoldingOverrideTier = (value: unknown): value is StudentVisibilityTier =>
  typeof value === 'string' &&
  (holdingStudentVisibilityOverrideTiers as readonly string[]).includes(value);

/**
 * An operator hold outranks the stored tier, which only the gate rewrites and which a
 * rematerialize or any other writer can leave above the hold, so every serve path reads
 * the tier through this function or `servedStudentVisibilityTierFilter` (#5783).
 */
export const effectiveStudentVisibilityTier = (
  record: Record<string, any> | null | undefined,
): string => {
  if (isHoldingOverrideTier(record?.studentVisibilityOverrideTier)) {
    return record!.studentVisibilityOverrideTier;
  }
  return typeof record?.studentVisibilityTier === 'string' ? record.studentVisibilityTier : '';
};

export const servesStudentVisibilityTier = (
  record: Record<string, any> | null | undefined,
  tiers: readonly StudentVisibilityTier[] = publicStudentVisibilityTiers,
): boolean => (tiers as readonly string[]).includes(effectiveStudentVisibilityTier(record));

/**
 * The Mongo form of `servesStudentVisibilityTier` for a tier set that holds no operator
 * hold tier, which is every student-facing set. A set that does name a hold tier is an
 * operator view, which reads the stored tier as it always has.
 */
export const servedStudentVisibilityTierFilter = (
  tiers: readonly StudentVisibilityTier[] = publicStudentVisibilityTiers,
): Record<string, unknown> => {
  const tierClause = { studentVisibilityTier: { $in: [...tiers] } };
  if (tiers.some(isHoldingOverrideTier)) return tierClause;
  return {
    ...tierClause,
    studentVisibilityOverrideTier: { $nin: [...holdingStudentVisibilityOverrideTiers] },
  };
};
