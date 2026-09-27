import { Types } from 'mongoose';
import { sanitizeLogValue } from '../utils/logSanitizer';
import {
  resolveBarrenStreakFailure,
  type RunYieldFacts,
  type YieldExpectationSource,
} from './sourceYieldGuard';
import { MongoWriteRefusedError } from './utils/mongoWriteRefusal';
import type {
  IScraper,
  ObservationInput,
  ScraperContext,
  ScraperOptions,
  ScraperResult,
} from './types';

export const DEFAULT_SCRAPER_CANARY_LIMIT = 5;

export type ScraperCanaryVerdict = 'passed' | 'failed' | 'inconclusive';

export interface ScraperCanaryReport {
  sourceName: string;
  verdict: ScraperCanaryVerdict;
  reason: string;
  limit: number;
  observationCount: number;
  entitiesObserved: number;
  durationMs: number;
  refusedWrites: string[];
}

export interface ScraperCanarySource extends YieldExpectationSource {
  _id: string;
  name: string;
  defaultWeight: number;
}

export interface ScraperCanaryInput {
  scraper: IScraper;
  source: ScraperCanarySource;
  limit?: number;
  forceLlm?: boolean;
  readPriorRuns: (sourceId: string) => Promise<RunYieldFacts[]>;
  refusedWrites?: () => string[];
  log?: (message: string) => void;
  now?: () => number;
}

export function scraperCanaryOptions(limit: number, forceLlm = false): ScraperOptions {
  return {
    dryRun: true,
    useCache: false,
    release: false,
    limit,
    ignoreWorkPlanner: true,
    triggeredBy: 'cli',
    ...(forceLlm ? { forceLlm } : {}),
  };
}

function isWriteRefusal(error: unknown): boolean {
  return (
    error instanceof MongoWriteRefusedError ||
    (error instanceof Error && error.name === 'MongoWriteRefusedError')
  );
}

export async function runScraperCanary(input: ScraperCanaryInput): Promise<ScraperCanaryReport> {
  const now = input.now ?? Date.now;
  const limit = input.limit ?? DEFAULT_SCRAPER_CANARY_LIMIT;
  const refusedWrites = input.refusedWrites ?? (() => []);
  const log = input.log ?? ((message: string) => console.log(message));
  const startedAt = now();
  const entityKeys = new Set<string>();
  let observationCount = 0;

  const ctx: ScraperContext = {
    scrapeRunId: new Types.ObjectId().toHexString(),
    sourceId: input.source._id,
    sourceName: input.source.name,
    sourceWeight: input.source.defaultWeight,
    options: scraperCanaryOptions(limit, input.forceLlm),
    emit: async (emitted: ObservationInput | ObservationInput[]) => {
      const batch = Array.isArray(emitted) ? emitted : [emitted];
      observationCount += batch.length;
      for (const observation of batch) {
        entityKeys.add(
          `${observation.entityType}:${observation.entityId || observation.entityKey || ''}`,
        );
      }
    },
    log: (message, meta) => {
      const safe = sanitizeLogValue(message);
      log(
        meta
          ? `[${input.source.name}] ${safe} ${sanitizeLogValue(meta)}`
          : `[${input.source.name}] ${safe}`,
      );
    },
  };

  const report = (verdict: ScraperCanaryVerdict, reason: string): ScraperCanaryReport => ({
    sourceName: input.source.name,
    verdict,
    reason,
    limit,
    observationCount,
    entitiesObserved: entityKeys.size,
    durationMs: now() - startedAt,
    refusedWrites: refusedWrites(),
  });

  let result: ScraperResult;
  try {
    result = await input.scraper.run(ctx);
  } catch (error) {
    if (isWriteRefusal(error)) {
      return report(
        'inconclusive',
        `the lane writes to MongoDB outside ctx.emit, so the canary cannot run it write-free: ${refusedWrites().join(', ')}`,
      );
    }
    return report(
      'failed',
      `the lane threw: ${sanitizeLogValue(error instanceof Error ? error.message : error)}`,
    );
  }

  if (observationCount > 0) {
    return report(
      'passed',
      `emitted ${observationCount} observation(s) across ${entityKeys.size} entities`,
    );
  }

  const barren = resolveBarrenStreakFailure({
    sourceName: input.source.name,
    source: input.source,
    currentRun: { observationCount: 0, metrics: result.metrics, options: ctx.options },
    priorRunsNewestFirst: await input.readPriorRuns(input.source._id),
  });
  if (barren) {
    return report(
      'failed',
      `emitted zero observations and its prior runs were barren, so the real run would fail the barren-streak guard: ${barren.message}`,
    );
  }
  return report(
    'inconclusive',
    `emitted zero observations in a run bounded to ${limit}; the prior runs were not barren, so this is not predicted to fail`,
  );
}

export function isScraperCanaryReport(value: unknown): value is ScraperCanaryReport {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ScraperCanaryReport>;
  return (
    typeof candidate.sourceName === 'string' &&
    (candidate.verdict === 'passed' ||
      candidate.verdict === 'failed' ||
      candidate.verdict === 'inconclusive') &&
    typeof candidate.reason === 'string' &&
    typeof candidate.observationCount === 'number'
  );
}
