/**
 * Evidence-backed signals about undergraduate access to research.
 */
import mongoose from 'mongoose';
import { recordReviewSchema } from './modelPrimitives';
import {
  accessSignalConfidences,
  accessSignalTypes,
} from './researchAccessTypes';

const accessSignalSchema = new mongoose.Schema(
  {
    researchEntityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ResearchEntity',
      required: true,
    },
    entryPathwayId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'EntryPathway',
      required: false,
    },
    signalType: {
      type: String,
      enum: [...accessSignalTypes],
      required: true,
    },
    confidence: {
      type: String,
      enum: [...accessSignalConfidences],
      required: true,
    },
    confidenceScore: {
      type: Number,
      min: 0,
      max: 1,
      default: 0,
    },
    sourceEvidenceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Observation',
      required: false,
    },
    observationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Observation',
      required: false,
    },
    sourceName: {
      type: String,
      default: '',
    },
    sourceUrl: {
      type: String,
      default: '',
    },
    observedAt: {
      type: Date,
      required: true,
      default: () => new Date(),
    },
    excerpt: {
      type: String,
      default: '',
    },
    originalConfidence: {
      type: Number,
      min: 0,
      max: 1,
      required: false,
    },
    lastMaterializedAt: {
      type: Date,
      required: false,
    },
    derivationKey: {
      type: String,
      required: false,
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
  {
    timestamps: true,
  },
);

accessSignalSchema.index({ researchEntityId: 1 });
accessSignalSchema.index({ entryPathwayId: 1 });
accessSignalSchema.index({ signalType: 1 });
accessSignalSchema.index({ confidence: 1 });
accessSignalSchema.index({ observedAt: -1 });
accessSignalSchema.index({ sourceEvidenceId: 1 });
accessSignalSchema.index({ archived: 1 });
accessSignalSchema.index({ 'review.status': 1 });
accessSignalSchema.index({ researchEntityId: 1, 'review.status': 1, 'review.reviewedAt': -1 });
accessSignalSchema.index(
  { researchEntityId: 1, signalType: 1, derivationKey: 1 },
  {
    unique: true,
    partialFilterExpression: { derivationKey: { $type: 'string' } },
  },
);

export const AccessSignal = mongoose.model(
  'AccessSignal',
  accessSignalSchema,
  'access_signals',
);

export { accessSignalSchema };
