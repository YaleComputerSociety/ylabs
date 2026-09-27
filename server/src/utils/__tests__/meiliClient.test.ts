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
