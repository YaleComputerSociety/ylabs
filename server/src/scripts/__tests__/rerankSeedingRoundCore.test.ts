import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { searchRerankCacheQueryKey } from '../../services/researchGroupService';
import {
  type RoundQuery,
  type ServedCandidates,
  aggregatesByQueryKey,
  assertReadOnlySourcePrivileges,
  collectRoundQueries,
  gateRound,
  judgePacket,
  ndcgOutcomes,
  parseJudgeGrades,
  parseRoundArgs,
  queryNamesATopic,
  rerankedTop,
  scoringBatch,
  searchEventQueryAggregation,
  seedInputFromRound,
  slugScoresFromScorerOutput,
  writePrivateRoundFile,
} from '../rerankSeedingRoundCore';

const REPOSITORY_ROOT = path.resolve(__dirname, '../../../..');

const candidateRow = (slug: string) => ({
  slug,
  name: 'Synthetic Profile',
  departments: ['Synthetic Department'],
  card: 'Studies a synthetic topic.',
  description: '',
});

const servedFor =
  (gates: Record<string, string>, size = 4) =>
  async (query: string): Promise<ServedCandidates> => ({
    gate: gates[query] ?? 'eligible',
    rows: Array.from({ length: size }, (_, index) => candidateRow(`row-${index}`)),
  });

const roundQuery = (row: string, served: string[]): RoundQuery => ({
  row,
  query: `synthetic topic ${row}`,
  searchCount: 1,
  served,
  candidates: served.map((slug, i) => ({ i, ...candidateRow(slug) })),
});

describe('parseRoundArgs', () => {
  it('needs a command and the inputs that command reads', () => {
    expect(() => parseRoundArgs([])).toThrow(/needs a command/);
    expect(() => parseRoundArgs(['collect'])).toThrow(/--since/);
    expect(() => parseRoundArgs(['gate', '--round=r.json', '--scores=s.json'])).toThrow(/--grades/);
    expect(() => parseRoundArgs(['collect', '--since=2026-11-01', '--apply'])).toThrow(/Unknown/);
    expect(parseRoundArgs(['collect', '--since=2026-11-01', '--aggregates=a.json'])).toMatchObject({
      command: 'collect',
      aggregates: 'a.json',
    });
  });
});

describe('searchEventQueryAggregation', () => {
  it('groups by query text alone and projects no user, session or event field', () => {
    const pipeline = searchEventQueryAggregation(new Date('2026-11-01T00:00:00Z'));
    const serialized = JSON.stringify(pipeline);
    expect(serialized).not.toMatch(/netid|session|metadata|entityId|dedupeKey/i);
    expect(pipeline[1]).toEqual({ $group: { _id: '$searchQuery', searchCount: { $sum: 1 } } });
    expect(pipeline[2]).toEqual({ $project: { _id: 0, query: '$_id', searchCount: 1 } });
  });
});

describe('assertReadOnlySourcePrivileges', () => {
  const status = (actions: string[]) => ({
    authInfo: {
      authenticatedUsers: [{ user: 'reader', db: 'admin' }],
      authenticatedUserPrivileges: [{ resource: { db: '', collection: '' }, actions }],
    },
  });

  it('accepts a credential that can only read', () => {
    expect(() => assertReadOnlySourcePrivileges(status(['find', 'listCollections']))).not.toThrow();
  });

  it('refuses a credential that can write', () => {
    expect(() => assertReadOnlySourcePrivileges(status(['find', 'insert', 'update']))).toThrow(
      /can write \(insert, update\)/,
    );
  });

  it('fails closed when the connection is unauthenticated or lists no privileges', () => {
    expect(() => assertReadOnlySourcePrivileges({ authInfo: { authenticatedUsers: [] } })).toThrow(
      /read-only credential/,
    );
    expect(() =>
      assertReadOnlySourcePrivileges({ authInfo: { authenticatedUsers: [{ user: 'x' }] } }),
    ).toThrow(/read-only credential/);
    expect(() => assertReadOnlySourcePrivileges(null)).toThrow(/read-only credential/);
  });
});

describe('queryNamesATopic', () => {
  it('treats a query made only of access-filter words as a filter phrase', () => {
    expect(queryNamesATopic('has hosted undergrad')).toBe(false);
    expect(queryNamesATopic('labs accepting undergraduates')).toBe(false);
    expect(queryNamesATopic('coastal ecology')).toBe(true);
    expect(queryNamesATopic('coastal ecology labs for undergrads')).toBe(true);
  });
});

describe('aggregatesByQueryKey', () => {
  it('counts spellings that share a cache key together and keeps the most searched one', () => {
    const byKey = aggregatesByQueryKey([
      { query: 'coastal ecology', searchCount: 1 },
      { query: 'Coastal  Ecology', searchCount: 3 },
      { query: '  ', searchCount: 5 },
    ]);
    expect([...byKey.values()]).toEqual([{ query: 'Coastal Ecology', searchCount: 4 }]);
  });
});

describe('collectRoundQueries', () => {
  it('drops filter phrases, seeded keys, name queries and ineligible queries before collecting', async () => {
    const seededKey = searchRerankCacheQueryKey('marine biology', {});
    const liveMissKey = searchRerankCacheQueryKey('soil chemistry', {});
    const asked: string[] = [];
    const { queries, report } = await collectRoundQueries({
      aggregates: [
        { query: 'coastal ecology', searchCount: 2 },
        { query: 'marine biology', searchCount: 4 },
        { query: 'soil chemistry', searchCount: 1 },
        { query: 'has hosted undergrad', searchCount: 6 },
        { query: 'synthetic person name', searchCount: 3 },
        { query: 'x', searchCount: 1 },
        { query: 'word '.repeat(40), searchCount: 1 },
      ],
      existingEntries: [
        { queryKey: seededKey, indexVersion: 'full-v4-2026-11-13' },
        { queryKey: liveMissKey, source: 'live-miss', indexVersion: 'live-miss' },
      ],
      searchCandidates: async (query) => {
        asked.push(query);
        return servedFor({ 'synthetic person name': 'name-query', x: 'too-short' })(query);
      },
    });

    expect(asked).not.toContain('marine biology');
    expect(asked).not.toContain('has hosted undergrad');
    expect(queries.map((query) => query.query)).toEqual(['coastal ecology', 'soil chemistry']);
    expect(queries[0]).toMatchObject({
      row: 'R1',
      served: ['row-0', 'row-1', 'row-2', 'row-3'],
    });
    expect(queries[0].candidates[2]).toMatchObject({ i: 2, slug: 'row-2' });
    expect(report).toMatchObject({
      distinctQueries: 7,
      searches: 18,
      collected: 2,
      collectedByWordCount: { '2': 2 },
      excluded: {
        'too-long': 1,
        'filter-phrase': 1,
        'already-seeded': 1,
        'name-query': 1,
        'not-rerank-eligible': 1,
        'too-few-results': 0,
      },
    });
  });

  it('refuses a query whose served list cannot be reordered', async () => {
    const { queries, report } = await collectRoundQueries({
      aggregates: [{ query: 'coastal ecology', searchCount: 1 }],
      existingEntries: [],
      searchCandidates: servedFor({}, 1),
    });
    expect(queries).toEqual([]);
    expect(report.excluded['too-few-results']).toBe(1);
  });
});

describe('scoringBatch', () => {
  it('hands the scorer indexes and text, never a slug or a search count', () => {
    const batch = scoringBatch([roundQuery('R1', ['row-a', 'row-b'])]);
    const serialized = JSON.stringify(batch);
    expect(serialized).not.toMatch(/row-a|row-b|searchCount|served/);
    expect(batch[0]).toMatchObject({ row: 'R1', candidates: [{ i: 0 }, { i: 1 }] });
  });
});

describe('slugScoresFromScorerOutput', () => {
  const queries = [roundQuery('R1', ['row-a', 'row-b'])];

  it('maps each scored index back to its slug', () => {
    const scores = slugScoresFromScorerOutput(queries, [[{ row: 'R1', scores: { 0: 1, 1: 3 } }]]);
    expect([...scores.get('R1')!.entries()]).toEqual([
      ['row-a', 1],
      ['row-b', 3],
    ]);
  });

  it('refuses a missing score, an out-of-range score, an unknown row and a repeated row', () => {
    expect(() => slugScoresFromScorerOutput(queries, [[{ row: 'R1', scores: { 0: 1 } }]])).toThrow(
      /index 1/,
    );
    expect(() =>
      slugScoresFromScorerOutput(queries, [[{ row: 'R1', scores: { 0: 1, 1: 4 } }]]),
    ).toThrow(/index 1/);
    expect(() =>
      slugScoresFromScorerOutput(queries, [[{ row: 'R9', scores: { 0: 1, 1: 1 } }]]),
    ).toThrow(/unknown round row/);
    expect(() =>
      slugScoresFromScorerOutput(queries, [
        [{ row: 'R1', scores: { 0: 1, 1: 1 } }],
        [{ row: 'R1', scores: { 0: 1, 1: 1 } }],
      ]),
    ).toThrow(/twice/);
  });
});

describe('rerankedTop', () => {
  it('reorders the served list the way serving does, keeping ties in served order', () => {
    const query = roundQuery('R1', ['a', 'b', 'c', 'd']);
    const scores = new Map([
      ['a', 0],
      ['b', 2],
      ['c', 3],
      ['d', 2],
    ]);
    expect(rerankedTop(query, scores)).toEqual(['c', 'b', 'd', 'a']);
  });
});

describe('judgePacket', () => {
  it('asks for the union of the served and reranked top 10 and nothing else', () => {
    const served = Array.from({ length: 14 }, (_, index) => `row-${index}`);
    const query = roundQuery('R1', served);
    const scores = new Map(served.map((slug) => [slug, slug === 'row-12' ? 3 : 1]));
    const pairs = judgePacket([query], new Map([['R1', scores]]));
    const slugs = pairs.map((pair) => pair.slug).sort();
    expect(slugs).toEqual([...served.slice(0, 10), 'row-12'].sort());
    expect(Object.keys(pairs[0]).sort()).toEqual(
      ['card', 'departments', 'description', 'name', 'qid', 'query', 'slug'].sort(),
    );
  });
});

describe('parseJudgeGrades', () => {
  it('takes the median of repeated grades and ignores malformed ones', () => {
    const grades = parseJudgeGrades([
      [
        { qid: 'R1', slug: 'a', grade: 0 },
        { qid: 'R1', slug: 'a', grade: 3 },
        { qid: 'R1', slug: 'a', grade: 2 },
        { qid: 'R1', slug: 'b', grade: 7 },
      ],
    ]);
    expect(grades.get('R1\u0000a')).toBe(2);
    expect(grades.has('R1\u0000b')).toBe(false);
  });
});

describe('ndcgOutcomes and gateRound', () => {
  const served = ['a', 'b', 'c', 'd'];
  const lifted = new Map([
    ['a', 0],
    ['b', 0],
    ['c', 3],
    ['d', 3],
  ]);
  const gradeList = (qid: string) => [
    { qid, slug: 'a', grade: 0 },
    { qid, slug: 'b', grade: 0 },
    { qid, slug: 'c', grade: 3 },
    { qid, slug: 'd', grade: 3 },
  ];

  it('imports a round whose reranking raises nDCG@10 on every query', () => {
    const queries = ['R1', 'R2', 'R3'].map((row) => roundQuery(row, served));
    const scores = new Map(queries.map((query) => [query.row, lifted]));
    const grades = parseJudgeGrades([queries.flatMap((query) => gradeList(query.row))]);
    const outcomes = ndcgOutcomes(queries, scores, grades);
    expect(outcomes.every((outcome) => outcome.rerankedNdcg === 1)).toBe(true);
    const report = gateRound(outcomes, 200);
    expect(report).toMatchObject({ verdict: 'import', better: 3, worse: 0, refusals: [] });
    expect(report.ci95[0]).toBeGreaterThan(0);
    expect(seedInputFromRound(queries, scores)[0]).toEqual({
      query: 'synthetic topic R1',
      filters: {},
      scores: { a: 0, b: 0, c: 3, d: 3 },
    });
  });

  it('refuses a round with an ungraded pair, because it would count as grade 0', () => {
    const queries = [roundQuery('R1', served)];
    const grades = parseJudgeGrades([gradeList('R1').slice(1)]);
    const report = gateRound(ndcgOutcomes(queries, new Map([['R1', lifted]]), grades), 200);
    expect(report.verdict).toBe('refuse');
    expect(report.refusals).toContain('ungraded pairs');
  });

  it('refuses a round whose interval reaches 0 or whose losses outweigh its gains', () => {
    const report = gateRound(
      [
        { row: 'R1', servedNdcg: 0.5, rerankedNdcg: 0.6, delta: 0.1, ungradedPairs: 0 },
        { row: 'R2', servedNdcg: 0.9, rerankedNdcg: 0.6, delta: -0.3, ungradedPairs: 0 },
      ],
      200,
    );
    expect(report).toMatchObject({ verdict: 'refuse', better: 1, worse: 1 });
    expect(report.refusals).toEqual([
      '95% interval does not exclude 0',
      'worse queries lose more than better ones gain',
    ]);
  });

  it('refuses an empty round', () => {
    expect(gateRound([], 200).refusals).toContain('no scored queries');
  });
});

describe('writePrivateRoundFile', () => {
  it('writes outside the repository with owner-only permissions', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rerank-round-'));
    const written = writePrivateRoundFile(
      path.join(directory, 'round.json'),
      { queries: [] },
      REPOSITORY_ROOT,
    );
    expect(fs.statSync(written).mode & 0o777).toBe(0o600);
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('refuses a path inside the repository', () => {
    expect(() =>
      writePrivateRoundFile(path.join(REPOSITORY_ROOT, 'round.json'), {}, REPOSITORY_ROOT),
    ).toThrow(/outside the repository/);
  });
});
