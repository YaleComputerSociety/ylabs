/**
 * One replay of the engine against one frozen benchmark (#3589).
 *
 * Counts only, never a row identifier, per docs/person-identifier-convention.md. Field
 * names match `laneScorecardSnapshot` wherever the meaning is the same, so the analytics
 * readout (#3591) can key both off one shape; the two differ only on input coverage,
 * because a lane's input is a page and the engine's is a frozen row.
 *
 * `rowsWithIncompleteInput` counts rows where the engine read something the capture did
 * not freeze. A fingerprint change on those rows is unattributable, so it is reported as a
 * frozen-input leak rather than as a regression.
 *
 * Environment-local by policy, listed in scripts/mirrorCollectionPolicy.ts.
 */
import mongoose from 'mongoose';

export const ENGINE_BENCHMARK_SNAPSHOT_COLLECTION = 'engine_benchmark_snapshots';

const fieldScoreSchema = new mongoose.Schema(
  {
    field: { type: String, required: true },
    resolved: { type: Number, required: true },
    cleared: { type: Number, required: true },
    labeledEntityResolved: { type: Number, required: true },
    knownWrong: { type: Number, required: true },
    /** Values across all rows, not rows: a shortened list moves this and not `resolved` (#3871). */
    values: { type: Number, required: false, default: 0 },
  },
  { _id: false },
);

const fieldDeltaSchema = new mongoose.Schema(
  {
    field: { type: String, required: true },
    resolvedDelta: { type: Number, required: true },
    clearedDelta: { type: Number, required: true },
    knownWrongDelta: { type: Number, required: true },
    /** Negative with `resolvedDelta` at zero means the same rows resolved fewer values (#3871). */
    valuesDelta: { type: Number, required: false, default: 0 },
  },
  { _id: false },
);

const tierDeltaSchema = new mongoose.Schema(
  {
    tier: { type: String, required: true },
    rowsDelta: { type: Number, required: true },
  },
  { _id: false },
);

const tierCountSchema = new mongoose.Schema(
  {
    tier: { type: String, required: true },
    rows: { type: Number, required: true },
  },
  { _id: false },
);

const engineBenchmarkSnapshotSchema = new mongoose.Schema(
  {
    measuredAt: { type: Date, required: true, default: () => new Date() },
    environment: { type: String, required: true },
    databaseName: { type: String, required: true },
    benchmarkId: { type: String, required: true },
    stage: { type: String, required: true },
    codeSha: { type: String, required: false },
    rowsReplayed: { type: Number, required: true },
    rowsWithIncompleteInput: { type: Number, required: true },
    unfrozenReads: { type: [String], default: [] },
    invalidatedRunSetChanged: { type: Boolean, required: true, default: false },
    resolved: { type: Number, required: true },
    cleared: { type: Number, required: true },
    knownWrong: { type: Number, required: true },
    labelsMatched: { type: Number, required: true },
    labelCount: { type: Number, required: true },
    outputFingerprint: { type: String, required: true },
    previousFingerprint: { type: String, required: false },
    fingerprintChanged: { type: Boolean, required: false },
    byField: { type: [fieldScoreSchema], default: [] },
    gateTiers: { type: [tierCountSchema], default: [] },
    byFieldDelta: { type: [fieldDeltaSchema], default: [] },
    gateTierDelta: { type: [tierDeltaSchema], default: [] },
    cardSynthesisRequested: { type: Number, required: true, default: 0 },
  },
  { timestamps: false },
);

engineBenchmarkSnapshotSchema.index({ benchmarkId: 1, stage: 1, measuredAt: -1 });

export const EngineBenchmarkSnapshot = mongoose.model(
  'EngineBenchmarkSnapshot',
  engineBenchmarkSnapshotSchema,
  ENGINE_BENCHMARK_SNAPSHOT_COLLECTION,
);
