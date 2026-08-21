/**
 * Shared embedded schemas for scraper-backed materialized models.
 */
import mongoose from 'mongoose';

export const recordReviewStatuses = [
  'unreviewed',
  'approved',
  'needs_source',
  'disputed',
  'archived_by_review',
] as const;

export const fieldProvenanceSchema = new mongoose.Schema(
  {
    sourceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Source',
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
    observationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Observation',
      required: false,
    },
    observedAt: {
      type: Date,
      required: false,
    },
    confidence: {
      type: Number,
      min: 0,
      max: 1,
      required: false,
    },
  },
  { _id: false },
);

export const recordReviewSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: [...recordReviewStatuses],
      default: 'unreviewed',
    },
    reviewedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false,
    },
    reviewedAt: {
      type: Date,
      required: false,
    },
    note: {
      type: String,
      default: '',
      maxlength: 2000,
    },
    lockedFields: {
      type: [String],
      default: [],
    },
  },
  { _id: false },
);
