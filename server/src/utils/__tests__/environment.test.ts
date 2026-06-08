import { describe, expect, it } from 'vitest';
import {
  allowsNonProductionSecurityBypass,
  isCI,
  isDevelopment,
  isLocalDevelopmentRuntime,
  isLocalHostValue,
  isProduction,
  isTest,
  nodeEnvValue,
  requiresSecureSessionCookie,
} from '../environment';

describe('environment utilities', () => {
  it('normalizes NODE_ENV checks', () => {
    expect(nodeEnvValue({ NODE_ENV: ' Production ' })).toBe('production');
    expect(isProduction({ NODE_ENV: 'production' })).toBe(true);
    expect(isProduction({ NODE_ENV: 'prod' })).toBe(true);
    expect(isDevelopment({ NODE_ENV: 'dev' })).toBe(true);
    expect(isDevelopment({ NODE_ENV: 'development' })).toBe(true);
    expect(isTest({ NODE_ENV: 'test' })).toBe(true);
    expect(isCI({ NODE_ENV: 'ci' })).toBe(true);
  });

  it('allows development bypasses only for local development runtimes, CI, or test', () => {
    expect(isLocalHostValue('http://localhost:4000')).toBe(true);
    expect(isLocalHostValue('https://preview.yalelabs.io')).toBe(false);
    expect(
      isLocalDevelopmentRuntime({
        NODE_ENV: 'development',
        SERVER_BASE_URL: 'http://localhost:4000',
      }),
    ).toBe(true);
    expect(
      isLocalDevelopmentRuntime({
        NODE_ENV: 'dev',
        SERVER_BASE_URL: 'http://127.0.0.1:4000',
      }),
    ).toBe(true);
    expect(
      isLocalDevelopmentRuntime({
        NODE_ENV: 'development',
        SERVER_BASE_URL: 'https://yalelabs.io',
      }),
    ).toBe(false);
    expect(
      allowsNonProductionSecurityBypass({
        NODE_ENV: 'development',
        SERVER_BASE_URL: 'https://yalelabs.io',
      }),
    ).toBe(false);
    expect(allowsNonProductionSecurityBypass({ NODE_ENV: 'test' })).toBe(true);
    expect(allowsNonProductionSecurityBypass({ NODE_ENV: 'ci' })).toBe(true);
  });

  it('requires secure session cookies outside CI, test, and local development runtimes', () => {
    expect(requiresSecureSessionCookie({ NODE_ENV: 'production' })).toBe(true);
    expect(
      requiresSecureSessionCookie({
        NODE_ENV: 'development',
        SERVER_BASE_URL: 'https://yalelabs.io',
      }),
    ).toBe(true);
    expect(
      requiresSecureSessionCookie({
        NODE_ENV: 'development',
        SERVER_BASE_URL: 'http://localhost:4000',
      }),
    ).toBe(false);
    expect(requiresSecureSessionCookie({ NODE_ENV: 'test' })).toBe(false);
  });
});
