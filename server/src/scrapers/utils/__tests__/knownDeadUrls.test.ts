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
  knownDeadUrlKey,
  knownDeadUrlKeyHash,
  rememberGoneUrl,
  withKnownDeadUrlFetchMetrics,
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
      learnedKeyHashes: [],
      learnedByStatus: {},
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

describe('a run records the URLs it found gone (#6231)', () => {
  const base = {
    assertUrl: async (url: string) => ({ toString: () => url }) as URL,
    limiter: new HostRateLimiter({ minIntervalMs: 0, sleep: async () => {} }),
    sleep: vi.fn(async () => {}),
    jitter: () => 0,
  };
  const noStoredVerdicts = async () => [] as StoredLinkVerdict[];
  const answering = (status: number) =>
    vi.fn<HttpRequestFn>(() => Promise.resolve({ status, data: '', finalUrl: LIVE }));

  it('records a 404 it observed by key hash and status', async () => {
    const { stats } = await withKnownDeadUrlScope(
      () => fetchPageWithPolicy(LIVE, { ...base, request: answering(404) }).catch(() => undefined),
      noStoredVerdicts,
    );
    expect(stats.learned).toBe(1);
    expect(stats.learnedByStatus).toEqual({ '404': 1 });
    expect(stats.learnedKeyHashes).toEqual([knownDeadUrlKeyHash(knownDeadUrlKey(LIVE)!)]);
  });

  it.each([403, 429, 500, 503])(
    'records nothing for a %i, which says nothing about the page',
    async (status) => {
      const { stats } = await withKnownDeadUrlScope(
        () =>
          fetchPageWithPolicy(LIVE, { ...base, request: answering(status) }).catch(() => undefined),
        noStoredVerdicts,
      );
      expect(stats.learned).toBe(0);
      expect(stats.learnedKeyHashes).toEqual([]);
    },
  );

  it('records nothing for a fetch that observed nothing', async () => {
    const reset = vi.fn<HttpRequestFn>(() =>
      Promise.reject(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })),
    );
    const { stats } = await withKnownDeadUrlScope(
      () => fetchPageWithPolicy(LIVE, { ...base, request: reset }).catch(() => undefined),
      noStoredVerdicts,
    );
    expect(stats.learned).toBe(0);
  });

  it('records a 410 under its own status', async () => {
    const { stats } = await withKnownDeadUrlScope(
      () => fetchPageWithPolicy(LIVE, { ...base, request: answering(410) }).catch(() => undefined),
      noStoredVerdicts,
    );
    expect(stats.learnedByStatus).toEqual({ '410': 1 });
    expect(stats.learnedKeyHashes).toHaveLength(1);
  });

  it('caps the stored hashes at 5,000 a run but still counts every URL learned', async () => {
    const { stats } = await withKnownDeadUrlScope(async () => {
      for (let i = 0; i < 5001; i += 1) {
        rememberGoneUrl(`https://fixture-dept.yale.edu/people/fixture-gone-${i}`, 404);
      }
    }, noStoredVerdicts);
    expect(stats.learnedKeyHashes).toHaveLength(5000);
    expect(stats.learnedKeyHashesTruncated).toBe(true);
    expect(stats.learned).toBe(5001);
    expect(stats.learnedByStatus).toEqual({ '404': 5001 });
  });

  it('keeps the stats on the run when it learned a URL but skipped none', () => {
    const result = withKnownDeadUrlFetchMetrics(
      { observationCount: 0, entitiesObserved: 0 } as any,
      {
        known: 0,
        learned: 1,
        skipped: 0,
        skippedByStoredVerdict: 0,
        skippedAsRepeatInRun: 0,
        learnedKeyHashes: ['abcdef0123456789'],
        learnedByStatus: { '404': 1 },
      },
    );
    expect(result.fetchMetrics?.knownDeadUrlSkip?.learnedKeyHashes).toEqual(['abcdef0123456789']);
  });
});
