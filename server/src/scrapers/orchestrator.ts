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
import { sanitizeLogValue } from '../utils/logSanitizer';
import { onInterrupt } from './interruptCleanup';
import { appendObservations, getSourceByName } from './observationStore';
import { currentScrapeRunOwner, startScrapeRunHeartbeat } from './scrapeRunLiveness';
import { readPriorRunYieldFacts, resolveBarrenStreakFailure } from './sourceYieldGuard';
import { withHttpCacheFetchMetrics, withHttpValidatorCacheScope } from './utils/httpValidatorCache';
import { withSweepPageReuseFetchMetrics, withSweepPageReuseScope } from './utils/sweepPageReuse';
import type {
  IScraper,
  ScraperContext,
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
      status: 'running',
      options: options as any,
      invalidated: options.benchmarkRun === true,
    });

    let observationCount = 0;
    let entitiesObserved = 0;
    const observedEntityKeys = new Set<string>();
    const errors: any[] = [];
    const previewObservations: Array<Record<string, unknown>> = [];
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
      await ScrapeRun.updateOne(
        { _id: run._id, status: 'running' },
        {
          $set: {
            finishedAt: at,
            status: 'interrupted',
            observationCount,
            entitiesObserved,
            interruption: { reason: 'signal', signal, detectedAt: at, detectedBy: 'orchestrator' },
            errors: [
              ...errors,
              { message: `Interrupted by ${signal} before the run finished`, at },
            ],
          },
        },
      );
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
      const barrenStreakFailure = resolveBarrenStreakFailure({
        sourceName: source.name,
        source,
        currentRun: { observationCount, metrics: result.metrics, options },
        priorRunsNewestFirst: await readPriorRunYieldFacts({
          sourceId: source._id,
          currentRunId: run._id,
        }),
      });
      if (barrenStreakFailure) {
        console.error(`[${name}] ${barrenStreakFailure.message}`);
        errors.push({ message: barrenStreakFailure.message, at: new Date() });
      }
      if (!interrupted) {
        await ScrapeRun.updateOne(
          { _id: run._id },
          {
            $set: {
              finishedAt: new Date(),
              status: barrenStreakFailure ? 'failure' : errors.length === 0 ? 'success' : 'partial',
              observationCount,
              entitiesObserved,
              fetchMetrics: result.fetchMetrics,
              metrics: evidenceCoverageImpact
                ? { ...(result.metrics || {}), evidenceCoverageImpact }
                : result.metrics,
              errors,
            },
          },
        );
      }
      return {
        runId: scrapeRunId,
        result: evidenceCoverageImpact
          ? {
              ...result,
              metrics: { ...(result.metrics || {}), evidenceCoverageImpact },
            }
          : result,
        ...(options.explain
          ? {
              explainedObservations: previewObservations,
              explainTruncated: observationCount > previewObservations.length,
            }
          : {}),
      };
    } catch (err: any) {
      if (!interrupted)
        await recordRunFailure(run._id, err, { observationCount, entitiesObserved, errors });
      throw err;
    } finally {
      heartbeat.stop();
      detachInterrupt();
    }
  }
}

// A failed failure write must not replace the scrape's own error, and the row it
// leaves `running` stops heartbeating, so `scrape-runs:reconcile-stale` can close it.
async function recordRunFailure(
  runId: unknown,
  err: unknown,
  progress: { observationCount: number; entitiesObserved: number; errors: any[] },
): Promise<void> {
  const errorMessage = sanitizeLogValue(err instanceof Error ? err.message : err);
  try {
    await ScrapeRun.updateOne(
      { _id: runId },
      {
        $set: {
          finishedAt: new Date(),
          status: 'failure',
          observationCount: progress.observationCount,
          entitiesObserved: progress.entitiesObserved,
          errors: [
            ...progress.errors,
            { message: errorMessage || 'Unknown scrape error', at: new Date() },
          ],
        },
      },
    );
  } catch (writeError) {
    console.error(
      'Failed to record the ScrapeRun failure; the row stays running until its heartbeat goes stale:',
      sanitizeLogValue(writeError),
    );
  }
}
