import axios from 'axios';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { RESEARCH_ENTITY_SEARCH_EMBEDDER_MODEL } from './researchEntitySearchIndexService';

/**
 * The query vector for one student search, embedded once per request and cached for
 * the life of the process.
 *
 * Meilisearch embeds `q` itself for every search that carries `hybrid`, and 1.13 has
 * no query-embedding cache, so each such search is one synchronous OpenAI round trip.
 * A single request issues more than one: measured on the real service call, two for a
 * bare query (the page query and the companion exhaustive count) and three when two
 * facets are actively filtered, because each of those needs its own disjunctive facet
 * distribution. Every one of them embeds the same string (#3149).
 *
 * Supplying `vector` makes Meilisearch skip its embedder, so embedding here once and
 * passing the result to every hybrid call in the request collapses those round trips
 * to one on a cold query and none on a repeat.
 *
 * It fails OPEN, returning null, and that is the whole safety argument: a null sends
 * the caller back to letting Meilisearch embed, which is exactly today's behaviour. So
 * a missing key, a timeout, or a malformed response costs the latency this exists to
 * save and never costs a result.
 */
const EMBEDDING_ENDPOINT = 'https://api.openai.com/v1/embeddings';
const EMBEDDING_TIMEOUT_MS = 8000;

/**
 * Bounded because the key is student-supplied query text, so an unbounded map is a
 * memory leak an outsider controls. Eviction is insertion-ordered rather than
 * least-recently-used: the cache exists to collapse the two-to-four calls inside ONE
 * request, which a single entry already does, and cross-request reuse is a bonus.
 */
const MAX_CACHED_QUERIES = 2000;
const cache = new Map<string, number[]>();

const remember = (key: string, vector: number[]): number[] => {
  if (cache.size >= MAX_CACHED_QUERIES) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, vector);
  return vector;
};

const isVector = (value: unknown): value is number[] =>
  Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === 'number');

export const searchQueryEmbeddingCacheSize = (): number => cache.size;

export const clearSearchQueryEmbeddingCache = (): void => {
  cache.clear();
};

export async function embedSearchQuery(queryText: unknown): Promise<number[] | null> {
  const text = typeof queryText === 'string' ? queryText.trim() : '';
  if (!text) return null;

  const cached = cache.get(text);
  if (cached) return cached;

  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) return null;

  try {
    const response = await axios.post(
      EMBEDDING_ENDPOINT,
      { model: RESEARCH_ENTITY_SEARCH_EMBEDDER_MODEL, input: text },
      {
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        timeout: EMBEDDING_TIMEOUT_MS,
      },
    );
    const vector = (response.data as { data?: Array<{ embedding?: unknown }> })?.data?.[0]
      ?.embedding;
    return isVector(vector) ? remember(text, vector) : null;
  } catch (error) {
    // The query text is deliberately not logged: it is student-supplied and a search
    // query is a behavioural record of a person.
    console.error('Search query embedding failed, falling back to Meilisearch:', {
      message: sanitizeLogValue(error instanceof Error ? error.message : String(error)),
    });
    return null;
  }
}
