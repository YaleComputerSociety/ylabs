/**
 * Shared embedded schemas for scraper-backed materialized models.
 */
import mongoose from 'mongoose';

export const suppressionReasons = [
  'evidence_replaced',
  'evidence_lost',
  'duplicate_collapsed',
  'source_audit',
] as const;

export type SuppressionReason = (typeof suppressionReasons)[number];

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

/**
 * Absent `reason` is the resting state: the record is not suppressed. A present
 * `reason` is a tombstone that stops materializers from resurrecting a record
 * they would otherwise rewrite, so it must never be defaulted on insert.
 */
export const recordSuppressionSchema = new mongoose.Schema(
  {
    reason: {
      type: String,
      enum: [...suppressionReasons],
      required: false,
    },
    suppressedAt: {
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
