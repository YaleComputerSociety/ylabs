/**
 * ScrapeRun reporting helpers.
 *
 * The report command is intentionally read-only. It turns a run plus its
 * Observations into an operator-friendly QA artifact: counts, field coverage,
 * conflict candidates, materialization counters, and warnings.
 */
import mongoose from 'mongoose';
import { Observation } from '../models/observation';
import { ScrapeRun } from '../models/scrapeRun';
import type { ScraperFetchMetrics } from './types';

export interface ReportObservation {
  entityType: string;
  entityId?: unknown;
  entityKey?: string;
  field: string;
  value: unknown;
  confidence?: number;
  sourceUrl?: string;
  superseded?: boolean;
  observationFingerprint?: string;
}

export interface ReportScrapeRun {
  _id: unknown;
  sourceName: string;
  status: string;
  triggeredBy?: string;
  startedAt?: Date | string;
  finishedAt?: Date | string;
  observationCount?: number;
  entitiesObserved?: number;
  entitiesCreated?: number;
  entitiesUpdated?: number;
  entitiesArchived?: number;
  materializationSkipped?: number;
  materializationConflicts?: number;
  materializationErrors?: number;
  errors?: Array<{ message?: string; context?: unknown; at?: Date | string }>;
  options?: Record<string, unknown>;
  fetchMetrics?: ScraperFetchMetrics;
  invalidated?: boolean;
}

export interface ScrapeRunReport {
  run: {
    id: string;
    sourceName: string;
    status: string;
    triggeredBy?: string;
    startedAt?: string;
    finishedAt?: string;
    durationSeconds?: number;
    invalidated: boolean;
    options: Record<string, unknown>;
  };
  observations: {
    total: number;
    entitiesObserved: number;
    byEntityType: Record<string, number>;
    byField: Record<string, number>;
    topFields: Array<{ field: string; count: number }>;
    active: number;
    superseded: number;
    duplicateRate: number;
  };
  materialization: {
    created: number;
    updated: number;
    archived: number;
    skipped: number;
    conflicts: number;
    errors: number;
  };
  fetchMetrics?: ScraperFetchMetrics;
  quality: {
    conflictCandidateCount: number;
    conflictCandidates: Array<{
      entityType: string;
      entity: string;
      field: string;
      distinctValues: number;
    }>;
    missingEntityIdentifierCount: number;
    missingSourceUrlCount: number;
    lowConfidenceCount: number;
  };
  warnings: string[];
  errors: Array<{ message: string; at?: string; context?: unknown }>;
}

function stringifyId(value: unknown): string | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  return String(value);
}

function iso(value: Date | string | undefined): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function durationSeconds(start?: Date | string, finish?: Date | string): number | undefined {
  if (!start || !finish) return undefined;
  const s = new Date(start).getTime();
  const f = new Date(finish).getTime();
  if (Number.isNaN(s) || Number.isNaN(f)) return undefined;
  return Math.max(0, Math.round((f - s) / 1000));
}

function increment(map: Record<string, number>, key: string): void {
  map[key] = (map[key] || 0) + 1;
}

function serializeValue(value: unknown): string {
  if (value === null || value === undefined) return '__null__';
  if (typeof value === 'string') return `s:${value.trim().toLowerCase()}`;
  if (typeof value === 'number' || typeof value === 'boolean') return `p:${String(value)}`;
  try {
    return `j:${JSON.stringify(value)}`;
  } catch {
    return `x:${String(value)}`;
  }
}

function topEntries(map: Record<string, number>, limit: number): Array<{ field: string; count: number }> {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([field, count]) => ({ field, count }));
}

export function buildScrapeRunReport(
  run: ReportScrapeRun,
  observations: ReportObservation[],
): ScrapeRunReport {
  const byEntityType: Record<string, number> = {};
  const byField: Record<string, number> = {};
  const entities = new Set<string>();
  const valuesByEntityField = new Map<string, Set<string>>();
  const labelsByEntityField = new Map<
    string,
    { entityType: string; entity: string; field: string }
  >();
  let missingEntityIdentifierCount = 0;
  let missingSourceUrlCount = 0;
  let lowConfidenceCount = 0;
  let supersededCount = 0;

  for (const obs of observations) {
    increment(byEntityType, obs.entityType || 'unknown');
    increment(byField, obs.field || 'unknown');

    const entityId = stringifyId(obs.entityId);
    const entityKey = stringifyId(obs.entityKey);
    const entity = entityId || entityKey;
    if (entity) {
      entities.add(`${obs.entityType}:${entity}`);
      const fieldKey = JSON.stringify([obs.entityType, entity, obs.field]);
      labelsByEntityField.set(fieldKey, {
        entityType: obs.entityType,
        entity,
        field: obs.field,
      });
      let values = valuesByEntityField.get(fieldKey);
      if (!values) {
        values = new Set<string>();
        valuesByEntityField.set(fieldKey, values);
      }
      values.add(serializeValue(obs.value));
    } else {
      missingEntityIdentifierCount++;
    }

    if (!obs.sourceUrl) missingSourceUrlCount++;
    if (typeof obs.confidence === 'number' && obs.confidence < 0.5) lowConfidenceCount++;
    if (obs.superseded) supersededCount++;
  }

  const conflictCandidates = Array.from(valuesByEntityField.entries())
    .filter(([, values]) => values.size > 1)
    .map(([key, values]) => {
      const label = labelsByEntityField.get(key);
      return {
        entityType: label?.entityType || 'unknown',
        entity: label?.entity || 'unknown',
        field: label?.field || 'unknown',
        distinctValues: values.size,
      };
    })
    .sort((a, b) => b.distinctValues - a.distinctValues || a.field.localeCompare(b.field))
    .slice(0, 20);

  const errors = (run.errors || []).map((err) => ({
    message: err.message || 'Unknown scrape error',
    at: iso(err.at),
    context: err.context,
  }));

  const warnings: string[] = [];
  if (run.status === 'failure') warnings.push('Run failed; do not materialize without inspecting errors.');
  if (run.status === 'partial') warnings.push('Run completed partially; inspect source-level logs/errors.');
  if (run.invalidated) warnings.push('Run has been invalidated.');
  if (observations.length === 0) warnings.push('Run produced zero observations.');
  if (missingEntityIdentifierCount > 0) {
    warnings.push(`${missingEntityIdentifierCount} observation(s) lack entityId/entityKey.`);
  }
  if (conflictCandidates.length > 0) {
    warnings.push(`${conflictCandidates.length} entity-field conflict candidate(s) found within this run.`);
  }
  if (lowConfidenceCount > 0) {
    warnings.push(`${lowConfidenceCount} low-confidence observation(s) found.`);
  }
  if (supersededCount > 0) {
    warnings.push(`${supersededCount} duplicate observation(s) superseded in this run.`);
  }

  return {
    run: {
      id: String(run._id),
      sourceName: run.sourceName,
      status: run.status,
      triggeredBy: run.triggeredBy,
      startedAt: iso(run.startedAt),
      finishedAt: iso(run.finishedAt),
      durationSeconds: durationSeconds(run.startedAt, run.finishedAt),
      invalidated: !!run.invalidated,
      options: run.options || {},
    },
    observations: {
      total: observations.length,
      entitiesObserved: entities.size,
      byEntityType,
      byField,
      topFields: topEntries(byField, 15),
      active: observations.length - supersededCount,
      superseded: supersededCount,
      duplicateRate: observations.length > 0 ? supersededCount / observations.length : 0,
    },
    materialization: {
      created: run.entitiesCreated || 0,
      updated: run.entitiesUpdated || 0,
      archived: run.entitiesArchived || 0,
      skipped: run.materializationSkipped || 0,
      conflicts: run.materializationConflicts || 0,
      errors: run.materializationErrors || 0,
    },
    fetchMetrics: run.fetchMetrics,
    quality: {
      conflictCandidateCount: conflictCandidates.length,
      conflictCandidates,
      missingEntityIdentifierCount,
      missingSourceUrlCount,
      lowConfidenceCount,
    },
    warnings,
    errors,
  };
}

export async function getScrapeRunReport(scrapeRunId: string): Promise<ScrapeRunReport> {
  if (!mongoose.Types.ObjectId.isValid(scrapeRunId)) {
    throw new Error(`Invalid ScrapeRun id: ${scrapeRunId}`);
  }

  const run = await ScrapeRun.findById(scrapeRunId).lean();
  if (!run) throw new Error(`ScrapeRun not found: ${scrapeRunId}`);

  const observations = await Observation.find({ scrapeRunId })
    .select('entityType entityId entityKey field value confidence sourceUrl superseded observationFingerprint')
    .lean();

  return buildScrapeRunReport(run as ReportScrapeRun, observations as ReportObservation[]);
}
