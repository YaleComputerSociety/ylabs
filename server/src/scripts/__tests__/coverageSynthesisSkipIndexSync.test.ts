import { beforeEach, describe, expect, it, vi } from 'vitest';

const meiliMocks = vi.hoisted(() => ({
  syncEntities: vi.fn(async (_entityType: string, _docs: unknown[]): Promise<unknown> => 0),
}));

vi.mock('../../services/meiliSyncService', () => ({ syncEntities: meiliMocks.syncEntities }));

import { syncResearchEntitiesWithOutcome } from '../../services/researchEntityIndexSyncOutcome';
import {
  deferSearchIndexWritesWhenSkipping,
  parseCoverageSynthesisArgs,
} from '../coverageSynthesisCore';
import { SEARCH_INDEX_WRITES_VARIABLE } from '../../utils/searchIndexWrites';

describe('coverage-synthesis --skip-index-sync', () => {
  const previous = process.env[SEARCH_INDEX_WRITES_VARIABLE];

  beforeEach(() => {
    meiliMocks.syncEntities.mockReset();
    meiliMocks.syncEntities.mockResolvedValue(2);
    if (previous === undefined) delete process.env[SEARCH_INDEX_WRITES_VARIABLE];
    else process.env[SEARCH_INDEX_WRITES_VARIABLE] = previous;
  });

  it('is off unless the flag is passed', () => {
    expect(parseCoverageSynthesisArgs(['--apply', '--all']).skipIndexSync).toBe(false);
    expect(
      parseCoverageSynthesisArgs(['--apply', '--all', '--skip-index-sync']).skipIndexSync,
    ).toBe(true);
  });

  it('syncs re-gated rows per run when the flag is absent', async () => {
    deferSearchIndexWritesWhenSkipping(parseCoverageSynthesisArgs(['--apply']));
    const outcome = await syncResearchEntitiesWithOutcome([{ _id: 'a' }, { _id: 'b' }]);
    expect(meiliMocks.syncEntities).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ resynced: 2, indexSyncFailures: 0 });
  });

  it('leaves the index untouched and counts the rows as skipped when the flag is passed', async () => {
    deferSearchIndexWritesWhenSkipping(
      parseCoverageSynthesisArgs(['--apply', '--all', '--skip-index-sync']),
    );
    const outcome = await syncResearchEntitiesWithOutcome([{ _id: 'a' }, { _id: 'b' }]);
    expect(meiliMocks.syncEntities).not.toHaveBeenCalled();
    expect(outcome).toEqual({ resynced: 0, indexSyncFailures: 0, indexSyncDeferred: 2 });
  });
});
