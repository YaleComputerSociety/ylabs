/**
 * Work planning helpers for scraper cost control.
 *
 * Snapshot cache prevents repeated HTTP requests during dev. The work planner
 * answers a different question: "Do we already have recent enough observations
 * for this source/entity/field, so can this scraper skip external work?"
 */
import { Observation } from '../models/observation';
import type { ObservedEntityType } from '../models/observation';

export interface WorkPlannerObservation {
  field: string;
  sourceName: string;
  observedAt: Date | string;
  superseded?: boolean;
}

export interface FieldPlan {
  field: string;
  shouldFetch: boolean;
  reason: 'missing' | 'stale' | 'manual-lock' | 'fresh';
  lastObservedAt?: string;
}

export interface EntityWorkPlan {
  entityType: ObservedEntityType;
  entityId?: string;
  entityKey?: string;
  sourceName: string;
  fields: FieldPlan[];
  shouldFetch: boolean;
}

export interface BuildFieldPlanOptions {
  sourceName: string;
  targetFields: string[];
  observations: WorkPlannerObservation[];
  manuallyLockedFields?: string[];
  freshnessWindowMs: number;
  now?: Date;
}

export interface BuildEntityWorkPlanOptions extends BuildFieldPlanOptions {
  entityType: ObservedEntityType;
  entityId?: string;
  entityKey?: string;
}

export interface LoadEntityWorkPlanOptions {
  entityType: ObservedEntityType;
  entityId?: string;
  entityKey?: string;
  sourceName: string;
  targetFields: string[];
  manuallyLockedFields?: string[];
  freshnessWindowMs: number;
  now?: Date;
}

export function buildEntityWorkPlan(options: BuildEntityWorkPlanOptions): EntityWorkPlan {
  const now = options.now ?? new Date();
  const locked = new Set(options.manuallyLockedFields || []);

  const fields = options.targetFields.map((field): FieldPlan => {
    if (locked.has(field)) {
      return { field, shouldFetch: false, reason: 'manual-lock' };
    }

    const lastObservedAt = latestObservedAt(
      options.observations.filter(
        (obs) =>
          !obs.superseded &&
          obs.sourceName === options.sourceName &&
          obs.field === field,
      ),
    );

    if (!lastObservedAt) {
      return { field, shouldFetch: true, reason: 'missing' };
    }

    const ageMs = now.getTime() - lastObservedAt.getTime();
    if (ageMs > options.freshnessWindowMs) {
      return {
        field,
        shouldFetch: true,
        reason: 'stale',
        lastObservedAt: lastObservedAt.toISOString(),
      };
    }

    return {
      field,
      shouldFetch: false,
      reason: 'fresh',
      lastObservedAt: lastObservedAt.toISOString(),
    };
  });

  return {
    entityType: options.entityType,
    entityId: options.entityId,
    entityKey: options.entityKey,
    sourceName: options.sourceName,
    fields,
    shouldFetch: fields.some((field) => field.shouldFetch),
  };
}

export async function loadEntityWorkPlan(
  options: LoadEntityWorkPlanOptions,
): Promise<EntityWorkPlan> {
  if (!options.entityId && !options.entityKey) {
    throw new Error('loadEntityWorkPlan requires entityId or entityKey');
  }

  const filter: Record<string, unknown> = {
    entityType: options.entityType,
    sourceName: options.sourceName,
    field: { $in: options.targetFields },
  };
  if (options.entityId) filter.entityId = options.entityId;
  if (options.entityKey) filter.entityKey = options.entityKey;

  const observations = await Observation.find(filter)
    .select('field sourceName observedAt superseded')
    .lean();

  return buildEntityWorkPlan({
    ...options,
    observations: observations as WorkPlannerObservation[],
  });
}

function latestObservedAt(observations: WorkPlannerObservation[]): Date | null {
  let latest: Date | null = null;
  for (const obs of observations) {
    const date = obs.observedAt instanceof Date ? obs.observedAt : new Date(obs.observedAt);
    if (Number.isNaN(date.getTime())) continue;
    if (!latest || date.getTime() > latest.getTime()) latest = date;
  }
  return latest;
}
