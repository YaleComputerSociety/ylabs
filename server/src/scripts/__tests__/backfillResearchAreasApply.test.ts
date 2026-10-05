import { describe, expect, it, vi } from 'vitest';
import { applyResearchAreaChanges, parseResearchAreaBackfillArgs } from '../backfillResearchAreas';
import type { ResearchAreaBackfillPlanRow } from '../backfillResearchAreasCore';

function changedRow(id: string, after: string[]): ResearchAreaBackfillPlanRow {
  return {
    id,
    before: [],
    after,
    added: after,
    fromExisting: [],
    fromDepartments: [],
    fromDescription: [],
    unmatchedForReview: [],
    droppedLeakage: [],
    canonicalizationChanged: false,
    changed: true,
  };
}

describe('applyResearchAreaChanges', () => {
  it('persists then syncs each batch and totals the synced count', async () => {
    const order: string[] = [];
    const persistBatch = vi.fn(async (rows: ResearchAreaBackfillPlanRow[]) => {
      order.push(`persist:${rows.map((row) => row.id).join(',')}`);
    });
    const syncBatch = vi.fn(async (ids: string[]) => {
      order.push(`sync:${ids.join(',')}`);
      return { resynced: ids.length, indexSyncFailures: 0 };
    });

    const rows = [
      changedRow('a', ['Machine Learning']),
      changedRow('b', ['Neuroscience']),
      changedRow('c', ['Public Health']),
    ];

    const result = await applyResearchAreaChanges(rows, 2, { persistBatch, syncBatch });

    expect(result).toEqual({ persisted: 3, synced: 3, indexSyncFailures: 0 });
    expect(persistBatch).toHaveBeenCalledTimes(2);
    expect(syncBatch).toHaveBeenCalledTimes(2);
    expect(order).toEqual(['persist:a,b', 'sync:a,b', 'persist:c', 'sync:c']);
    expect(syncBatch).toHaveBeenNthCalledWith(1, ['a', 'b']);
    expect(syncBatch).toHaveBeenNthCalledWith(2, ['c']);
  });

  it('syncs exactly the ids that were written, not the plan rows', async () => {
    const syncedIds: string[] = [];
    const result = await applyResearchAreaChanges(
      [changedRow('x', ['Economics']), changedRow('y', ['Ecology'])],
      10,
      {
        persistBatch: async () => {},
        syncBatch: async (ids) => {
          syncedIds.push(...ids);
          return { resynced: ids.length, indexSyncFailures: 0 };
        },
      },
    );

    expect(syncedIds).toEqual(['x', 'y']);
    expect(result.synced).toBe(2);
  });

  it('does not persist or sync when there are no changed rows', async () => {
    const persistBatch = vi.fn(async () => {});
    const syncBatch = vi.fn(async () => ({ resynced: 0, indexSyncFailures: 0 }));

    const result = await applyResearchAreaChanges([], 200, { persistBatch, syncBatch });

    expect(result).toEqual({ persisted: 0, synced: 0, indexSyncFailures: 0 });
    expect(persistBatch).not.toHaveBeenCalled();
    expect(syncBatch).not.toHaveBeenCalled();
  });

  it('reports fewer synced than persisted when a doc vanished before reindex', async () => {
    const result = await applyResearchAreaChanges(
      [changedRow('a', ['Immunology']), changedRow('b', ['Diagnostics'])],
      200,
      {
        persistBatch: async () => {},
        syncBatch: async (ids) => ({ resynced: ids.length - 1, indexSyncFailures: 0 }),
      },
    );

    expect(result.persisted).toBe(2);
    expect(result.synced).toBe(1);
  });

  it('reports a batch the index refused as failed rather than synced (#3726)', async () => {
    const result = await applyResearchAreaChanges(
      [changedRow('a', ['Immunology']), changedRow('b', ['Diagnostics'])],
      1,
      {
        persistBatch: async () => {},
        syncBatch: async (ids) => ({ resynced: 0, indexSyncFailures: ids.length }),
      },
    );

    expect(result).toEqual({ persisted: 2, synced: 0, indexSyncFailures: 2 });
  });
});

describe('parseResearchAreaBackfillArgs --record-id (issue #1717)', () => {
  it('collects repeated --record-id flags into recordIds', () => {
    const options = parseResearchAreaBackfillArgs(['--record-id=abc', '--record-id=def']);
    expect(options.recordIds).toEqual(['abc', 'def']);
  });

  it('leaves recordIds undefined when the flag is not passed', () => {
    const options = parseResearchAreaBackfillArgs([]);
    expect(options.recordIds).toBeUndefined();
  });
});
