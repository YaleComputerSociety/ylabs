import { describe, expect, it } from 'vitest';

import {
  isPostHogConfigured,
  isProductionWebRuntime,
  isProductAnalyticsAllowedForSession,
  posthogConnectOrigins,
} from '../posthogConfig';

const SYNTHETIC_KEY = 'phc_syntheticTestKey0000000000000000000000';

const production = (overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  NODE_ENV: 'production',
  SERVER_BASE_URL: 'https://yalelabs.io',
  MONGODBURL: 'mongodb+srv://cluster.example.test/Prod?retryWrites=true',
  MEILISEARCH_INDEX_PREFIX: 'prod',
  VITE_POSTHOG_KEY: SYNTHETIC_KEY,
  VITE_POSTHOG_HOST: 'https://us.i.posthog.com',
  ...overrides,
});

describe('PostHog server gate', () => {
  it('is on for a deployed non-Beta runtime with a project key and the US host', () => {
    expect(isPostHogConfigured(production())).toBe(true);
    expect(posthogConnectOrigins(production())).toEqual([
      'https://us.i.posthog.com',
      'https://us-assets.i.posthog.com',
    ]);
  });

  it('is off with no key', () => {
    expect(isPostHogConfigured(production({ VITE_POSTHOG_KEY: '' }))).toBe(false);
    expect(posthogConnectOrigins(production({ VITE_POSTHOG_KEY: undefined }))).toEqual([]);
  });

  it.each([
    ['a personal API key shape', 'phx_syntheticTestKey0000000000000000000000'],
    ['trailing directive text', `${SYNTHETIC_KEY}; script-src *`],
    ['a short value', 'phc_short'],
  ])('is off for %s', (_label, key) => {
    expect(isPostHogConfigured(production({ VITE_POSTHOG_KEY: key }))).toBe(false);
  });

  it.each([
    ['the EU host', 'https://eu.i.posthog.com'],
    ['a look-alike host', 'https://us.i.posthog.com.example.test'],
    ['plain http', 'http://us.i.posthog.com'],
    ['an explicit port', 'https://us.i.posthog.com:8443'],
    ['a path', 'https://us.i.posthog.com/e'],
    ['no host', ''],
  ])('is off for %s', (_label, host) => {
    expect(isPostHogConfigured(production({ VITE_POSTHOG_HOST: host }))).toBe(false);
  });

  it('is off in Beta, the way first-party analytics suppresses Beta', () => {
    expect(isPostHogConfigured(production({ SCRAPER_ENV: 'beta' }))).toBe(false);
    expect(posthogConnectOrigins(production({ SCRAPER_ENV: ' Beta ' }))).toEqual([]);
  });

  it.each([
    ['the Beta database', { MONGODBURL: 'mongodb+srv://cluster.example.test/Beta' }],
    ['the Development database', { MONGODBURL: 'mongodb+srv://cluster.example.test/Development' }],
    ['no database name', { MONGODBURL: 'mongodb+srv://cluster.example.test/' }],
    ['no database URL', { MONGODBURL: undefined }],
    ['the Beta search index', { MEILISEARCH_INDEX_PREFIX: 'beta' }],
    ['no search index prefix', { MEILISEARCH_INDEX_PREFIX: undefined }],
  ])('is off on %s, because only the Production deploy runs it', (_label, overrides) => {
    expect(isProductionWebRuntime(production(overrides))).toBe(false);
    expect(isPostHogConfigured(production(overrides))).toBe(false);
  });

  it.each([
    ['local development', { NODE_ENV: 'development', SERVER_BASE_URL: 'http://localhost:4000' }],
    ['CI', { NODE_ENV: 'ci' }],
    ['a test run', { NODE_ENV: 'test' }],
  ])('is off in %s even with a key', (_label, overrides) => {
    expect(isPostHogConfigured(production(overrides))).toBe(false);
  });

  it('allows a signed-in non-admin session only', () => {
    expect(isProductAnalyticsAllowedForSession({ isAdmin: false }, production())).toBe(true);
    expect(isProductAnalyticsAllowedForSession({ isAdmin: true }, production())).toBe(false);
    expect(isProductAnalyticsAllowedForSession(null, production())).toBe(false);
    expect(
      isProductAnalyticsAllowedForSession({ isAdmin: false }, production({ SCRAPER_ENV: 'beta' })),
    ).toBe(false);
  });
});
