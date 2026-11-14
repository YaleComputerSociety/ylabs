import mongoose from 'mongoose';

export interface ScrapeRunCountFacts {
  _id: unknown;
  sourceName?: unknown;
  status?: unknown;
  startedAt?: unknown;
  heartbeatAt?: unknown;
  finishedAt?: unknown;
  observationCount?: unknown;
  options?: { dryRun?: unknown; only?: unknown } | null;
}

export interface ScrapeRunCountCorrection {
  runId: string;
  sourceName: string;
  status: string;
  startedAt: string | null;
  // Separate columns on purpose: a crashed run's `finishedAt` is the last sign of life a
  // reaper could see, not when the process actually died, so reading one as the other
  // misdates the crash (#6269).
  heartbeatAt: string | null;
  finishedAt: string | null;
  apply: boolean;
  scoped: boolean;
  reportedObservations: number | null;
  actualObservations: number;
}

/**
 * Observations carry `scrapeRunId` as an ObjectId. A Mongoose query casts a string for us, but
 * the same filter on the raw driver collection matches nothing, so a recount written that way
 * reads zero for every run: exactly the answer a crashed record already gives (#6269). Every
 * recount goes through this cast, so it holds either way.
 */
export function scrapeRunIdFilterValue(runId: unknown): mongoose.Types.ObjectId | null {
  if (runId instanceof mongoose.Types.ObjectId) return runId;
  const text = typeof runId === 'string' ? runId.trim() : String(runId ?? '');
  return mongoose.Types.ObjectId.isValid(text) ? new mongoose.Types.ObjectId(text) : null;
}

const numberOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const isoOrNull = (value: unknown): string | null => {
  if (!value) return null;
  const at = new Date(value as string);
  return Number.isFinite(at.getTime()) ? at.toISOString() : null;
};

/**
 * A run whose own record cannot be trusted about what it wrote: it ended `interrupted` or
 * `failure`, or it still claims to be running with no heartbeat inside the stale window, so
 * nothing flushed its counters at the end.
 */
export function runRecordCountIsUnreliable(
  run: ScrapeRunCountFacts,
  now: number,
  staleHeartbeatMs: number,
): boolean {
  if (run.status === 'interrupted' || run.status === 'failure') return true;
  if (run.status !== 'running') return false;
  const beat = run.heartbeatAt ? new Date(run.heartbeatAt as string).getTime() : NaN;
  return !Number.isFinite(beat) || now - beat > staleHeartbeatMs;
}

/**
 * Whether a recount should replace what the record claims. A record that already matches needs
 * no correction, and one that claims more than the recount found keeps its own number, because
 * a pruned or superseded-away observation is not evidence that the run wrote less.
 */
export function needsCountCorrection(
  reportedObservations: number | null,
  actualObservations: number,
): boolean {
  if (actualObservations === 0) return false;
  return reportedObservations === null || reportedObservations < actualObservations;
}

export function countCorrectionFor(
  run: ScrapeRunCountFacts,
  actualObservations: number,
): ScrapeRunCountCorrection {
  const only = run.options?.only;
  return {
    runId: String(run._id),
    sourceName: String(run.sourceName ?? ''),
    status: String(run.status ?? ''),
    startedAt: isoOrNull(run.startedAt),
    heartbeatAt: isoOrNull(run.heartbeatAt),
    finishedAt: isoOrNull(run.finishedAt),
    apply: run.options?.dryRun === false,
    scoped: Array.isArray(only) && only.length > 0,
    reportedObservations: numberOrNull(run.observationCount),
    actualObservations,
  };
}

export interface ScrapeRunCountReconciliation {
  mode: 'dry-run' | 'apply';
  runsExamined: number;
  runsWithUnreliableCounts: number;
  corrections: ScrapeRunCountCorrection[];
  falseGreens: number;
  underReported: number;
  observationsUnaccountedFor: number;
  recordsUpdated: number;
}

export function summarizeCountCorrections(
  corrections: readonly ScrapeRunCountCorrection[],
): Pick<
  ScrapeRunCountReconciliation,
  'falseGreens' | 'underReported' | 'observationsUnaccountedFor'
> {
  return {
    falseGreens: corrections.filter((c) => (c.reportedObservations ?? 0) === 0).length,
    underReported: corrections.filter((c) => (c.reportedObservations ?? 0) > 0).length,
    observationsUnaccountedFor: corrections.reduce(
      (sum, c) => sum + (c.actualObservations - (c.reportedObservations ?? 0)),
      0,
    ),
  };
}
