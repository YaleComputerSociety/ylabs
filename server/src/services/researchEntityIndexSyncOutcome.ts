import { syncEntities } from './meiliSyncService';

export interface IndexSyncOutcome {
  resynced: number;
  indexSyncFailures: number;
}

export const NO_INDEX_SYNC: IndexSyncOutcome = Object.freeze({ resynced: 0, indexSyncFailures: 0 });

// Mirrors the archived-row rule in `syncEntities`, which deletes those rows rather than
// counting them among the documents it applied; changing that rule also requires
// updating this.
const isIndexableRow = (doc: unknown): boolean =>
  (doc as { archived?: unknown } | null | undefined)?.archived !== true;

export const addIndexSyncOutcomes = (...outcomes: readonly IndexSyncOutcome[]): IndexSyncOutcome =>
  outcomes.reduce(
    (total, outcome) => ({
      resynced: total.resynced + outcome.resynced,
      indexSyncFailures: total.indexSyncFailures + outcome.indexSyncFailures,
    }),
    NO_INDEX_SYNC,
  );

export async function syncResearchEntitiesWithOutcome(
  docs: readonly unknown[],
): Promise<IndexSyncOutcome> {
  if (docs.length === 0) return NO_INDEX_SYNC;
  const indexable = docs.filter(isIndexableRow).length;
  const submitted = await syncEntities('researchEntity', [...docs]);
  const resynced = Number.isFinite(submitted) ? Math.max(0, Math.min(submitted, indexable)) : 0;
  return { resynced, indexSyncFailures: indexable - resynced };
}
