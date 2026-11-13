import { SearchRerankCache } from '../models/searchRerankCache';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { storedSearchRerankTextHash } from './searchRerankCandidateText';
import { isSearchRerankLiveMissEnabled } from './searchRerankLiveMiss';

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

export const SEARCH_RERANK_STALE_WINDOW = 10;
export const SEARCH_RERANK_STALE_UNSCORED_ROWS = 3;

/**
 * Reads the hash the index document builder precomputed, so search compares it without
 * retrieving descriptions for every pool hit. A hit from an index not yet synced has none.
 */
export const searchRerankCandidateTextHash = (
  hit: Readonly<Record<string, unknown>>,
): string | null => storedSearchRerankTextHash(hit);

export interface SearchRerankCandidateFingerprint {
  entityId: string;
  textHash: string | null;
}

export const searchRerankCandidateFingerprints = (
  pool: ReadonlyArray<RerankCandidate & Record<string, unknown>>,
  limit: number,
): SearchRerankCandidateFingerprint[] =>
  pool.slice(0, Math.max(0, Math.floor(limit))).map((hit) => ({
    entityId: rerankCandidateId(hit),
    textHash: searchRerankCandidateTextHash(hit),
  }));

export type SearchRerankScoredTextHashes = ReadonlyMap<string, string | null>;

export const searchRerankScoredTextHashes = (entry: unknown): SearchRerankScoredTextHashes => {
  const scores = (entry as { scores?: unknown } | null)?.scores;
  const byId = new Map<string, string | null>();
  if (!Array.isArray(scores)) return byId;
  for (const row of scores) {
    const { entityId, textHash } = (row ?? {}) as { entityId?: unknown; textHash?: unknown };
    if (typeof entityId !== 'string') continue;
    byId.set(entityId, typeof textHash === 'string' && textHash !== '' ? textHash : null);
  }
  return byId;
};

/**
 * Judged against the fused order before any cached reorder, which is the order the job
 * re-scores; the reordered head would pull the entry's own scored rows up and hide a moved
 * candidate set. A score stored without a hash, or a hit the index has not hashed yet, never
 * counts as changed.
 */
export function searchRerankEntryIsStale(
  scored: SearchRerankScoredTextHashes,
  servedCandidates: readonly SearchRerankCandidateFingerprint[],
): boolean {
  let unscoredRows = 0;
  for (const candidate of servedCandidates.slice(0, SEARCH_RERANK_STALE_WINDOW)) {
    if (!scored.has(candidate.entityId)) {
      unscoredRows += 1;
      if (unscoredRows >= SEARCH_RERANK_STALE_UNSCORED_ROWS) return true;
      continue;
    }
    const storedHash = scored.get(candidate.entityId);
    if (storedHash && candidate.textHash && storedHash !== candidate.textHash) return true;
  }
  return false;
}

export const SEARCH_RERANK_SHADOW_SOURCE = 'shadow';
export const SEARCH_RERANK_LIVE_MISS_SOURCE = 'live-miss';
export const SEARCH_RERANK_SEEDED_INDEX_VERSION_PREFIX = 'full-';

export type SearchRerankEntryKind = 'absent' | 'seeded' | 'shadow' | 'served';

export interface SearchRerankCacheLookup {
  scores: SearchRerankScores | null;
  kind: SearchRerankEntryKind;
  scoredTextHashes: SearchRerankScoredTextHashes;
}

interface MemoEntry {
  expiresAt: number;
  lookup: SearchRerankCacheLookup;
}

const memo = new Map<string, MemoEntry>();

export const resetSearchRerankCacheMemo = (): void => memo.clear();

export const forgetSearchRerankCacheKey = (queryKey: string): void => {
  memo.delete(queryKey);
};

const remember = (queryKey: string, lookup: SearchRerankCacheLookup, now: number): void => {
  memo.delete(queryKey);
  if (memo.size >= SEARCH_RERANK_MEMO_MAX_ENTRIES) {
    const oldestKey = memo.keys().next().value;
    if (oldestKey !== undefined) memo.delete(oldestKey);
  }
  memo.set(queryKey, { expiresAt: now + SEARCH_RERANK_MEMO_TTL_MS, lookup });
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

export const searchRerankEntryKind = (entry: unknown): SearchRerankEntryKind => {
  if (!entry || typeof entry !== 'object') return 'absent';
  const { source, indexVersion } = entry as { source?: unknown; indexVersion?: unknown };
  if (
    typeof indexVersion === 'string' &&
    indexVersion.startsWith(SEARCH_RERANK_SEEDED_INDEX_VERSION_PREFIX)
  ) {
    return 'seeded';
  }
  return source === SEARCH_RERANK_SHADOW_SOURCE ? 'shadow' : 'served';
};

export const SEARCH_RERANK_CLOSE_MATCH_SCORE = 2;
// Measured on 36 seeded Production queries: it fired on 10, every one with 0-2 relevant rows in its top 10, and raised no false alarm (#6094).
export const SEARCH_FEW_CLOSE_MATCHES_MAX_COUNT = 3;

export interface SearchFewCloseMatches {
  closeMatchCount: number;
}

export function searchFewCloseMatches(
  entry: Pick<SearchRerankCacheLookup, 'kind' | 'scoredTextHashes'>,
  scoresById: SearchRerankScores,
  servedPool: ReadonlyArray<RerankCandidate & Record<string, unknown>>,
): SearchFewCloseMatches | null {
  if (entry.kind !== 'seeded') return null;
  if (
    searchRerankEntryIsStale(
      entry.scoredTextHashes,
      searchRerankCandidateFingerprints(servedPool, SEARCH_RERANK_STALE_WINDOW),
    )
  ) {
    return null;
  }
  const closeMatchIds = new Set(
    servedPool
      .map(rerankCandidateId)
      .filter((id) => (scoresById.get(id) ?? 0) >= SEARCH_RERANK_CLOSE_MATCH_SCORE),
  );
  const closeMatchCount = closeMatchIds.size;
  return closeMatchCount <= SEARCH_FEW_CLOSE_MATCHES_MAX_COUNT ? { closeMatchCount } : null;
}

const servesScores = (entry: unknown, kind: SearchRerankEntryKind): boolean => {
  if (kind === 'absent' || kind === 'shadow') return false;
  if (kind === 'seeded') return true;
  const { source } = entry as { source?: unknown };
  return source !== SEARCH_RERANK_LIVE_MISS_SOURCE || isSearchRerankLiveMissEnabled();
};

const lookupFromEntry = (entry: unknown): SearchRerankCacheLookup => {
  const kind = searchRerankEntryKind(entry);
  return {
    scores: servesScores(entry, kind) ? scoresFromEntry(entry) : null,
    kind,
    scoredTextHashes: searchRerankScoredTextHashes(entry),
  };
};

/**
 * Resolves to null for a failed read, which serves the search's own order. A shadow entry
 * is written by the live-miss job's shadow mode and never carries servable scores. An absent
 * entry is remembered for the TTL, so the pages of one search cost one read; a failed read
 * is not, so the next request tries again.
 */
export async function lookupSearchRerankCacheEntry(
  queryKey: string,
  now: () => number = Date.now,
): Promise<SearchRerankCacheLookup | null> {
  const remembered = memo.get(queryKey);
  if (remembered && remembered.expiresAt > now()) return remembered.lookup;
  try {
    const entry = await SearchRerankCache.findOne({ queryKey })
      .select('scores source indexVersion')
      .maxTimeMS(SEARCH_RERANK_LOOKUP_MAX_TIME_MS)
      .lean();
    const lookup = lookupFromEntry(entry);
    remember(queryKey, lookup, now());
    return lookup;
  } catch (error) {
    console.error('Search rerank cache read failed; serving fused order:', sanitizeLogValue(error));
    return null;
  }
}
