import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ execFile: vi.fn() }));

// No robots.txt is read in this suite: every host allows everything, so these tests keep
// exercising what they were written for. robotsFetchHookRendered.test.ts covers the robots path.
vi.mock('../utils/robotsPolicyCache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/robotsPolicyCache')>()),
  robotsPolicyFor: async () => ({ rules: [] }),
}));

vi.mock('node:child_process', () => ({ execFile: mocks.execFile }));

import {
  createScraplingRenderedFetcher,
  type RenderedFetchProxyPacing,
  type RenderedSeedPreflight,
} from '../renderedFetch';
import type { HostSlotLimiter } from '../utils/hostConcurrencyLimiter';
import { activeHostPause, HostPausedError } from '../utils/hostPause';
import {
  hostBackoffState,
  recordHostBackoff,
  resetHostPauseStateForTests,
  setHostPauseStateForTests,
} from '../utils/hostPauseState';
import { HostSlotWaitTimeoutError } from '../utils/hostThrottlePolicy';
import { isNotObserved } from '../utils/notObserved';
import type { ScraperRequestLog } from '../utils/scraperRequestLog';

const SEED_HOST = '8.8.8.8';
const SEED_URL = `https://${SEED_HOST}/research`;
const noRetryWait = { sleep: async () => {}, jitter: () => 0 };

const renderReturns = (payload: unknown) => {
  mocks.execFile.mockImplementationOnce((_command, _args, _options, callback) => {
    callback(null, { stdout: JSON.stringify(payload), stderr: '' });
  });
};

const proxyStub = (pacingRefusals: Array<{ host: string; error: Error }> = []) => {
  const started: RenderedFetchProxyPacing[] = [];
  return {
    started,
    start: vi.fn(async (pacing: RenderedFetchProxyPacing) => {
      started.push(pacing);
      return {
        url: 'http://127.0.0.1:18080',
        forwardedHosts: () => [SEED_HOST],
        pacingRefusals: () => pacingRefusals,
        close: async () => {},
      };
    }),
  };
};

const fetcherWith = (
  proxy: ReturnType<typeof proxyStub>,
  overrides: {
    maxRetries?: number;
    requestLog?: ScraperRequestLog | null;
    seedRedirectCheck?: () => Promise<boolean | RenderedSeedPreflight>;
    hostSlots?: HostSlotLimiter;
  } = {},
) =>
  createScraplingRenderedFetcher({
    enabled: true,
    pythonCommand: 'python3',
    bridgePath: 'scraplingBridge.py',
    seedRedirectCheck: overrides.seedRedirectCheck ?? (async () => false),
    ...(overrides.hostSlots ? { hostSlots: overrides.hostSlots } : {}),
    startForwardProxy: proxy.start,
    retry: { ...noRetryWait, maxRetries: overrides.maxRetries ?? 0 },
    requestLog: overrides.requestLog ?? null,
  })!;

beforeEach(() => {
  mocks.execFile.mockReset();
  resetHostPauseStateForTests();
});

afterEach(() => resetHostPauseStateForTests());

describe('the rendered fetch honours the host pause (#6255)', () => {
  it('refuses a paused seed host before preflight or render, as not observed', async () => {
    await recordHostBackoff(SEED_HOST, { status: 429 });
    const proxy = proxyStub();
    const seedRedirectCheck = vi.fn(async () => false);
    const fetcher = createScraplingRenderedFetcher({
      enabled: true,
      pythonCommand: 'python3',
      bridgePath: 'scraplingBridge.py',
      seedRedirectCheck,
      startForwardProxy: proxy.start,
      retry: { ...noRetryWait, maxRetries: 0 },
      requestLog: null,
    })!;

    const error = await fetcher({ url: SEED_URL }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HostPausedError);
    expect((error as HostPausedError).pause.host).toBe(SEED_HOST);
    expect(isNotObserved(error)).toBe(true);
    expect(seedRedirectCheck).not.toHaveBeenCalled();
    expect(proxy.start).not.toHaveBeenCalled();
    expect(mocks.execFile).not.toHaveBeenCalled();
  });

  it('hands the proxy the seed host as the slot the render already holds', async () => {
    renderReturns({ url: SEED_URL, statusCode: 200, html: '<html>ok</html>' });
    const proxy = proxyStub();

    await fetcherWith(proxy)({ url: SEED_URL, timeoutMs: 20_000 });

    expect(proxy.started).toEqual([{ heldHost: SEED_HOST, hostSlotWaitMs: 20_000 }]);
  });
});

describe('the rendered fetch records its answer in the shared backoff store (#6255)', () => {
  it('pauses the seed host machine-wide after a rendered 429 outlasts the quick retries', async () => {
    renderReturns({
      url: SEED_URL,
      statusCode: 429,
      html: '<html>slow down</html>',
      blocked: true,
    });

    const page = await fetcherWith(proxyStub())({ url: SEED_URL });

    expect(page).toMatchObject({ statusCode: 429 });
    expect(activeHostPause(SEED_HOST)?.host).toBe(SEED_HOST);
  });

  it("pauses the seed host at once for a rendered 403 that states the site's own date", async () => {
    renderReturns({
      url: SEED_URL,
      statusCode: 403,
      html: '<p>203.0.113.7 has been banned up to Fri, 20 Nov 2099 07:32:40 +0000</p>',
      blocked: true,
    });

    const error = await fetcherWith(proxyStub(), { maxRetries: 2 })({ url: SEED_URL }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(HostPausedError);
    expect((error as HostPausedError).requestSent).toBe(true);
    expect(mocks.execFile).toHaveBeenCalledTimes(1);
    expect(activeHostPause(SEED_HOST)?.until).toEqual(new Date('2099-11-20T07:32:40Z'));
  });

  it('records a rendered 2xx as a success, which clears a quiet backoff', async () => {
    const start = Date.now();
    let clock = start;
    setHostPauseStateForTests({ now: () => new Date(clock) });
    await recordHostBackoff(SEED_HOST, { status: 503 });
    expect(hostBackoffState(SEED_HOST)).toBeDefined();
    clock = start + 2 * 60 * 60_000;
    renderReturns({ url: SEED_URL, statusCode: 200, html: '<html>ok</html>' });

    await fetcherWith(proxyStub())({ url: SEED_URL });

    expect(hostBackoffState(SEED_HOST)).toBeUndefined();
  });

  it('records nothing for a page that is gone', async () => {
    renderReturns({ url: SEED_URL, statusCode: 404, html: '<html>gone</html>' });

    await fetcherWith(proxyStub())({ url: SEED_URL });

    expect(activeHostPause(SEED_HOST)).toBeUndefined();
    expect(hostBackoffState(SEED_HOST)).toBeUndefined();
  });
});

describe('a proxy pacing refusal is not observed, never evidence (#6255)', () => {
  it.each([
    [
      'a paused subresource host',
      new HostPausedError({ host: 'cdn.example.org', until: new Date('2099-01-01') }),
    ],
    ['a slot that never came free', new HostSlotWaitTimeoutError('cdn.example.org', 20_000)],
  ])('throws %s rather than returning the page or recording a refusal', async (_label, refusal) => {
    renderReturns({ url: SEED_URL, statusCode: 403, html: '<html>partial</html>', blocked: true });

    const error = await fetcherWith(proxyStub([{ host: 'cdn.example.org', error: refusal }]))({
      url: SEED_URL,
    }).catch((caught: unknown) => caught);

    expect(error).toBe(refusal);
    expect(isNotObserved(error)).toBe(true);
    expect(activeHostPause(SEED_HOST)).toBeUndefined();
    expect(hostBackoffState(SEED_HOST)).toBeUndefined();
  });
});

describe('the rendered seed preflight reaches the request log (#6255)', () => {
  it('logs the preflight request it sends before rendering', async () => {
    renderReturns({ url: SEED_URL, statusCode: 200, html: '<html>ok</html>' });
    const record = vi.fn();

    await fetcherWith(proxyStub(), { requestLog: { record } })({ url: SEED_URL });

    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][0]).toBe(SEED_URL);
  });
});

describe('the rendered fetch re-checks the seed pause after its slot wait (#6335)', () => {
  it('refuses a seed host paused while the render waited, releasing the slot and sending nothing', async () => {
    const released = vi.fn();
    const hostSlots: HostSlotLimiter = {
      acquire: async (host) => {
        await recordHostBackoff(host, { status: 429 });
        return released;
      },
    };
    const seedRedirectCheck = vi.fn(async () => false);
    const proxy = proxyStub();

    const error = await fetcherWith(proxy, { hostSlots, seedRedirectCheck })({
      url: SEED_URL,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HostPausedError);
    expect(isNotObserved(error)).toBe(true);
    expect(released).toHaveBeenCalledTimes(1);
    expect(seedRedirectCheck).not.toHaveBeenCalled();
    expect(proxy.start).not.toHaveBeenCalled();
    expect(mocks.execFile).not.toHaveBeenCalled();
  });
});

describe('a refused rendered preflight is recorded and stops the render (#6335)', () => {
  it('pauses the seed host for a preflight 429 asking to wait longer than the quick retries', async () => {
    const proxy = proxyStub();

    const error = await fetcherWith(proxy, {
      seedRedirectCheck: async () => ({ redirected: false, status: 429, retryAfterMs: 3_600_000 }),
    })({ url: SEED_URL }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HostPausedError);
    expect((error as HostPausedError).requestSent).toBe(true);
    expect(activeHostPause(SEED_HOST)?.host).toBe(SEED_HOST);
    expect(proxy.start).not.toHaveBeenCalled();
    expect(mocks.execFile).not.toHaveBeenCalled();
  });

  it('returns a refused preflight as the refused page without starting the browser', async () => {
    const proxy = proxyStub();

    const page = await fetcherWith(proxy, {
      seedRedirectCheck: async () => ({ redirected: false, status: 403 }),
    })({ url: SEED_URL });

    expect(page).toMatchObject({
      statusCode: 403,
      blocked: true,
      blockedReason: 'rendered-seed-refused',
      html: '',
    });
    expect(proxy.start).not.toHaveBeenCalled();
    expect(mocks.execFile).not.toHaveBeenCalled();
    expect(activeHostPause(SEED_HOST)?.host).toBe(SEED_HOST);
  });

  it('logs the preflight status', async () => {
    const record = vi.fn();

    await fetcherWith(proxyStub(), {
      requestLog: { record },
      seedRedirectCheck: async () => ({ redirected: false, status: 403 }),
    })({ url: SEED_URL });

    expect(record.mock.calls[0][3]).toEqual({ status: 403 });
  });
});
