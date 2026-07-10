/**
 * Shared types for the scraper subsystem.
 */
import type { ObservedEntityType } from '../models/observation';
import type { WorkPlannerMetrics } from './workPlanner';

export interface ObservationInput {
  entityType: ObservedEntityType;
  entityId?: string;
  entityKey?: string;
  field: string;
  value: unknown;
  sourceUrl?: string;
  observedAt?: Date;
  confidenceOverride?: number;
}

export interface ScraperContext {
  scrapeRunId: string;
  sourceId: string;
  sourceName: string;
  sourceWeight: number;
  options: ScraperOptions;
  emit: (obs: ObservationInput | ObservationInput[]) => Promise<void>;
  log: (msg: string, meta?: Record<string, unknown>) => void;
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
  discoverOpenAlexAuthors?: boolean;
  maxOpenAlexPagesPerAuthor?: number;
  manualRecipientCsvDir?: string;
  ignoreWorkPlanner?: boolean;
  dbReview?: boolean;
  triggeredBy?: 'cli' | 'cron' | 'admin';
}

export interface ScraperResult {
  observationCount: number;
  entitiesObserved: number;
  notes?: string;
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
