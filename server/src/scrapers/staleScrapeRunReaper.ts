import { hostname } from 'os';

import { ScrapeJobLock } from '../models/scrapeJobLock';
import { ScrapeRun } from '../models/scrapeRun';
import {
  planStaleScrapeRunReconciliation,
  staleScrapeRunUpdate,
  type RunningScrapeRunFacts,
  type StaleScrapeRunPlan,
  type StaleScrapeRunThresholds,
} from '../scripts/reconcileStaleScrapeRunsCore';
import { operatorEnvironmentForDatabaseName } from '../scripts/operatorDatabaseEnvironment';
import { isLocalProcessAlive } from './scrapeRunLiveness';

export async function loadRunningScrapeRuns(sourceName?: string): Promise<RunningScrapeRunFacts[]> {
  const docs = (await ScrapeRun.find({
    status: 'running',
    ...(sourceName ? { sourceName } : {}),
  })
    .select('_id sourceName startedAt heartbeatAt owner')
    .sort({ startedAt: 1 })
    .lean()) as unknown as Array<Record<string, any>>;
  return docs.map((doc) => ({
    id: String(doc._id),
    sourceName: String(doc.sourceName),
    startedAt: new Date(doc.startedAt),
    ...(doc.heartbeatAt ? { heartbeatAt: new Date(doc.heartbeatAt) } : {}),
    ...(doc.owner ? { owner: doc.owner } : {}),
  }));
}

export async function loadHeldScrapeLockSourceNames(
  now: Date,
  ignoreLockOwnerId?: string,
): Promise<Set<string>> {
  const locks = (await ScrapeJobLock.find({ locked: true, leaseExpiresAt: { $gt: now } })
    .select('sourceName ownerId')
    .lean()) as unknown as Array<{ sourceName?: string; ownerId?: string }>;
  return new Set(
    locks
      .filter((lock) => !ignoreLockOwnerId || lock.ownerId !== ignoreLockOwnerId)
      .map((lock) => String(lock.sourceName)),
  );
}

export interface DeadScrapeRunReapResult {
  plan: StaleScrapeRunPlan;
  closed: number;
  changedSinceRead: number;
  skippedDatabase?: string;
}

const REAPABLE_DATABASE_ENVIRONMENTS = new Set(['development', 'test']);

/**
 * Closes runs whose process died without recording a finish, so a dead run cannot read as
 * `running` until the next sweep. The scraper cron can be suspended for weeks while CLI runs
 * continue, and a CLI run killed after its last write stayed `running` for eight days (#5628).
 *
 * Only a run with a stopped heartbeat is closed, never one with a fresh heartbeat, a held
 * source lock other than the caller's own, or a live owner process on this host, and the
 * write is the same status-only update `scrape-runs:reconcile-stale` makes: its observations
 * stay live and materializable. Like that command it writes only to Development, because
 * Beta and Production receive `scrape_runs` only through promotion.
 */
export async function reapDeadScrapeRuns(input: {
  detectedBy: string;
  callerLockOwnerId?: string;
  now?: Date;
  thresholds?: StaleScrapeRunThresholds;
  databaseName?: string;
}): Promise<DeadScrapeRunReapResult> {
  const databaseName = input.databaseName ?? ScrapeRun.db.name;
  const databaseEnvironment = operatorEnvironmentForDatabaseName(databaseName);
  if (!databaseEnvironment || !REAPABLE_DATABASE_ENVIRONMENTS.has(databaseEnvironment)) {
    return {
      plan: { reap: [], keep: [] },
      closed: 0,
      changedSinceRead: 0,
      skippedDatabase: databaseName,
    };
  }
  const now = input.now ?? new Date();
  const [runs, heldLockSourceNames] = await Promise.all([
    loadRunningScrapeRuns(),
    loadHeldScrapeLockSourceNames(now, input.callerLockOwnerId),
  ]);
  const plan = planStaleScrapeRunReconciliation({
    runs,
    heldLockSourceNames,
    now,
    localHost: hostname(),
    isLocalProcessAlive,
    thresholds: input.thresholds,
    heartbeatStaleOnly: true,
  });
  let closed = 0;
  let changedSinceRead = 0;
  for (const reap of plan.reap) {
    const { filter, update } = staleScrapeRunUpdate(reap, { now, detectedBy: input.detectedBy });
    const result = await ScrapeRun.updateOne(filter, update);
    if ((result.matchedCount ?? 0) > 0) closed += 1;
    else changedSinceRead += 1;
  }
  return { plan, closed, changedSinceRead };
}
