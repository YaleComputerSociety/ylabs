import fs from 'fs';
import path from 'path';
import { searchRerankCacheQueryKey } from '../services/researchGroupService';
import {
  SEARCH_RERANK_NEUTRAL_SCORE,
  SEARCH_RERANK_WINDOW,
  applyCachedRerank,
  searchRerankEntryKind,
} from '../services/searchRerankCache';
import { searchRerankLiveMissQueryFits } from '../services/searchRerankLiveMiss';
import {
  SPELLING_CANDIDATE_MIN_DOCUMENTS,
  type SearchSpellingVocabulary,
} from '../services/searchQuerySpellingCorrection';
import { foldLatinDiacritics } from '../utils/latinDiacritics';

export const ROUND_SCRIPT_NAME = 'research-search:rerank-seeding-round';
export const ROUND_SOURCE_URL_ENV = 'PRODUCTION_READONLY_MONGODBURL';
export const ROUND_TOP_K = 10;
export const ROUND_BOOTSTRAP_SAMPLES = 4000;
export const ROUND_RELEVANT_GRADE = 2;
export const ROUND_MIN_QUERIES = 10;

export type RoundCommand = 'collect' | 'judge-packet' | 'gate';

export interface RoundArgs {
  command: RoundCommand;
  since?: Date;
  aggregates?: string;
  out?: string;
  round?: string;
  scores: string[];
  grades: string[];
  seedOut?: string;
}

const flagValue = (arg: string, name: string): string | undefined =>
  arg.startsWith(`${name}=`) ? arg.slice(name.length + 1) : undefined;

const ROUND_COMMANDS: ReadonlySet<string> = new Set(['collect', 'judge-packet', 'gate']);

export function parseRoundArgs(argv: string[]): RoundArgs {
  const [command, ...rest] = argv.filter((arg) => arg !== '--');
  if (!command || !ROUND_COMMANDS.has(command)) {
    throw new Error(`${ROUND_SCRIPT_NAME} needs a command: collect, judge-packet or gate`);
  }
  const args: RoundArgs = { command: command as RoundCommand, scores: [], grades: [] };
  for (const arg of rest) {
    const since = flagValue(arg, '--since');
    const out = flagValue(arg, '--out');
    const round = flagValue(arg, '--round');
    const scores = flagValue(arg, '--scores');
    const grades = flagValue(arg, '--grades');
    const seedOut = flagValue(arg, '--seed-out');
    const aggregates = flagValue(arg, '--aggregates');
    if (since !== undefined) {
      const parsed = new Date(since);
      if (Number.isNaN(parsed.getTime())) throw new Error(`--since is not a date: ${since}`);
      args.since = parsed;
    } else if (out !== undefined) args.out = out;
    else if (round !== undefined) args.round = round;
    else if (scores !== undefined) args.scores.push(scores);
    else if (grades !== undefined) args.grades.push(grades);
    else if (seedOut !== undefined) args.seedOut = seedOut;
    else if (aggregates !== undefined) args.aggregates = aggregates;
    else throw new Error(`Unknown ${ROUND_SCRIPT_NAME} argument: ${arg}`);
  }
  if (args.command === 'collect' && !args.since) {
    throw new Error('collect needs --since=<ISO date of the last round>');
  }
  if (args.command !== 'collect' && !args.round) {
    throw new Error(`${args.command} needs --round=<path to the collected round>`);
  }
  if (args.command !== 'collect' && args.scores.length === 0) {
    throw new Error(`${args.command} needs at least one --scores=<path>`);
  }
  if (args.command === 'gate' && args.grades.length === 0) {
    throw new Error('gate needs at least one --grades=<path>');
  }
  return args;
}

const isInside = (child: string, parent: string): boolean => {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

/**
 * Round files pair real student queries with research rows, so they are written only
 * outside the repository and readable by their owner alone.
 */
export function writePrivateRoundFile(
  target: string,
  value: unknown,
  repositoryRoot: string,
): string {
  const resolvedDirectory = fs.realpathSync(path.dirname(path.resolve(target)));
  const resolved = path.join(resolvedDirectory, path.basename(target));
  if (isInside(resolved, fs.realpathSync(repositoryRoot))) {
    throw new Error(`${ROUND_SCRIPT_NAME} writes round files only outside the repository`);
  }
  const { O_WRONLY, O_CREAT, O_TRUNC, O_NOFOLLOW } = fs.constants;
  const descriptor = fs.openSync(resolved, O_WRONLY | O_CREAT | O_TRUNC | O_NOFOLLOW, 0o600);
  try {
    fs.fchmodSync(descriptor, 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 1)}\n`);
  } finally {
    fs.closeSync(descriptor);
  }
  return resolved;
}

export function searchEventQueryAggregation(since: Date): Record<string, unknown>[] {
  return [
    {
      $match: {
        eventType: 'search',
        timestamp: { $gte: since },
        searchQuery: { $type: 'string', $ne: '' },
      },
    },
    { $group: { _id: '$searchQuery', searchCount: { $sum: 1 } } },
    { $project: { _id: 0, query: '$_id', searchCount: 1 } },
  ];
}

const SOURCE_READ_ACTIONS: ReadonlySet<string> = new Set([
  'changeStream',
  'collStats',
  'dbHash',
  'dbStats',
  'find',
  'killCursors',
  'listCollections',
  'listIndexes',
  'listSearchIndexes',
  'planCacheRead',
]);

interface ConnectionStatusPrivilege {
  actions?: unknown;
}

/**
 * The query read must run on a credential that can only read, so a mistyped variable
 * cannot hand this script an operator credential. Every listed action must be a known
 * read action, so a broad grant such as `anyAction` is refused too, and an
 * unauthenticated connection or one whose privileges are not listed fails closed.
 */
export function assertReadOnlySourcePrivileges(connectionStatus: unknown): void {
  const authInfo = (connectionStatus as { authInfo?: Record<string, unknown> } | null)?.authInfo;
  const users = authInfo?.authenticatedUsers;
  const privileges = authInfo?.authenticatedUserPrivileges;
  if (
    !Array.isArray(users) ||
    users.length === 0 ||
    !Array.isArray(privileges) ||
    privileges.length === 0
  ) {
    throw new Error(
      `${ROUND_SOURCE_URL_ENV} must be an authenticated read-only credential whose privileges can be listed`,
    );
  }
  const refused = new Set<string>();
  for (const privilege of privileges as ConnectionStatusPrivilege[]) {
    const actions = Array.isArray(privilege?.actions) ? privilege.actions : null;
    if (!actions) {
      refused.add('<unlisted>');
      continue;
    }
    for (const action of actions) {
      if (typeof action !== 'string' || !SOURCE_READ_ACTIONS.has(action)) {
        refused.add(String(action));
      }
    }
  }
  if (refused.size > 0) {
    throw new Error(
      `${ROUND_SOURCE_URL_ENV} holds actions beyond reading (${[...refused].sort().join(', ')}); use a read-only credential`,
    );
  }
}

const ACCESS_FILTER_WORDS: ReadonlySet<string> = new Set([
  'a',
  'accept',
  'accepting',
  'accepts',
  'an',
  'and',
  'any',
  'currently',
  'for',
  'has',
  'have',
  'host',
  'hosted',
  'hosting',
  'hosts',
  'in',
  'lab',
  'labs',
  'mentor',
  'mentoring',
  'mentors',
  'now',
  'of',
  'open',
  'opportunities',
  'opportunity',
  'position',
  'positions',
  'research',
  'researcher',
  'researchers',
  'student',
  'students',
  'that',
  'the',
  'undergrad',
  'undergrads',
  'undergraduate',
  'undergraduates',
  'welcome',
  'welcomes',
  'welcoming',
  'with',
  'work',
  'works',
  'yale',
]);

const queryWords = (query: string): string[] =>
  query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

export const queryNamesATopic = (query: string): boolean =>
  queryWords(query).some((word) => !ACCESS_FILTER_WORDS.has(word));

export const NAME_SHAPED_MAX_WORDS = 4;

export interface TopicVocabulary {
  isTopicTerm: (word: string) => boolean;
}

export function topicVocabularyFrom(
  vocabulary: Pick<SearchSpellingVocabulary, 'documentFrequency' | 'personNameWords'>,
  isDictionaryWord: (word: string) => boolean,
): TopicVocabulary {
  const personNameWords = new Set(vocabulary.personNameWords);
  return {
    isTopicTerm: (word) => {
      const folded = foldLatinDiacritics(word.toLowerCase());
      if (personNameWords.has(folded)) return false;
      return (
        isDictionaryWord(folded) ||
        (vocabulary.documentFrequency.get(folded) ?? 0) >= SPELLING_CANDIDATE_MIN_DOCUMENTS
      );
    },
  };
}

/**
 * Development's search recognises only the people its corpus carries, so a classmate's
 * name it does not know would pass the name-query gate. A short query of letters only is
 * therefore kept only when some word is a topic term, and a word that is also part of a
 * person's name never counts as one; in doubt the query is dropped.
 */
export function queryIsNameShaped(query: string, vocabulary: TopicVocabulary): boolean {
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token && !ACCESS_FILTER_WORDS.has(token));
  if (tokens.length === 0 || tokens.length > NAME_SHAPED_MAX_WORDS) return false;
  if (!tokens.every((token) => /^[\p{L}'.-]+$/u.test(token))) return false;
  return !tokens.some((token) =>
    token
      .split(/['.-]+/)
      .filter((word) => word && !ACCESS_FILTER_WORDS.has(word))
      .some((word) => vocabulary.isTopicTerm(word)),
  );
}

export interface SearchQueryAggregate {
  query: string;
  searchCount: number;
}

export type RoundExclusion =
  | 'too-long'
  | 'filter-phrase'
  | 'name-shaped'
  | 'already-seeded'
  | 'name-query'
  | 'not-rerank-eligible'
  | 'too-few-results';

export interface RoundCandidateRow {
  i: number;
  slug: string;
  name: string;
  departments: string[];
  card: string;
  description: string;
}

export interface RoundQuery {
  row: string;
  query: string;
  searchCount: number;
  served: string[];
  candidates: RoundCandidateRow[];
}

export interface ServedCandidates {
  gate: string;
  rows: Omit<RoundCandidateRow, 'i'>[];
}

export interface CollectRoundReport {
  distinctQueries: number;
  distinctQueryKeys: number;
  searches: number;
  excluded: Record<RoundExclusion, number>;
  collected: number;
  collectedByWordCount: Record<string, number>;
}

const wordCountBand = (query: string): string => {
  const words = query.trim().split(/\s+/).length;
  return words >= 4 ? '4+' : String(words);
};

const mostSearchedSpelling = (spellings: ReadonlyMap<string, number>): string =>
  [...spellings.entries()].sort(
    ([leftQuery, left], [rightQuery, right]) => right - left || leftQuery.localeCompare(rightQuery),
  )[0][0];

/**
 * Spellings search treats alike share one cache key, so they are counted together and
 * the round scores the spelling students typed most.
 */
export function aggregatesByQueryKey(
  aggregates: readonly SearchQueryAggregate[],
): Map<string, SearchQueryAggregate> {
  const spellingsByKey = new Map<string, Map<string, number>>();
  for (const aggregate of aggregates) {
    const query = aggregate.query.trim().replace(/\s+/g, ' ');
    if (!query) continue;
    const key = searchRerankCacheQueryKey(query, {});
    const spellings = spellingsByKey.get(key) ?? new Map<string, number>();
    spellings.set(query, (spellings.get(query) ?? 0) + aggregate.searchCount);
    spellingsByKey.set(key, spellings);
  }
  return new Map(
    [...spellingsByKey.entries()].map(([key, spellings]) => [
      key,
      {
        query: mostSearchedSpelling(spellings),
        searchCount: [...spellings.values()].reduce((total, count) => total + count, 0),
      },
    ]),
  );
}

export function parseQueryAggregates(raw: unknown): SearchQueryAggregate[] {
  if (!Array.isArray(raw)) throw new Error('Query aggregates must be a list');
  return raw.map((item, index) => {
    const { query, searchCount } = (item ?? {}) as { query?: unknown; searchCount?: unknown };
    if (
      typeof query !== 'string' ||
      typeof searchCount !== 'number' ||
      !Number.isInteger(searchCount) ||
      searchCount < 1
    ) {
      throw new Error(`Query aggregate ${index} needs a query and a positive integer searchCount`);
    }
    return { query, searchCount };
  });
}

/**
 * A query enters a round only when search would use a cache entry for it: it keys an
 * entry the cache does not already seed, names a topic rather than an access filter, and
 * passes the same gate the live-miss job uses, which refuses name queries.
 */
export async function collectRoundQueries(options: {
  aggregates: readonly SearchQueryAggregate[];
  existingEntries: ReadonlyArray<{ queryKey: string; indexVersion?: unknown; source?: unknown }>;
  topicVocabulary: TopicVocabulary;
  searchCandidates: (query: string) => Promise<ServedCandidates>;
}): Promise<{ queries: RoundQuery[]; report: CollectRoundReport }> {
  const seededKeys = new Set(
    options.existingEntries
      .filter((entry) => searchRerankEntryKind(entry) === 'seeded')
      .map((entry) => entry.queryKey),
  );
  const byKey = aggregatesByQueryKey(options.aggregates);

  const excluded: Record<RoundExclusion, number> = {
    'too-long': 0,
    'filter-phrase': 0,
    'name-shaped': 0,
    'already-seeded': 0,
    'name-query': 0,
    'not-rerank-eligible': 0,
    'too-few-results': 0,
  };
  const ordered = [...byKey.entries()].sort(
    ([leftKey, left], [rightKey, right]) =>
      right.searchCount - left.searchCount || leftKey.localeCompare(rightKey),
  );
  const queries: RoundQuery[] = [];
  for (const [key, aggregate] of ordered) {
    if (!searchRerankLiveMissQueryFits(aggregate.query)) excluded['too-long'] += 1;
    else if (!queryNamesATopic(aggregate.query)) excluded['filter-phrase'] += 1;
    else if (queryIsNameShaped(aggregate.query, options.topicVocabulary)) {
      excluded['name-shaped'] += 1;
    } else if (seededKeys.has(key)) excluded['already-seeded'] += 1;
    else {
      const served = await options.searchCandidates(aggregate.query);
      if (served.gate === 'name-query') excluded['name-query'] += 1;
      else if (served.gate !== 'eligible') excluded['not-rerank-eligible'] += 1;
      else if (served.rows.length < 2) excluded['too-few-results'] += 1;
      else {
        const rows = served.rows.slice(0, SEARCH_RERANK_WINDOW);
        queries.push({
          row: `R${queries.length + 1}`,
          query: aggregate.query,
          searchCount: aggregate.searchCount,
          served: rows.map((row) => row.slug),
          candidates: rows.map((row, i) => ({ i, ...row })),
        });
      }
    }
  }

  const collectedByWordCount: Record<string, number> = {};
  for (const query of queries) {
    const band = wordCountBand(query.query);
    collectedByWordCount[band] = (collectedByWordCount[band] ?? 0) + 1;
  }
  return {
    queries,
    report: {
      distinctQueries: options.aggregates.length,
      distinctQueryKeys: byKey.size,
      searches: options.aggregates.reduce((total, aggregate) => total + aggregate.searchCount, 0),
      excluded,
      collected: queries.length,
      collectedByWordCount,
    },
  };
}

export function scoringBatch(queries: readonly RoundQuery[]): unknown[] {
  return queries.map((query) => ({
    row: query.row,
    query: query.query,
    candidates: query.candidates.map(({ i, name, departments, card, description }) => ({
      i,
      name,
      departments,
      card,
      description,
    })),
  }));
}

export type RoundScores = ReadonlyMap<string, ReadonlyMap<string, number>>;

/**
 * Scorer output names candidates by index, so each index is mapped back to the slug the
 * round captured for it. A query missing a score for any candidate is refused rather than
 * seeded with a hole the neutral score would silently fill.
 */
export function slugScoresFromScorerOutput(
  queries: readonly RoundQuery[],
  outputs: readonly unknown[],
): RoundScores {
  const byRow = new Map(queries.map((query) => [query.row, query]));
  const scores = new Map<string, Map<string, number>>();
  for (const output of outputs) {
    for (const item of Array.isArray(output) ? output : []) {
      const row = (item as { row?: unknown }).row;
      const raw = (item as { scores?: unknown }).scores;
      const query = typeof row === 'string' ? byRow.get(row) : undefined;
      if (!query || !raw || typeof raw !== 'object') {
        throw new Error(`Scorer output names an unknown round row: ${String(row)}`);
      }
      if (scores.has(query.row)) throw new Error(`Scorer output scores ${query.row} twice`);
      const bySlug = new Map<string, number>();
      for (const candidate of query.candidates) {
        const value = (raw as Record<string, unknown>)[String(candidate.i)];
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 3) {
          throw new Error(
            `Scorer output for ${query.row} lacks a 0-3 score for index ${candidate.i}`,
          );
        }
        bySlug.set(candidate.slug, value);
      }
      scores.set(query.row, bySlug);
    }
  }
  return scores;
}

export const rerankedTop = (
  query: RoundQuery,
  scores: ReadonlyMap<string, number>,
  topK = ROUND_TOP_K,
): string[] =>
  applyCachedRerank(
    query.served.map((slug) => ({ id: slug })),
    scores,
    { window: SEARCH_RERANK_WINDOW, neutral: SEARCH_RERANK_NEUTRAL_SCORE },
  )
    .slice(0, topK)
    .map((candidate) => candidate.id);

export interface JudgePair {
  qid: string;
  query: string;
  slug: string;
  name: string;
  departments: string[];
  card: string;
  description: string;
}

export const xorshiftRandom = (seed: number): (() => number) => {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
};

const seededShuffle = <T>(items: T[], seed: number): T[] => {
  const next = xorshiftRandom(seed);
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(next() * (index + 1));
    [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
  }
  return shuffled;
};

/**
 * The judge sees the union of each query's served and reranked top 10 in a shuffled
 * order, so no pair reveals which arm put it there.
 */
export function judgePacket(queries: readonly RoundQuery[], scores: RoundScores): JudgePair[] {
  const pairs: JudgePair[] = [];
  for (const query of queries) {
    const queryScores = scores.get(query.row);
    if (!queryScores) continue;
    const union = new Set([
      ...query.served.slice(0, ROUND_TOP_K),
      ...rerankedTop(query, queryScores),
    ]);
    for (const candidate of query.candidates) {
      if (!union.has(candidate.slug)) continue;
      pairs.push({
        qid: query.row,
        query: query.query,
        slug: candidate.slug,
        name: candidate.name,
        departments: candidate.departments,
        card: candidate.card,
        description: candidate.description,
      });
    }
  }
  return seededShuffle(pairs, pairs.length);
}

export type JudgeGrades = ReadonlyMap<string, number>;

const gradeKey = (qid: string, slug: string) => `${qid}\u0000${slug}`;

export function parseJudgeGrades(outputs: readonly unknown[]): JudgeGrades {
  const votes = new Map<string, number[]>();
  for (const output of outputs) {
    for (const item of Array.isArray(output) ? output : []) {
      const { qid, slug, grade } = item as { qid?: unknown; slug?: unknown; grade?: unknown };
      if (typeof qid !== 'string' || typeof slug !== 'string') continue;
      if (typeof grade !== 'number' || !Number.isInteger(grade) || grade < 0 || grade > 3) continue;
      const key = gradeKey(qid, slug);
      votes.set(key, [...(votes.get(key) ?? []), grade]);
    }
  }
  return new Map(
    [...votes.entries()].map(([key, grades]) => {
      const sorted = [...grades].sort((left, right) => left - right);
      return [key, sorted[Math.floor(sorted.length / 2)]];
    }),
  );
}

const dcg = (grades: readonly number[]): number =>
  grades.reduce((total, grade, rank) => total + (2 ** grade - 1) / Math.log2(rank + 2), 0);

export interface RoundQueryOutcome {
  row: string;
  servedNdcg: number;
  rerankedNdcg: number;
  delta: number;
  ungradedPairs: number;
}

export function ndcgOutcomes(
  queries: readonly RoundQuery[],
  scores: RoundScores,
  grades: JudgeGrades,
): RoundQueryOutcome[] {
  const outcomes: RoundQueryOutcome[] = [];
  for (const query of queries) {
    const queryScores = scores.get(query.row);
    if (!queryScores) continue;
    const served = query.served.slice(0, ROUND_TOP_K);
    const reranked = rerankedTop(query, queryScores);
    const gradeOf = (slug: string) => grades.get(gradeKey(query.row, slug));
    const union = [...new Set([...served, ...reranked])];
    const ungradedPairs = union.filter((slug) => gradeOf(slug) === undefined).length;
    const ideal = dcg(
      union
        .map((slug) => gradeOf(slug) ?? 0)
        .sort((left, right) => right - left)
        .slice(0, ROUND_TOP_K),
    );
    const ndcg = (slugs: readonly string[]) =>
      ideal > 0 ? dcg(slugs.map((slug) => gradeOf(slug) ?? 0)) / ideal : 0;
    const servedNdcg = ndcg(served);
    const rerankedNdcg = ndcg(reranked);
    outcomes.push({
      row: query.row,
      servedNdcg,
      rerankedNdcg,
      delta: rerankedNdcg - servedNdcg,
      ungradedPairs,
    });
  }
  return outcomes;
}

const DELTA_EPSILON = 1e-9;

export interface RoundGateReport {
  queries: number;
  ungradedPairs: number;
  meanServedNdcg: number;
  meanRerankedNdcg: number;
  meanDelta: number;
  ci95: [number, number];
  better: number;
  worse: number;
  meanGainOnBetter: number;
  meanLossOnWorse: number;
  verdict: 'import' | 'refuse';
  refusals: string[];
}

const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;

const bootstrapMeanCi = (values: readonly number[], samples: number): [number, number] => {
  if (values.length === 0) return [0, 0];
  const next = xorshiftRandom(1);
  const means: number[] = [];
  for (let sample = 0; sample < samples; sample += 1) {
    let total = 0;
    for (let draw = 0; draw < values.length; draw += 1) {
      total += values[Math.floor(next() * values.length)];
    }
    means.push(total / values.length);
  }
  means.sort((left, right) => left - right);
  return [means[Math.floor(samples * 0.025)], means[Math.ceil(samples * 0.975) - 1]];
};

/**
 * The import rule from #6222: a round's entries are imported only when nDCG@10 rises with
 * a 95% bootstrap interval above 0 over at least ROUND_MIN_QUERIES scored queries, and
 * the queries it makes worse lose no more on average than the queries it makes better gain. Any ungraded pair refuses the round,
 * because an ungraded row counts as grade 0 and would bias the comparison.
 */
export function gateRound(
  outcomes: readonly RoundQueryOutcome[],
  samples = ROUND_BOOTSTRAP_SAMPLES,
): RoundGateReport {
  const deltas = outcomes.map((outcome) => outcome.delta);
  const gains = deltas.filter((delta) => delta > DELTA_EPSILON);
  const losses = deltas.filter((delta) => delta < -DELTA_EPSILON).map((delta) => -delta);
  const ci95 = bootstrapMeanCi(deltas, samples);
  const ungradedPairs = outcomes.reduce((total, outcome) => total + outcome.ungradedPairs, 0);
  const meanGainOnBetter = mean(gains);
  const meanLossOnWorse = mean(losses);
  const refusals: string[] = [];
  if (outcomes.length < ROUND_MIN_QUERIES) {
    refusals.push(`fewer than ${ROUND_MIN_QUERIES} scored queries`);
  }
  if (ungradedPairs > 0) refusals.push('ungraded pairs');
  if (!(ci95[0] > 0)) refusals.push('95% interval does not exclude 0');
  if (meanLossOnWorse > meanGainOnBetter)
    refusals.push('worse queries lose more than better ones gain');
  return {
    queries: outcomes.length,
    ungradedPairs,
    meanServedNdcg: mean(outcomes.map((outcome) => outcome.servedNdcg)),
    meanRerankedNdcg: mean(outcomes.map((outcome) => outcome.rerankedNdcg)),
    meanDelta: mean(deltas),
    ci95,
    better: gains.length,
    worse: losses.length,
    meanGainOnBetter,
    meanLossOnWorse,
    verdict: refusals.length === 0 ? 'import' : 'refuse',
    refusals,
  };
}

export function seedInputFromRound(
  queries: readonly RoundQuery[],
  scores: RoundScores,
): Array<{ query: string; filters: Record<string, never>; scores: Record<string, number> }> {
  return queries.flatMap((query) => {
    const queryScores = scores.get(query.row);
    if (!queryScores) return [];
    return [{ query: query.query, filters: {}, scores: Object.fromEntries(queryScores) }];
  });
}

export function parseRoundFile(raw: unknown): RoundQuery[] {
  const queries = (raw as { queries?: unknown } | null)?.queries;
  if (!Array.isArray(queries)) throw new Error('Round file has no queries list');
  return queries.map((query, index) => {
    const value = query as Partial<RoundQuery>;
    if (
      typeof value.row !== 'string' ||
      typeof value.query !== 'string' ||
      !Array.isArray(value.served) ||
      !Array.isArray(value.candidates)
    ) {
      throw new Error(`Round query ${index} is malformed`);
    }
    return value as RoundQuery;
  });
}
