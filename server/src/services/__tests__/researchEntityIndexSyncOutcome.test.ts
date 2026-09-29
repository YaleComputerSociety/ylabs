import { beforeEach, describe, expect, it, vi } from 'vitest';

const meiliMocks = vi.hoisted(() => ({
  syncEntities: vi.fn(async (_entityType: string, _docs: unknown[]): Promise<unknown> => 0),
}));

vi.mock('../meiliSyncService', () => ({ syncEntities: meiliMocks.syncEntities }));

import {
  addIndexSyncOutcomes,
  syncResearchEntitiesWithOutcome,
} from '../researchEntityIndexSyncOutcome';

describe('syncResearchEntitiesWithOutcome', () => {
  beforeEach(() => meiliMocks.syncEntities.mockReset());

  it('counts every indexable row as failed when the batch is refused', async () => {
    meiliMocks.syncEntities.mockResolvedValue(0);

    expect(await syncResearchEntitiesWithOutcome([{ _id: 'a' }, { _id: 'b' }])).toEqual({
      resynced: 0,
      indexSyncFailures: 2,
    });
  });

  it('counts what the index accepted, and the remainder as failed', async () => {
    meiliMocks.syncEntities.mockResolvedValue(1);

    expect(await syncResearchEntitiesWithOutcome([{ _id: 'a' }, { _id: 'b' }])).toEqual({
      resynced: 1,
      indexSyncFailures: 1,
    });
  });

  it('does not count an archived row, which the sync deletes rather than submits', async () => {
    meiliMocks.syncEntities.mockResolvedValue(1);

    expect(
      await syncResearchEntitiesWithOutcome([{ _id: 'a' }, { _id: 'b', archived: true }]),
    ).toEqual({ resynced: 1, indexSyncFailures: 0 });
  });

  it('treats a result that is not a count as a refusal', async () => {
    meiliMocks.syncEntities.mockResolvedValue(undefined);

    expect(await syncResearchEntitiesWithOutcome([{ _id: 'a' }])).toEqual({
      resynced: 0,
      indexSyncFailures: 1,
    });
  });

  it('does not call the index for an empty batch', async () => {
    expect(await syncResearchEntitiesWithOutcome([])).toEqual({
      resynced: 0,
      indexSyncFailures: 0,
    });
    expect(meiliMocks.syncEntities).not.toHaveBeenCalled();
  });

  it('adds outcomes field by field', () => {
    expect(
      addIndexSyncOutcomes(
        { resynced: 2, indexSyncFailures: 0 },
        { resynced: 0, indexSyncFailures: 3 },
      ),
    ).toEqual({ resynced: 2, indexSyncFailures: 3 });
  });
});
