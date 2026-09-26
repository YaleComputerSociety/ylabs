import { describe, it, expect } from 'vitest';
import {
  isPrivateAddress,
  isPublicHostname,
  assertPublicHttpUrl,
  classifyHostnameResolution,
  ssrfSafeAgents,
  SsrfBlockedError,
} from '../ssrfGuard';

describe('ssrfGuard', () => {
  it('classifies private / loopback / link-local / metadata addresses as private', () => {
    for (const addr of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.5.5',
      '192.168.1.1',
      '169.254.169.254', // cloud metadata
      '0.0.0.0',
      '::1',
      'fc00::1',
      'fe80::1',
      'not-an-ip',
    ]) {
      expect(isPrivateAddress(addr), addr).toBe(true);
    }
  });

  it('classifies public addresses as public', () => {
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
    expect(isPrivateAddress('2606:4700:4700::1111')).toBe(false);
  });

  it('assertPublicHttpUrl blocks private hosts, bad schemes, and embedded credentials', async () => {
    await expect(
      assertPublicHttpUrl('http://169.254.169.254/latest/meta-data'),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(assertPublicHttpUrl('http://127.0.0.1/')).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(assertPublicHttpUrl('http://10.0.0.5/')).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(assertPublicHttpUrl('https://[::1]/')).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(assertPublicHttpUrl('ftp://8.8.8.8/')).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(assertPublicHttpUrl('file:///etc/passwd')).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
    await expect(assertPublicHttpUrl('http://user:pass@8.8.8.8/')).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
    await expect(assertPublicHttpUrl('not a url')).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it('assertPublicHttpUrl rejects raw whitespace, control characters, and backslashes before parsing', async () => {
    await expect(assertPublicHttpUrl('https://example.com/a b')).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
    await expect(assertPublicHttpUrl('https://example.com/\n@8.8.8.8/')).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
    await expect(assertPublicHttpUrl('https://example.com\\@8.8.8.8/')).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
  });

  it('assertPublicHttpUrl allows a public IP-literal URL', async () => {
    const url = await assertPublicHttpUrl('https://8.8.8.8/path');
    expect(url.hostname).toBe('8.8.8.8');
  });

  it('ssrfSafeAgents returns http and https agents', () => {
    const agents = ssrfSafeAgents();
    expect(agents.httpAgent).toBeDefined();
    expect(agents.httpsAgent).toBeDefined();
  });

  describe('classifyHostnameResolution on IP literals', () => {
    it('separates a private literal from a public one without touching DNS', async () => {
      await expect(classifyHostnameResolution('127.0.0.1')).resolves.toEqual({
        kind: 'private-address',
      });
      await expect(classifyHostnameResolution('10.1.2.3')).resolves.toEqual({
        kind: 'private-address',
      });
      await expect(classifyHostnameResolution('8.8.8.8')).resolves.toEqual({ kind: 'public' });
    });

    it('leaves isPublicHostname answering exactly as before', async () => {
      await expect(isPublicHostname('8.8.8.8')).resolves.toBe(true);
      await expect(isPublicHostname('127.0.0.1')).resolves.toBe(false);
    });
  });

  describe('SsrfBlockedError.reason', () => {
    it('reports a private address as private, never as unresolvable', async () => {
      for (const url of ['http://127.0.0.1/', 'http://10.1.2.3/', 'http://169.254.169.254/']) {
        const error = await assertPublicHttpUrl(url).catch((e) => e);
        expect(error, url).toBeInstanceOf(SsrfBlockedError);
        expect(error.reason, url).toBe('private-address');
      }
    });

    it('distinguishes the non-address refusals', async () => {
      const cases: [string, string][] = [
        ['not a url', 'invalid-url'],
        ['ftp://8.8.8.8/', 'unsupported-scheme'],
        ['http://user:pass@8.8.8.8/', 'credentials'],
        ['http://8.8.8.8:8080/', 'port'],
      ];
      for (const [url, reason] of cases) {
        const error = await assertPublicHttpUrl(url).catch((e) => e);
        expect(error, url).toBeInstanceOf(SsrfBlockedError);
        expect(error.reason, url).toBe(reason);
      }
    });
  });
});
