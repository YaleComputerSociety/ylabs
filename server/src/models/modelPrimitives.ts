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

export const fieldLockReasons = ['operator_decision', 'engine_gap_workaround', 'unknown'] as const;

export type FieldLockReason = (typeof fieldLockReasons)[number];

/**
 * Records who applied a `manuallyLockedFields` entry and why, keyed by the locked
 * field name. `fieldProvenance` records who produced the *value*; a lock can be
 * applied to a value the engine itself produced, so the two are independent.
 *
 * `reason` is the load-bearing part: `operator_decision` is a human judgement no
 * engine improvement may ever override, while `engine_gap_workaround` is a repair
 * standing in for a capability the engine lacks (#2542) and must be revisitable
 * once that capability lands. An absent entry - every lock applied before #2612 -
 * reads as `unknown`, which is treated as the conservative case, never as a
 * revisitable workaround.
 */
export const fieldLockProvenanceSchema = new mongoose.Schema(
  {
    reason: {
      type: String,
      enum: [...fieldLockReasons],
      required: true,
    },
    lockedBy: {
      type: String,
      default: '',
    },
    lockedAt: {
      type: Date,
      required: false,
    },
    note: {
      type: String,
      default: '',
      maxlength: 2000,
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
