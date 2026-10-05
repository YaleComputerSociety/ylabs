import http from 'node:http';
import { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type MeiliClientModule = typeof import('../meiliClient');

const loadActualMeiliClient = async (): Promise<MeiliClientModule> => {
  vi.resetModules();
  return vi.importActual<MeiliClientModule>('../meiliClient');
};

const DEPLOYED_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  SERVER_BASE_URL: 'https://yalelabs.io',
  MEILISEARCH_HOST: 'http://meili-private:7700',
  MEILISEARCH_INDEX_PREFIX: 'prod',
};

const LOCAL_DEVELOPMENT_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: 'development',
  SERVER_BASE_URL: 'http://localhost:4000',
};

const startUnresponsiveServer = async () => {
  const heldResponses: http.ServerResponse[] = [];
  const server = http.createServer((_request, response) => {
    heldResponses.push(response);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    host: `http://127.0.0.1:${port}`,
    close: async () => {
      for (const response of heldResponses) response.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
};

describe('meiliClient request timeout', () => {
  const originalHost = process.env.MEILISEARCH_HOST;

  afterEach(() => {
    vi.useRealTimers();
    if (originalHost === undefined) delete process.env.MEILISEARCH_HOST;
    else process.env.MEILISEARCH_HOST = originalHost;
  });

  it('bounds every request with a timeout of a few seconds', async () => {
    const { MEILISEARCH_REQUEST_TIMEOUT_MS, resolveMeiliConnectionConfig } =
      await loadActualMeiliClient();

    expect(MEILISEARCH_REQUEST_TIMEOUT_MS).toBeGreaterThanOrEqual(1_000);
    expect(MEILISEARCH_REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(10_000);
    expect(resolveMeiliConnectionConfig(LOCAL_DEVELOPMENT_ENV).requestTimeoutMs).toBe(
      MEILISEARCH_REQUEST_TIMEOUT_MS,
    );
  });

  it('gives up on a hung Meilisearch instead of holding the request open', async () => {
    const hung = await startUnresponsiveServer();
    try {
      process.env.MEILISEARCH_HOST = hung.host;
      const { getMeiliClient, MEILISEARCH_REQUEST_TIMEOUT_MS } = await loadActualMeiliClient();
      const client = await getMeiliClient();

      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const outcome = client
        .index('researchentities')
        .search('neuroscience')
        .then(
          () => 'resolved',
          (error: Error) => error,
        );
      await vi.advanceTimersByTimeAsync(MEILISEARCH_REQUEST_TIMEOUT_MS + 1);

      const error = await outcome;
      expect(error).toBeInstanceOf(Error);
      expect(String((error as Error).cause ?? error)).toMatch(/timed out/);
    } finally {
      vi.useRealTimers();
      await hung.close();
    }
  });
});

describe('meiliClient connection config', () => {
  let meiliClient: MeiliClientModule;

  beforeEach(async () => {
    meiliClient = await loadActualMeiliClient();
  });

  it('keeps the local development defaults', () => {
    const config = meiliClient.resolveMeiliConnectionConfig(LOCAL_DEVELOPMENT_ENV);

    expect(config.host).toBe('http://localhost:7700');
    expect(config.indexPrefix).toBe('');
  });

  it('keeps the defaults under the test runner', () => {
    const config = meiliClient.resolveMeiliConnectionConfig({ NODE_ENV: 'test' });

    expect(config.host).toBe('http://localhost:7700');
    expect(config.indexPrefix).toBe('');
  });

  it('keeps the defaults for a local script run that sets no NODE_ENV', () => {
    const config = meiliClient.resolveMeiliConnectionConfig({});

    expect(config.host).toBe('http://localhost:7700');
    expect(config.indexPrefix).toBe('');
  });

  it('reads the configured host and prefix', () => {
    const config = meiliClient.resolveMeiliConnectionConfig(DEPLOYED_ENV);

    expect(config.host).toBe('http://meili-private:7700');
    expect(config.indexPrefix).toBe('prod');
  });

  it('accepts a deployed runtime that names its host and prefix', () => {
    expect(() => meiliClient.assertDeployedMeiliConnectionConfig(DEPLOYED_ENV)).not.toThrow();
  });

  it.each(['MEILISEARCH_HOST', 'MEILISEARCH_INDEX_PREFIX'])(
    'fails fast when %s is unset in a deployed runtime',
    (name) => {
      const env = { ...DEPLOYED_ENV };
      delete env[name];

      expect(() => meiliClient.assertDeployedMeiliConnectionConfig(env)).toThrow(
        new RegExp(`${name} must be set in deployed runtimes`),
      );
    },
  );

  it.each(['MEILISEARCH_HOST', 'MEILISEARCH_INDEX_PREFIX'])(
    'treats a blank %s as unset in a deployed runtime',
    (name) => {
      expect(() =>
        meiliClient.assertDeployedMeiliConnectionConfig({ ...DEPLOYED_ENV, [name]: '   ' }),
      ).toThrow(new RegExp(`${name} must be set in deployed runtimes`));
    },
  );

  it('fails fast for a remote development-labelled runtime too', () => {
    expect(() =>
      meiliClient.assertDeployedMeiliConnectionConfig({
        NODE_ENV: 'development',
        SERVER_BASE_URL: 'https://yalelabs.io',
      }),
    ).toThrow(/MEILISEARCH_HOST must be set in deployed runtimes/);
  });

  it('asks nothing of local development or the test runner', () => {
    expect(() =>
      meiliClient.assertDeployedMeiliConnectionConfig(LOCAL_DEVELOPMENT_ENV),
    ).not.toThrow();
    expect(() =>
      meiliClient.assertDeployedMeiliConnectionConfig({ NODE_ENV: 'test' }),
    ).not.toThrow();
  });

  it('prefixes index names from the environment it resolves', () => {
    expect(meiliClient.resolveIndexName('researchentities', DEPLOYED_ENV)).toBe(
      'prod_researchentities',
    );
    expect(meiliClient.resolveIndexName('researchentities', LOCAL_DEVELOPMENT_ENV)).toBe(
      'researchentities',
    );
  });
});

const startRecordingServer = async () => {
  const authorizationHeaders: string[] = [];
  const server = http.createServer((request, response) => {
    authorizationHeaders.push(String(request.headers.authorization ?? ''));
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ hits: [], status: 'available' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    host: `http://127.0.0.1:${port}`,
    authorizationHeaders,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
};

describe('meiliClient scoped keys', () => {
  const KEY_VARIABLES = [
    'MEILISEARCH_HOST',
    'MEILISEARCH_API_KEY',
    'MEILISEARCH_SEARCH_API_KEY',
    'MEILISEARCH_WRITE_API_KEY',
    'NODE_ENV',
    'SERVER_BASE_URL',
  ] as const;
  const originalValues = Object.fromEntries(KEY_VARIABLES.map((name) => [name, process.env[name]]));

  afterEach(() => {
    vi.restoreAllMocks();
    for (const name of KEY_VARIABLES) {
      if (originalValues[name] === undefined) delete process.env[name];
      else process.env[name] = originalValues[name];
    }
  });

  const setEnv = (values: Partial<Record<(typeof KEY_VARIABLES)[number], string>>) => {
    for (const name of KEY_VARIABLES) delete process.env[name];
    Object.assign(process.env, values);
  };

  it('resolves the search key for the search role and the write key for the write role', async () => {
    const { resolveMeiliConnectionConfig } = await loadActualMeiliClient();
    const env = {
      ...DEPLOYED_ENV,
      MEILISEARCH_API_KEY: 'legacy-admin-key',
      MEILISEARCH_SEARCH_API_KEY: 'scoped-search-key',
      MEILISEARCH_WRITE_API_KEY: 'scoped-write-key',
    };

    expect(resolveMeiliConnectionConfig(env, 'search')).toMatchObject({
      apiKey: 'scoped-search-key',
      apiKeySource: 'scoped',
    });
    expect(resolveMeiliConnectionConfig(env, 'write')).toMatchObject({
      apiKey: 'scoped-write-key',
      apiKeySource: 'scoped',
    });
    expect(resolveMeiliConnectionConfig(env)).toMatchObject({ apiKey: 'scoped-write-key' });
  });

  it('sends the search key on search requests and the write key on index writes', async () => {
    const recorder = await startRecordingServer();
    try {
      setEnv({
        MEILISEARCH_HOST: recorder.host,
        MEILISEARCH_API_KEY: 'legacy-admin-key',
        MEILISEARCH_SEARCH_API_KEY: 'scoped-search-key',
        MEILISEARCH_WRITE_API_KEY: 'scoped-write-key',
      });
      const { getMeiliSearchIndex, getMeiliIndex } = await loadActualMeiliClient();

      await (await getMeiliSearchIndex('researchentities')).search('neuroscience');
      expect(recorder.authorizationHeaders.at(-1)).toBe('Bearer scoped-search-key');

      await (await getMeiliIndex('researchentities')).addDocuments([{ id: 'synthetic' }]);
      expect(recorder.authorizationHeaders.at(-1)).toBe('Bearer scoped-write-key');
      expect(recorder.authorizationHeaders).not.toContain('Bearer legacy-admin-key');
    } finally {
      await recorder.close();
    }
  });

  it('falls back to the legacy key for both roles and warns once per role when deployed', async () => {
    const recorder = await startRecordingServer();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      setEnv({
        NODE_ENV: 'production',
        SERVER_BASE_URL: 'https://yalelabs.io',
        MEILISEARCH_HOST: recorder.host,
        MEILISEARCH_API_KEY: 'legacy-admin-key',
      });
      const { getMeiliSearchIndex, getMeiliIndex, legacyMeiliKeyFallbackWarning } =
        await loadActualMeiliClient();

      await (await getMeiliSearchIndex('researchentities')).search('neuroscience');
      await (await getMeiliSearchIndex('researchentities')).search('chemistry');
      await (await getMeiliIndex('researchentities')).addDocuments([{ id: 'synthetic' }]);

      expect(recorder.authorizationHeaders).toEqual([
        'Bearer legacy-admin-key',
        'Bearer legacy-admin-key',
        'Bearer legacy-admin-key',
      ]);
      const warnings = warn.mock.calls.map(([message]) => String(message));
      expect(warnings).toEqual([
        legacyMeiliKeyFallbackWarning('search'),
        legacyMeiliKeyFallbackWarning('write'),
      ]);
      expect(warnings.join('\n')).toMatch(/MEILISEARCH_SEARCH_API_KEY is not set/);
      expect(warnings.join('\n')).not.toContain('legacy-admin-key');
    } finally {
      await recorder.close();
    }
  });

  it('never hands the search role the write key', async () => {
    const { resolveMeiliConnectionConfig } = await loadActualMeiliClient();

    expect(
      resolveMeiliConnectionConfig({ MEILISEARCH_WRITE_API_KEY: 'scoped-write-key' }, 'search'),
    ).toMatchObject({ apiKey: undefined, apiKeySource: 'none' });
  });
});
