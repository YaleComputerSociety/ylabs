import mongoose from 'mongoose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cacheFindOne: vi.fn(),
  cacheUpdateOne: vi.fn(),
  entityFind: vi.fn(),
  usageAggregate: vi.fn(),
  searchCandidates: vi.fn(),
  postChatCompletion: vi.fn(),
}));

vi.mock('../../models/searchRerankCache', () => ({
  SEARCH_RERANK_MIN_SCORE: 0,
  SEARCH_RERANK_MAX_SCORE: 3,
  SearchRerankCache: { findOne: mocks.cacheFindOne, updateOne: mocks.cacheUpdateOne },
}));
vi.mock('../../models/researchEntity', () => ({ ResearchEntity: { find: mocks.entityFind } }));
vi.mock('../../models/modelCallUsage', () => ({
  ModelCallUsage: { aggregate: mocks.usageAggregate },
}));
vi.mock('../../utils/modelClient', () => ({ postChatCompletion: mocks.postChatCompletion }));
vi.mock('../researchGroupService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../researchGroupService')>()),
  searchResearchGroupsForRerankCandidates: mocks.searchCandidates,
}));

import { searchRerankCacheQueryKey } from '../researchGroupService';
import {
  SEARCH_RERANK_LIVE_MISS_MODEL,
  defaultSearchRerankLiveMissModel,
  parseSearchRerankLiveMissScores,
  runSearchRerankLiveMissJob,
  searchRerankLiveMissSpendTodayUsd,
  searchRerankLiveMissUserPrompt,
} from '../searchRerankLiveMissJob';
import { lookupSearchRerankCacheEntry, resetSearchRerankCacheMemo } from '../searchRerankCache';

const NOW = new Date('2026-11-10T15:30:00.000Z');
const QUERY = 'tidal marsh ecology';
const rowId = (index: number) => `67d8928150621bcef435${String(index).padStart(4, '0')}`;
const CANDIDATE_COUNT = 4;

const queryResult = <T>(value: T) => {
  const query: any = { lean: async () => value };
  query.select = () => query;
  query.maxTimeMS = () => query;
  return query;
};

const servedEntity = (index: number) => ({
  _id: rowId(index),
  slug: `synthetic-row-${index}`,
  name: `Synthetic Row ${index}`,
  departments: ['Synthetic Department'],
  shortDescription: `Synthetic card ${index}.`,
});

const storedRow = (index: number) => ({
  _id: rowId(index),
  slug: `synthetic-row-${index}`,
  name: `Synthetic Row ${index}`,
  kind: 'lab',
  departments: ['Synthetic Department'],
  researchAreas: ['Coastal Ecology'],
  sourceUrls: [],
  shortDescription: 'Studies tidal marsh dynamics and shoreline restoration.',
  fullDescription:
    'This research studies tidal marsh dynamics, sediment transport, and shoreline restoration across field sites.',
});

const modelScores = (scores: Record<string, unknown>) => async () =>
  JSON.stringify({ ranking: [], scores });
const validScores = modelScores({ 0: 1, 1: 3, 2: 0, 3: 2 });

const spendNothing = async () => 0;

const runJob = (options: Parameters<typeof runSearchRerankLiveMissJob>[1] = {}) =>
  runSearchRerankLiveMissJob(
    { query: QUERY, filters: {} },
    { now: () => NOW, readSpendTodayUsd: spendNothing, model: validScores, ...options },
  );

beforeEach(() => {
  resetSearchRerankCacheMemo();
  mocks.cacheFindOne.mockReset();
  mocks.cacheFindOne.mockImplementation(() => queryResult(null));
  mocks.cacheUpdateOne.mockReset();
  mocks.cacheUpdateOne.mockResolvedValue({ acknowledged: true });
  mocks.entityFind.mockReset();
  mocks.entityFind.mockImplementation(() =>
    queryResult(Array.from({ length: CANDIDATE_COUNT }, (_v, index) => storedRow(index))),
  );
  mocks.usageAggregate.mockReset();
  mocks.searchCandidates.mockReset();
  mocks.searchCandidates.mockResolvedValue({
    researchEntities: Array.from({ length: CANDIDATE_COUNT }, (_v, index) => servedEntity(index)),
    rerankLiveMissGate: 'eligible',
  });
  mocks.postChatCompletion.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('runSearchRerankLiveMissJob', () => {
  it('scores the top candidates and upserts a live-miss entry in serve mode', async () => {
    const outcome = await runJob({ mode: 'serve' });

    expect(outcome.status).toBe('written');
    const queryKey = searchRerankCacheQueryKey(QUERY, {});
    expect(outcome.entry).toEqual({
      queryKey,
      queryText: QUERY,
      filters: {},
      scores: [
        { entityId: rowId(0), score: 1 },
        { entityId: rowId(1), score: 3 },
        { entityId: rowId(2), score: 0 },
        { entityId: rowId(3), score: 2 },
      ],
      scoredAt: NOW,
      indexVersion: `async-${SEARCH_RERANK_LIVE_MISS_MODEL}-2026-11-10`,
      source: 'live-miss',
    });
    expect(mocks.cacheUpdateOne).toHaveBeenCalledTimes(1);
    const [filter, update, options] = mocks.cacheUpdateOne.mock.calls[0];
    expect(filter.queryKey).toBe(queryKey);
    expect(filter.source).toBeUndefined();
    expect(String(filter.indexVersion.$not)).toBe(String(/^full-/));
    expect(update).toEqual({ $set: outcome.entry });
    expect(options).toEqual({ upsert: true });
    expect(mocks.searchCandidates).toHaveBeenCalledWith(QUERY, {}, 30);
  });

  it('writes a shadow entry that only ever replaces another shadow entry', async () => {
    const outcome = await runJob({ mode: 'shadow' });

    expect(outcome.status).toBe('written');
    expect(outcome.entry?.source).toBe('shadow');
    const [filter] = mocks.cacheUpdateOne.mock.calls[0];
    expect(filter.source).toBe('shadow');
    expect(String(filter.indexVersion.$not)).toBe(String(/^full-/));
  });

  it('defaults to shadow mode', async () => {
    expect((await runJob()).entry?.source).toBe('shadow');
    vi.stubEnv('SEARCH_RERANK_LIVE_MISS_MODE', 'serve');
    expect((await runJob()).entry?.source).toBe('live-miss');
  });

  it('never calls the model or writes when a seeded full- entry holds the key', async () => {
    const model = vi.fn(validScores);
    mocks.cacheFindOne.mockImplementation(() =>
      queryResult({ source: 'offline-scoring', indexVersion: 'full-v2-2026-11-10', scoredAt: NOW }),
    );

    for (const mode of ['shadow', 'serve'] as const) {
      expect((await runJob({ mode, model })).status).toBe('not-wanted');
    }
    expect(model).not.toHaveBeenCalled();
    expect(mocks.cacheUpdateOne).not.toHaveBeenCalled();
  });

  it('keeps a seeded entry that lands while the model is scoring', async () => {
    mocks.cacheUpdateOne.mockRejectedValue(Object.assign(new Error('E11000'), { code: 11000 }));

    expect((await runJob({ mode: 'serve' })).status).toBe('kept-existing');
  });

  it('never replaces a served entry from shadow mode', async () => {
    const model = vi.fn(validScores);
    mocks.cacheFindOne.mockImplementation(() =>
      queryResult({
        source: 'live-miss',
        indexVersion: 'async-gpt-5-mini-2026-11-01',
        scoredAt: NOW,
      }),
    );

    expect((await runJob({ mode: 'shadow', model })).status).toBe('not-wanted');
    expect(model).not.toHaveBeenCalled();
  });

  it.each([
    ['not JSON', async () => 'scores: 0 3 1 2'],
    ['no scores object', async () => JSON.stringify({ ranking: [0, 1, 2, 3] })],
    ['a missing candidate', modelScores({ 0: 1, 1: 3, 2: 0 })],
    ['a score above 3', modelScores({ 0: 1, 1: 4, 2: 0, 3: 2 })],
    ['a negative score', modelScores({ 0: 1, 1: -1, 2: 0, 3: 2 })],
    ['a fractional score', modelScores({ 0: 1, 1: 2.5, 2: 0, 3: 2 })],
    ['a string score', modelScores({ 0: 1, 1: '3', 2: 0, 3: 2 })],
    ['no content', async () => undefined],
  ])('writes nothing when the model returns %s', async (_label, model) => {
    const outcome = await runJob({ mode: 'serve', model });

    expect(outcome).toEqual({ status: 'malformed-output' });
    expect(mocks.cacheUpdateOne).not.toHaveBeenCalled();
  });

  it('ignores a candidate id outside the window and keeps the in-window scores', async () => {
    const outcome = await runJob({
      mode: 'serve',
      model: modelScores({ 0: 1, 1: 3, 2: 0, 3: 2, 4: 1 }),
    });

    expect(outcome.status).not.toBe('malformed-output');
    expect(outcome.entry?.scores.map((row) => row.score)).toEqual([1, 3, 0, 2]);
  });

  it('writes nothing when the model call fails', async () => {
    const outcome = await runJob({
      mode: 'serve',
      model: async () => {
        throw new Error('synthetic upstream failure');
      },
    });

    expect(outcome).toEqual({ status: 'model-failed' });
    expect(mocks.cacheUpdateOne).not.toHaveBeenCalled();
  });

  it('stops before the model call once today has spent the ceiling', async () => {
    const model = vi.fn(validScores);

    const outcome = await runJob({ model, readSpendTodayUsd: async () => 1 });

    expect(outcome).toEqual({ status: 'spend-ceiling' });
    expect(model).not.toHaveBeenCalled();
    expect(mocks.cacheUpdateOne).not.toHaveBeenCalled();
  });

  it('fails closed when the spend cannot be read', async () => {
    const model = vi.fn(validScores);

    const outcome = await runJob({
      model,
      readSpendTodayUsd: async () => {
        throw new Error('synthetic read failure');
      },
    });

    expect(outcome).toEqual({ status: 'spend-unreadable' });
    expect(model).not.toHaveBeenCalled();
  });

  it.each(['name-query', 'no-keyword-row', 'too-few-candidates', 'unsearchable'])(
    'never calls the model when the re-run search is %s',
    async (gate) => {
      const model = vi.fn(validScores);
      mocks.searchCandidates.mockResolvedValue({
        researchEntities: [servedEntity(0), servedEntity(1)],
        rerankLiveMissGate: gate,
      });

      expect((await runJob({ model })).status).toBe('ineligible');
      expect(model).not.toHaveBeenCalled();
    },
  );

  it('refuses a query over the length bound without searching', async () => {
    const outcome = await runSearchRerankLiveMissJob(
      { query: 'x'.repeat(101) },
      { readSpendTodayUsd: spendNothing, model: validScores },
    );

    expect(outcome.status).toBe('ineligible');
    expect(mocks.searchCandidates).not.toHaveBeenCalled();
  });

  it('forgets the remembered miss so the next search reads the new entry', async () => {
    const queryKey = searchRerankCacheQueryKey(QUERY, {});
    expect((await lookupSearchRerankCacheEntry(queryKey))?.kind).toBe('absent');

    vi.stubEnv('SEARCH_RERANK_LIVE_MISS_ENABLED', 'true');
    await runJob({ mode: 'serve' });
    mocks.cacheFindOne.mockImplementation(() =>
      queryResult({
        source: 'live-miss',
        indexVersion: 'async-gpt-5-mini-2026-11-10',
        scoredAt: NOW,
        scores: [{ entityId: rowId(1), score: 3 }],
      }),
    );

    const lookup = await lookupSearchRerankCacheEntry(queryKey);
    expect(lookup?.kind).toBe('served');
    expect(lookup?.scores?.get(rowId(1))).toBe(3);
  });

  it('sends the served text of each candidate in the rerank prompt shape', async () => {
    const model = vi.fn(async (_input: unknown) => validScores());

    await runJob({ model });

    const { query, candidates } = model.mock.calls[0][0] as any;
    expect(query).toBe(QUERY);
    expect(candidates.map((candidate: { entityId: string }) => candidate.entityId)).toEqual(
      Array.from({ length: CANDIDATE_COUNT }, (_v, index) => rowId(index)),
    );
    const prompt = searchRerankLiveMissUserPrompt(query, candidates);
    expect(
      prompt.startsWith(
        `Query: ${QUERY}\n\n[0] Synthetic Row 0 | departments: Synthetic Department | `,
      ),
    ).toBe(true);
    expect(prompt).toContain('tidal marsh dynamics');
  });
});

describe('parseSearchRerankLiveMissScores', () => {
  const scoresFor = (ids: number[]) =>
    JSON.stringify({ scores: Object.fromEntries(ids.map((id) => [String(id), id % 4])) });
  const range = (count: number) => Array.from({ length: count }, (_v, index) => index);

  it('returns each scored candidate by its index', () => {
    expect(parseSearchRerankLiveMissScores('{"scores":{"1":0,"0":3}}', 2)).toEqual(
      new Map([
        [1, 0],
        [0, 3],
      ]),
    );
  });

  it('keeps an answer that scores 29 of 30 candidates and stores only those 29', () => {
    const scored = parseSearchRerankLiveMissScores(
      scoresFor(range(30).filter((id) => id !== 17)),
      30,
    );

    expect(scored?.size).toBe(29);
    expect(scored?.has(17)).toBe(false);
  });

  it('keeps an answer that scores 27 of 30 candidates', () => {
    expect(parseSearchRerankLiveMissScores(scoresFor(range(27)), 30)?.size).toBe(27);
  });

  it('rejects an answer that scores 20 of 30 candidates', () => {
    expect(parseSearchRerankLiveMissScores(scoresFor(range(20)), 30)).toBeNull();
  });

  it('ignores out-of-window and non-integer ids rather than rejecting the answer', () => {
    const content = JSON.stringify({
      scores: {
        ...Object.fromEntries(range(30).map((id) => [String(id), 2])),
        '30': 3,
        '1.5': 1,
        x: 0,
      },
    });

    expect(parseSearchRerankLiveMissScores(content, 30)?.size).toBe(30);
  });
});

describe('defaultSearchRerankLiveMissModel', () => {
  it('calls gpt-5-mini through the shared client under its registered caller', async () => {
    mocks.postChatCompletion.mockResolvedValue({
      data: { choices: [{ message: { content: '{"scores":{"0":2}}' } }] },
    });

    const content = await defaultSearchRerankLiveMissModel('sk-synthetic')({
      query: QUERY,
      candidates: [
        {
          entityId: rowId(0),
          name: 'Synthetic Row 0',
          departments: [],
          shortDescription: '',
          fullDescription: '',
        },
      ],
    });

    expect(content).toBe('{"scores":{"0":2}}');
    const request = mocks.postChatCompletion.mock.calls[0][0];
    expect(request.caller).toBe('search-rerank-live-miss');
    expect(request.apiKey).toBe('sk-synthetic');
    expect(request.body.model).toBe('gpt-5-mini');
    expect(request.body.response_format).toEqual({ type: 'json_object' });
    expect(request.body.messages[0].content).toContain('3 squarely on topic');
  });

  it('is not reached without a usable API key', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');

    const outcome = await runSearchRerankLiveMissJob(
      { query: QUERY },
      { now: () => NOW, readSpendTodayUsd: spendNothing, mode: 'serve' },
    );

    expect(outcome).toEqual({ status: 'no-api-key' });
    expect(mocks.postChatCompletion).not.toHaveBeenCalled();
    expect(mocks.cacheUpdateOne).not.toHaveBeenCalled();
  });
});

describe('searchRerankLiveMissSpendTodayUsd', () => {
  it("sums this caller's estimated cost since UTC midnight", async () => {
    vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(1);
    mocks.usageAggregate.mockResolvedValue([
      {
        _id: 'gpt-5-mini',
        promptTokens: 2_000_000,
        cachedPromptTokens: 0,
        completionTokens: 100_000,
      },
    ]);

    expect(await searchRerankLiveMissSpendTodayUsd(NOW)).toBeCloseTo(0.7, 10);
    expect(mocks.usageAggregate.mock.calls[0][0][0]).toEqual({
      $match: {
        caller: 'search-rerank-live-miss',
        calledAt: { $gte: new Date('2026-11-10T00:00:00.000Z') },
      },
    });
  });

  it('counts an unpriced model as over the ceiling', async () => {
    vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(1);
    mocks.usageAggregate.mockResolvedValue([
      { _id: 'unpriced-model', promptTokens: 1, cachedPromptTokens: 0, completionTokens: 1 },
    ]);

    expect(await searchRerankLiveMissSpendTodayUsd(NOW)).toBe(Infinity);
  });

  it('refuses to read without a database connection', async () => {
    vi.spyOn(mongoose.connection, 'readyState', 'get').mockReturnValue(0);

    await expect(searchRerankLiveMissSpendTodayUsd(NOW)).rejects.toThrow(/database connection/);
    expect(mocks.usageAggregate).not.toHaveBeenCalled();
  });
});
