import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  getCached: vi.fn(),
  setCached: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: mocks.execFile,
}));

vi.mock('../snapshotCache', () => ({
  getCached: mocks.getCached,
  setCached: mocks.setCached,
}));

import {
  createScraplingRenderedFetcher,
  fetchUsableRenderedPage,
  measureRenderedFallback,
  measureRenderedFetch,
  renderedPageFailureReason,
} from '../renderedFetch';
import {
  BenchmarkReplayNetworkError,
  beginBenchmarkReplay,
  finishBenchmarkReplay,
} from '../snapshotBenchmarkMode';

const execFileSuccess = (payload: unknown) => {
  mocks.execFile.mockImplementationOnce((_command, _args, _options, callback) => {
    callback(null, { stdout: JSON.stringify(payload), stderr: '' });
  });
};

const noSeedRedirect = async () => false;

const forwardProxyStub = (forwardedHosts: string[]) => {
  const close = vi.fn(async () => {});
  return {
    close,
    start: vi.fn(async () => ({
      url: 'http://127.0.0.1:18080',
      forwardedHosts: () => forwardedHosts,
      close,
    })),
  };
};

const seedForwardingProxy = forwardProxyStub(['8.8.8.8']).start;

describe('createScraplingRenderedFetcher', () => {
  it('refuses to render during a benchmark replay and counts the block', async () => {
    const seedRedirectCheck = vi.fn(async () => false);
    const fetcher = createScraplingRenderedFetcher({
      enabled: true,
      pythonCommand: 'python3',
      bridgePath: 'scraplingBridge.py',
      seedRedirectCheck,
    });

    beginBenchmarkReplay([]);
    try {
      await expect(fetcher?.({ url: 'https://8.8.8.8/source' })).rejects.toBeInstanceOf(
        BenchmarkReplayNetworkError,
      );
      expect(seedRedirectCheck).not.toHaveBeenCalled();
      expect(mocks.execFile).not.toHaveBeenCalled();
    } finally {
      expect(finishBenchmarkReplay()).toMatchObject({
        pagesServed: 0,
        pagesMissed: 0,
        networkBlocks: 1,
      });
    }
  });

  it('blocks before invoking the Python renderer when the seed URL redirects', async () => {
    const fetcher = createScraplingRenderedFetcher({
      enabled: true,
      pythonCommand: 'python3',
      bridgePath: 'scraplingBridge.py',
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
      bridgePath: 'scraplingBridge.py',
      seedRedirectCheck: noSeedRedirect,
      startForwardProxy: seedForwardingProxy,
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
      bridgePath: 'scraplingBridge.py',
      seedRedirectCheck: noSeedRedirect,
      startForwardProxy: seedForwardingProxy,
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
      bridgePath: 'scraplingBridge.py',
      seedRedirectCheck: noSeedRedirect,
      startForwardProxy: seedForwardingProxy,
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
      bridgePath: 'scraplingBridge.py',
      timeoutMs: 250_000,
      seedRedirectCheck: noSeedRedirect,
      startForwardProxy: seedForwardingProxy,
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
      bridgePath: 'scraplingBridge.py',
      timeoutMs: 10,
      seedRedirectCheck: noSeedRedirect,
      startForwardProxy: seedForwardingProxy,
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

describe('createScraplingRenderedFetcher guarded browser egress', () => {
  it('hands the browser the guarded proxy and closes it after the render', async () => {
    execFileSuccess({ url: 'https://8.8.8.8/source', statusCode: 200, html: '<html>ok</html>' });
    const proxy = forwardProxyStub(['8.8.8.8']);
    const fetcher = createScraplingRenderedFetcher({
      enabled: true,
      pythonCommand: 'python3',
      bridgePath: 'scraplingBridge.py',
      seedRedirectCheck: noSeedRedirect,
      startForwardProxy: proxy.start,
    });

    const result = await fetcher?.({ url: 'https://8.8.8.8/source' });

    expect(result).toMatchObject({ html: '<html>ok</html>', fetchMode: 'scrapling' });
    expect(mocks.execFile).toHaveBeenLastCalledWith(
      'python3',
      expect.arrayContaining(['--proxy-server', 'http://127.0.0.1:18080']),
      expect.anything(),
      expect.any(Function),
    );
    expect(proxy.close).toHaveBeenCalledTimes(1);
  });

  it('discards a render whose seed request never passed through the guarded proxy', async () => {
    execFileSuccess({ url: 'https://8.8.8.8/source', statusCode: 200, html: '<html>ok</html>' });
    const proxy = forwardProxyStub([]);
    const fetcher = createScraplingRenderedFetcher({
      enabled: true,
      pythonCommand: 'python3',
      bridgePath: 'scraplingBridge.py',
      seedRedirectCheck: noSeedRedirect,
      startForwardProxy: proxy.start,
    });

    const result = await fetcher?.({ url: 'https://8.8.8.8/source' });

    expect(result).toMatchObject({
      html: '',
      blocked: true,
      blockedReason: 'rendered-outside-ssrf-proxy',
    });
    expect(proxy.close).toHaveBeenCalledTimes(1);
  });

  it('keeps the bridge failure label when the browser failed before any request', async () => {
    execFileSuccess({ html: '', blocked: false, blockedReason: 'scrapling-import-failed' });
    const proxy = forwardProxyStub([]);
    const fetcher = createScraplingRenderedFetcher({
      enabled: true,
      pythonCommand: 'python3',
      bridgePath: 'scraplingBridge.py',
      seedRedirectCheck: noSeedRedirect,
      startForwardProxy: proxy.start,
    });

    const result = await fetcher?.({ url: 'https://8.8.8.8/source' });

    expect(result).toMatchObject({
      html: '',
      blocked: false,
      blockedReason: 'scrapling-import-failed',
    });
    expect(renderedPageFailureReason(result ?? null)).toBe('scrapling-import-failed');
    expect(proxy.close).toHaveBeenCalledTimes(1);
  });

  it('does not launch the browser when the guarded proxy cannot start', async () => {
    mocks.execFile.mockClear();
    const fetcher = createScraplingRenderedFetcher({
      enabled: true,
      pythonCommand: 'python3',
      bridgePath: 'scraplingBridge.py',
      seedRedirectCheck: noSeedRedirect,
      startForwardProxy: async () => {
        throw new Error('listen failed');
      },
    });

    const result = await fetcher?.({ url: 'https://8.8.8.8/source' });

    expect(mocks.execFile).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      html: '',
      blocked: true,
      blockedReason: 'rendered-ssrf-proxy-unavailable',
    });
  });

  it('closes the guarded proxy when the bridge fails', async () => {
    mocks.execFile.mockImplementationOnce((_command, _args, _options, callback) => {
      callback(new Error('bridge crashed'), { stdout: '', stderr: '' });
    });
    const proxy = forwardProxyStub(['8.8.8.8']);
    const fetcher = createScraplingRenderedFetcher({
      enabled: true,
      pythonCommand: 'python3',
      bridgePath: 'scraplingBridge.py',
      seedRedirectCheck: noSeedRedirect,
      startForwardProxy: proxy.start,
    });

    await fetcher?.({ url: 'https://8.8.8.8/source' });

    expect(proxy.close).toHaveBeenCalledTimes(1);
  });
});

describe('renderedPageFailureReason', () => {
  const page = { url: 'https://lab.example.edu/', html: '<html><body>ok</body></html>' };

  it.each([
    [{ ...page, statusCode: 200 }, null],
    [page, null],
    [{ ...page, statusCode: 404 }, 'http-404'],
    [{ ...page, statusCode: 500 }, 'http-500'],
    [{ ...page, statusCode: 403, blocked: true, blockedReason: 'http-403' }, 'http-403'],
    [
      { ...page, statusCode: 200, blocked: true, blockedReason: 'captcha-or-turnstile' },
      'captcha-or-turnstile',
    ],
    [{ ...page, blocked: true }, 'blocked'],
    [{ ...page, html: '   ' }, 'empty-body'],
    [
      { ...page, html: '', blockedReason: 'scrapling-fetch-failed: boom' },
      'scrapling-fetch-failed: boom',
    ],
    [null, 'no-result'],
  ])('classifies %j as %s', (result, reason) => {
    expect(renderedPageFailureReason(result)).toBe(reason);
  });
});

describe('fetchUsableRenderedPage', () => {
  const request = { url: 'https://lab.example.edu/', waitSelector: 'body', timeoutMs: 10_000 };
  const notFound = {
    url: 'https://lab.example.edu/',
    html: '<html><body>Page not found</body></html>',
    statusCode: 404,
    blocked: false,
    fetchMode: 'scrapling' as const,
  };
  const good = { ...notFound, html: '<html><body>Lab research</body></html>', statusCode: 200 };

  it('strips the body of an unusable page and refuses to cache it', async () => {
    mocks.getCached.mockReset().mockResolvedValue(null);
    mocks.setCached.mockReset();
    const renderedFetcher = vi.fn().mockResolvedValue(notFound);

    const result = await fetchUsableRenderedPage({
      sourceName: 'lane',
      useCache: true,
      request,
      renderedFetcher,
    });

    expect(result).toMatchObject({ html: '', statusCode: 404, blockedReason: 'http-404' });
    expect(mocks.setCached).not.toHaveBeenCalled();
  });

  it('ignores a cached unusable page and re-renders instead of serving it', async () => {
    mocks.getCached.mockReset().mockResolvedValue(notFound);
    mocks.setCached.mockReset();
    const renderedFetcher = vi.fn().mockResolvedValue(good);

    const result = await fetchUsableRenderedPage({
      sourceName: 'lane',
      useCache: true,
      request,
      renderedFetcher,
    });

    expect(renderedFetcher).toHaveBeenCalledWith(request);
    expect(result?.html).toBe(good.html);
    expect(mocks.setCached).toHaveBeenCalledWith(
      'lane',
      'rendered-page:v1:https://lab.example.edu/',
      good,
    );
  });

  it('serves a cached usable page without rendering', async () => {
    mocks.getCached.mockReset().mockResolvedValue(good);
    mocks.setCached.mockReset();
    const renderedFetcher = vi.fn();

    const result = await fetchUsableRenderedPage({
      sourceName: 'lane',
      useCache: true,
      request,
      renderedFetcher,
    });

    expect(renderedFetcher).not.toHaveBeenCalled();
    expect(result).toEqual(good);
  });

  it('counts a non-2xx page as a failed attempt that is neither blocked nor a selector breakage', async () => {
    const renderedFetcher = vi.fn().mockResolvedValue(notFound);

    const measured = await measureRenderedFetch(request.url, 'scrapling', () =>
      fetchUsableRenderedPage({ sourceName: 'lane', useCache: false, request, renderedFetcher }),
    );

    expect(measured.metric).toMatchObject({
      success: false,
      blocked: false,
      blockedReason: 'http-404',
      selectorBreakage: false,
    });
  });
});

describe('measureRenderedFallback (#3742)', () => {
  const request = { url: 'https://lab.example.edu/', waitSelector: 'body', timeoutMs: 10_000 };

  it('measures nothing when no renderer is configured, so a disabled renderer is no breakage', () => {
    expect(
      measureRenderedFallback(request.url, {
        sourceName: 'lane',
        useCache: false,
        request,
        renderedFetcher: null,
      }),
    ).toBeNull();
  });

  it('records a scrapling attempt for a renderer that actually rendered', async () => {
    mocks.getCached.mockReset().mockResolvedValue(null);
    mocks.setCached.mockReset();
    const renderedFetcher = vi.fn().mockResolvedValue({
      url: request.url,
      html: '<html><body>Lab research</body></html>',
      statusCode: 200,
      fetchMode: 'scrapling' as const,
    });

    const measured = await measureRenderedFallback(
      request.url,
      { sourceName: 'lane', useCache: false, request, renderedFetcher },
      { selectorName: 'body' },
    );

    expect(renderedFetcher).toHaveBeenCalledWith(request);
    expect(measured?.metric).toMatchObject({
      fetchMode: 'scrapling',
      success: true,
      selectorBreakage: false,
    });
  });
});
