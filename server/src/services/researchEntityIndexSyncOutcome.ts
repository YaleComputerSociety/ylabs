import { syncEntities } from './meiliSyncService';
import { searchIndexWritesDeferred } from '../utils/searchIndexWrites';

export interface IndexSyncOutcome {
  resynced: number;
  indexSyncFailures: number;
  indexSyncDeferred?: number;
}

export const NO_INDEX_SYNC: IndexSyncOutcome = Object.freeze({ resynced: 0, indexSyncFailures: 0 });

// Mirrors the archived-row rule in `syncEntities`, which deletes those rows rather than
// counting them among the documents it applied; changing that rule also requires
// updating this.
const isIndexableRow = (doc: unknown): boolean =>
  (doc as { archived?: unknown } | null | undefined)?.archived !== true;

export const addIndexSyncOutcomes = (...outcomes: readonly IndexSyncOutcome[]): IndexSyncOutcome =>
  outcomes.reduce((total, outcome) => {
    const indexSyncDeferred = (total.indexSyncDeferred ?? 0) + (outcome.indexSyncDeferred ?? 0);
    return {
      resynced: total.resynced + outcome.resynced,
      indexSyncFailures: total.indexSyncFailures + outcome.indexSyncFailures,
      ...(indexSyncDeferred > 0 ? { indexSyncDeferred } : {}),
    };
  }, NO_INDEX_SYNC);

export async function syncResearchEntitiesWithOutcome(
  docs: readonly unknown[],
): Promise<IndexSyncOutcome> {
  if (docs.length === 0) return NO_INDEX_SYNC;
  if (searchIndexWritesDeferred()) {
    return { resynced: 0, indexSyncFailures: 0, indexSyncDeferred: docs.length };
  }
  const indexable = docs.filter(isIndexableRow).length;
  const submitted = await syncEntities('researchEntity', [...docs]);
  const resynced = Number.isFinite(submitted) ? Math.max(0, Math.min(submitted, indexable)) : 0;
  return { resynced, indexSyncFailures: indexable - resynced };
}
