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
};

export const isStudentVisibilityTier = (value: unknown): value is StudentVisibilityTier =>
  typeof value === 'string' && studentVisibilityTiers.includes(value as StudentVisibilityTier);
