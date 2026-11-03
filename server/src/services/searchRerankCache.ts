import { SearchRerankCache } from '../models/searchRerankCache';
import { sanitizeLogValue } from '../utils/logSanitizer';

export const SEARCH_RERANK_WINDOW = 30;
export const SEARCH_RERANK_NEUTRAL_SCORE = 1.5;
export const SEARCH_RERANK_MEMO_TTL_MS = 5 * 60 * 1000;
const SEARCH_RERANK_MEMO_MAX_ENTRIES = 1000;
const SEARCH_RERANK_LOOKUP_MAX_TIME_MS = 500;

export type SearchRerankScores = ReadonlyMap<string, number>;

export interface ApplyCachedRerankOptions {
  window: number;
  neutral: number;
}

export interface RerankCandidate {
  id?: unknown;
  _id?: unknown;
}

export const isSearchRerankCacheEnabled = (env: NodeJS.ProcessEnv = process.env): boolean =>
  env.SEARCH_RERANK_CACHE_ENABLED === 'true';

const rerankCandidateId = (candidate: RerankCandidate): string =>
  String(candidate.id ?? candidate._id);

export function applyCachedRerank<T extends RerankCandidate>(
  candidates: readonly T[],
  scoresById: SearchRerankScores,
  options: ApplyCachedRerankOptions = {
    window: SEARCH_RERANK_WINDOW,
    neutral: SEARCH_RERANK_NEUTRAL_SCORE,
  },
): T[] {
  const windowSize = Math.max(0, Math.floor(options.window));
  const scoreOf = (candidate: T) => scoresById.get(rerankCandidateId(candidate)) ?? options.neutral;
  const reorderedHead = candidates
    .slice(0, windowSize)
    .map((candidate, incomingRank) => ({ candidate, incomingRank, score: scoreOf(candidate) }))
    .sort((left, right) => right.score - left.score || left.incomingRank - right.incomingRank)
    .map(({ candidate }) => candidate);
  return [...reorderedHead, ...candidates.slice(windowSize)];
}

interface MemoEntry {
  expiresAt: number;
  scores: SearchRerankScores | null;
}

const memo = new Map<string, MemoEntry>();

export const resetSearchRerankCacheMemo = (): void => memo.clear();

const remember = (queryKey: string, scores: SearchRerankScores | null, now: number): void => {
  memo.delete(queryKey);
  if (memo.size >= SEARCH_RERANK_MEMO_MAX_ENTRIES) {
    const oldestKey = memo.keys().next().value;
    if (oldestKey !== undefined) memo.delete(oldestKey);
  }
  memo.set(queryKey, { expiresAt: now + SEARCH_RERANK_MEMO_TTL_MS, scores });
};

const scoresFromEntry = (entry: unknown): SearchRerankScores | null => {
  const scores = (entry as { scores?: unknown } | null)?.scores;
  if (!Array.isArray(scores)) return null;
  const byId = new Map<string, number>();
  for (const row of scores) {
    const { entityId, score } = (row ?? {}) as { entityId?: unknown; score?: unknown };
    if (typeof entityId !== 'string' || typeof score !== 'number' || !Number.isFinite(score)) {
      continue;
    }
    byId.set(entityId, score);
  }
  return byId.size > 0 ? byId : null;
};

/**
 * Resolves to null for a query with no entry and for a failed read, both of which serve the
 * search's own order. An absent entry is remembered for the TTL, so the pages of one search
 * cost one read; a failed read is not, so the next request tries again.
 */
export async function cachedSearchRerankScores(
  queryKey: string,
  now: () => number = Date.now,
): Promise<SearchRerankScores | null> {
  const remembered = memo.get(queryKey);
  if (remembered && remembered.expiresAt > now()) return remembered.scores;
  try {
    const entry = await SearchRerankCache.findOne({ queryKey })
      .select('scores')
      .maxTimeMS(SEARCH_RERANK_LOOKUP_MAX_TIME_MS)
      .lean();
    const scores = scoresFromEntry(entry);
    remember(queryKey, scores, now());
    return scores;
  } catch (error) {
    console.error('Search rerank cache read failed; serving fused order:', sanitizeLogValue(error));
    return null;
  }
}
