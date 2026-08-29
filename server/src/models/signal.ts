/**
 * One source-attributed, typed signal about a research entity.
 *
 * Consolidates the former AccessSignal (undergraduate-access evidence, with a
 * HIGH/MEDIUM/LOW confidence gradient) and UndergraduateLogisticsClaim (KNOWN /
 * STALE_UNDER_REVIEW / CONFLICTING_WITHHELD logistics) into one extensible
 * collection. Future metrics become new `type` values, never new collections.
 *
 * Missing rows are unknown. They must never be interpreted as negative facts,
 * and the materializers must not cross-infer one type from another.
 */
import mongoose from 'mongoose';
import { recordSuppressionSchema } from './modelPrimitives';
import { signalConfidences, signalStatuses, signalTypes } from './researchAccessTypes';

const signalSourceSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      default: '',
    },
    url: {
      type: String,
      default: '',
    },
    excerpt: {
      type: String,
      default: '',
      maxlength: 500,
    },
    evidenceIds: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'Observation',
      default: [],
    },
    scrapeRunIds: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'ScrapeRun',
      default: [],
    },
  },
  { _id: false },
);

const signalSchema = new mongoose.Schema(
  {
    researchEntityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ResearchEntity',
      required: true,
    },
    type: {
      type: String,
      enum: [...signalTypes],
      required: true,
    },
    value: {
      type: mongoose.Schema.Types.Mixed,
      required: false,
    },
    confidence: {
      type: String,
      enum: [...signalConfidences],
      required: false,
    },
    confidenceScore: {
      type: Number,
      min: 0,
      max: 1,
      required: false,
    },
    originalConfidence: {
      type: Number,
      min: 0,
      max: 1,
      required: false,
    },
    status: {
      type: String,
      enum: [...signalStatuses],
      required: false,
    },
    source: {
      type: signalSourceSchema,
      default: () => ({}),
    },
    observedAt: {
      type: Date,
      required: true,
      default: () => new Date(),
    },
    expiresAt: {
      type: Date,
      required: false,
    },
    derivationKey: {
      type: String,
      required: false,
    },
    lastMaterializedAt: {
      type: Date,
      required: false,
    },
    archived: {
      type: Boolean,
      default: false,
    },
    suppression: {
      type: recordSuppressionSchema,
      required: false,
    },
  },
  {
    timestamps: true,
  },
);

signalSchema.index({ researchEntityId: 1 });
signalSchema.index({ type: 1 });
signalSchema.index({ confidence: 1 });
signalSchema.index({ status: 1 });
signalSchema.index({ observedAt: -1 });
signalSchema.index({ expiresAt: 1, archived: 1 });
signalSchema.index({ 'source.evidenceIds': 1 });
signalSchema.index({ 'source.scrapeRunIds': 1 });
signalSchema.index({ archived: 1 });
signalSchema.index(
  { researchEntityId: 1, type: 1, derivationKey: 1 },
  {
    unique: true,
    partialFilterExpression: { derivationKey: { $type: 'string' } },
  },
);

export const Signal = mongoose.model('Signal', signalSchema, 'signals');

export { signalSchema };
