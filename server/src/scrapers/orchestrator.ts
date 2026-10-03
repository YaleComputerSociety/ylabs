/**
 * ScraperOrchestrator: resolves a source name to a registered IScraper, opens a ScrapeRun,
 * runs the scraper, persists Observations as they're emitted, and finalizes the run record.
 *
 * Materialization is a separate step (--materialize flag on the CLI) so a buggy scraper
 * never directly affects entity collections.
 */
import { ScrapeRun } from '../models/scrapeRun';
import { buildEvidenceCoverageImpactReportForObservations } from '../services/researchEntityEvidenceCoverage';
import { serializedDocumentId } from '../utils/idSerialization';
import { sanitizeErrorForLog, sanitizeLogValue } from '../utils/logSanitizer';
import { onInterrupt } from './interruptCleanup';
import { appendObservations, getSourceByName } from './observationStore';
import { currentProcessCodeSha } from './scrapeRunCodeIdentity';
import type { ReturnedScrapeRunStatus } from './sourceCrawlStamp';
import { currentScrapeRunOwner, startScrapeRunHeartbeat } from './scrapeRunLiveness';
import { boundedScrapeRunNotes } from './scrapeRunNotes';
import {
  SCRAPE_RUN_INTERRUPT_WRITE_DEADLINE_MS,
  ScrapeRunTerminalWriteError,
  writeScrapeRunTerminalStatus,
} from './scrapeRunTerminalWrite';
import {
  readPriorRunYieldFacts,
  resolveBarrenStreakFailure,
  resolveBarrenUnitStreakFailures,
} from './sourceYieldGuard';
import { withHttpCacheFetchMetrics, withHttpValidatorCacheScope } from './utils/httpValidatorCache';
import { withSweepPageReuseFetchMetrics, withSweepPageReuseScope } from './utils/sweepPageReuse';
import type {
  IScraper,
  ScraperContext,
  ScraperMetrics,
  ScraperOptions,
  ObservationInput,
  ScraperResult,
} from './types';

/**
 * Cap on the observation values a single `--explain` run collects in memory and
 * writes to its report, so a corpus-wide dry run cannot produce an unbounded
 * artifact. Raise per run with `--explain-limit`.
 */
const DEFAULT_EXPLAIN_LIMIT = 500;

export interface ScraperOrchestratorConfig {
  runHeartbeatIntervalMs?: number;
}

export interface ScraperRunOwnership {
  lockOwnerId?: string;
}

export class ScraperOrchestrator {
  private scrapers: Map<string, IScraper> = new Map();

  constructor(private readonly config: ScraperOrchestratorConfig = {}) {}

  register(scraper: IScraper): void {
    this.scrapers.set(scraper.name, scraper);
  }

  list(): { name: string; displayName: string }[] {
    return Array.from(this.scrapers.values()).map((s) => ({
      name: s.name,
      displayName: s.displayName,
    }));
  }

  get(name: string): IScraper | undefined {
    return this.scrapers.get(name);
  }

  async run(
    name: string,
    options: ScraperOptions,
    ownership: ScraperRunOwnership = {},
  ): Promise<{
    runId: string;
    status: ReturnedScrapeRunStatus;
    result: unknown;
    explainedObservations?: Array<Record<string, unknown>>;
    explainTruncated?: boolean;
  }> {
    const scraper = this.scrapers.get(name);
    if (!scraper) {
      throw new Error(
        `No scraper registered with name "${name}". Registered: ${Array.from(this.scrapers.keys()).join(', ')}`,
      );
    }

    const source = await getSourceByName(name);
    if (!source) {
      throw new Error(`No Source row found with name "${name}". Run "yarn seed:sources" first.`);
    }

    const startedAt = new Date();
    const run = await ScrapeRun.create({
      sourceId: source._id,
      sourceName: source.name,
      triggeredBy: options.triggeredBy || 'cli',
      startedAt,
      heartbeatAt: startedAt,
      owner: currentScrapeRunOwner(ownership.lockOwnerId),
      codeSha: currentProcessCodeSha(),
      status: 'running',
      options: options as any,
      invalidated: options.benchmarkRun === true,
    });

    let observationCount = 0;
    let entitiesObserved = 0;
    const observedEntityKeys = new Set<string>();
    const errors: any[] = [];
    const previewObservations: Array<Record<string, unknown>> = [];
    // What the lane has reported so far, kept outside the try so a throw does not take
    // it with it (#3890).
    const reportedMetrics: ScraperMetrics = {};
    const explainLimit = options.explain
      ? (options.explainLimit ?? DEFAULT_EXPLAIN_LIMIT)
      : Infinity;
    const scrapeRunId = serializedDocumentId(run._id) || '';

    const ctx: ScraperContext = {
      scrapeRunId,
      sourceId: source._id,
      sourceName: source.name,
      sourceWeight: source.defaultWeight,
      options,
      emit: async (input: ObservationInput | ObservationInput[]) => {
        const inputs = Array.isArray(input) ? input : [input];
        if (inputs.length === 0) return;
        const res = await appendObservations(inputs, {
          scrapeRunId,
          sourceId: source._id,
          sourceName: source.name,
          sourceWeight: source.defaultWeight,
          dryRun: options.dryRun,
        });
        if (options.dryRun && (options.dbReview || options.explain)) {
          const room = explainLimit - previewObservations.length;
          if (room > 0) {
            previewObservations.push(
              ...inputs.slice(0, room).map((obs) => ({
                ...obs,
                sourceName: source.name,
                sourceId: source._id,
                confidence: obs.confidenceOverride ?? source.defaultWeight,
              })),
            );
          }
        }
        observationCount += options.dryRun ? inputs.length : res.inserted;
        for (const o of inputs) {
          const key = `${o.entityType}:${o.entityId || o.entityKey || ''}`;
          observedEntityKeys.add(key);
        }
        entitiesObserved = observedEntityKeys.size;
      },
      reportMetrics: (metrics) => {
        Object.assign(reportedMetrics, metrics);
      },
      log: (msg, meta) => {
        const prefix = `[${name}]`;
        const safeMessage = sanitizeLogValue(msg);
        if (meta) console.log(prefix, safeMessage, sanitizeLogValue(meta));
        else console.log(prefix, safeMessage);
      },
    };

    const heartbeat = startScrapeRunHeartbeat({
      runId: run._id,
      sourceName: source.name,
      intervalMs: this.config.runHeartbeatIntervalMs,
    });
    let interrupted = false;
    const detachInterrupt = onInterrupt(async (signal) => {
      interrupted = true;
      heartbeat.stop();
      const at = new Date();
      await writeScrapeRunTerminalStatus(
        () =>
          ScrapeRun.updateOne(
            { _id: run._id, status: 'running' },
            {
              $set: {
                finishedAt: at,
                status: 'interrupted',
                observationCount,
                entitiesObserved,
                interruption: {
                  reason: 'signal',
                  signal,
                  detectedAt: at,
                  detectedBy: 'orchestrator',
                },
                errors: [
                  ...errors,
                  { message: `Interrupted by ${signal} before the run finished`, at },
                ],
              },
            },
          ),
        {
          status: 'interrupted',
          sourceName: source.name,
          deadlineMs: SCRAPE_RUN_INTERRUPT_WRITE_DEADLINE_MS,
        },
      ).catch(() => undefined);
    });

    try {
      const reused = await withSweepPageReuseScope(() =>
        withHttpValidatorCacheScope(() => scraper.run(ctx)),
      );
      const result = withSweepPageReuseFetchMetrics(
        withHttpCacheFetchMetrics(reused.value.value as ScraperResult, reused.value.stats),
        reused.stats,
      );
      const evidenceCoverageImpact =
        options.dryRun && options.dbReview
          ? await buildEvidenceCoverageImpactReportForObservations(previewObservations)
          : undefined;
      for (const failure of result.partialFailures ?? []) {
        errors.push({ message: sanitizeLogValue(failure), at: new Date() });
      }
      const currentRunYield = { observationCount, metrics: result.metrics, options };
      const priorRunsNewestFirst = await readPriorRunYieldFacts({
        sourceId: source._id,
        currentRunId: run._id,
      });
      const barrenStreakFailure = resolveBarrenStreakFailure({
        sourceName: source.name,
        source,
        currentRun: currentRunYield,
        priorRunsNewestFirst,
      });
      if (barrenStreakFailure) {
        console.error(`[${name}] ${barrenStreakFailure.message}`);
        errors.push({ message: barrenStreakFailure.message, at: new Date() });
      }
      // A dead unit inside a healthy lane is as much a failure as a dead lane, and the
      // source total cannot show it (#3876).
      const barrenUnitFailures = resolveBarrenUnitStreakFailures({
        sourceName: source.name,
        source,
        currentRun: currentRunYield,
        priorRunsNewestFirst,
      });
      for (const failure of barrenUnitFailures) {
        console.error(`[${name}] ${failure.message}`);
        errors.push({ message: failure.message, at: new Date() });
      }
      const status: ReturnedScrapeRunStatus = interrupted
        ? 'interrupted'
        : barrenStreakFailure || barrenUnitFailures.length > 0
          ? 'failure'
          : errors.length === 0
            ? 'success'
            : 'partial';
      if (!interrupted) {
        const finishedAt = new Date();
        const runNotes = boundedScrapeRunNotes(result.notes);
        await writeScrapeRunTerminalStatus(
          () =>
            ScrapeRun.updateOne(
              { _id: run._id },
              {
                $set: {
                  finishedAt,
                  status,
                  observationCount,
                  entitiesObserved,
                  fetchMetrics: result.fetchMetrics,
                  // The returned object wins key by key, because it is the lane's
                  // final word; anything only reported mid-run survives beside it.
                  metrics: runMetrics(reportedMetrics, result.metrics, evidenceCoverageImpact),
                  ...(runNotes ? { notes: runNotes } : {}),
                  errors,
                },
              },
            ),
          { status, sourceName: source.name },
        );
      }
      return {
        runId: scrapeRunId,
        status,
        result: {
          ...result,
          metrics: runMetrics(reportedMetrics, result.metrics, evidenceCoverageImpact),
        },
        ...(options.explain
          ? {
              explainedObservations: previewObservations,
              explainTruncated: observationCount > previewObservations.length,
            }
          : {}),
      };
    } catch (err: any) {
      if (!interrupted && !(err instanceof ScrapeRunTerminalWriteError))
        await recordRunFailure(run._id, source.name, err, {
          observationCount,
          entitiesObserved,
          errors,
          metrics: runMetrics(reportedMetrics),
        });
      throw err;
    } finally {
      heartbeat.stop();
      detachInterrupt();
    }
  }
}

/**
 * The run's stored metrics: what the lane reported mid-run, then what it returned, then
 * the dry-run coverage report. Returns undefined when there is nothing at all, so a run
 * with no measurements stores no empty object (#3890).
 */
function runMetrics(
  reported: ScraperMetrics,
  returned?: ScraperMetrics,
  evidenceCoverageImpact?: unknown,
): Record<string, unknown> | undefined {
  const merged: Record<string, unknown> = {
    ...reported,
    ...(returned || {}),
    ...(evidenceCoverageImpact ? { evidenceCoverageImpact } : {}),
  };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

// A failed failure write must not replace the scrape's own error. A terminal write
// that exhausted its retries is not re-recorded as a failure either: the scrape itself
// did not fail, and the row it leaves `running` stops heartbeating, so the sweep's
// stale-run stage or `scrape-runs:reconcile-stale` closes it.
async function recordRunFailure(
  runId: unknown,
  sourceName: string,
  err: unknown,
  progress: {
    observationCount: number;
    entitiesObserved: number;
    errors: any[];
    metrics?: Record<string, unknown>;
  },
): Promise<void> {
  // `sanitizeErrorForLog` rather than the message alone: `errors.stack` has been a
  // schema path all along and nothing has written it since June, so the one run that
  // died with `Maximum call stack size exceeded` recorded no frame to read and the
  // investigation had to proceed by elimination over the lane's source (#3891).
  const sanitized =
    err instanceof Error
      ? sanitizeErrorForLog(err)
      : { message: sanitizeLogValue(err), stack: undefined };
  const errorMessage = sanitized.message;
  const finishedAt = new Date();
  await writeScrapeRunTerminalStatus(
    () =>
      ScrapeRun.updateOne(
        { _id: runId },
        {
          $set: {
            finishedAt,
            status: 'failure',
            observationCount: progress.observationCount,
            entitiesObserved: progress.entitiesObserved,
            ...(progress.metrics ? { metrics: progress.metrics } : {}),
            errors: [
              ...progress.errors,
              {
                message: errorMessage || 'Unknown scrape error',
                ...(sanitized.stack ? { stack: sanitized.stack } : {}),
                at: new Date(),
              },
            ],
          },
        },
      ),
    { status: 'failure', sourceName },
  ).catch(() => undefined);
}
