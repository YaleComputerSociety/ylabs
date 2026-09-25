import { describe, expect, it } from 'vitest';

import {
  fetchDirectoryPageWithRetry,
  loadDirectoryIdentities,
} from '../sources/directoryAliasResolutionScraper';

const noSleep = async () => undefined;

describe('fetchDirectoryPageWithRetry', () => {
  it('survives a transient page failure instead of losing the whole walk', async () => {
    let calls = 0;
    const rows = await fetchDirectoryPageWithRetry(
      3,
      async () => {
        calls += 1;
        if (calls < 3) throw new Error('Yalies API request failed');
        return [{ netid: 'af42', email: 'ada.fixture1@yale.edu' }];
      },
      noSleep,
    );
    expect(calls).toBe(3);
    expect(rows).toHaveLength(1);
  });

  it('gives up after the attempt budget and surfaces the last error', async () => {
    let calls = 0;
    await expect(
      fetchDirectoryPageWithRetry(
        1,
        async () => {
          calls += 1;
          throw new Error('Yalies API request failed');
        },
        noSleep,
      ),
    ).rejects.toThrow('Yalies API request failed');
    expect(calls).toBe(4);
  });
});

describe('loadDirectoryIdentities', () => {
  it('walks pages until a short page and maps the directory field names', async () => {
    const page1 = Array.from({ length: 100 }, (_, index) => ({
      netid: `af${index}`,
      email: `ada.fixture${index}@yale.edu`,
      first_name: 'Ada',
      last_name: 'Fixture',
      school_code: 'GS',
    }));
    const identities = await loadDirectoryIdentities({
      fetchPage: async (page) => (page === 1 ? page1 : page1.slice(0, 2)),
      sleep: noSleep,
    });
    expect(identities).toHaveLength(102);
    expect(identities[0]).toEqual({
      netid: 'af0',
      email: 'ada.fixture0@yale.edu',
      firstName: 'Ada',
      lastName: 'Fixture',
      schoolCode: 'GS',
    });
  });
});
