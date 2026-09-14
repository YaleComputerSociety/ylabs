import { beforeEach, describe, expect, it, vi } from 'vitest';

const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));

vi.mock('dns/promises', () => ({
  default: { lookup: (...args: unknown[]) => lookupMock(...args) },
}));

import {
  assertPublicHttpUrl,
  classifyHostnameResolution,
  isPublicHostname,
  SsrfBlockedError,
} from '../ssrfGuard';

const dnsError = (code: string): NodeJS.ErrnoException => {
  const error = new Error(code) as NodeJS.ErrnoException;
  error.code = code;
  return error;
};

describe('hostname resolution classification (#2709)', () => {
  beforeEach(() => {
    lookupMock.mockReset();
  });

  const noSleep = async () => {};

  it('calls a name with no record unresolvable once a second lookup agrees', async () => {
    for (const code of ['ENOTFOUND', 'ENODATA']) {
      lookupMock.mockRejectedValueOnce(dnsError(code));
      lookupMock.mockRejectedValueOnce(dnsError(code));
      await expect(classifyHostnameResolution('gone.example.edu', noSleep), code).resolves.toEqual({
        kind: 'unresolvable',
      });
      expect(lookupMock, code).toHaveBeenCalledTimes(2);
      lookupMock.mockClear();
    }
  });

  it('treats a confirmed empty answer as unresolvable', async () => {
    lookupMock.mockResolvedValueOnce([]);
    lookupMock.mockResolvedValueOnce([]);
    await expect(classifyHostnameResolution('empty.example.edu', noSleep)).resolves.toEqual({
      kind: 'unresolvable',
    });
    expect(lookupMock).toHaveBeenCalledTimes(2);
  });

  // #2725: Node reports ENOTFOUND for live names when the resolver is stressed, so
  // a single negative must never reach a destructive verdict.
  it('never records unresolvable on one negative when the retry resolves', async () => {
    lookupMock.mockRejectedValueOnce(dnsError('ENOTFOUND'));
    lookupMock.mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }]);
    await expect(classifyHostnameResolution('blip.example.edu', noSleep)).resolves.toEqual({
      kind: 'public',
    });
  });

  it('downgrades a claimed negative to resolver-failure when the retry is inconclusive', async () => {
    lookupMock.mockRejectedValueOnce(dnsError('ENOTFOUND'));
    lookupMock.mockRejectedValueOnce(dnsError('EAI_AGAIN'));
    await expect(classifyHostnameResolution('blip.example.edu', noSleep)).resolves.toEqual({
      kind: 'resolver-failure',
    });
  });

  it('re-asks an empty first answer rather than acting on it', async () => {
    lookupMock.mockResolvedValueOnce([]);
    lookupMock.mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }]);
    await expect(classifyHostnameResolution('empty.example.edu', noSleep)).resolves.toEqual({
      kind: 'public',
    });
  });

  it('does not spend a retry on a verdict it would not act on', async () => {
    lookupMock.mockRejectedValueOnce(dnsError('EAI_AGAIN'));
    await expect(classifyHostnameResolution('slow.example.edu', noSleep)).resolves.toEqual({
      kind: 'resolver-failure',
    });
    expect(lookupMock).toHaveBeenCalledTimes(1);

    lookupMock.mockClear();
    lookupMock.mockResolvedValueOnce([{ address: '10.0.0.5', family: 4 }]);
    await expect(classifyHostnameResolution('internal.example.edu', noSleep)).resolves.toEqual({
      kind: 'private-address',
    });
    expect(lookupMock).toHaveBeenCalledTimes(1);
  });

  it('keeps a resolver failure inconclusive, so a DNS blip never retires a live citation', async () => {
    for (const code of ['EAI_AGAIN', 'ESERVFAIL', 'ETIMEOUT']) {
      lookupMock.mockRejectedValueOnce(dnsError(code));
      await expect(classifyHostnameResolution('slow.example.edu', noSleep), code).resolves.toEqual({
        kind: 'resolver-failure',
      });
    }
  });

  it('reports a name that resolves privately as a private address, not as unresolvable', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '10.0.0.5', family: 4 }]);
    await expect(classifyHostnameResolution('internal.example.edu')).resolves.toEqual({
      kind: 'private-address',
    });
  });

  it('refuses a name whose answers mix public and private addresses', async () => {
    lookupMock.mockResolvedValueOnce([
      { address: '8.8.8.8', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);
    await expect(classifyHostnameResolution('rebind.example.edu')).resolves.toEqual({
      kind: 'private-address',
    });
  });

  it('accepts a name that resolves publicly', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }]);
    await expect(classifyHostnameResolution('good.example.edu')).resolves.toEqual({
      kind: 'public',
    });
  });

  it('collapses every non-public kind to false for isPublicHostname, as before', async () => {
    lookupMock.mockRejectedValueOnce(dnsError('ENOTFOUND'));
    lookupMock.mockRejectedValueOnce(dnsError('ENOTFOUND'));
    await expect(isPublicHostname('gone.example.edu')).resolves.toBe(false);
    lookupMock.mockRejectedValueOnce(dnsError('EAI_AGAIN'));
    await expect(isPublicHostname('slow.example.edu')).resolves.toBe(false);
    lookupMock.mockResolvedValueOnce([{ address: '10.0.0.5', family: 4 }]);
    await expect(isPublicHostname('internal.example.edu')).resolves.toBe(false);
    lookupMock.mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }]);
    await expect(isPublicHostname('good.example.edu')).resolves.toBe(true);
  });

  it('still refuses the request in every non-public case, and says which it was', async () => {
    // A claimed negative costs two lookups (the verdict is confirmed); an
    // inconclusive one costs a single lookup, so queue exactly what each consumes
    // or a leftover rejection poisons the next case.
    const cases: [string, string, number][] = [
      ['ENOTFOUND', 'unresolvable', 2],
      ['EAI_AGAIN', 'resolver-failure', 1],
    ];
    for (const [code, reason, lookups] of cases) {
      lookupMock.mockClear();
      for (let i = 0; i < lookups; i += 1) lookupMock.mockRejectedValueOnce(dnsError(code));
      const error = await assertPublicHttpUrl('https://host.example.edu/x').catch((e) => e);
      expect(error, code).toBeInstanceOf(SsrfBlockedError);
      expect(error.reason, code).toBe(reason);
      expect(lookupMock, code).toHaveBeenCalledTimes(lookups);
    }
    lookupMock.mockClear();

    lookupMock.mockResolvedValueOnce([{ address: '169.254.169.254', family: 4 }]);
    const blocked = await assertPublicHttpUrl('https://metadata.example.edu/x').catch((e) => e);
    expect(blocked).toBeInstanceOf(SsrfBlockedError);
    expect(blocked.reason).toBe('private-address');
  });
});
