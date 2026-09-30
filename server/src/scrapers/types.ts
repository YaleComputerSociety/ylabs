/**
 * Shared types for the scraper subsystem.
 */
import type { ObservedEntityType } from '../models/observation';
import type { WorkPlannerMetrics } from './workPlanner';
import type { HttpValidatorCacheStats } from './utils/httpValidatorCache';
import type { SweepPageReuseStats } from './utils/sweepPageReuse';

export interface ObservationInput {
  entityType: ObservedEntityType;
  entityId?: string;
  entityKey?: string;
  field: string;
  value: unknown;
  sourceUrl?: string;
  observedAt?: Date;
  confidenceOverride?: number;
  /**
   * Fields this source states have NO value for this entity in this run. Say this
   * only when the page itself stopped carrying the value, never when a guard
   * refused a value the page still carries: field retraction reads this as
   * permission to retire a prior assertion (#2647).
   */
  assertsNoValueFor?: string[];
}

export interface ScraperContext {
  scrapeRunId: string;
  sourceId: string;
  sourceName: string;
  sourceWeight: number;
  options: ScraperOptions;
  emit: (obs: ObservationInput | ObservationInput[]) => Promise<void>;
  log: (msg: string, meta?: Record<string, unknown>) => void;
  /**
   * Report what the run has measured so far, merged into the run's stored `metrics`
   * whether the lane finishes or throws.
   *
   * `metrics` on `ScraperResult` rides on the return value, so a throw discards every
   * measurement the lane had made: one Development run died after 474 observations
   * with a stack overflow and stored nothing about how far it had got, which is the
   * case a diagnostic is worth most (#3890). Report through here as soon as a number
   * is known, and a later crash or early return keeps it.
   *
   * A returned `metrics` object wins over what was reported here, key by key, because
   * the return value is the lane's final word.
   *
   * Optional only so the several dozen test fixtures that build a context by hand keep
   * compiling; the orchestrator always supplies it, which `orchestrator.test.ts` pins.
   * Call it as `ctx.reportMetrics?.(...)`. A fixture that omits it loses what a lane
   * reports, so a lane test asserting reported metrics has to supply one.
   */
  reportMetrics?: (metrics: ScraperMetrics) => void;
}

export interface ScraperOptions {
  dryRun: boolean;
  useCache: boolean;
  release: boolean;
  limit?: number;
  offset?: number;
  only?: string[];
  onlyFile?: string;
  targetBucket?: string;
  batch?: number;
  batchSize?: number;
  visibilityGateMode?: 'dry-run' | 'apply';
  allowVisibilityDemotions?: boolean;
  since?: Date;
  manualRecipientCsvDir?: string;
  ignoreWorkPlanner?: boolean;
  exhaustive?: boolean;
  forceLlm?: boolean;
  sourceConcurrency?: number;
  dbReview?: boolean;
  explain?: boolean;
  explainLimit?: number;
  triggeredBy?: 'cli' | 'cron' | 'admin';
  benchmarkRun?: boolean;
  // The moment a date-reading lane treats as now. A benchmark pins it to its capture time,
  // so a replay next week infers the same deadline years and acceptance windows (#4132).
  referenceDate?: Date;
}

export interface ScraperResult {
  observationCount: number;
  entitiesObserved: number;
  notes?: string;
  partialFailures?: string[];
  metrics?: ScraperMetrics;
  fetchMetrics?: ScraperFetchMetrics;
}

export interface IScraper {
  readonly name: string;
  readonly displayName: string;
  run(context: ScraperContext): Promise<ScraperResult>;
}

export type ScraperFetchMode =
  | 'http'
  | 'rendered'
  | 'browser'
  | 'remote-browser'
  | 'api'
  | (string & {});

export interface ScraperFetchAttemptMetrics<TFetchMode extends string = ScraperFetchMode> {
  target?: string;
  success: boolean;
  latencyMs: number;
  fetchMode: TFetchMode;
  memoryDeltaBytes?: number;
  blocked: boolean;
  blockedReason?: string;
  selectorBreakage: boolean;
  selectorName?: string;
  statusCode?: number;
  errorMessage?: string;
}

export type ScraperFetchMetric<TFetchMode extends string = ScraperFetchMode> =
  ScraperFetchAttemptMetrics<TFetchMode>;

export interface ScraperFetchMetrics<TFetchMode extends string = ScraperFetchMode> {
  attempts: ScraperFetchAttemptMetrics<TFetchMode>[];
  httpCache?: HttpValidatorCacheStats;
  sweepPageReuse?: SweepPageReuseStats;
  summary: {
    total: number;
    succeeded: number;
    failed: number;
    blocked: number;
    selectorBreakages: number;
    averageLatencyMs: number;
    averageMemoryDeltaBytes?: number;
    byMode: Partial<
      Record<
        TFetchMode,
        {
          total: number;
          succeeded: number;
          blocked: number;
          selectorBreakages: number;
          averageLatencyMs: number;
        }
      >
    >;
  };
}

export interface ScraperMetrics<TFetchMode extends string = ScraperFetchMode> {
  fetchAttempts?: ScraperFetchAttemptMetrics<TFetchMode>[];
  workPlanner?: WorkPlannerMetrics;
  /**
   * What each unit inside this lane yielded, keyed by unit: one track page, one
   * department roster, one centre index. `sourceYieldGuard` compares each key across
   * runs, so a unit going to zero fails the run even while the lane's other units
   * keep the source total healthy (#3876).
   *
   * Report a unit only on a run that attempted it. An omitted unit reads as
   * inconclusive; a zero reads as barren.
   */
  unitYields?: Record<string, number>;
  quotesNotOnPage?: number;
  evidenceQuotesWithdrawn?: number;
  evidenceQuotesRecited?: number;
  fellowshipCatalog?: {
    discovered: number;
    emitted: number;
    created: number;
    updated: number;
    unchanged: number;
    reviewRequired: number;
    missingPreviouslySeen: number;
    deadlineParsed: number;
    deadlineMissing: number;
    sitemapProgramsDiscovered?: number;
    detailPagesCrawled?: number;
    detailPagesCapped?: number;
  };
  reuPrograms?: {
    seeded: number;
    nsfDirectoryDiscovered: number;
    fetched: number;
    emitted: number;
    deadlineParsed: number;
    deadlineMissing: number;
  };
  healthSciencesSummerPrograms?: {
    seeded: number;
    directoryDiscovered: number;
    fetched: number;
    emitted: number;
    deadlineParsed: number;
    deadlineMissing: number;
  };
  evidenceCoverageImpact?: {
    assessed: number;
    improved: number;
    rows: Array<{
      entityType: string;
      entityId?: string;
      entityKey?: string;
      beforeCoverageTier: string;
      afterCoverageTier: string;
      resolvedBlockers: string[];
      remainingBlockers: string[];
      rejectedFields: Array<{ field: string; reason: string; sourceName?: string }>;
    }>;
  };
}
