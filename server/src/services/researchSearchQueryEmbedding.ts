import axios from 'axios';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { usableOpenAiApiKey } from '../utils/openAiApiKey';
import { RESEARCH_ENTITY_SEARCH_EMBEDDER_MODEL } from './researchEntitySearchIndexService';
import {
  recordResearchSearchQueryEmbeddingFailure,
  recordResearchSearchQueryEmbeddingSuccess,
  reserveResearchSearchQueryEmbedding,
} from './researchSearchQueryEmbeddingBudget';

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

const isUpstreamRejection = (error: unknown): boolean => {
  const status = (error as { response?: { status?: unknown } } | undefined)?.response?.status;
  return status === 429;
};

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

export interface ResearchSearchQueryVectorOutcome {
  /** The vector to hand Meilisearch, or `null` when one could not be produced. */
  vector: number[] | null;
  /**
   * False when the budget or the breaker refused this call, which obliges the
   * caller to drop `hybrid` as well as `vector`. A `hybrid` block with no vector
   * makes Meilisearch embed the query through the same paid account, so omitting
   * only the vector would move the call rather than decline it.
   */
  semanticLegAffordable: boolean;
}

const affordable = (vector: number[] | null): ResearchSearchQueryVectorOutcome => ({
  vector,
  semanticLegAffordable: true,
});

/**
 * Returns the query vector to hand Meilisearch for a hybrid search.
 *
 * A `null` vector with `semanticLegAffordable: true` is not an error path: the
 * caller omits `vector`, Meilisearch embeds the query itself, and behaviour is
 * unchanged apart from the latency this exists to remove.
 *
 * `clientKey` is the client bucket the route derives, used only to meter spend.
 *
 * The cache is keyed on the exact text sent upstream, because that is also the text
 * the search sends Meilisearch as `q` and rank equivalence with Meilisearch's own
 * embedder holds only for that text.
 */
export const getResearchSearchQueryVector = async (
  queryText: string,
  clientKey?: string,
): Promise<ResearchSearchQueryVectorOutcome> => {
  const key = queryText;
  if (key.trim() === '') return affordable(null);

  const cached = cachedQueryVectors.get(key);
  if (cached) {
    rememberQueryVector(key, cached);
    return affordable(cached);
  }

  // Joining a call already in flight costs nothing upstream, so it is not metered.
  const inFlight = inFlightQueryVectors.get(key);
  if (inFlight) return affordable(await inFlight);

  const decision = reserveResearchSearchQueryEmbedding(clientKey);
  if (decision !== 'allowed') return { vector: null, semanticLegAffordable: false };

  const apiKey = usableOpenAiApiKey();
  if (!apiKey) return affordable(null);

  const pending = (async () => {
    try {
      const vector = await requestQueryVector(queryText, apiKey);
      if (!vector) {
        recordResearchSearchQueryEmbeddingFailure('error');
        return null;
      }
      rememberQueryVector(key, vector);
      recordResearchSearchQueryEmbeddingSuccess();
      return vector;
    } catch (error) {
      recordResearchSearchQueryEmbeddingFailure(
        isUpstreamRejection(error) ? 'upstream-rejected' : 'error',
      );
      console.error('Research search query embedding failed:', sanitizeLogValue(error));
      return null;
    } finally {
      inFlightQueryVectors.delete(key);
    }
  })();
  inFlightQueryVectors.set(key, pending);
  return affordable(await pending);
};
