import http from 'node:http';
import { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SearchIndexWritesDeferredError, searchIndexWritesDeferred } from '../searchIndexWrites';

type MeiliClientModule = typeof import('../meiliClient');

const startRecordingServer = async () => {
  const requests: string[] = [];
  const server = http.createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ taskUid: 1, status: 'enqueued' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    host: `http://127.0.0.1:${port}`,
    requests,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('deferred search index writes', () => {
  it('reads the deferral only from the exact value', () => {
    expect(searchIndexWritesDeferred({ SEARCH_INDEX_WRITES: 'deferred' })).toBe(true);
    expect(searchIndexWritesDeferred({ SEARCH_INDEX_WRITES: ' deferred ' })).toBe(true);
    expect(searchIndexWritesDeferred({})).toBe(false);
    expect(searchIndexWritesDeferred({ SEARCH_INDEX_WRITES: 'off' })).toBe(false);
  });

  it('opens no connection to a reachable index while writes are deferred', async () => {
    const recorder = await startRecordingServer();
    try {
      vi.stubEnv('MEILISEARCH_HOST', recorder.host);
      vi.stubEnv('SEARCH_INDEX_WRITES', 'deferred');
      vi.resetModules();
      const { getMeiliIndex, getMeiliSearchIndex } =
        await vi.importActual<MeiliClientModule>('../meiliClient');

      await expect(getMeiliIndex('researchentities')).rejects.toMatchObject({
        name: new SearchIndexWritesDeferredError().name,
      });
      await expect(getMeiliSearchIndex('researchentities')).rejects.toMatchObject({
        name: new SearchIndexWritesDeferredError().name,
      });
      expect(recorder.requests).toEqual([]);

      vi.stubEnv('SEARCH_INDEX_WRITES', '');
      await (await getMeiliIndex('researchentities')).addDocuments([{ id: 'synthetic' }]);
      expect(recorder.requests.length).toBeGreaterThan(0);
    } finally {
      await recorder.close();
    }
  });
});
