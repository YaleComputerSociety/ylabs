import { afterEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';

vi.unmock('../utils/meiliClient');

const ORIGINAL_ENV = { ...process.env };
const STRONG_SESSION_SECRET = 'R8h!vK2p#Q7zLm4$T9nWx6%Yc3@F5sJ0';

const DEPLOYED_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  SERVER_BASE_URL: 'https://yalelabs.io',
  SSOBASEURL: 'https://secure.its.yale.edu/cas',
  SESSION_SECRET: STRONG_SESSION_SECRET,
  TRUSTED_PROXY_CIDRS: '10.0.0.0/8',
  MEILISEARCH_HOST: 'http://meili-private:7700',
  MEILISEARCH_INDEX_PREFIX: 'prod',
};

describe('app Meilisearch runtime configuration', () => {
  afterEach(() => {
    vi.resetModules();
    mongoose.deleteModel(/.+/);
    process.env = { ...ORIGINAL_ENV };
  });

  it.each(['MEILISEARCH_HOST', 'MEILISEARCH_INDEX_PREFIX'])(
    'refuses to start a deployed runtime without %s',
    async (name) => {
      process.env = { ...ORIGINAL_ENV, ...DEPLOYED_ENV };
      delete process.env[name];

      await expect(import('../app')).rejects.toThrow(
        new RegExp(`${name} must be set in deployed runtimes`),
      );
    },
  );

  it('starts a deployed runtime that names its Meilisearch host and prefix', async () => {
    process.env = { ...ORIGINAL_ENV, ...DEPLOYED_ENV };

    await expect(import('../app')).resolves.toBeTruthy();
  });

  it('keeps local development startable on the local defaults', async () => {
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'development',
      SERVER_BASE_URL: 'http://localhost:4000',
      SSOBASEURL: 'https://secure.its.yale.edu/cas',
    };
    delete process.env.MEILISEARCH_HOST;
    delete process.env.MEILISEARCH_INDEX_PREFIX;

    await expect(import('../app')).resolves.toBeTruthy();
  });
});
