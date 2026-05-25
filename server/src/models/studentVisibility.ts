import mongoose from 'mongoose';

export const studentVisibilityTiers = [
  'student_ready',
  'limited_but_safe',
  'operator_review',
  'suppressed',
] as const;

export type StudentVisibilityTier = (typeof studentVisibilityTiers)[number];

export const publicStudentVisibilityTiers: StudentVisibilityTier[] = [
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
  studentVisibilityVersion: {
    type: String,
    default: '',
  },
  studentVisibilityReviewedAt: {
    type: Date,
    required: false,
  },
  studentVisibilityReviewedByUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false,
  },
};

export const isStudentVisibilityTier = (value: unknown): value is StudentVisibilityTier =>
  typeof value === 'string' && studentVisibilityTiers.includes(value as StudentVisibilityTier);
