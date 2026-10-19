export interface RelevanceMatchers {
  anyTopicMatches?: string[];
  anyDepartmentMatches?: string[];
  anyTextMatches?: string[];
}

export interface TopicQueryJudgement {
  query: string;
  note?: string;
  topK?: number;
  minRelevant?: number;
  expectNoResults?: boolean;
  relevantWhen?: RelevanceMatchers;
}

export interface TopicQueryJudgementSet {
  queries: TopicQueryJudgement[];
}

export const DEFAULT_TOP_K = 10;

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string');

const parseMatchers = (value: unknown, query: string): RelevanceMatchers => {
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null)
    throw new Error(`Judgement for "${query}" has a relevantWhen that is not an object`);
  const raw = value as Record<string, unknown>;
  const matchers: RelevanceMatchers = {};
  for (const key of ['anyTopicMatches', 'anyDepartmentMatches', 'anyTextMatches'] as const) {
    const entry = raw[key];
    if (entry === undefined) continue;
    if (!isStringArray(entry))
      throw new Error(`Judgement for "${query}" has a ${key} that is not an array of strings`);
    matchers[key] = entry;
  }
  return matchers;
};

export function parseTopicQueryJudgements(value: unknown): TopicQueryJudgementSet {
  if (typeof value !== 'object' || value === null)
    throw new Error('A judgements file must be a JSON object');
  const queries = (value as Record<string, unknown>).queries;
  if (!Array.isArray(queries)) throw new Error('A judgements file must carry a queries array');

  return {
    queries: queries.map((entry, index) => {
      if (typeof entry !== 'object' || entry === null)
        throw new Error(`Judgement at index ${index} is not an object`);
      const raw = entry as Record<string, unknown>;
      if (typeof raw.query !== 'string' || raw.query.trim().length === 0)
        throw new Error(`Judgement at index ${index} has no query`);
      const query = raw.query;

      const expectNoResults = raw.expectNoResults === true;
      const matchers = parseMatchers(raw.relevantWhen, query);
      const hasMatcher = Object.values(matchers).some(
        (entry) => Array.isArray(entry) && entry.length > 0,
      );
      if (!expectNoResults && !hasMatcher)
        throw new Error(
          `Judgement for "${query}" must either expectNoResults or supply at least one relevantWhen matcher`,
        );

      const topK = raw.topK === undefined ? DEFAULT_TOP_K : Number(raw.topK);
      if (!Number.isInteger(topK) || topK <= 0)
        throw new Error(`Judgement for "${query}" has a topK that is not a positive integer`);

      const minRelevant = raw.minRelevant === undefined ? topK : Number(raw.minRelevant);
      if (!Number.isInteger(minRelevant) || minRelevant < 0 || minRelevant > topK)
        throw new Error(
          `Judgement for "${query}" has a minRelevant outside 0..topK, which can never be satisfied`,
        );

      return {
        query,
        ...(typeof raw.note === 'string' ? { note: raw.note } : {}),
        topK,
        minRelevant,
        ...(expectNoResults ? { expectNoResults } : {}),
        ...(hasMatcher ? { relevantWhen: matchers } : {}),
      };
    }),
  };
}
