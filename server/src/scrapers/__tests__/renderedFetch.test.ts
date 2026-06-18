import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: mocks.execFile,
}));

import { createScraplingRenderedFetcher } from '../renderedFetch';

const execFileSuccess = (payload: unknown) => {
  mocks.execFile.mockImplementationOnce((_command, _args, _options, callback) => {
    callback(null, { stdout: JSON.stringify(payload), stderr: '' });
  });
};

const noSeedRedirect = async () => false;

describe('createScraplingRenderedFetcher', () => {
  it('blocks before invoking the Python renderer when the seed URL redirects', async () => {
    const fetcher = createScraplingRenderedFetcher({
      enabled: true,
      pythonCommand: 'python3',
      bridgePath: '/tmp/scraplingBridge.py',
      seedRedirectCheck: async () => true,
    });

    const result = await fetcher?.({ url: 'https://8.8.8.8/source' });

    expect(mocks.execFile).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      url: 'https://8.8.8.8/source',
      html: '',
      blocked: true,
      blockedReason: 'redirected-before-render',
      fetchMode: 'scrapling',
    });
  });

  it('blocks rendered content when the final browser URL redirects cross-origin', async () => {
    execFileSuccess({
      url: 'https://1.1.1.1/private',
      statusCode: 200,
      html: '<html>internal content</html>',
    });
    const fetcher = createScraplingRenderedFetcher({
      enabled: true,
      pythonCommand: 'python3',
      bridgePath: '/tmp/scraplingBridge.py',
      seedRedirectCheck: noSeedRedirect,
    });

    const result = await fetcher?.({ url: 'https://8.8.8.8/source' });

    expect(result).toMatchObject({
      url: 'https://8.8.8.8/source',
      html: '',
      statusCode: 200,
      blocked: true,
      blockedReason: 'redirected-cross-origin',
      fetchMode: 'scrapling',
    });
  });

  it('classifies private final browser URLs as SSRF blocks', async () => {
    execFileSuccess({
      url: 'http://127.0.0.1/private',
      statusCode: 200,
      html: '<html>internal content</html>',
    });
    const fetcher = createScraplingRenderedFetcher({
      enabled: true,
      pythonCommand: 'python3',
      bridgePath: '/tmp/scraplingBridge.py',
      seedRedirectCheck: noSeedRedirect,
    });

    const result = await fetcher?.({ url: 'https://8.8.8.8/source' });

    expect(result).toMatchObject({
      url: 'https://8.8.8.8/source',
      html: '',
      statusCode: 200,
      blocked: true,
      blockedReason: 'rendered-final-url-blocked',
      fetchMode: 'scrapling',
    });
  });

  it('returns rendered content when the final browser URL remains same-origin', async () => {
    execFileSuccess({
      url: 'https://8.8.8.8/redirected',
      statusCode: 200,
      html: '<html>public content</html>',
    });
    const fetcher = createScraplingRenderedFetcher({
      enabled: true,
      pythonCommand: 'python3',
      bridgePath: '/tmp/scraplingBridge.py',
      seedRedirectCheck: noSeedRedirect,
    });

    const result = await fetcher?.({ url: 'https://8.8.8.8/source' });

    expect(result).toMatchObject({
      url: 'https://8.8.8.8/redirected',
      html: '<html>public content</html>',
      statusCode: 200,
      fetchMode: 'scrapling',
    });
  });

  it('bounds rendered fetch child-process timeouts', async () => {
    execFileSuccess({
      url: 'https://8.8.8.8/source',
      statusCode: 200,
      html: '<html>public content</html>',
    });
    const fetcher = createScraplingRenderedFetcher({
      enabled: true,
      pythonCommand: 'python3',
      bridgePath: '/tmp/scraplingBridge.py',
      timeoutMs: 250_000,
      seedRedirectCheck: noSeedRedirect,
    });

    await fetcher?.({ url: 'https://8.8.8.8/source', timeoutMs: 900_000 });

    expect(mocks.execFile).toHaveBeenCalledWith(
      'python3',
      expect.arrayContaining(['--timeout-ms', '30000']),
      expect.objectContaining({ timeout: 35_000 }),
      expect.any(Function),
    );
  });

  it('uses a sane minimum for tiny rendered fetch timeouts', async () => {
    execFileSuccess({
      url: 'https://8.8.8.8/source',
      statusCode: 200,
      html: '<html>public content</html>',
    });
    const fetcher = createScraplingRenderedFetcher({
      enabled: true,
      pythonCommand: 'python3',
      bridgePath: '/tmp/scraplingBridge.py',
      timeoutMs: 10,
      seedRedirectCheck: noSeedRedirect,
    });

    await fetcher?.({ url: 'https://8.8.8.8/source', timeoutMs: 1 });

    expect(mocks.execFile).toHaveBeenCalledWith(
      'python3',
      expect.arrayContaining(['--timeout-ms', '1000']),
      expect.objectContaining({ timeout: 6_000 }),
      expect.any(Function),
    );
  });
});
