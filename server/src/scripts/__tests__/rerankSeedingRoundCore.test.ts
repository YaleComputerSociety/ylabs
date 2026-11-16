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
  parseQueryAggregates,
  queryIsNameShaped,
  queryHasUnknownSymbol,
  corpusSymbolsFrom,
  topicVocabularyFrom,
  parseRoundArgs,
  queryNamesATopic,
  rerankedTop,
  scoringBatch,
  searchEventQueryAggregation,
  seedInputFromRound,
  slugScoresFromScorerOutput,
  writePrivateRoundFile,
  xorshiftRandom,
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

  it('accepts every action the built-in read role grants', () => {
    expect(() =>
      assertReadOnlySourcePrivileges(
        status([
          'changeStream',
          'collStats',
          'dbHash',
          'dbStats',
          'find',
          'killCursors',
          'listCollections',
          'listIndexes',
          'listSearchIndexes',
          'performRawDataOperations',
          'planCacheRead',
        ]),
      ),
    ).not.toThrow();
  });

  it('refuses a credential whose only writes are role, password or search index changes', () => {
    expect(() =>
      assertReadOnlySourcePrivileges(status(['find', 'createRole', 'changePassword'])),
    ).toThrow(/beyond reading \(changePassword, createRole\)/);
    expect(() => assertReadOnlySourcePrivileges(status(['find', 'updateSearchIndex']))).toThrow(
      /beyond reading \(updateSearchIndex\)/,
    );
  });

  it('refuses a credential that can write', () => {
    expect(() => assertReadOnlySourcePrivileges(status(['find', 'insert', 'update']))).toThrow(
      /beyond reading \(insert, update\)/,
    );
  });

  it('refuses a broad or unknown grant, not only a named write', () => {
    expect(() => assertReadOnlySourcePrivileges(status(['anyAction']))).toThrow(
      /beyond reading \(anyAction\)/,
    );
    expect(() => assertReadOnlySourcePrivileges(status(['find', 'internal']))).toThrow(
      /beyond reading \(internal\)/,
    );
    expect(() => assertReadOnlySourcePrivileges(status(['find', 'someFutureAction']))).toThrow(
      /beyond reading \(someFutureAction\)/,
    );
    expect(() =>
      assertReadOnlySourcePrivileges({
        authInfo: {
          authenticatedUsers: [{ user: 'reader', db: 'admin' }],
          authenticatedUserPrivileges: [{ resource: { anyResource: true } }],
        },
      }),
    ).toThrow(/beyond reading \(<unlisted>\)/);
  });

  it('fails closed when the connection is unauthenticated or lists no privileges', () => {
    expect(() => assertReadOnlySourcePrivileges({ authInfo: { authenticatedUsers: [] } })).toThrow(
      /read-only credential/,
    );
    expect(() =>
      assertReadOnlySourcePrivileges({ authInfo: { authenticatedUsers: [{ user: 'x' }] } }),
    ).toThrow(/read-only credential/);
    expect(() => assertReadOnlySourcePrivileges(null)).toThrow(/read-only credential/);
    expect(() =>
      assertReadOnlySourcePrivileges({
        authInfo: { authenticatedUsers: [{ user: 'x' }], authenticatedUserPrivileges: [] },
      }),
    ).toThrow(/read-only credential/);
  });
});

describe('queryNamesATopic', () => {
  it('treats a query made only of access-filter words as a filter phrase', () => {
    expect(queryNamesATopic('has hosted undergrad')).toBe(false);
    expect(queryNamesATopic('labs accepting undergraduates')).toBe(false);
    expect(queryNamesATopic('first year')).toBe(false);
    expect(queryNamesATopic('freshmen')).toBe(false);
    expect(queryNamesATopic('research for sophomores')).toBe(false);
    expect(queryNamesATopic('first year seminar in coastal ecology')).toBe(true);
    expect(queryNamesATopic('2027')).toBe(false);
    expect(queryNamesATopic('CPSC 4xx')).toBe(false);
    expect(queryNamesATopic('cpsc 474')).toBe(false);
    expect(queryNamesATopic('MATH225')).toBe(false);
    expect(queryNamesATopic('cpsc 201 math 225')).toBe(false);
    expect(queryNamesATopic('covid 19 vaccines')).toBe(true);
    expect(queryNamesATopic('5g networks')).toBe(true);
    expect(queryNamesATopic('covid 19')).toBe(true);
    expect(queryNamesATopic('covid19')).toBe(true);
    expect(queryNamesATopic('cd19')).toBe(true);
    expect(queryNamesATopic('tp53')).toBe(true);
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

const TOPIC_WORDS = new Set([
  'coastal',
  'ecology',
  'marine',
  'biology',
  'soil',
  'chemistry',
  'synthetic',
  'person',
  'name',
  'word',
  'x',
]);
const CORPUS_SYMBOLS = new Set(['tp53', 'cd19', 'il6', 'h1n1', 'brca1']);
const isCorpusSymbol = (token: string) => CORPUS_SYMBOLS.has(token);
const topicVocabulary = { isTopicTerm: (word: string) => TOPIC_WORDS.has(word), isCorpusSymbol };

describe('queryIsNameShaped', () => {
  it('reads a name with digits beside or inside its words as the name it carries', () => {
    expect(queryIsNameShaped('Tqxa Vrnbe 2027', topicVocabulary)).toBe(true);
    expect(queryIsNameShaped('Tqxa2', topicVocabulary)).toBe(true);
    expect(queryIsNameShaped('2027 Tqxa Vrnbe', topicVocabulary)).toBe(true);
    expect(queryIsNameShaped('Tqxa Vrnbe 2027 2028', topicVocabulary)).toBe(true);
    expect(queryIsNameShaped('Tqxa Vrnbe (2027)', topicVocabulary)).toBe(true);
    expect(queryIsNameShaped('Tqxa Vrnbe #2027', topicVocabulary)).toBe(true);
    expect(queryIsNameShaped('marine biology 2027', topicVocabulary)).toBe(false);
    expect(queryIsNameShaped('soil2 chemistry', topicVocabulary)).toBe(false);
  });

  it('keeps a gene or virus symbol the corpus states as a topic', () => {
    for (const query of ['tp53', 'CD19', 'il6', 'h1n1', 'brca1', 'tp53 cd19']) {
      expect(queryIsNameShaped(query, topicVocabulary)).toBe(false);
    }
    expect(queryIsNameShaped('Tqxa2', topicVocabulary)).toBe(true);
  });

  it('reads a name beside a short letter-prefixed year as the name it carries', () => {
    for (const query of ['Tqxa Vrnbe TD27', "Tqxa Vrnbe TD'27", 'Tqxa Y27', 'c2027 Tqxa Vrnbe']) {
      expect(queryIsNameShaped(query, topicVocabulary)).toBe(true);
    }
  });

  it('keeps a mixed word next to a name only when the corpus states the whole word', () => {
    expect(queryIsNameShaped('tp53 Tqxa', topicVocabulary)).toBe(false);
    expect(
      queryIsNameShaped('tp53 Tqxa', { ...topicVocabulary, isCorpusSymbol: () => false }),
    ).toBe(true);
  });

  it('reads a name written with a comma or parentheses as the name it carries', () => {
    expect(queryIsNameShaped('Vrnbe, Tqxa', topicVocabulary)).toBe(true);
    expect(queryIsNameShaped('Tqxa (Vrnbe)', topicVocabulary)).toBe(true);
    expect(queryIsNameShaped('"Tqxa Vrnbe"', topicVocabulary)).toBe(true);
    expect(queryIsNameShaped('ecology, marine', topicVocabulary)).toBe(false);
  });

  it('leaves a purely numeric query to the filter-phrase rule rather than calling it a name', () => {
    expect(queryIsNameShaped('2027', topicVocabulary)).toBe(false);
  });

  it('drops a short letters-only query with no topic term', () => {
    expect(queryIsNameShaped('Tqxa Vrnbe', topicVocabulary)).toBe(true);
    expect(queryIsNameShaped("Tqxa O'Vrnbe-Plok", topicVocabulary)).toBe(true);
    expect(queryIsNameShaped('Tqxa', topicVocabulary)).toBe(true);
  });

  it('keeps a query with a topic term or more than four words', () => {
    expect(queryIsNameShaped('Tqxa marine biology', topicVocabulary)).toBe(false);
    expect(queryIsNameShaped('tqxa vrnbe plok zemv quor', topicVocabulary)).toBe(false);
  });

  it('drops a name padded with access-filter words that a real vocabulary knows', () => {
    const vocabularyKnowingFilterWords = {
      isTopicTerm: (word: string) =>
        TOPIC_WORDS.has(word) || ['research', 'labs', 'mentor', 'yale'].includes(word),
      isCorpusSymbol,
    };
    expect(queryIsNameShaped('research Tqxa Vrnbe', vocabularyKnowingFilterWords)).toBe(true);
    expect(
      queryIsNameShaped('yale labs mentor Tqxa Vrnbe Plok', vocabularyKnowingFilterWords),
    ).toBe(true);
    expect(queryIsNameShaped('research Tqxa marine', vocabularyKnowingFilterWords)).toBe(false);
  });
});

describe('queryHasUnknownSymbol', () => {
  it('flags a netid-shaped word, since the same shape names a student', () => {
    expect(queryHasUnknownSymbol('jd456', topicVocabulary)).toBe(true);
    expect(queryHasUnknownSymbol('jd456 lab', topicVocabulary)).toBe(true);
    expect(queryHasUnknownSymbol('research with abc123 in marine biology', topicVocabulary)).toBe(
      true,
    );
  });

  it('flags a symbol the corpus never states and passes one it does', () => {
    expect(queryHasUnknownSymbol('xy12 signalling', topicVocabulary)).toBe(true);
    expect(queryHasUnknownSymbol('tp53 mutations', topicVocabulary)).toBe(false);
    expect(queryHasUnknownSymbol('H1N1 vaccines', topicVocabulary)).toBe(false);
  });

  it('ignores digits that stand apart from letters', () => {
    expect(queryHasUnknownSymbol('covid 19', topicVocabulary)).toBe(false);
    expect(queryHasUnknownSymbol('covid-19 vaccines', topicVocabulary)).toBe(false);
    expect(queryHasUnknownSymbol('marine biology 2027', topicVocabulary)).toBe(false);
  });
});

describe('corpusSymbolsFrom', () => {
  const served = (text: string) => ({ bodyText: [text], served: true });

  it('collects a letter-and-digit word stated by at least two served rows', () => {
    const symbols = corpusSymbolsFrom([
      served('Studies TP53 signalling.'),
      served('tp53 in lymphoma'),
      { bodyText: [['Models of CD19 loss', 'cd19']], served: true },
      served('il6 therapy'),
    ]);
    expect([...symbols].sort()).toEqual(['tp53']);
  });

  it('never collects a word from an email address or a link, or from an unserved row', () => {
    const symbols = corpusSymbolsFrom([
      served('Contact jd456@yale.edu'),
      served('Write to jd456@example.org or see https://lab.example.org/jd456'),
      served('Visit www.example.org/jd456 for details'),
      { bodyText: ['jd456'], served: false },
      { bodyText: ['jd456'], served: false },
      { bodyText: ['jd456'], served: false },
    ]);
    expect(symbols.has('jd456')).toBe(false);
  });
});

describe('topicVocabularyFrom', () => {
  const vocabulary = topicVocabularyFrom(
    {
      documentFrequency: new Map([
        ['proteomics', 4],
        ['tqxa', 9],
        ['rarebody', 2],
      ]),
      personNameWords: ['tqxa', 'rose'],
    },
    (word) => word === 'rose' || word === 'garden',
    new Set(['tp53']),
  );

  it('answers corpus symbols case-insensitively from the set it was given', () => {
    expect(vocabulary.isCorpusSymbol('TP53')).toBe(true);
    expect(vocabulary.isCorpusSymbol('jd456')).toBe(false);
  });

  it('counts a dictionary word or a body term in at least three documents as a topic term', () => {
    expect(vocabulary.isTopicTerm('garden')).toBe(true);
    expect(vocabulary.isTopicTerm('Proteomics')).toBe(true);
    expect(vocabulary.isTopicTerm('rarebody')).toBe(false);
  });

  it('never counts a word that is part of a person name, even a dictionary word', () => {
    expect(vocabulary.isTopicTerm('rose')).toBe(false);
    expect(vocabulary.isTopicTerm('tqxa')).toBe(false);
  });
});

describe('parseQueryAggregates', () => {
  it('accepts positive integer counts and refuses anything else', () => {
    expect(parseQueryAggregates([{ query: 'coastal ecology', searchCount: 2 }])).toEqual([
      { query: 'coastal ecology', searchCount: 2 },
    ]);
    expect(() => parseQueryAggregates([{ query: 'coastal ecology', searchCount: 1.5 }])).toThrow(
      /positive integer/,
    );
    expect(() => parseQueryAggregates([{ query: 'coastal ecology', searchCount: '2' }])).toThrow(
      /positive integer/,
    );
    expect(() => parseQueryAggregates([{ query: 'coastal ecology', searchCount: 0 }])).toThrow(
      /positive integer/,
    );
    expect(() => parseQueryAggregates({ query: 'coastal ecology' })).toThrow(/list/);
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
        { query: 'Tqxa Vrnbe', searchCount: 2 },
        { query: 'x', searchCount: 1 },
        { query: 'word '.repeat(40), searchCount: 1 },
      ],
      existingEntries: [
        { queryKey: seededKey, indexVersion: 'full-v4-2026-11-13' },
        { queryKey: liveMissKey, source: 'live-miss', indexVersion: 'live-miss' },
      ],
      topicVocabulary,
      searchCandidates: async (query) => {
        asked.push(query);
        return servedFor({ 'synthetic person name': 'name-query', x: 'too-short' })(query);
      },
    });

    expect(asked).not.toContain('marine biology');
    expect(asked).not.toContain('has hosted undergrad');
    expect(asked).not.toContain('Tqxa Vrnbe');
    expect(queries.map((query) => query.query)).toEqual(['coastal ecology', 'soil chemistry']);
    expect(queries[0]).toMatchObject({
      row: 'R1',
      served: ['row-0', 'row-1', 'row-2', 'row-3'],
    });
    expect(queries[0].candidates[2]).toMatchObject({ i: 2, slug: 'row-2' });
    expect(report).toMatchObject({
      distinctQueries: 8,
      searches: 20,
      collected: 2,
      collectedByWordCount: { '2': 2 },
      excluded: {
        'too-long': 1,
        'filter-phrase': 1,
        'name-shaped': 1,
        'already-seeded': 1,
        'name-query': 1,
        'not-rerank-eligible': 1,
        'too-few-results': 0,
      },
    });
  });

  it('drops a name with a digit before search and files course codes as filter phrases', async () => {
    const asked: string[] = [];
    const { queries, report } = await collectRoundQueries({
      aggregates: [
        { query: 'Tqxa Vrnbe 2027', searchCount: 1 },
        { query: 'Tqxa2', searchCount: 1 },
        { query: 'jd456 lab', searchCount: 1 },
        { query: 'tp53 mutations', searchCount: 1 },
        { query: 'CPSC 4xx', searchCount: 1 },
        { query: '2027', searchCount: 1 },
        { query: 'marine biology 2027', searchCount: 1 },
      ],
      existingEntries: [],
      topicVocabulary,
      searchCandidates: async (query) => {
        asked.push(query);
        return servedFor({})(query);
      },
    });
    expect(asked.sort()).toEqual(['marine biology 2027', 'tp53 mutations']);
    expect(queries.map((query) => query.query).sort()).toEqual(asked);
    expect(report.excluded).toMatchObject({
      'unknown-symbol': 2,
      'name-shaped': 1,
      'filter-phrase': 2,
    });
  });

  it('refuses a query whose served list cannot be reordered', async () => {
    const { queries, report } = await collectRoundQueries({
      aggregates: [{ query: 'coastal ecology', searchCount: 1 }],
      existingEntries: [],
      topicVocabulary,
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
    const queries = Array.from({ length: 10 }, (_, index) => roundQuery(`R${index + 1}`, served));
    const scores = new Map(queries.map((query) => [query.row, lifted]));
    const grades = parseJudgeGrades([queries.flatMap((query) => gradeList(query.row))]);
    const outcomes = ndcgOutcomes(queries, scores, grades);
    expect(outcomes.every((outcome) => outcome.rerankedNdcg === 1)).toBe(true);
    const report = gateRound(outcomes, 200);
    expect(report).toMatchObject({ verdict: 'import', better: 10, worse: 0, refusals: [] });
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
      'fewer than 10 scored queries',
      '95% interval does not exclude 0',
      'worse queries lose more than better ones gain',
    ]);
  });

  const outcomesFor = (deltas: readonly number[]) =>
    deltas.map((delta, index) => ({
      row: `R${index + 1}`,
      servedNdcg: 0.5,
      rerankedNdcg: 0.5 + delta,
      delta,
      ungradedPairs: 0,
    }));

  it('draws the same bootstrap interval for the same deltas every run', () => {
    const outcomes = outcomesFor([0.1, -0.05, 0.2, 0, 0.3, 0.15, -0.1, 0.05, 0.25, 0.1]);
    expect(gateRound(outcomes).ci95).toEqual([0.02, 0.175]);
  });

  it('brackets the mean delta with a non-degenerate interval inside the range of the deltas', () => {
    const deltas = [0.1, -0.05, 0.2, 0, 0.3, 0.15, -0.1, 0.05, 0.25, 0.1];
    const meanDelta = deltas.reduce((total, delta) => total + delta, 0) / deltas.length;
    const [lower, upper] = gateRound(outcomesFor(deltas)).ci95;
    expect(lower).toBeGreaterThanOrEqual(Math.min(...deltas));
    expect(lower).toBeLessThan(meanDelta);
    expect(upper).toBeGreaterThan(meanDelta);
    expect(upper).toBeLessThanOrEqual(Math.max(...deltas));
  });

  it('collapses the interval onto the delta when every query moves by the same amount', () => {
    const [lower, upper] = gateRound(outcomesFor(Array(12).fill(0.25))).ci95;
    expect(lower).toBeCloseTo(0.25, 12);
    expect(upper).toBeCloseTo(0.25, 12);
  });

  it('refuses an empty round', () => {
    expect(gateRound([], 200).refusals).toContain('fewer than 10 scored queries');
  });

  it('refuses a round too small for its interval to mean anything, even when every query improves', () => {
    const improved = Array.from({ length: 3 }, (_, index) => ({
      row: `R${index + 1}`,
      servedNdcg: 0.5,
      rerankedNdcg: 0.9,
      delta: 0.4,
      ungradedPairs: 0,
    }));
    const report = gateRound(improved, 200);
    expect(report.ci95[0]).toBeGreaterThan(0);
    expect(report).toMatchObject({ verdict: 'refuse', refusals: ['fewer than 10 scored queries'] });
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

  it('makes an existing world-readable file owner-only before rewriting it', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rerank-round-'));
    const target = path.join(directory, 'round.json');
    fs.writeFileSync(target, 'old', { mode: 0o644 });
    fs.chmodSync(target, 0o644);
    writePrivateRoundFile(target, { queries: [] }, REPOSITORY_ROOT);
    expect(fs.statSync(target).mode & 0o777).toBe(0o600);
    expect(JSON.parse(fs.readFileSync(target, 'utf8'))).toEqual({ queries: [] });
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('refuses a target that is a symlink into the repository', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rerank-round-'));
    const inside = path.join(REPOSITORY_ROOT, `.rerank-round-symlink-target-${process.pid}`);
    const link = path.join(directory, 'round.json');
    fs.symlinkSync(inside, link);
    try {
      expect(() => writePrivateRoundFile(link, {}, REPOSITORY_ROOT)).toThrow();
      expect(fs.existsSync(inside)).toBe(false);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('refuses a path inside the repository', () => {
    expect(() =>
      writePrivateRoundFile(path.join(REPOSITORY_ROOT, 'round.json'), {}, REPOSITORY_ROOT),
    ).toThrow(/outside the repository/);
  });
});

describe('xorshiftRandom', () => {
  it('is the standard 32-bit xorshift sequence', () => {
    const next = xorshiftRandom(1);
    expect([next(), next(), next()].map((draw) => draw * 0x100000000)).toEqual([
      270369, 67634689, 2647435461,
    ]);
  });

  it('draws evenly over [0, 1) with no repeating short cycle', () => {
    const next = xorshiftRandom(1);
    const draws = Array.from({ length: 20000 }, next);
    const buckets = new Array(10).fill(0);
    for (const draw of draws) buckets[Math.floor(draw * 10)] += 1;
    expect(draws.every((draw) => draw >= 0 && draw < 1)).toBe(true);
    expect(new Set(draws).size).toBe(draws.length);
    for (const bucket of buckets) expect(Math.abs(bucket - 2000)).toBeLessThan(200);
  });
});
