/**
 * OpenAI embedding generation for listing similarity search.
 */
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const EMBEDDING_CACHE_TTL_MS = 10 * 60 * 1000;
const EMBEDDING_CACHE_MAX_SIZE = 500;
const EMBEDDING_CACHE_SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const embeddingCache = new Map<string, { embedding: number[]; expiresAt: number }>();

// Periodically purge expired entries so the cache doesn't retain stale data indefinitely.
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of embeddingCache) {
    if (value.expiresAt <= now) {
      embeddingCache.delete(key);
    }
  }
}, EMBEDDING_CACHE_SWEEP_INTERVAL_MS).unref();

interface GenerateEmbeddingOptions {
  useCache?: boolean;
}

const normalizeEmbeddingText = (text: string): string =>
  text.trim().replace(/\s+/g, ' ').toLowerCase().substring(0, 8000);

const getCachedEmbedding = (key: string): number[] | null => {
  const cached = embeddingCache.get(key);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    embeddingCache.delete(key);
    return null;
  }

  // Re-insert to mark as most recently used.
  embeddingCache.delete(key);
  embeddingCache.set(key, cached);
  return cached.embedding;
};

const setCachedEmbedding = (key: string, embedding: number[]) => {
  // Evict the least recently used (oldest) entry when at capacity.
  if (embeddingCache.size >= EMBEDDING_CACHE_MAX_SIZE && !embeddingCache.has(key)) {
    const oldestKey = embeddingCache.keys().next().value;
    if (oldestKey !== undefined) {
      embeddingCache.delete(oldestKey);
    }
  }
  embeddingCache.set(key, {
    embedding,
    expiresAt: Date.now() + EMBEDDING_CACHE_TTL_MS,
  });
};

export async function generateEmbedding(
  text: string,
  options: GenerateEmbeddingOptions = {}
): Promise<number[]> {
  try {
    const normalizedText = normalizeEmbeddingText(text);

    if (options.useCache) {
      const cachedEmbedding = getCachedEmbedding(normalizedText);
      if (cachedEmbedding) {
        return cachedEmbedding;
      }
    }

    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: normalizedText,
      encoding_format: 'float',
    });

    const embedding = response.data[0].embedding;
    if (options.useCache) {
      setCachedEmbedding(normalizedText, embedding);
    }

    return embedding;
  } catch (error) {
    console.error('Failed to generate embedding:', error);
    throw new Error(`Embedding generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export function formatListingForEmbedding(title: string, description: string): string {
  return `${title}. ${description}`;
}

export async function generateListingEmbedding(
  title: string,
  description: string
): Promise<number[]> {
  const text = formatListingForEmbedding(title, description);
  return generateEmbedding(text);
}
