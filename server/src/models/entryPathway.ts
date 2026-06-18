/**
 * Durable ways a Yale student might enter a research entity.
 */
import mongoose from 'mongoose';
import { recordReviewSchema } from './modelPrimitives';
import {
  compensationTypes,
  entryPathwayStatuses,
  entryPathwayTypes,
  evidenceStrengths,
} from './researchAccessTypes';

const entryPathwaySchema = new mongoose.Schema(
  {
    researchEntityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ResearchEntity',
      required: true,
    },
    pathwayType: {
      type: String,
      enum: [...entryPathwayTypes],
      required: true,
    },
    status: {
      type: String,
      enum: [...entryPathwayStatuses],
      default: 'PLAUSIBLE',
    },
    evidenceStrength: {
      type: String,
      enum: [...evidenceStrengths],
      default: 'MODERATE',
    },
    studentFacingLabel: {
      type: String,
      required: true,
      trim: true,
    },
    explanation: {
      type: String,
      default: '',
    },
    bestNextStep: {
      type: String,
      default: '',
    },
    compensation: {
      type: String,
      enum: [...compensationTypes],
      default: 'UNKNOWN',
    },
    sourceEvidenceIds: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'Observation',
      default: [],
    },
    sourceUrls: {
      type: [String],
      default: [],
    },
    confidence: {
      type: Number,
      min: 0,
      max: 1,
      default: 0,
    },
    derivationKey: {
      type: String,
      required: false,
    },
    archived: {
      type: Boolean,
      default: false,
    },
    lastObservedAt: {
      type: Date,
      required: false,
    },
    lastMaterializedAt: {
      type: Date,
      required: false,
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

entryPathwaySchema.index({ researchEntityId: 1 });
entryPathwaySchema.index({ pathwayType: 1 });
entryPathwaySchema.index({ status: 1 });
entryPathwaySchema.index({ evidenceStrength: 1 });
entryPathwaySchema.index({ compensation: 1 });
entryPathwaySchema.index({ archived: 1 });
entryPathwaySchema.index({ 'review.status': 1 });
entryPathwaySchema.index(
  { researchEntityId: 1, derivationKey: 1 },
  {
    unique: true,
    partialFilterExpression: { derivationKey: { $type: 'string' } },
  },
);

export const EntryPathway = mongoose.model(
  'EntryPathway',
  entryPathwaySchema,
  'entry_pathways',
);

export { entryPathwaySchema };
