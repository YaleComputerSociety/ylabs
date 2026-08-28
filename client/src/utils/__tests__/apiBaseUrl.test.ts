import { describe, expect, it } from 'vitest';

import { isProductionWebHost, normalizeBackendOrigin } from '../apiBaseUrl';

describe('apiBaseUrl safety helpers', () => {
  it('detects only the canonical production web hosts', () => {
    expect(isProductionWebHost('yalelabs.io')).toBe(true);
    expect(isProductionWebHost('www.yalelabs.io')).toBe(true);
    expect(isProductionWebHost('yalelabs.io:443')).toBe(true);
    expect(isProductionWebHost('yalelabs.io.evil.example')).toBe(false);
    expect(isProductionWebHost('evil-yalelabs.io')).toBe(false);
  });

  it('normalizes credential-free HTTP(S) backend origins and strips a trailing /api suffix', () => {
    expect(normalizeBackendOrigin('https://api.example.test/api')).toBe('https://api.example.test');
    expect(normalizeBackendOrigin('https://api.example.test/base/api')).toBe(
      'https://api.example.test/base',
    );
    expect(normalizeBackendOrigin('http://localhost:4000///')).toBe('http://localhost:4000');
  });

  it('rejects scriptable, credential-bearing, malformed, and empty backend origins', () => {
    expect(normalizeBackendOrigin('javascript:alert(1)', 'https://fallback.test')).toBe(
      'https://fallback.test',
    );
    expect(normalizeBackendOrigin('https://user:pass@example.test', 'https://fallback.test')).toBe(
      'https://fallback.test',
    );
    expect(
      normalizeBackendOrigin('https://api.example.test\nhttps://evil.example', 'https://fallback.test'),
    ).toBe('https://fallback.test');
    expect(normalizeBackendOrigin('https:\\\\evil.example\\api', 'https://fallback.test')).toBe(
      'https://fallback.test',
    );
    expect(normalizeBackendOrigin('https://api.example.test/api v1', 'https://fallback.test')).toBe(
      'https://fallback.test',
    );
    expect(normalizeBackendOrigin('not a url', 'https://fallback.test')).toBe(
      'https://fallback.test',
    );
    expect(normalizeBackendOrigin('', 'https://fallback.test')).toBe('https://fallback.test');
  });

  it('rejects oversized backend origins before parsing', () => {
    expect(
      normalizeBackendOrigin(`https://api.example.test/${'a'.repeat(2049)}`, 'https://fallback.test'),
    ).toBe('https://fallback.test');
  });
});
