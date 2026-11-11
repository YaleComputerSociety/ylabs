import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findOne: vi.fn() }));

vi.mock('../../models/searchRerankCache', () => ({
  SearchRerankCache: { findOne: mocks.findOne },
}));

import {
  SEARCH_RERANK_MEMO_TTL_MS,
  applyCachedRerank,
  isSearchRerankCacheEnabled,
  lookupSearchRerankCacheEntry,
  resetSearchRerankCacheMemo,
  searchRerankCandidateFingerprints,
  searchRerankCandidateTextHash,
  searchRerankEntryIsStale,
  searchRerankScoredTextHashes,
} from '../searchRerankCache';
import { buildSearchRerankTextHash } from '../searchRerankCandidateText';
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

  it('keys an acronym typed alone as the phrase it is searched as (#5169)', () => {
    const phrase = searchRerankCacheQueryKey('natural language processing', {});
    expect(searchRerankCacheQueryKey('NLP', {})).toBe(phrase);
    expect(searchRerankCacheQueryKey('nlp lab', {})).toBe(phrase);
    expect(searchRerankCacheQueryKey('rna', {})).not.toBe(
      searchRerankCacheQueryKey('ribonucleic acid', {}),
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

  it('gives the works-with-undergraduates toggle its own key (#5362)', () => {
    expect(searchRerankCacheQueryKey('ecology', { worksWithUndergrads: true })).not.toBe(
      searchRerankCacheQueryKey('ecology', {}),
    );
    expect(searchRerankCacheQueryKey('ecology', { worksWithUndergrads: true })).not.toBe(
      searchRerankCacheQueryKey('ecology', { welcomesUndergrads: true }),
    );
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

describe('lookupSearchRerankCacheEntry', () => {
  const cachedScores = async (queryKey: string, now?: () => number) =>
    (await lookupSearchRerankCacheEntry(queryKey, now))?.scores ?? null;

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

    const first = await cachedScores('key', clock);
    now += SEARCH_RERANK_MEMO_TTL_MS - 1;
    const second = await cachedScores('key', clock);

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
    await cachedScores('key', clock);
    expect(mocks.findOne).toHaveBeenCalledTimes(2);
  });

  it('remembers a query with no entry as null', async () => {
    mocks.findOne.mockReturnValue(lookupResolving(null));

    expect(await cachedScores('missing')).toBeNull();
    expect(await cachedScores('missing')).toBeNull();
    expect(mocks.findOne).toHaveBeenCalledTimes(1);
  });

  it('answers null on a failed read and tries again on the next request', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.findOne.mockReturnValue({
      select: () => ({
        maxTimeMS: () => ({ lean: async () => Promise.reject(new Error('down')) }),
      }),
    });

    expect(await cachedScores('key')).toBeNull();
    expect(await cachedScores('key')).toBeNull();
    expect(mocks.findOne).toHaveBeenCalledTimes(2);
    consoleError.mockRestore();
  });

  it('carries each scored row and its stored hash, whether or not the entry is served', async () => {
    mocks.findOne.mockReturnValue(
      lookupResolving({
        source: 'shadow',
        indexVersion: 'async-gpt-5-mini-2026-11-01',
        scores: [
          { entityId: 'row-1', score: 3, textHash: 'aaaaaaaaaaaaaaaa' },
          { entityId: 'row-2', score: 1 },
        ],
      }),
    );

    const lookup = await lookupSearchRerankCacheEntry('key');

    expect(lookup?.scores).toBeNull();
    expect(lookup?.scoredTextHashes).toEqual(
      new Map([
        ['row-1', 'aaaaaaaaaaaaaaaa'],
        ['row-2', null],
      ]),
    );
  });

  it('serves a live-miss entry only while the live-miss job is switched on', async () => {
    mocks.findOne.mockReturnValue(
      lookupResolving({
        source: 'live-miss',
        indexVersion: 'async-gpt-5-mini-2026-11-01',
        scores: [{ entityId: 'row-1', score: 3 }],
      }),
    );

    vi.stubEnv('SEARCH_RERANK_LIVE_MISS_ENABLED', '');
    expect(await cachedScores('key')).toBeNull();

    resetSearchRerankCacheMemo();
    vi.stubEnv('SEARCH_RERANK_LIVE_MISS_ENABLED', 'true');
    expect(await cachedScores('key')).toEqual(new Map([['row-1', 3]]));
    vi.unstubAllEnvs();
  });
});

const poolHit = (index: number, overrides: Record<string, unknown> = {}) => {
  const document = {
    id: `row-${index}`,
    name: `Synthetic Row ${index}`,
    kind: 'lab',
    entityType: 'lab',
    departments: ['Synthetic Department'],
    researchAreas: ['Coastal Ecology'],
    shortDescription: `Synthetic card ${index}.`,
    fullDescription: `Synthetic description ${index}.`,
    ...overrides,
  };
  return { id: document.id, rerankTextHash: buildSearchRerankTextHash(document) };
};

describe('searchRerankCandidateTextHash', () => {
  it('reads the hash the index document builder stored on the hit', () => {
    const hit = poolHit(0);

    expect(searchRerankCandidateTextHash(hit)).toBe(hit.rerankTextHash);
  });

  it('has no hash for a hit from an index not yet synced, or a malformed one', () => {
    expect(searchRerankCandidateTextHash({ id: 'row-0' })).toBeNull();
    expect(searchRerankCandidateTextHash({ id: 'row-0', rerankTextHash: 'not-a-hash' })).toBeNull();
  });
});

describe('searchRerankEntryIsStale', () => {
  const pool = (count: number) => Array.from({ length: count }, (_v, index) => poolHit(index));
  const servedTop = (hits: Array<{ id: string; rerankTextHash?: string }> = pool(12)) =>
    searchRerankCandidateFingerprints(hits, 10);
  const scoredWithHashes = (hits: ReturnType<typeof poolHit>[]) =>
    new Map(hits.map((hit) => [hit.id, hit.rerankTextHash] as const));

  it('is fresh when every served top-10 row is scored with its current hash', () => {
    expect(searchRerankEntryIsStale(scoredWithHashes(pool(10)), servedTop())).toBe(false);
  });

  it('is stale when a scored top-10 row now hashes differently', () => {
    const changed = pool(12);
    changed[4] = poolHit(4, { researchAreas: ['Synthetic Rewritten Topic'] });

    expect(searchRerankEntryIsStale(scoredWithHashes(pool(10)), servedTop(changed))).toBe(true);
  });

  it('is stale when only a scored row description was rewritten', () => {
    const changed = pool(12);
    changed[2] = poolHit(2, { shortDescription: 'A rewritten synthetic card.' });

    expect(searchRerankEntryIsStale(scoredWithHashes(pool(10)), servedTop(changed))).toBe(true);
  });

  it('never calls a row stale by hash while the index has not hashed it', () => {
    const unsynced = pool(12).map(({ id }) => ({ id }));

    expect(searchRerankEntryIsStale(scoredWithHashes(pool(10)), servedTop(unsynced))).toBe(false);
  });

  it('ignores a changed row outside the served top 10', () => {
    const changed = pool(12);
    changed[11] = poolHit(11, { researchAreas: ['Synthetic Rewritten Topic'] });

    expect(searchRerankEntryIsStale(scoredWithHashes(pool(12)), servedTop(changed))).toBe(false);
  });

  it('is fresh with two unscored top-10 rows and stale with three', () => {
    const scoredAllBut = (unscored: number) => scoredWithHashes(pool(10).slice(0, 10 - unscored));

    expect(searchRerankEntryIsStale(scoredAllBut(2), servedTop())).toBe(false);
    expect(searchRerankEntryIsStale(scoredAllBut(3), servedTop())).toBe(true);
  });

  it('never calls a hashless legacy score changed, so only the candidate-set rule applies', () => {
    const changed = pool(12).map((_hit, index) =>
      poolHit(index, { researchAreas: ['Synthetic New Topic'] }),
    );
    const legacy = searchRerankScoredTextHashes({
      scores: pool(10).map((hit) => ({ entityId: hit.id, score: 2 })),
    });

    expect(searchRerankEntryIsStale(legacy, servedTop(changed))).toBe(false);
    expect(
      searchRerankEntryIsStale(
        searchRerankScoredTextHashes({
          scores: pool(7).map((hit) => ({ entityId: hit.id, score: 2 })),
        }),
        servedTop(),
      ),
    ).toBe(true);
  });

  it('reads hit ids keyed by _id as well as id', () => {
    const hits = pool(10).map(({ id, ...rest }) => ({ _id: id, ...rest }));

    expect(
      searchRerankCandidateFingerprints(hits, 10).map((candidate) => candidate.entityId),
    ).toEqual(pool(10).map((hit) => hit.id));
  });
});
