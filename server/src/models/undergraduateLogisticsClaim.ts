/**
 * Claim-specific, source-backed undergraduate logistics for a research entity.
 *
 * Missing rows are unknown. They must never be interpreted as negative facts.
 */
import mongoose from 'mongoose';
import { recordReviewSchema } from './modelPrimitives';

export const undergraduateLogisticsClaimTypes = [
  'STUDENT_LEVEL',
  'COMPENSATION',
  'TIME_COMMITMENT',
  'MODALITY',
  'CURRENT_AVAILABILITY',
] as const;

export type UndergraduateLogisticsClaimType = (typeof undergraduateLogisticsClaimTypes)[number];

export const undergraduateLogisticsClaimStatuses = [
  'KNOWN',
  'STALE_UNDER_REVIEW',
  'CONFLICTING_WITHHELD',
] as const;

export type UndergraduateLogisticsClaimStatus =
  (typeof undergraduateLogisticsClaimStatuses)[number];

const undergraduateLogisticsClaimSchema = new mongoose.Schema(
  {
    researchEntityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ResearchEntity',
      required: true,
    },
    claimType: {
      type: String,
      enum: [...undergraduateLogisticsClaimTypes],
      required: true,
    },
    status: {
      type: String,
      enum: [...undergraduateLogisticsClaimStatuses],
      required: true,
    },
    value: {
      type: mongoose.Schema.Types.Mixed,
      required: false,
    },
    sourceEvidenceIds: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'Observation',
      default: [],
    },
    sourceScrapeRunIds: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'ScrapeRun',
      default: [],
    },
    sourceName: {
      type: String,
      default: '',
    },
    sourceUrl: {
      type: String,
      default: '',
    },
    evidenceExcerpt: {
      type: String,
      default: '',
      maxlength: 500,
    },
    observedAt: {
      type: Date,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    materializedAt: {
      type: Date,
      required: true,
      default: () => new Date(),
    },
    archived: {
      type: Boolean,
      default: false,
    },
    review: {
      type: recordReviewSchema,
      default: () => ({}),
    },
  },
  { timestamps: true },
);

undergraduateLogisticsClaimSchema.index({ researchEntityId: 1, claimType: 1 }, { unique: true });
undergraduateLogisticsClaimSchema.index({ status: 1, archived: 1 });
undergraduateLogisticsClaimSchema.index({ expiresAt: 1, archived: 1 });
undergraduateLogisticsClaimSchema.index({ sourceEvidenceIds: 1 });
undergraduateLogisticsClaimSchema.index({ sourceScrapeRunIds: 1 });

export const UndergraduateLogisticsClaim = mongoose.model(
  'UndergraduateLogisticsClaim',
  undergraduateLogisticsClaimSchema,
  'undergraduate_logistics_claims',
);

export { undergraduateLogisticsClaimSchema };
