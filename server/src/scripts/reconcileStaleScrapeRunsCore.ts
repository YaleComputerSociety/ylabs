import type { ScrapeRunInterruptionReason } from '../models/storedVocabularies';
import {
  classifyScrapeRunLiveness,
  SCRAPE_RUN_LEGACY_ABANDONED_AFTER_MS,
  SCRAPE_RUN_STALE_HEARTBEAT_MS,
} from '../scrapers/scrapeRunLiveness';
import {
  assertScraperEnvironmentMatchesMongoTarget,
  isPromotionOnlyEnvironment,
  resolveMongoDatabaseName,
  type ScraperEnvironment,
} from '../scrapers/scraperEnvironment';
import { operatorEnvironmentForDatabaseName } from './operatorDatabaseEnvironment';
import { assertScriptApplyAllowed } from './scriptWriteGuards';

export interface RunningScrapeRunFacts {
  id: string;
  sourceName: string;
  startedAt: Date;
  heartbeatAt?: Date;
  owner?: { host?: string; pid?: number; lockOwnerId?: string };
}

export type StaleScrapeRunKeepReason =
  | 'heartbeat_fresh'
  | 'source_lock_held'
  | 'owner_process_alive'
  | 'legacy_too_recent'
  | 'started_at_or_after_cutoff'
  | 'legacy_operator_only';

export type StaleScrapeRunReapReason = Extract<
  ScrapeRunInterruptionReason,
  'heartbeat_stale' | 'legacy_abandoned'
>;

export interface StaleScrapeRunReap {
  id: string;
  sourceName: string;
  startedAt: Date;
  heartbeatAt?: Date;
  reason: StaleScrapeRunReapReason;
  lastSignOfLifeAt: Date;
}

export interface StaleScrapeRunKeep {
  id: string;
  sourceName: string;
  startedAt: Date;
  heartbeatAt?: Date;
  reason: StaleScrapeRunKeepReason;
}

export interface StaleScrapeRunPlan {
  reap: StaleScrapeRunReap[];
  keep: StaleScrapeRunKeep[];
}

export interface StaleScrapeRunThresholds {
  staleHeartbeatMs: number;
  legacyAbandonedAfterMs: number;
}

export const DEFAULT_STALE_SCRAPE_RUN_THRESHOLDS: StaleScrapeRunThresholds = {
  staleHeartbeatMs: SCRAPE_RUN_STALE_HEARTBEAT_MS,
  legacyAbandonedAfterMs: SCRAPE_RUN_LEGACY_ABANDONED_AFTER_MS,
};

export function resolveStaleScrapeRunThresholds(requested: {
  staleAfterMinutes?: number;
  legacyOlderThanHours?: number;
}): StaleScrapeRunThresholds {
  const staleHeartbeatMs =
    requested.staleAfterMinutes === undefined
      ? DEFAULT_STALE_SCRAPE_RUN_THRESHOLDS.staleHeartbeatMs
      : requested.staleAfterMinutes * 60 * 1000;
  const legacyAbandonedAfterMs =
    requested.legacyOlderThanHours === undefined
      ? DEFAULT_STALE_SCRAPE_RUN_THRESHOLDS.legacyAbandonedAfterMs
      : requested.legacyOlderThanHours * 60 * 60 * 1000;
  if (staleHeartbeatMs < DEFAULT_STALE_SCRAPE_RUN_THRESHOLDS.staleHeartbeatMs) {
    throw new Error(
      `--stale-after-minutes may only raise the bound, never lower it below ${DEFAULT_STALE_SCRAPE_RUN_THRESHOLDS.staleHeartbeatMs / 60_000}, because a live run heartbeats only once a minute.`,
    );
  }
  if (legacyAbandonedAfterMs < DEFAULT_STALE_SCRAPE_RUN_THRESHOLDS.legacyAbandonedAfterMs) {
    throw new Error(
      `--legacy-older-than-hours may only raise the bound, never lower it below ${DEFAULT_STALE_SCRAPE_RUN_THRESHOLDS.legacyAbandonedAfterMs / 3_600_000}, because a run that predates heartbeats has no other sign of life.`,
    );
  }
  return { staleHeartbeatMs, legacyAbandonedAfterMs };
}

export function planStaleScrapeRunReconciliation(input: {
  runs: RunningScrapeRunFacts[];
  heldLockSourceNames: ReadonlySet<string>;
  now: Date;
  localHost: string;
  isLocalProcessAlive: (pid: number) => boolean;
  thresholds?: StaleScrapeRunThresholds;
  heartbeatStaleOnly?: boolean;
  startedBefore?: Date;
}): StaleScrapeRunPlan {
  const thresholds = input.thresholds ?? DEFAULT_STALE_SCRAPE_RUN_THRESHOLDS;
  const plan: StaleScrapeRunPlan = { reap: [], keep: [] };
  for (const run of input.runs) {
    const base = {
      id: run.id,
      sourceName: run.sourceName,
      startedAt: run.startedAt,
      ...(run.heartbeatAt ? { heartbeatAt: run.heartbeatAt } : {}),
    };
    const keep = (reason: StaleScrapeRunKeepReason) => plan.keep.push({ ...base, reason });
    if (input.startedBefore && run.startedAt.getTime() >= input.startedBefore.getTime()) {
      keep('started_at_or_after_cutoff');
      continue;
    }
    const liveness = classifyScrapeRunLiveness(
      { status: 'running', startedAt: run.startedAt, heartbeatAt: run.heartbeatAt },
      input.now,
      thresholds.staleHeartbeatMs,
    );
    if (liveness === 'live') {
      keep('heartbeat_fresh');
      continue;
    }
    if (input.heldLockSourceNames.has(run.sourceName)) {
      keep('source_lock_held');
      continue;
    }
    const pid = run.owner?.pid;
    if (
      run.owner?.host === input.localHost &&
      typeof pid === 'number' &&
      input.isLocalProcessAlive(pid)
    ) {
      keep('owner_process_alive');
      continue;
    }
    if (liveness === 'stale' && run.heartbeatAt) {
      plan.reap.push({ ...base, reason: 'heartbeat_stale', lastSignOfLifeAt: run.heartbeatAt });
      continue;
    }
    if (input.now.getTime() - run.startedAt.getTime() <= thresholds.legacyAbandonedAfterMs) {
      keep('legacy_too_recent');
      continue;
    }
    if (input.heartbeatStaleOnly) {
      keep('legacy_operator_only');
      continue;
    }
    plan.reap.push({ ...base, reason: 'legacy_abandoned', lastSignOfLifeAt: run.startedAt });
  }
  return plan;
}

export function staleScrapeRunInterruptionMessage(reap: StaleScrapeRunReap): string {
  return reap.reason === 'heartbeat_stale'
    ? `Closed as interrupted: its heartbeat stopped at ${reap.lastSignOfLifeAt.toISOString()} and no live process or lock owns it`
    : `Closed as interrupted: it predates run heartbeats, started ${reap.startedAt.toISOString()}, and never recorded a terminal status`;
}

// The filter pins the heartbeat that was read, so a run that beat after the plan
// was built no longer matches and is left alone.
export function staleScrapeRunUpdate(
  reap: StaleScrapeRunReap,
  input: { now: Date; detectedBy: string },
): { filter: Record<string, unknown>; update: Record<string, unknown> } {
  return {
    filter: {
      _id: reap.id,
      status: 'running',
      heartbeatAt: reap.heartbeatAt ?? { $exists: false },
    },
    update: {
      $set: {
        status: 'interrupted',
        finishedAt: reap.lastSignOfLifeAt,
        interruption: {
          reason: reap.reason,
          detectedAt: input.now,
          detectedBy: input.detectedBy,
        },
      },
      $push: { errors: { message: staleScrapeRunInterruptionMessage(reap), at: input.now } },
    },
  };
}

export function summarizeStaleScrapeRunPlan(plan: StaleScrapeRunPlan): {
  running: number;
  planned: number;
  plannedByReason: Record<string, number>;
  keptByReason: Record<string, number>;
} {
  const count = (reasons: string[]) =>
    reasons.reduce<Record<string, number>>((acc, reason) => {
      acc[reason] = (acc[reason] ?? 0) + 1;
      return acc;
    }, {});
  return {
    running: plan.reap.length + plan.keep.length,
    planned: plan.reap.length,
    plannedByReason: count(plan.reap.map((entry) => entry.reason)),
    keptByReason: count(plan.keep.map((entry) => entry.reason)),
  };
}

export function assertReconcileStaleScrapeRunsApplyAllowed(input: {
  apply: boolean;
  scriptName: string;
  mongoUrl?: string;
  env?: NodeJS.ProcessEnv;
}): { environment: ScraperEnvironment; dbLabel: string } {
  const env = input.env ?? process.env;
  const guard = assertScriptApplyAllowed({
    apply: input.apply,
    scriptName: input.scriptName,
    mongoUrl: input.mongoUrl,
    env,
  });
  if (!input.apply) return { environment: guard.environment, dbLabel: guard.dbLabel };

  const databaseName = resolveMongoDatabaseName(input.mongoUrl);
  const databaseEnvironment = databaseName
    ? operatorEnvironmentForDatabaseName(databaseName)
    : undefined;
  if (
    isPromotionOnlyEnvironment(guard.environment) ||
    (databaseEnvironment !== 'development' && databaseEnvironment !== 'test')
  ) {
    throw new Error(
      `${input.scriptName} --apply writes only to Development (SCRAPER_ENV=${guard.environment}, Mongo target ${guard.dbLabel}). ` +
        'Beta and Production receive scrape_runs only through promotion, so close stale runs in Development and promote.',
    );
  }
  assertScraperEnvironmentMatchesMongoTarget({
    environment: guard.environment,
    mongoUrl: input.mongoUrl,
    env,
  });
  return { environment: guard.environment, dbLabel: guard.dbLabel };
}
