/**
 * One replay of one lane against one frozen benchmark (#3526).
 *
 * Counts only, never a row identifier, per docs/person-identifier-convention.md. A known-wrong
 * count is stored beside the population it was taken over and the replay coverage, because a
 * refusal label is a negative only: a value no refusal names is unjudged, not correct (#3514).
 *
 * Environment-local by policy, listed in scripts/mirrorCollectionPolicy.ts, for the same
 * reason as `corpus_quality_snapshots`: a copied history is both misdated and lost.
 */
import mongoose from 'mongoose';

export const LANE_SCORECARD_SNAPSHOT_COLLECTION = 'lane_scorecard_snapshots';

const fieldScoreSchema = new mongoose.Schema(
  {
    field: { type: String, required: true },
    emitted: { type: Number, required: true },
    labeledEntityEmitted: { type: Number, required: true },
    knownWrong: { type: Number, required: true },
  },
  { _id: false },
);

const laneScorecardSnapshotSchema = new mongoose.Schema(
  {
    measuredAt: { type: Date, required: true, default: () => new Date() },
    environment: { type: String, required: true },
    databaseName: { type: String, required: true },
    benchmarkId: { type: String, required: true },
    sourceName: { type: String, required: true },
    codeSha: { type: String, required: false },
    pagesServed: { type: Number, required: true },
    pagesMissed: { type: Number, required: true },
    emitted: { type: Number, required: true },
    knownWrong: { type: Number, required: true },
    labelsMatched: { type: Number, required: true },
    labelCount: { type: Number, required: true },
    outputFingerprint: { type: String, required: true },
    byField: { type: [fieldScoreSchema], default: [] },
  },
  { timestamps: false },
);

laneScorecardSnapshotSchema.index({ benchmarkId: 1, measuredAt: -1 });

export const LaneScorecardSnapshot = mongoose.model(
  'LaneScorecardSnapshot',
  laneScorecardSnapshotSchema,
  LANE_SCORECARD_SNAPSHOT_COLLECTION,
);
