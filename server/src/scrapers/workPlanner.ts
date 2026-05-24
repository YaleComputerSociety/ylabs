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

export type WorkPlannerRecurringCadence = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'manual';

export interface WorkPlannerSourcePolicy {
  sourceName: string;
  entityType: ObservedEntityType;
  targetFields: string[];
  freshnessWindowMs: number;
  paid?: boolean;
  defaultRecurringCadence?: WorkPlannerRecurringCadence;
  notes?: string;
}

export interface WorkPlannerMetrics {
  planned: number;
  fetched: number;
  skippedFresh: number;
  skippedManualLock: number;
  skippedNoIdentifier: number;
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

export const WORK_PLANNER_DAY_MS = 24 * 60 * 60 * 1000;

export const workPlannerSourcePolicies = [
  {
    sourceName: 'lab-microsite-description-llm',
    entityType: 'researchEntity',
    targetFields: ['lastObservedAt'],
    freshnessWindowMs: 7 * WORK_PLANNER_DAY_MS,
    paid: true,
    defaultRecurringCadence: 'weekly',
    notes:
      'Official microsite description evidence; use the source-level lastObservedAt heartbeat to skip fresh entities before fetch/LLM calls.',
  },
  {
    sourceName: 'lab-microsite-undergrad-llm',
    entityType: 'researchEntity',
    targetFields: ['lastObservedAt'],
    freshnessWindowMs: 7 * WORK_PLANNER_DAY_MS,
    paid: true,
    defaultRecurringCadence: 'weekly',
    notes:
      'Official microsite evidence; use the source-level lastObservedAt heartbeat to skip fresh entities before fetch/LLM calls.',
  },
  {
    sourceName: 'openalex',
    entityType: 'user',
    targetFields: ['openAlexWorksSyncedAt'],
    freshnessWindowMs: 30 * WORK_PLANNER_DAY_MS,
    defaultRecurringCadence: 'monthly',
    notes:
      'Publication enrichment policy; concrete integration should emit a user-level freshness marker after a successful faculty sync.',
  },
  {
    sourceName: 'orcid',
    entityType: 'user',
    targetFields: ['orcidWorksSyncedAt'],
    freshnessWindowMs: 30 * WORK_PLANNER_DAY_MS,
    defaultRecurringCadence: 'monthly',
    notes:
      'Identity-backed ORCID public works ingestion for accepted Yale user ORCIDs.',
  },
  {
    sourceName: 'europe-pmc',
    entityType: 'user',
    targetFields: ['europePmcWorksSyncedAt'],
    freshnessWindowMs: 30 * WORK_PLANNER_DAY_MS,
    defaultRecurringCadence: 'monthly',
    notes:
      'Biomedical ORCID-backed paper discovery; no name-only authorship.',
  },
  {
    sourceName: 'pubmed',
    entityType: 'user',
    targetFields: ['pubmedWorksSyncedAt'],
    freshnessWindowMs: 30 * WORK_PLANNER_DAY_MS,
    defaultRecurringCadence: 'monthly',
    notes:
      'PubMed-facing ORCID-backed biomedical paper discovery via Europe PMC.',
  },
  {
    sourceName: 'crossref',
    entityType: 'scholarlyLink',
    targetFields: ['crossrefHydratedAt'],
    freshnessWindowMs: 90 * WORK_PLANNER_DAY_MS,
    defaultRecurringCadence: 'quarterly',
    notes:
      'DOI-backed compact scholarly-link hydration only; never creates Yale authorship links.',
  },
] satisfies WorkPlannerSourcePolicy[];

export function getWorkPlannerSourcePolicy(
  sourceName: string,
): WorkPlannerSourcePolicy | undefined {
  return workPlannerSourcePolicies.find((policy) => policy.sourceName === sourceName);
}

export function createWorkPlannerMetrics(): WorkPlannerMetrics {
  return {
    planned: 0,
    fetched: 0,
    skippedFresh: 0,
    skippedManualLock: 0,
    skippedNoIdentifier: 0,
  };
}

export function recordWorkPlannerNoIdentifier(metrics: WorkPlannerMetrics): WorkPlannerMetrics {
  metrics.planned += 1;
  metrics.skippedNoIdentifier += 1;
  return metrics;
}

export function recordWorkPlannerDecision(
  metrics: WorkPlannerMetrics,
  plan: EntityWorkPlan,
): WorkPlannerMetrics {
  metrics.planned += 1;
  if (plan.shouldFetch) {
    metrics.fetched += 1;
    return metrics;
  }

  if (plan.fields.some((field) => field.reason === 'manual-lock')) {
    metrics.skippedManualLock += 1;
  } else {
    metrics.skippedFresh += 1;
  }
  return metrics;
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
