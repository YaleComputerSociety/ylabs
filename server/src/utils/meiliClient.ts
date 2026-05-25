import dotenv from 'dotenv';
dotenv.config();

// Default to a common local meilisearch host if not provided
const MEILISEARCH_HOST = process.env.MEILISEARCH_HOST || 'http://localhost:7700';
const MEILISEARCH_API_KEY = process.env.MEILISEARCH_API_KEY;
const MEILISEARCH_INDEX_PREFIX = process.env.MEILISEARCH_INDEX_PREFIX || '';

let meiliClientPromise: Promise<any> | null = null;

export const getMeiliClient = async () => {
  if (!meiliClientPromise) {
    meiliClientPromise = (async () => {
      const { Meilisearch } = await import('meilisearch');
      return new Meilisearch({
        host: MEILISEARCH_HOST,
        apiKey: MEILISEARCH_API_KEY,
      });
    })();
  }

  return meiliClientPromise;
};

export const resolveIndexName = (name: string): string => {
  return MEILISEARCH_INDEX_PREFIX ? `${MEILISEARCH_INDEX_PREFIX}_${name}` : name;
};

export const getMeiliIndex = async (name: string) => {
  const client = await getMeiliClient();
  return client.index(resolveIndexName(name));
};
