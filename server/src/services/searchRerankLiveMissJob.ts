import mongoose from 'mongoose';
import { ModelCallUsage } from '../models/modelCallUsage';
import { ResearchEntity } from '../models/researchEntity';
import {
  SEARCH_RERANK_MAX_SCORE,
  SEARCH_RERANK_MIN_SCORE,
  SearchRerankCache,
} from '../models/searchRerankCache';
import { SEARCH_RERANK_LIVE_MISS_PROMPT } from '../scrapers/prompts';
import { serializedDocumentId } from '../utils/idSerialization';
import { postChatCompletion } from '../utils/modelClient';
import { estimatedCostUsd } from '../utils/modelPricing';
import { usableOpenAiApiKey } from '../utils/openAiApiKey';
import { detailServedSource, toPublicResearchEntityDto } from './researchEntityDto';
import type { ResearchGroupFilterInput } from './researchGroupFilters';
import {
  searchRerankCacheFilters,
  searchRerankCacheQueryKey,
  searchResearchGroupsForRerankCandidates,
  type SearchRerankCacheFilters,
} from './researchGroupService';
import {
  SEARCH_RERANK_SEEDED_INDEX_VERSION_PREFIX,
  SEARCH_RERANK_SHADOW_SOURCE,
  SEARCH_RERANK_WINDOW,
  forgetSearchRerankCacheKey,
  searchRerankEntryKind,
} from './searchRerankCache';
import {
  SEARCH_RERANK_LIVE_MISS_CALLER,
  SEARCH_RERANK_LIVE_MISS_DAILY_SPEND_CEILING_USD,
  searchRerankLiveMissMode,
  searchRerankLiveMissQueryFits,
  searchRerankLiveMissStaleBefore,
  searchRerankLiveMissWantsEntry,
  type SearchRerankLiveMissJobStatus,
  type SearchRerankLiveMissMode,
} from './searchRerankLiveMiss';

export const SEARCH_RERANK_LIVE_MISS_MODEL = 'gpt-5-mini';
export const SEARCH_RERANK_LIVE_MISS_SOURCE = 'live-miss';
export const SEARCH_RERANK_LIVE_MISS_TIMEOUT_MS = 60_000;

const DAY_MS = 24 * 60 * 60 * 1000;
const NOT_SEEDED_INDEX_VERSION = {
  $not: new RegExp(`^${SEARCH_RERANK_SEEDED_INDEX_VERSION_PREFIX}`),
};

export interface SearchRerankLiveMissCandidate {
  entityId: string;
  name: string;
  departments: string[];
  shortDescription: string;
  fullDescription: string;
}

export type SearchRerankLiveMissModel = (input: {
  query: string;
  candidates: readonly SearchRerankLiveMissCandidate[];
}) => Promise<unknown>;

export interface SearchRerankLiveMissEntry {
  queryKey: string;
  queryText: string;
  filters: SearchRerankCacheFilters;
  scores: Array<{ entityId: string; score: number }>;
  scoredAt: Date;
  indexVersion: string;
  source: string;
}

export interface SearchRerankLiveMissJobInput {
  query: string;
  filters?: ResearchGroupFilterInput;
}

export interface RunSearchRerankLiveMissJobOptions {
  write?: boolean;
  mode?: SearchRerankLiveMissMode;
  now?: () => Date;
  model?: SearchRerankLiveMissModel;
  readSpendTodayUsd?: (now: Date) => Promise<number>;
}

export interface SearchRerankLiveMissJobOutcome {
  status: SearchRerankLiveMissJobStatus;
  entry?: SearchRerankLiveMissEntry;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

const textList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

export function searchRerankLiveMissUserPrompt(
  query: string,
  candidates: readonly SearchRerankLiveMissCandidate[],
): string {
  const lines = candidates.map(
    (candidate, index) =>
      `[${index}] ${candidate.name} | departments: ${candidate.departments
        .join(', ')
        .slice(
          0,
          120,
        )} | ${candidate.shortDescription.slice(0, 220)} | ${candidate.fullDescription.slice(0, 300)}`,
  );
  return `Query: ${query}\n\n${lines.join('\n')}`;
}

export function defaultSearchRerankLiveMissModel(apiKey: string): SearchRerankLiveMissModel {
  return async ({ query, candidates }) => {
    const response = await postChatCompletion({
      caller: SEARCH_RERANK_LIVE_MISS_CALLER,
      apiKey,
      timeoutMs: SEARCH_RERANK_LIVE_MISS_TIMEOUT_MS,
      body: {
        model: SEARCH_RERANK_LIVE_MISS_MODEL,
        response_format: { type: 'json_object' },
        reasoning_effort: 'minimal',
        messages: [
          { role: 'system', content: SEARCH_RERANK_LIVE_MISS_PROMPT },
          { role: 'user', content: searchRerankLiveMissUserPrompt(query, candidates) },
        ],
      },
    });
    return response.data?.choices?.[0]?.message?.content;
  };
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function parseSearchRerankLiveMissScores(
  content: unknown,
  candidateCount: number,
): number[] | null {
  if (typeof content !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed) || !isPlainObject(parsed.scores)) return null;
  const scores = parsed.scores;
  const expectedIds = Array.from({ length: candidateCount }, (_value, index) => String(index));
  if (Object.keys(scores).length !== candidateCount) return null;
  const ordered: number[] = [];
  for (const id of expectedIds) {
    const score = scores[id];
    if (
      typeof score !== 'number' ||
      !Number.isInteger(score) ||
      score < SEARCH_RERANK_MIN_SCORE ||
      score > SEARCH_RERANK_MAX_SCORE
    ) {
      return null;
    }
    ordered.push(score);
  }
  return ordered;
}

export async function searchRerankLiveMissSpendTodayUsd(now: Date): Promise<number> {
  if (mongoose.connection.readyState !== 1) {
    throw new Error('model usage log is unreadable without a database connection');
  }
  const dayStart = new Date(now.getTime() - (now.getTime() % DAY_MS));
  const groups = await ModelCallUsage.aggregate<{
    _id: string;
    promptTokens: number;
    cachedPromptTokens: number;
    completionTokens: number;
  }>([
    { $match: { caller: SEARCH_RERANK_LIVE_MISS_CALLER, calledAt: { $gte: dayStart } } },
    {
      $group: {
        _id: '$model',
        promptTokens: { $sum: '$promptTokens' },
        cachedPromptTokens: { $sum: '$cachedPromptTokens' },
        completionTokens: { $sum: '$completionTokens' },
      },
    },
  ]);
  return groups.reduce(
    (total, group) => total + (estimatedCostUsd(String(group._id), group) ?? Infinity),
    0,
  );
}

async function candidatesWithServedText(
  entities: ReadonlyArray<Record<string, unknown>>,
): Promise<SearchRerankLiveMissCandidate[]> {
  const slugs = entities.map((entity) => text(entity.slug)).filter(Boolean);
  const rows = (await ResearchEntity.find({
    slug: { $in: slugs },
    archived: { $ne: true },
  }).lean()) as Array<Record<string, any>>;
  const rowBySlug = new Map(rows.map((row) => [text(row.slug), row]));
  return entities.flatMap((entity) => {
    const row = rowBySlug.get(text(entity.slug));
    const entityId = row ? serializedDocumentId(row._id) : undefined;
    if (!row || !entityId) return [];
    const served = toPublicResearchEntityDto(detailServedSource(row, [])) as Record<
      string,
      unknown
    >;
    return [
      {
        entityId,
        name: text(served.displayName) || text(served.name) || text(entity.name),
        departments: textList(served.departments),
        shortDescription: text(served.shortDescription),
        fullDescription: text(served.fullDescription),
      },
    ];
  });
}

const isDuplicateKeyError = (error: unknown): boolean =>
  (error as { code?: unknown } | null)?.code === 11000;

const utcDate = (value: Date): string => value.toISOString().slice(0, 10);

export async function runSearchRerankLiveMissJob(
  input: SearchRerankLiveMissJobInput,
  options: RunSearchRerankLiveMissJobOptions = {},
): Promise<SearchRerankLiveMissJobOutcome> {
  const write = options.write !== false;
  const mode = options.mode ?? searchRerankLiveMissMode();
  const now = options.now ?? (() => new Date());
  const filters = searchRerankCacheFilters(input.filters ?? {});
  const queryKey = searchRerankCacheQueryKey(input.query, filters);
  const queryText = input.query.trim();
  if (!searchRerankLiveMissQueryFits(queryText)) return { status: 'ineligible' };

  if (write) {
    const existing = await SearchRerankCache.findOne({ queryKey })
      .select('source indexVersion scoredAt')
      .lean();
    const scoredAt = (existing as { scoredAt?: unknown } | null)?.scoredAt;
    const wanted = searchRerankLiveMissWantsEntry(
      {
        kind: searchRerankEntryKind(existing),
        scores: null,
        scoredAt: scoredAt instanceof Date ? scoredAt : null,
      },
      mode,
      searchRerankLiveMissStaleBefore(),
    );
    if (!wanted) return { status: 'not-wanted' };
  }

  const searched = await searchResearchGroupsForRerankCandidates(
    queryText,
    filters,
    SEARCH_RERANK_WINDOW,
  );
  if (searched.rerankLiveMissGate !== 'eligible') return { status: 'ineligible' };
  const top = searched.researchEntities.slice(0, SEARCH_RERANK_WINDOW);
  if (top.length < 2) return { status: 'ineligible' };

  let spentToday: number;
  try {
    spentToday = await (options.readSpendTodayUsd ?? searchRerankLiveMissSpendTodayUsd)(now());
  } catch {
    return { status: 'spend-unreadable' };
  }
  if (!(spentToday < SEARCH_RERANK_LIVE_MISS_DAILY_SPEND_CEILING_USD)) {
    return { status: 'spend-ceiling' };
  }

  const apiKey = usableOpenAiApiKey();
  const model = options.model ?? (apiKey ? defaultSearchRerankLiveMissModel(apiKey) : null);
  if (!model) return { status: 'no-api-key' };

  const candidates = await candidatesWithServedText(top);
  if (candidates.length < 2) return { status: 'ineligible' };
  let content: unknown;
  try {
    content = await model({ query: queryText, candidates });
  } catch {
    return { status: 'model-failed' };
  }
  const scores = parseSearchRerankLiveMissScores(content, candidates.length);
  if (!scores) return { status: 'malformed-output' };

  const scoredAt = now();
  const entry: SearchRerankLiveMissEntry = {
    queryKey,
    queryText,
    filters,
    scores: candidates.map((candidate, index) => ({
      entityId: candidate.entityId,
      score: scores[index],
    })),
    scoredAt,
    indexVersion: `async-${SEARCH_RERANK_LIVE_MISS_MODEL}-${utcDate(scoredAt)}`,
    source: mode === 'shadow' ? SEARCH_RERANK_SHADOW_SOURCE : SEARCH_RERANK_LIVE_MISS_SOURCE,
  };
  if (!write) return { status: 'scored', entry };

  const replaceable =
    mode === 'shadow'
      ? { queryKey, source: SEARCH_RERANK_SHADOW_SOURCE, indexVersion: NOT_SEEDED_INDEX_VERSION }
      : { queryKey, indexVersion: NOT_SEEDED_INDEX_VERSION };
  try {
    await SearchRerankCache.updateOne(replaceable, { $set: entry }, { upsert: true });
  } catch (error) {
    if (isDuplicateKeyError(error)) return { status: 'kept-existing', entry };
    throw error;
  }
  forgetSearchRerankCacheKey(queryKey);
  return { status: 'written', entry };
}
