import { describe, expect, it } from 'vitest';

import { SsrfBlockedError } from '../../../utils/ssrfGuard';
import { RESOLVER_CONTROL_URLS, probeResolverControl } from '../resolverControlProbe';

const CONTROLS = ['https://control-a.example.edu/robots.txt', 'https://control-b.example.edu/'];

const errorWithCode = (code: string) => Object.assign(new Error(code), { code });

describe('probeResolverControl', () => {
  it('is healthy as soon as one control host answers with any status', async () => {
    const asked: string[] = [];
    const outcome = await probeResolverControl(async (url) => {
      asked.push(url);
      return { status: 503 };
    }, CONTROLS);
    expect(outcome).toEqual({ healthy: true, detail: 'control-a.example.edu answered HTTP 503' });
    expect(asked).toEqual([CONTROLS[0]]);
  });

  it('falls through to the second control host when the first fails', async () => {
    const outcome = await probeResolverControl(async (url) => {
      if (url === CONTROLS[0]) throw errorWithCode('ECONNREFUSED');
      return { status: 200 };
    }, CONTROLS);
    expect(outcome.healthy).toBe(true);
    expect(outcome.detail).toBe('control-b.example.edu answered HTTP 200');
  });

  it('counts a split-horizon private answer as a working resolver', async () => {
    const outcome = await probeResolverControl(async () => {
      throw new SsrfBlockedError('private', 'private-address');
    }, CONTROLS);
    expect(outcome).toEqual({
      healthy: true,
      detail: 'control-a.example.edu resolved to a private address',
    });
  });

  it('is unhealthy when every control host fails, naming each failure', async () => {
    const outcome = await probeResolverControl(async (url) => {
      if (url === CONTROLS[0]) throw new SsrfBlockedError('gone', 'unresolvable');
      throw errorWithCode('ENETUNREACH');
    }, CONTROLS);
    expect(outcome).toEqual({
      healthy: false,
      detail: 'control-a.example.edu: ssrf-unresolvable; control-b.example.edu: ENETUNREACH',
    });
  });

  it('uses fixed https control hosts chosen by the code', () => {
    expect(RESOLVER_CONTROL_URLS.length).toBeGreaterThan(0);
    expect(RESOLVER_CONTROL_URLS.length).toBeLessThanOrEqual(2);
    for (const url of RESOLVER_CONTROL_URLS) {
      const parsed = new URL(url);
      expect(parsed.protocol).toBe('https:');
      expect(parsed.hostname.endsWith('yale.edu')).toBe(true);
    }
  });
});
