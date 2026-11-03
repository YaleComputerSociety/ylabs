import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findOne: vi.fn() }));

vi.mock('../../models/searchRerankCache', () => ({
  SearchRerankCache: { findOne: mocks.findOne },
}));

import {
  SEARCH_RERANK_MEMO_TTL_MS,
  applyCachedRerank,
  cachedSearchRerankScores,
  isSearchRerankCacheEnabled,
  resetSearchRerankCacheMemo,
} from '../searchRerankCache';
import { searchRerankCacheFilters, searchRerankCacheQueryKey } from '../researchGroupService';

const candidates = (count: number) =>
  Array.from({ length: count }, (_value, index) => ({ id: `row-${index}` }));
const ids = (rows: Array<{ id: string }>) => rows.map((row) => row.id);
const options = { window: 30, neutral: 1.5 };

describe('searchRerankCacheQueryKey', () => {
  it('reads the query the way search tokenizes it', () => {
    const key = searchRerankCacheQueryKey('Machine Learning', {});
    expect(searchRerankCacheQueryKey('  machine    LEARNING ', {})).toBe(key);
    expect(searchRerankCacheQueryKey('machine-learning', {})).toBe(key);
    expect(searchRerankCacheQueryKey('machine learning labs', {})).not.toBe(
      searchRerankCacheQueryKey('robotics', {}),
    );
  });

  it('serializes the student filters in a stable order whatever order they were chosen in', () => {
    const chosen = searchRerankCacheQueryKey('ecology', {
      departments: ['Physics', 'Biology'],
      welcomesUndergrads: true,
      school: ['Synthetic School'],
    });
    expect(
      searchRerankCacheQueryKey('ecology', {
        school: ['Synthetic School'],
        welcomesUndergrads: true,
        departments: ['biology', 'Physics'],
      }),
    ).toBe(chosen);
    expect(searchRerankCacheQueryKey('ecology', { departments: ['Physics'] })).not.toBe(chosen);
    expect(searchRerankCacheQueryKey('ecology', {})).not.toBe(chosen);
  });

  it('keeps an operator visibility scope and an unset toggle out of the key', () => {
    expect(
      searchRerankCacheQueryKey('ecology', {
        studentVisibilityTier: ['student_ready'],
        hostsUndergrads: false,
        departments: [],
      }),
    ).toBe(searchRerankCacheQueryKey('ecology', {}));
  });

  it('stores the chosen filters in the same fixed order', () => {
    expect(
      searchRerankCacheFilters({
        welcomesUndergrads: true,
        departments: ['Physics', 'Biology'],
        studentVisibilityTier: ['student_ready'],
      }),
    ).toEqual({ departments: ['Biology', 'Physics'], welcomesUndergrads: true });
  });
});

describe('applyCachedRerank', () => {
  it('orders the window by score, highest first', () => {
    const scores = new Map([
      ['row-2', 3],
      ['row-0', 0],
      ['row-1', 2],
    ]);
    expect(ids(applyCachedRerank(candidates(3), scores, options))).toEqual([
      'row-2',
      'row-1',
      'row-0',
    ]);
  });

  it('keeps the incoming order between equal scores', () => {
    const scores = new Map([
      ['row-0', 1],
      ['row-1', 3],
      ['row-2', 1],
      ['row-3', 3],
    ]);
    expect(ids(applyCachedRerank(candidates(4), scores, options))).toEqual([
      'row-1',
      'row-3',
      'row-0',
      'row-2',
    ]);
  });

  it('gives an unscored candidate the neutral score', () => {
    const scores = new Map([
      ['row-0', 1],
      ['row-2', 2],
    ]);
    expect(ids(applyCachedRerank(candidates(3), scores, options))).toEqual([
      'row-2',
      'row-1',
      'row-0',
    ]);
  });

  it('leaves every candidate after the window in place', () => {
    const rows = candidates(40);
    const scores = new Map([
      ['row-35', 3],
      ['row-29', 3],
    ]);
    const reranked = applyCachedRerank(rows, scores, options);
    expect(reranked[0].id).toBe('row-29');
    expect(ids(reranked.slice(30))).toEqual(ids(rows.slice(30)));
    expect(new Set(ids(reranked))).toEqual(new Set(ids(rows)));
  });

  it('reads a candidate keyed by _id as well as id', () => {
    const rows = [{ _id: 'row-0' }, { _id: 'row-1' }];
    expect(applyCachedRerank(rows, new Map([['row-1', 3]]), options)).toEqual([
      { _id: 'row-1' },
      { _id: 'row-0' },
    ]);
  });
});

describe('isSearchRerankCacheEnabled', () => {
  it('is on only for the literal true', () => {
    expect(isSearchRerankCacheEnabled({})).toBe(false);
    expect(isSearchRerankCacheEnabled({ SEARCH_RERANK_CACHE_ENABLED: '1' })).toBe(false);
    expect(isSearchRerankCacheEnabled({ SEARCH_RERANK_CACHE_ENABLED: 'true' })).toBe(true);
  });
});

describe('cachedSearchRerankScores', () => {
  const lookupResolving = (value: unknown) => {
    const query: any = { lean: async () => value };
    query.select = () => query;
    query.maxTimeMS = () => query;
    return query;
  };

  beforeEach(() => {
    resetSearchRerankCacheMemo();
    mocks.findOne.mockReset();
  });

  it('reads an entry once per TTL and serves its scores by entity id', async () => {
    mocks.findOne.mockReturnValue(
      lookupResolving({
        scores: [
          { entityId: 'row-1', score: 3 },
          { entityId: 'row-2', score: 0 },
        ],
      }),
    );
    let now = 1_000;
    const clock = () => now;

    const first = await cachedSearchRerankScores('key', clock);
    now += SEARCH_RERANK_MEMO_TTL_MS - 1;
    const second = await cachedSearchRerankScores('key', clock);

    expect(first).toEqual(
      new Map([
        ['row-1', 3],
        ['row-2', 0],
      ]),
    );
    expect(second).toBe(first);
    expect(mocks.findOne).toHaveBeenCalledTimes(1);
    expect(mocks.findOne).toHaveBeenCalledWith({ queryKey: 'key' });

    now += 2;
    await cachedSearchRerankScores('key', clock);
    expect(mocks.findOne).toHaveBeenCalledTimes(2);
  });

  it('remembers a query with no entry as null', async () => {
    mocks.findOne.mockReturnValue(lookupResolving(null));

    expect(await cachedSearchRerankScores('missing')).toBeNull();
    expect(await cachedSearchRerankScores('missing')).toBeNull();
    expect(mocks.findOne).toHaveBeenCalledTimes(1);
  });

  it('answers null on a failed read and tries again on the next request', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.findOne.mockReturnValue({
      select: () => ({
        maxTimeMS: () => ({ lean: async () => Promise.reject(new Error('down')) }),
      }),
    });

    expect(await cachedSearchRerankScores('key')).toBeNull();
    expect(await cachedSearchRerankScores('key')).toBeNull();
    expect(mocks.findOne).toHaveBeenCalledTimes(2);
    consoleError.mockRestore();
  });
});
