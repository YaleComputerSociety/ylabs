import { describe, expect, it, vi } from 'vitest';
import {
  fetchPageWithPolicy,
  HostRateLimiter,
  HttpStatusError,
  KnownDeadUrlError,
  type HttpRequestFn,
} from '../httpFetch';
import {
  goneStatusByUrlKey,
  isKnownDeadUrl,
  withKnownDeadUrlScope,
  type StoredLinkVerdict,
} from '../knownDeadUrls';

const NOW = Date.parse('2026-11-13T12:00:00Z');
const DAY = 86_400_000;
const DEAD = 'https://fixture-dept.yale.edu/people/fixture-gone-page';
const LIVE = 'https://fixture-dept.yale.edu/people/fixture-live-page';

const verdict = (
  url: string,
  healthStatus: string,
  httpStatusCode: number | undefined,
  daysAgo: number,
): StoredLinkVerdict => ({
  url,
  healthStatus,
  ...(httpStatusCode === undefined ? {} : { httpStatusCode }),
  checkedAt: new Date(NOW - daysAgo * DAY),
});

describe('goneStatusByUrlKey (#6210)', () => {
  it('keeps only a recent 404 or 410 that link-health recorded as gone', () => {
    const gone = goneStatusByUrlKey(
      [
        verdict(`${DEAD}-404`, 'UNAVAILABLE', 404, 2),
        verdict(`${DEAD}-410`, 'UNAVAILABLE', 410, 2),
        verdict(`${DEAD}-403`, 'UNKNOWN', 403, 2),
        verdict(`${DEAD}-429`, 'UNKNOWN', 429, 2),
        verdict(`${DEAD}-503`, 'UNKNOWN', 503, 2),
        verdict(`${DEAD}-dns`, 'UNAVAILABLE', undefined, 2),
        verdict(`${DEAD}-landed-away`, 'UNAVAILABLE', 200, 2),
        verdict(`${DEAD}-stale`, 'UNAVAILABLE', 404, 31),
      ],
      NOW,
    );
    expect([...gone.keys()].sort()).toEqual([
      'https://fixture-dept.yale.edu/people/fixture-gone-page-404',
      'https://fixture-dept.yale.edu/people/fixture-gone-page-410',
    ]);
  });

  it('lets the newest verdict for a URL decide, so a page that came back is fetched again', () => {
    const gone = goneStatusByUrlKey(
      [verdict(DEAD, 'UNAVAILABLE', 404, 5), verdict(`${DEAD}/`, 'HEALTHY', 200, 1)],
      NOW,
    );
    expect(gone.size).toBe(0);
  });
});

describe('fetchPageWithPolicy inside a known-dead scope (#6210)', () => {
  const base = {
    assertUrl: async (url: string) => ({ toString: () => url }) as URL,
    limiter: new HostRateLimiter({ minIntervalMs: 0, sleep: async () => {} }),
    sleep: vi.fn(async () => {}),
    jitter: () => 0,
  };
  const okRequest = () =>
    vi.fn<HttpRequestFn>(() =>
      Promise.resolve({ status: 200, data: '<html></html>', finalUrl: LIVE }),
    );
  const scope = <T>(run: () => Promise<T>) =>
    withKnownDeadUrlScope(run, async () => [verdict(DEAD, 'UNAVAILABLE', 404, 1)]);

  it('sends no request for a known-dead URL and answers the 404 it would have got', async () => {
    const request = okRequest();
    const { value: error, stats } = await scope(() =>
      fetchPageWithPolicy(`https://www.${DEAD.slice('https://'.length)}/`, {
        ...base,
        request,
      }).catch((e: unknown) => e),
    );
    expect(request).not.toHaveBeenCalled();
    expect(error).toBeInstanceOf(KnownDeadUrlError);
    expect(error).toBeInstanceOf(HttpStatusError);
    expect((error as HttpStatusError).status).toBe(404);
    expect(stats).toEqual({
      known: 1,
      learned: 0,
      skipped: 1,
      skippedByStoredVerdict: 1,
      skippedAsRepeatInRun: 0,
    });
  });

  it('still fetches a URL with no gone verdict', async () => {
    const request = okRequest();
    const { stats } = await scope(() => fetchPageWithPolicy(LIVE, { ...base, request }));
    expect(request).toHaveBeenCalledTimes(1);
    expect(stats.skipped).toBe(0);
  });

  it('asks a URL that answered 404 in this run only once', async () => {
    const request = vi.fn<HttpRequestFn>(() =>
      Promise.resolve({ status: 404, data: '', finalUrl: LIVE }),
    );
    const { stats } = await scope(async () => {
      for (let i = 0; i < 3; i += 1) {
        await fetchPageWithPolicy(LIVE, { ...base, request }).catch(() => undefined);
      }
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(stats).toMatchObject({
      learned: 1,
      skipped: 2,
      skippedByStoredVerdict: 0,
      skippedAsRepeatInRun: 2,
    });
  });

  it('never lets a plain-HTTP 404 skip the https page', async () => {
    const request = okRequest();
    const { stats } = await withKnownDeadUrlScope(
      () => fetchPageWithPolicy(DEAD, { ...base, request }),
      async () => [verdict(DEAD.replace('https://', 'http://'), 'UNAVAILABLE', 404, 1)],
    );
    expect(request).toHaveBeenCalledTimes(1);
    expect(stats.skipped).toBe(0);
  });

  it('fails open when the stored verdicts cannot load, running the scrape and skipping nothing', async () => {
    const request = okRequest();
    const { value, stats } = await withKnownDeadUrlScope(
      () => fetchPageWithPolicy(DEAD, { ...base, request }).then(() => 'ran'),
      async () => {
        throw new Error('fixture load failure');
      },
    );
    expect(value).toBe('ran');
    expect(request).toHaveBeenCalledTimes(1);
    expect(stats).toMatchObject({ known: 0, skipped: 0, loadFailed: true });
  });

  it('skips nothing outside a scrape-run scope', async () => {
    const request = okRequest();
    await fetchPageWithPolicy(DEAD, { ...base, request });
    expect(request).toHaveBeenCalledTimes(1);
    expect(isKnownDeadUrl(DEAD)).toBe(false);
  });
});
