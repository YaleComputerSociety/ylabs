/**
 * A frozen input for scoring one scraper lane (#3526).
 *
 * `lane_benchmarks` records what was captured and the refusal labels that applied at
 * capture time; `lane_benchmark_pages` holds every page the lane fetched during capture,
 * with no TTL, unlike `scrape_snapshots`. Replaying a lane against these pages is what makes
 * two scorecards comparable: the pages and the labels are the same, so only the code moved.
 *
 * Environment-local by policy, listed in scripts/mirrorCollectionPolicy.ts, because a
 * promotion replaces whole collections and would erase a benchmark the target captured.
 */
import mongoose from 'mongoose';

export const LANE_BENCHMARK_COLLECTION = 'lane_benchmarks';
export const LANE_BENCHMARK_PAGE_COLLECTION = 'lane_benchmark_pages';

const benchmarkLabelSchema = new mongoose.Schema(
  {
    entityKey: { type: String, required: true },
    field: { type: String, required: true },
    valueKey: { type: String, required: true },
    rule: { type: String, required: true },
  },
  { _id: false },
);

const laneBenchmarkSchema = new mongoose.Schema(
  {
    benchmarkId: { type: String, required: true, unique: true },
    sourceName: { type: String, required: true },
    only: { type: [String], default: [] },
    limit: { type: Number, required: false },
    capturedAt: { type: Date, required: true },
    environment: { type: String, required: true },
    databaseName: { type: String, required: true },
    codeSha: { type: String, required: false },
    pageCount: { type: Number, required: true },
    plannedObservationCount: { type: Number, required: true },
    labels: { type: [benchmarkLabelSchema], default: [] },
  },
  { timestamps: true },
);

const laneBenchmarkPageSchema = new mongoose.Schema(
  {
    benchmarkId: { type: String, required: true },
    sourceName: { type: String, required: true },
    requestKey: { type: String, required: true },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    fetchedAt: { type: Date, required: true },
  },
  { timestamps: false },
);

laneBenchmarkPageSchema.index({ benchmarkId: 1, sourceName: 1, requestKey: 1 }, { unique: true });

export const LaneBenchmark = mongoose.model(
  'LaneBenchmark',
  laneBenchmarkSchema,
  LANE_BENCHMARK_COLLECTION,
);

export const LaneBenchmarkPage = mongoose.model(
  'LaneBenchmarkPage',
  laneBenchmarkPageSchema,
  LANE_BENCHMARK_PAGE_COLLECTION,
);
