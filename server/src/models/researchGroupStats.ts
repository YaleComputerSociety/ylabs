/**
 * Mongoose schema and model for recomputable ResearchGroup metrics.
 */
import mongoose from 'mongoose';

const researchGroupStatsSchema = new mongoose.Schema(
  {
    researchGroupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'researchgroups',
      required: true,
      unique: true,
    },
    responseRateAllTime: {
      type: Number,
      default: 0,
    },
    responseRateAllTimeSampleSize: {
      type: Number,
      default: 0,
    },
    responseRate90d: {
      type: Number,
      default: 0,
    },
    responseRate90dSampleSize: {
      type: Number,
      default: 0,
    },
    joinedRateAllTime: {
      type: Number,
      default: 0,
    },
    joinedRateAllTimeSampleSize: {
      type: Number,
      default: 0,
    },
    medianResponseTimeDays: {
      type: Number,
      required: false,
    },
    medianTimeToJoinDays: {
      type: Number,
      required: false,
    },
    viewCount30d: {
      type: Number,
      default: 0,
    },
    saveCount30d: {
      type: Number,
      default: 0,
    },
    outreachCount30d: {
      type: Number,
      default: 0,
    },
    inquiryQualityScore: {
      type: Number,
      default: 0,
    },
    undergradEvidence: {
      type: {
        memberCount: { type: Number, default: 0 },
        reportedJoinedCount: { type: Number, default: 0 },
        evidenceLabel: { type: String, default: '' },
      },
      default: () => ({
        memberCount: 0,
        reportedJoinedCount: 0,
        evidenceLabel: '',
      }),
    },
    publicVisibility: {
      type: {
        showResponseRate: { type: Boolean, default: false },
        showJoinedRate: { type: Boolean, default: false },
        showMedianResponseTime: { type: Boolean, default: false },
      },
      default: () => ({
        showResponseRate: false,
        showJoinedRate: false,
        showMedianResponseTime: false,
      }),
    },
    computedAt: {
      type: Date,
      required: true,
      default: () => new Date(),
    },
  },
  {
    timestamps: true,
  },
);

researchGroupStatsSchema.index({ computedAt: -1 });
researchGroupStatsSchema.index({ responseRate90dSampleSize: -1 });
researchGroupStatsSchema.index({ outreachCount30d: -1 });

export const ResearchGroupStats = mongoose.model(
  'researchgroupstats',
  researchGroupStatsSchema,
  'research_group_stats',
);

export { researchGroupStatsSchema };
