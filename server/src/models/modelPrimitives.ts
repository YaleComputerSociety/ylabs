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
 * One stored value declared inadmissible at one field on one row (#3167).
 *
 * Keyed on the value rather than on an observation, which is what makes it survive
 * re-observation: `superseded` retires a row and the next run mints a fresh one
 * carrying the same value. `withdrawnAt` is what keeps it from becoming a permanent
 * veto, so it must never be defaulted.
 */
export const fieldValueRefusalSchema = new mongoose.Schema(
  {
    valueKey: { type: String, required: true },
    rule: { type: String, required: true },
    // Names the lane that emitted the refused value, which `refusedBy` does not:
    // that names the operator or script that recorded the refusal. Without this a
    // refusal is countable but not attributable, so no lane's precision has a
    // denominator (#3506).
    sourceName: { type: String, required: false },
    // Derived by the `refusal-lane-attribution` sweep stage from the observation log,
    // kept apart from the declared `sourceName` so a reader can tell the two apart, and
    // plural because every lane that asserted a refused value produced it (#3521).
    attributedSourceNames: { type: [String], default: undefined },
    attributedAt: { type: Date, required: false },
    refusedBy: { type: String, default: '' },
    refusedAt: { type: Date, required: false },
    note: { type: String, default: '', maxlength: 2000 },
    evidenceUrl: { type: String, required: false },
    withdrawnAt: { type: Date, required: false },
    withdrawnReason: { type: String, required: false },
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
