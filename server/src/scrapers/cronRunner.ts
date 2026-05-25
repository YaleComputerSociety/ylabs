import { randomUUID } from 'crypto';
import { Source } from '../models/source';
import { materializeFromRun } from './entityMaterializer';
import { getScrapeRunReport } from './runReport';
import {
  acquireScrapeJobLock,
  heartbeatScrapeJobLock,
  releaseScrapeJobLock,
} from './scrapeJobLock';
import { runStudentVisibilityGate } from '../services/studentVisibilityGateService';
import type { ScraperEnvironment } from './scraperEnvironment';
import type { ScraperOptions } from './types';
import type { ScraperOrchestrator } from './orchestrator';

export interface CronRunnerDependencies {
  loadSource: (sourceName: string) => Promise<{ name: string; enabled?: boolean } | null>;
  orchestrator: Pick<ScraperOrchestrator, 'run'>;
  materializeFromRun: typeof materializeFromRun;
  runStudentVisibilityGate: typeof runStudentVisibilityGate;
  getScrapeRunReport: typeof getScrapeRunReport;
  acquireScrapeJobLock: typeof acquireScrapeJobLock;
  heartbeatScrapeJobLock: typeof heartbeatScrapeJobLock;
  releaseScrapeJobLock: typeof releaseScrapeJobLock;
}

export interface RunScraperCronInput {
  sourceName: string;
  environment: ScraperEnvironment;
  options: ScraperOptions;
  ownerId?: string;
  forceDisabled?: boolean;
  now?: Date;
  leaseMs?: number;
  heartbeatIntervalMs?: number;
}

export type RunScraperCronResult =
  | {
      status: 'skipped-lock-held';
      sourceName: string;
      exitCode: 0;
      ownerId: string;
    }
  | {
      status: 'completed';
      sourceName: string;
      runId: string;
      exitCode: 0 | 1;
      ownerId: string;
      scrapeResult: unknown;
      materializationResult: Awaited<ReturnType<typeof materializeFromRun>>;
      visibilityGateResult?: Awaited<ReturnType<typeof runStudentVisibilityGate>>;
      report: Awaited<ReturnType<typeof getScrapeRunReport>>;
    };

export function createCronRunnerDependencies(
  orchestrator: Pick<ScraperOrchestrator, 'run'>,
): CronRunnerDependencies {
  return {
    loadSource: loadCronSource,
    orchestrator,
    materializeFromRun,
    runStudentVisibilityGate,
    getScrapeRunReport,
    acquireScrapeJobLock,
    heartbeatScrapeJobLock,
    releaseScrapeJobLock,
  };
}

export async function runScraperCron(
  input: RunScraperCronInput,
  deps: CronRunnerDependencies,
): Promise<RunScraperCronResult> {
  if (input.environment !== 'production') {
    throw new Error('Cron scraper command requires SCRAPER_ENV=production.');
  }
  if (!input.options.release || input.options.dryRun) {
    throw new Error('Cron scraper command requires --release write mode.');
  }

  const source = await deps.loadSource(input.sourceName);
  if (!source) {
    throw new Error(
      `No Source row found with name "${input.sourceName}". Run "yarn scrape:seed-sources" first.`,
    );
  }
  if (source.enabled === false && !input.forceDisabled) {
    throw new Error(
      `Source "${input.sourceName}" is disabled; pass --force-disabled only for manual recovery.`,
    );
  }

  const ownerId = input.ownerId || createCronOwnerId(input.environment, input.sourceName);
  const lock = await deps.acquireScrapeJobLock({
    environment: input.environment,
    sourceName: input.sourceName,
    ownerId,
    now: input.now,
    leaseMs: input.leaseMs,
  });

  if (!lock.acquired) {
    return {
      status: 'skipped-lock-held',
      sourceName: input.sourceName,
      exitCode: 0,
      ownerId,
    };
  }

  let runId: string | undefined;
  const heartbeat = startHeartbeat(input, deps, ownerId);
  try {
    const runOptions: ScraperOptions = {
      ...input.options,
      triggeredBy: 'cron',
    };
    const { runId: nextRunId, result: scrapeResult } = await deps.orchestrator.run(
      input.sourceName,
      runOptions,
    );
    runId = nextRunId;
    const materializationResult = await deps.materializeFromRun(runId, { dryRun: false });
    const visibilityGateResult =
      materializationResult.errors === 0
        ? await deps.runStudentVisibilityGate({
            collection: 'all',
            mode: 'apply',
            sourceName: input.sourceName,
          })
        : undefined;
    const report = await deps.getScrapeRunReport(runId);
    const exitCode = materializationResult.errors > 0 ? 1 : 0;

    await deps.releaseScrapeJobLock({
      environment: input.environment,
      sourceName: input.sourceName,
      ownerId,
      releaseReason: exitCode === 0 ? 'success' : 'failure',
      lastRunId: runId,
    });

    return {
      status: 'completed',
      sourceName: input.sourceName,
      runId,
      exitCode,
      ownerId,
      scrapeResult,
      materializationResult,
      visibilityGateResult,
      report,
    };
  } catch (error) {
    await deps.releaseScrapeJobLock({
      environment: input.environment,
      sourceName: input.sourceName,
      ownerId,
      releaseReason: 'failure',
      lastRunId: runId,
    });
    throw error;
  } finally {
    heartbeat.stop();
  }
}

function startHeartbeat(
  input: RunScraperCronInput,
  deps: CronRunnerDependencies,
  ownerId: string,
): { stop: () => void } {
  const intervalMs = input.heartbeatIntervalMs ?? 60 * 1000;
  if (intervalMs <= 0) return { stop: () => undefined };

  const timer = setInterval(() => {
    deps
      .heartbeatScrapeJobLock({
        environment: input.environment,
        sourceName: input.sourceName,
        ownerId,
        leaseMs: input.leaseMs,
      })
      .catch((error) => {
        console.error(
          `Failed to heartbeat scraper cron lock for ${input.sourceName}:`,
          error instanceof Error ? error.message : error,
        );
      });
  }, intervalMs);
  timer.unref?.();

  return {
    stop: () => clearInterval(timer),
  };
}

async function loadCronSource(
  sourceName: string,
): Promise<{ name: string; enabled?: boolean } | null> {
  const source = await Source.findOne({ name: sourceName }).select('name enabled').lean();
  if (!source) return null;
  return {
    name: (source as any).name,
    enabled: (source as any).enabled,
  };
}

function createCronOwnerId(environment: ScraperEnvironment, sourceName: string): string {
  return `cron:${environment}:${sourceName}:${process.pid}:${randomUUID()}`;
}
