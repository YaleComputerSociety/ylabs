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

export const meiliTaskUidFromResponse = (response: unknown): number | undefined => {
  if (!response || typeof response !== 'object') return undefined;
  const record = response as Record<string, unknown>;
  const uid = record.taskUid ?? record.uid;
  return typeof uid === 'number' && Number.isFinite(uid) ? uid : undefined;
};

export const waitForMeiliTask = async (taskUid: number): Promise<unknown> => {
  const client = await getMeiliClient();
  const result = await client.tasks.waitForTask(taskUid, {
    timeout: Number(process.env.MEILI_TASK_TIMEOUT_MS || 15 * 60 * 1000),
    interval: Number(process.env.MEILI_TASK_POLL_INTERVAL_MS || 500),
  });
  if (result?.status === 'failed') {
    throw new Error(result.error?.message || `Meilisearch task ${taskUid} failed`);
  }
  return result;
};

export const waitForMeiliTaskResponse = async (response: unknown): Promise<void> => {
  const taskUid = meiliTaskUidFromResponse(response);
  if (taskUid !== undefined) {
    await waitForMeiliTask(taskUid);
  }
};

const isMissingIndexError = (error: unknown): boolean => {
  const maybeError = error as {
    code?: string;
    message?: string;
    cause?: { code?: string; message?: string };
  };
  return (
    maybeError?.code === 'index_not_found' ||
    maybeError?.cause?.code === 'index_not_found' ||
    /index .*not found/i.test(maybeError?.message || '') ||
    /index .*not found/i.test(maybeError?.cause?.message || '')
  );
};

export const createMeiliIndex = async (indexName: string, primaryKey: string) => {
  const client = await getMeiliClient();
  await waitForMeiliTaskResponse(await client.createIndex(indexName, { primaryKey }));
  return client.index(indexName);
};

export const ensureMeiliIndex = async (name: string, primaryKey: string) => {
  const client = await getMeiliClient();
  const resolvedIndexName = resolveIndexName(name);
  try {
    await client.getRawIndex(resolvedIndexName);
  } catch (error) {
    if (!isMissingIndexError(error)) throw error;
    await waitForMeiliTaskResponse(
      await client.createIndex(resolvedIndexName, { primaryKey }),
    );
  }
  return client.index(resolvedIndexName);
};

export const swapMeiliIndexes = async (
  sourceIndexName: string,
  targetIndexName: string,
): Promise<void> => {
  const client = await getMeiliClient();
  await waitForMeiliTaskResponse(
    await client.swapIndexes([
      {
        indexes: [sourceIndexName, targetIndexName],
        rename: false,
      },
    ]),
  );
};

export const deleteMeiliIndex = async (indexName: string): Promise<void> => {
  const client = await getMeiliClient();
  try {
    await waitForMeiliTaskResponse(await client.deleteIndex(indexName));
  } catch (error) {
    if (!isMissingIndexError(error)) throw error;
  }
};
