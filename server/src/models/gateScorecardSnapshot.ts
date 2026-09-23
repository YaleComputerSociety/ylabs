/**
 * Mongoose schema and model for the latest gate scorecard summary per gate per
 * environment, which is what the admin operator board renders.
 *
 * The board used to read JSON files, and `scriptWriteGuards` confines those to
 * the OS temp directory or `./tmp`, both wiped when Render redeploys. A row
 * survives a deploy, and a runner with the connection string can write one, so a
 * scheduled refresh becomes meaningful.
 *
 * A row records what was evaluated, not only the verdict: the command that
 * produced it, the exit code, whether the feeder rewrote its artifact, and the
 * database the audit itself claims. A stored verdict that cannot say what it
 * judged is no better than the blank board it replaces.
 *
 * `summary` holds the normalized artifact the matching `derive*Gate` consumes.
 * Those shapes are owned by adminOperatorBoardService, differ per gate, and grow
 * fields regularly, so pinning them here would silently drop whatever the schema
 * had not been taught yet. Counts and command strings only: a normalized gate
 * artifact never carries a slug or name, per docs/person-identifier-convention.md.
 *
 * Environment-local by policy. A promotion replaces whole collections, so this
 * collection is listed in scripts/mirrorCollectionPolicy.ts and must never join
 * the promotion copy set, or a promotion would attribute one environment's gate
 * verdicts to another.
 */
import mongoose from 'mongoose';

const gateScorecardEvaluationSchema = new mongoose.Schema(
  {
    command: { type: String, required: true },
    exitCode: { type: Number, default: null },
    artifactWritten: { type: Boolean, required: true },
    artifactPath: { type: String },
    artifactGeneratedAt: { type: String },
    artifactDatabase: { type: String },
    artifactEnvironment: { type: String },
    failureReason: { type: String },
  },
  { _id: false },
);

const gateScorecardSnapshotSchema = new mongoose.Schema(
  {
    gate: {
      type: String,
      required: true,
      index: true,
    },
    environment: {
      type: String,
      required: true,
    },
    databaseName: {
      type: String,
      required: true,
      index: true,
    },
    measuredAt: {
      type: Date,
      required: true,
    },
    storedAt: {
      type: Date,
      required: true,
      default: () => new Date(),
    },
    refreshRunId: {
      type: String,
      required: true,
    },
    evaluated: {
      type: gateScorecardEvaluationSchema,
      required: true,
    },
    summary: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  { timestamps: true },
);

gateScorecardSnapshotSchema.index({ databaseName: 1, gate: 1 }, { unique: true });

export const GATE_SCORECARD_SNAPSHOT_COLLECTION = 'gate_scorecard_snapshots';

export const GateScorecardSnapshot = mongoose.model(
  'GateScorecardSnapshot',
  gateScorecardSnapshotSchema,
  GATE_SCORECARD_SNAPSHOT_COLLECTION,
);
