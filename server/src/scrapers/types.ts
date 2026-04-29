/**
 * Shared types for the scraper subsystem.
 */
import type { ObservedEntityType } from '../models/observation';

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
  only?: string[];
  since?: Date;
}

export interface ScraperResult {
  observationCount: number;
  entitiesObserved: number;
  notes?: string;
}

export interface IScraper {
  readonly name: string;
  readonly displayName: string;
  run(context: ScraperContext): Promise<ScraperResult>;
}
