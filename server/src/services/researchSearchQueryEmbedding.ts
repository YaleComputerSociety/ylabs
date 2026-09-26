import axios from 'axios';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { RESEARCH_ENTITY_SEARCH_EMBEDDER_MODEL } from './researchEntitySearchIndexService';

// Meilisearch 1.13 has no query-embedding cache, so every hybrid search it runs
// is one synchronous OpenAI round trip. A single student search issues two to
// four hybrid queries over the same query text (the page query, the companion
// exhaustive threshold-aware count, and one disjunctive facet query per active
// filter), so the same string was embedded two to four times per request and the
// embedding dominated the latency: ~200-300ms of waiting against ~40ms of actual
// search. Embedding here and passing the vector to Meilisearch makes it skip its
// own embedder, so a request pays at most one round trip, and a repeat query
// pays none. Verified rank-equivalent against Meilisearch's own embedding on the
// Development index: identical totalHits on 6 of 6 sampled queries and identical
// top-24 sets, with the only order divergence past rank 60. See #3149.
const OPENAI_EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings';
const EMBEDDING_REQUEST_TIMEOUT_MS = 10_000;
// A 1536-float vector is ~12KB in V8, so this bounds the cache near 6MB while
// covering far more distinct queries than a single browsing session produces.
const MAX_CACHED_QUERY_VECTORS = 500;

const cachedQueryVectors = new Map<string, number[]>();
const inFlightQueryVectors = new Map<string, Promise<number[] | null>>();

export const researchSearchQueryEmbeddingCacheSize = (): number => cachedQueryVectors.size;

export const clearResearchSearchQueryEmbeddingCache = (): void => {
  cachedQueryVectors.clear();
  inFlightQueryVectors.clear();
};

const rememberQueryVector = (key: string, vector: number[]): void => {
  if (cachedQueryVectors.has(key)) cachedQueryVectors.delete(key);
  cachedQueryVectors.set(key, vector);
  while (cachedQueryVectors.size > MAX_CACHED_QUERY_VECTORS) {
    const oldest = cachedQueryVectors.keys().next();
    if (oldest.done) break;
    cachedQueryVectors.delete(oldest.value);
  }
};

const isVector = (value: unknown): value is number[] =>
  Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === 'number');

const requestQueryVector = async (queryText: string, apiKey: string): Promise<number[] | null> => {
  const response = await axios.post(
    OPENAI_EMBEDDINGS_URL,
    { model: RESEARCH_ENTITY_SEARCH_EMBEDDER_MODEL, input: queryText },
    {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: EMBEDDING_REQUEST_TIMEOUT_MS,
    },
  );
  const vector = response.data?.data?.[0]?.embedding;
  return isVector(vector) ? vector : null;
};

/**
 * Returns the query vector to hand Meilisearch for a hybrid search, or `null`
 * when one cannot be produced. `null` is not an error path: the caller omits
 * `vector`, Meilisearch embeds the query itself, and behaviour is unchanged
 * apart from the latency this exists to remove.
 */
export const getResearchSearchQueryVector = async (queryText: string): Promise<number[] | null> => {
  const key = queryText;
  if (!key) return null;

  const cached = cachedQueryVectors.get(key);
  if (cached) {
    rememberQueryVector(key, cached);
    return cached;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const inFlight = inFlightQueryVectors.get(key);
  if (inFlight) return inFlight;

  const pending = (async () => {
    try {
      const vector = await requestQueryVector(key, apiKey);
      if (vector) rememberQueryVector(key, vector);
      return vector;
    } catch (error) {
      console.error('Research search query embedding failed:', sanitizeLogValue(error));
      return null;
    } finally {
      inFlightQueryVectors.delete(key);
    }
  })();
  inFlightQueryVectors.set(key, pending);
  return pending;
};
