/**
 * One row per weekly Development sweep job (#4507), the durable record of a run whose
 * artifacts otherwise live in a container's temp directory and vanish when it exits.
 *
 * Per-source, per-stage and per-phase timings are flattened into queryable arrays rather than
 * kept as an opaque summary, so runs can be compared over time; artifact paths and stage
 * deltas are deliberately not stored, to keep a row small.
 *
 * Environment-local by policy, listed in scripts/mirrorCollectionPolicy.ts, for the same
 * reason as `corpus_quality_snapshots`: a copied history is both misdated and lost.
 */
import mongoose from 'mongoose';
import {
  weeklySweepCorpusSnapshotStatuses,
  weeklySweepModes,
  weeklySweepRunStatuses,
} from './storedVocabularies';

export const WEEKLY_SWEEP_RUN_COLLECTION = 'weekly_sweep_runs';

const timing = {
  startedAt: { type: Date, required: false },
  finishedAt: { type: Date, required: false },
  durationMs: { type: Number, required: false },
};

function requiredOnceFinished(this: { status?: string }): boolean {
  return this.status !== 'running';
}

const modeField = { type: String, enum: weeklySweepModes, required: true };

const storageReadingSchema = new mongoose.Schema(
  {
    ok: { type: Boolean, required: true },
    usedMb: { type: Number, required: true },
    quotaMb: { type: Number, required: true },
    headroomMb: { type: Number, required: true },
    minHeadroomMb: { type: Number, required: true },
  },
  { _id: false },
);

const modeRunSchema = new mongoose.Schema(
  {
    mode: modeField,
    exitCode: { type: Number, required: false },
    summaryFound: { type: Boolean, required: true },
    codeSha: { type: String, required: false },
    ...timing,
    sourceCount: { type: Number, required: true },
    succeeded: { type: Number, required: true },
    failed: { type: Number, required: true },
    notRun: { type: Number, required: true },
    producedNothing: { type: Number, required: true },
    postRunStatus: { type: String, enum: ['succeeded', 'failed'], required: false },
    postRunDurationMs: { type: Number, required: false },
    throttleRecovered: { type: Number, required: true },
    throttleExhausted: { type: Number, required: true },
  },
  { _id: false },
);

const sourceRunSchema = new mongoose.Schema(
  {
    mode: modeField,
    sourceName: { type: String, required: true },
    phase: { type: String, required: true },
    status: { type: String, required: true },
    exitCode: { type: Number, required: false },
    ...timing,
    observationCount: { type: Number, required: false },
    entitiesObserved: { type: Number, required: false },
    fetchAttempts: { type: Number, required: false },
    fetchFailed: { type: Number, required: false },
    fetchBlocked: { type: Number, required: false },
    throttleRecovered: { type: Number, required: false },
    throttleExhausted: { type: Number, required: false },
    materializationErrors: { type: Number, required: false },
    error: { type: String, required: false },
  },
  { _id: false },
);

const stageRunSchema = new mongoose.Schema(
  {
    mode: modeField,
    name: { type: String, required: true },
    status: { type: String, required: true },
    exitCode: { type: Number, required: false },
    ...timing,
    error: { type: String, required: false },
  },
  { _id: false },
);

const phaseRunSchema = new mongoose.Schema(
  { mode: modeField, phase: { type: String, required: true }, ...timing },
  { _id: false },
);

const codeDriftSchema = new mongoose.Schema(
  {
    mode: modeField,
    stage: { type: String, required: true },
    startedSha: { type: String, required: false },
    currentSha: { type: String, required: false },
    message: { type: String, required: true },
  },
  { _id: false },
);

const weeklySweepRunSchema = new mongoose.Schema(
  {
    startedAt: { type: Date, required: true },
    finishedAt: { type: Date, required: requiredOnceFinished },
    durationMs: { type: Number, required: requiredOnceFinished },
    renderLimit: {
      limitMs: { type: Number, required: requiredOnceFinished },
      withinLimit: { type: Boolean, required: requiredOnceFinished },
      headroomMs: { type: Number, required: requiredOnceFinished },
    },
    environment: { type: String, required: true },
    databaseName: { type: String, required: true },
    codeSha: { type: String, required: false },
    status: { type: String, enum: weeklySweepRunStatuses, required: true },
    exitCode: { type: Number, required: requiredOnceFinished },
    requestedModes: { type: [{ type: String, enum: weeklySweepModes }], default: [] },
    preflight: {
      ok: { type: Boolean, required: requiredOnceFinished },
      heldLockSources: { type: [String], default: [] },
      storageBefore: { type: storageReadingSchema, required: false },
      storageAfter: { type: storageReadingSchema, required: false },
      snapshotCacheDropped: { type: Boolean, required: true, default: false },
      refusal: { type: String, required: false },
    },
    modes: { type: [modeRunSchema], default: [] },
    sources: { type: [sourceRunSchema], default: [] },
    stages: { type: [stageRunSchema], default: [] },
    phases: { type: [phaseRunSchema], default: [] },
    codeDrift: { type: [codeDriftSchema], default: [] },
    refusals: { type: [String], default: [] },
    throttleRetry: {
      recovered: { type: Number, required: true, default: 0 },
      exhausted: { type: Number, required: true, default: 0 },
      exhaustedSources: { type: [String], default: [] },
    },
    corpusSnapshot: {
      status: {
        type: String,
        enum: weeklySweepCorpusSnapshotStatuses,
        required: requiredOnceFinished,
      },
      exitCode: { type: Number, required: false },
    },
    error: { type: String, required: false },
  },
  { timestamps: false },
);

weeklySweepRunSchema.index({ startedAt: -1 });

export const WeeklySweepRun = mongoose.model(
  'WeeklySweepRun',
  weeklySweepRunSchema,
  WEEKLY_SWEEP_RUN_COLLECTION,
);
