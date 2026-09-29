/**
 * A frozen input for replaying the resolve and gate engine (#3589).
 *
 * `engine_benchmarks` records what was captured and the refusal labels that applied at
 * capture time; `engine_benchmark_rows` holds one row's whole input: its observations,
 * its stored document, and the corpus-wide gate inputs the visibility gate reached its
 * verdict on. The lane scorecard freezes pages because a lane's input is a page (#3526);
 * the engine's input is an observation set plus a stored row, so that is what this freezes.
 *
 * Scoped at rows that exercised known engine defects rather than a first-N sample, so a
 * regression in the arms that were hardest to get right is the thing the fingerprint moves on.
 *
 * Environment-local by policy, listed in scripts/mirrorCollectionPolicy.ts, for the same
 * reason as the lane benchmark: a promotion replaces whole collections and would erase a
 * benchmark the target captured.
 */
import mongoose from 'mongoose';

export const ENGINE_BENCHMARK_COLLECTION = 'engine_benchmarks';
export const ENGINE_BENCHMARK_ROW_COLLECTION = 'engine_benchmark_rows';

const benchmarkLabelSchema = new mongoose.Schema(
  {
    entityKey: { type: String, required: true },
    field: { type: String, required: true },
    valueKey: { type: String, required: true },
    rule: { type: String, required: true },
  },
  { _id: false },
);

const engineBenchmarkSchema = new mongoose.Schema(
  {
    benchmarkId: { type: String, required: true, unique: true },
    entityType: { type: String, required: true },
    scope: { type: String, required: true },
    capturedAt: { type: Date, required: true },
    environment: { type: String, required: true },
    databaseName: { type: String, required: true },
    codeSha: { type: String, required: false },
    rowCount: { type: Number, required: true },
    observationCount: { type: Number, required: true },
    /**
     * Corpus-wide, so held once for the benchmark rather than per row. Absent means the
     * capture could not reach the roster, which makes the gate's eponym arm answer the
     * explicitly weaker way; stored so a replay cannot silently take the weaker answer.
     */
    knownPersonSurnames: { type: [String], default: [] },
    /**
     * The quarantined runs at capture. An observation from a run quarantined later is
     * withheld on replay, which is a real input change rather than a code regression, so
     * the replay compares this against the live set and reports the difference.
     */
    invalidatedScrapeRunIds: { type: [String], default: [] },
    labels: { type: [benchmarkLabelSchema], default: [] },
  },
  { timestamps: true },
);

const engineBenchmarkRowSchema = new mongoose.Schema(
  {
    benchmarkId: { type: String, required: true },
    entityKey: { type: String, required: false },
    entityId: { type: String, required: false },
    entityDoc: { type: mongoose.Schema.Types.Mixed, required: false, default: null },
    observations: { type: [mongoose.Schema.Types.Mixed], default: [] },
    hasMergedInRows: { type: Boolean, required: true, default: false },
    soleLeadPersonId: { type: String, required: false },
    leadPersonName: { type: String, required: false },
    /**
     * Set on a row captured only so a survivor can read its observations: the archived loser it
     * was merged into this survivor from. Such a row is frozen input, never a replay subject, so
     * the replay skips it (#3849).
     */
    mergedIntoSurvivorId: { type: String, required: false },
    gateInput: { type: mongoose.Schema.Types.Mixed, required: false, default: null },
    capturedTier: { type: String, required: false },
    capturedReasons: { type: [String], default: [] },
  },
  { timestamps: false },
);

engineBenchmarkRowSchema.index({ benchmarkId: 1, entityKey: 1 }, { unique: true, sparse: true });

export const EngineBenchmark = mongoose.model(
  'EngineBenchmark',
  engineBenchmarkSchema,
  ENGINE_BENCHMARK_COLLECTION,
);

export const EngineBenchmarkRow = mongoose.model(
  'EngineBenchmarkRow',
  engineBenchmarkRowSchema,
  ENGINE_BENCHMARK_ROW_COLLECTION,
);
