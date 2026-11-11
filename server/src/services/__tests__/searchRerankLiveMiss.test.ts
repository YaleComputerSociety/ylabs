import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SEARCH_RERANK_LIVE_MISS_MAX_PER_IP_PER_HOUR,
  SEARCH_RERANK_LIVE_MISS_MAX_PER_SESSION_PER_DAY,
  SEARCH_RERANK_LIVE_MISS_QUEUE_LIMIT,
  enqueueSearchRerankLiveMiss,
  isSearchRerankLiveMissEnabled,
  resetSearchRerankLiveMissQueue,
  searchRerankLiveMissIdle,
  searchRerankLiveMissMode,
  searchRerankLiveMissQueueSnapshot,
  searchRerankLiveMissWantsEntry,
  setSearchRerankLiveMissClock,
  setSearchRerankLiveMissRunner,
  type SearchRerankLiveMissJobRequest,
  type SearchRerankLiveMissJobStatus,
} from '../searchRerankLiveMiss';

const START = Date.UTC(2026, 10, 10, 12, 0, 0);
const HOUR_MS = 60 * 60 * 1000;

let now = START;
const job = (
  index: number,
  query = `synthetic topic ${index}`,
): SearchRerankLiveMissJobRequest => ({
  queryKey: `key-${index}`,
  query,
  filters: {},
});
const client = (ip = 'ip:198.51.100.7', session = 'anonymous:session-a') => ({
  ipKey: ip,
  sessionKey: session,
});

interface Deferred {
  resolve: (status: SearchRerankLiveMissJobStatus) => void;
}

const holdEveryJob = () => {
  const held: Array<{ request: SearchRerankLiveMissJobRequest } & Deferred> = [];
  const runner = vi.fn(
    (request: SearchRerankLiveMissJobRequest) =>
      new Promise<{ status: SearchRerankLiveMissJobStatus }>((resolve) => {
        held.push({ request, resolve: (status) => resolve({ status }) });
      }),
  );
  setSearchRerankLiveMissRunner(runner);
  return { runner, held };
};

const flushImmediates = () => new Promise<void>((resolve) => setImmediate(resolve));

beforeEach(() => {
  now = START;
  setSearchRerankLiveMissClock(() => now);
  resetSearchRerankLiveMissQueue();
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
});

afterEach(async () => {
  setSearchRerankLiveMissRunner(null);
  setSearchRerankLiveMissClock(null);
  resetSearchRerankLiveMissQueue();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('live-miss configuration', () => {
  it('is off unless SEARCH_RERANK_LIVE_MISS_ENABLED is exactly true', () => {
    expect(isSearchRerankLiveMissEnabled({})).toBe(false);
    expect(isSearchRerankLiveMissEnabled({ SEARCH_RERANK_LIVE_MISS_ENABLED: '1' })).toBe(false);
    expect(isSearchRerankLiveMissEnabled({ SEARCH_RERANK_CACHE_ENABLED: 'true' })).toBe(false);
    expect(isSearchRerankLiveMissEnabled({ SEARCH_RERANK_LIVE_MISS_ENABLED: 'true' })).toBe(true);
  });

  it('writes shadow entries unless the mode is exactly serve', () => {
    expect(searchRerankLiveMissMode({})).toBe('shadow');
    expect(searchRerankLiveMissMode({ SEARCH_RERANK_LIVE_MISS_MODE: 'SERVE' })).toBe('shadow');
    expect(searchRerankLiveMissMode({ SEARCH_RERANK_LIVE_MISS_MODE: 'serve' })).toBe('serve');
  });
});

describe('which cache entries a live-miss job may replace', () => {
  it('never replaces a seeded full- entry, even a stale one', () => {
    for (const mode of ['shadow', 'serve'] as const) {
      expect(searchRerankLiveMissWantsEntry('seeded', mode)).toBe(false);
      expect(searchRerankLiveMissWantsEntry('seeded', mode, () => true)).toBe(false);
    }
  });

  it('fills a miss in either mode', () => {
    expect(searchRerankLiveMissWantsEntry('absent', 'shadow')).toBe(true);
    expect(searchRerankLiveMissWantsEntry('absent', 'serve')).toBe(true);
  });

  it('never replaces a fresh served entry', () => {
    expect(searchRerankLiveMissWantsEntry('served', 'shadow')).toBe(false);
    expect(searchRerankLiveMissWantsEntry('served', 'serve')).toBe(false);
    expect(searchRerankLiveMissWantsEntry('served', 'serve', () => false)).toBe(false);
  });

  it('re-scores a stale served entry in serve mode only', () => {
    expect(searchRerankLiveMissWantsEntry('served', 'serve', () => true)).toBe(true);
    expect(searchRerankLiveMissWantsEntry('served', 'shadow', () => true)).toBe(false);
  });

  it('promotes a shadow entry to a served one only in serve mode', () => {
    expect(searchRerankLiveMissWantsEntry('shadow', 'serve')).toBe(true);
    expect(searchRerankLiveMissWantsEntry('shadow', 'shadow')).toBe(false);
  });

  it('re-scores a stale shadow entry in shadow mode', () => {
    expect(searchRerankLiveMissWantsEntry('shadow', 'shadow', () => true)).toBe(true);
    expect(searchRerankLiveMissWantsEntry('shadow', 'shadow', () => false)).toBe(false);
  });

  it('asks about staleness only when staleness alone decides', () => {
    const isStale = vi.fn(() => true);
    searchRerankLiveMissWantsEntry('absent', 'serve', isStale);
    searchRerankLiveMissWantsEntry('seeded', 'serve', isStale);
    searchRerankLiveMissWantsEntry('shadow', 'serve', isStale);
    searchRerankLiveMissWantsEntry('served', 'shadow', isStale);
    expect(isStale).not.toHaveBeenCalled();
  });
});

describe('enqueueSearchRerankLiveMiss', () => {
  it('returns before the job runs, so the request path never awaits the model', async () => {
    const { runner, held } = holdEveryJob();

    expect(enqueueSearchRerankLiveMiss(job(1), client())).toBe('enqueued');
    expect(runner).not.toHaveBeenCalled();

    await flushImmediates();
    expect(runner).toHaveBeenCalledTimes(1);
    held[0].resolve('written');
    await searchRerankLiveMissIdle();
  });

  it('runs one job per key however many searches miss it at once', async () => {
    const { runner, held } = holdEveryJob();

    const decisions = Array.from({ length: 10 }, () =>
      enqueueSearchRerankLiveMiss(job(1), client()),
    );
    await flushImmediates();

    expect(decisions).toEqual(['enqueued', ...Array(9).fill('joined-in-flight')]);
    expect(runner).toHaveBeenCalledTimes(1);
    held[0].resolve('written');
    await searchRerankLiveMissIdle();

    expect(enqueueSearchRerankLiveMiss(job(1), client())).toBe('enqueued');
    await flushImmediates();
    held[1].resolve('written');
    await searchRerankLiveMissIdle();
  });

  it('runs jobs one at a time in the order they were enqueued', async () => {
    const { runner, held } = holdEveryJob();
    enqueueSearchRerankLiveMiss(job(1), client());
    enqueueSearchRerankLiveMiss(job(2), client());
    await flushImmediates();

    expect(runner).toHaveBeenCalledTimes(1);
    held[0].resolve('written');
    await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(2));
    expect(held[1].request.queryKey).toBe('key-2');
    held[1].resolve('written');
    await searchRerankLiveMissIdle();
  });

  it(`holds at most ${SEARCH_RERANK_LIVE_MISS_QUEUE_LIMIT} pending jobs and drops the oldest`, async () => {
    const { held } = holdEveryJob();
    enqueueSearchRerankLiveMiss(job(0), client('ip:running'));
    await flushImmediates();

    for (let index = 1; index <= SEARCH_RERANK_LIVE_MISS_QUEUE_LIMIT + 2; index += 1) {
      enqueueSearchRerankLiveMiss(job(index), client(`ip:${index}`, `anonymous:${index}`));
    }

    const { pending, inFlight } = searchRerankLiveMissQueueSnapshot();
    expect(pending).toHaveLength(SEARCH_RERANK_LIVE_MISS_QUEUE_LIMIT);
    expect(pending[0]).toBe('key-3');
    expect(pending.at(-1)).toBe(`key-${SEARCH_RERANK_LIVE_MISS_QUEUE_LIMIT + 2}`);
    expect(inFlight).not.toContain('key-1');
    expect(inFlight).toContain('key-0');
    expect(enqueueSearchRerankLiveMiss(job(1), client('ip:again', 'anonymous:again'))).toBe(
      'enqueued',
    );
    resetSearchRerankLiveMissQueue();
    held[0].resolve('written');
  });

  it(`caps one address at ${SEARCH_RERANK_LIVE_MISS_MAX_PER_IP_PER_HOUR} enqueues an hour`, () => {
    holdEveryJob();
    const decisions = Array.from(
      { length: SEARCH_RERANK_LIVE_MISS_MAX_PER_IP_PER_HOUR + 1 },
      (_v, index) =>
        enqueueSearchRerankLiveMiss(job(index), client('ip:shared', `anonymous:${index}`)),
    );

    expect(decisions.filter((decision) => decision === 'enqueued')).toHaveLength(
      SEARCH_RERANK_LIVE_MISS_MAX_PER_IP_PER_HOUR,
    );
    expect(decisions.at(-1)).toBe('ip-cap');
    expect(enqueueSearchRerankLiveMiss(job(900), client('ip:other', 'anonymous:other'))).toBe(
      'enqueued',
    );

    now += HOUR_MS;
    expect(enqueueSearchRerankLiveMiss(job(901), client('ip:shared', 'anonymous:fresh'))).toBe(
      'enqueued',
    );
  });

  it(`caps one session at ${SEARCH_RERANK_LIVE_MISS_MAX_PER_SESSION_PER_DAY} enqueues a day`, () => {
    holdEveryJob();
    const decisions = Array.from(
      { length: SEARCH_RERANK_LIVE_MISS_MAX_PER_SESSION_PER_DAY + 1 },
      (_v, index) =>
        enqueueSearchRerankLiveMiss(job(index), client(`ip:${index}`, 'user:synthetic')),
    );

    expect(decisions.filter((decision) => decision === 'enqueued')).toHaveLength(
      SEARCH_RERANK_LIVE_MISS_MAX_PER_SESSION_PER_DAY,
    );
    expect(decisions.at(-1)).toBe('session-cap');

    now = Date.UTC(2026, 10, 11, 0, 0, 1);
    expect(enqueueSearchRerankLiveMiss(job(999), client('ip:next-day', 'user:synthetic'))).toBe(
      'enqueued',
    );
  });

  it('does not charge a client for joining a job already in flight', () => {
    holdEveryJob();
    for (let index = 0; index < SEARCH_RERANK_LIVE_MISS_MAX_PER_IP_PER_HOUR * 2; index += 1) {
      enqueueSearchRerankLiveMiss(job(1), client('ip:joiner'));
    }
    expect(enqueueSearchRerankLiveMiss(job(2), client('ip:joiner'))).toBe('enqueued');
  });

  it('refuses a query over 100 characters or 10 words', () => {
    const runner = vi.fn();
    setSearchRerankLiveMissRunner(runner);

    expect(enqueueSearchRerankLiveMiss(job(1, 'x'.repeat(101)), client())).toBe('query-too-long');
    expect(
      enqueueSearchRerankLiveMiss(
        job(2, 'one two three four five six seven eight nine ten eleven'),
        client(),
      ),
    ).toBe('query-too-long');
    expect(enqueueSearchRerankLiveMiss(job(3, '   '), client())).toBe('query-too-long');
    expect(enqueueSearchRerankLiveMiss(job(4, 'x'.repeat(100)), client())).toBe('enqueued');
    expect(
      enqueueSearchRerankLiveMiss(
        job(5, 'one two three four five six seven eight nine ten'),
        client(),
      ),
    ).toBe('enqueued');
  });

  it('stops for the rest of the UTC day once a job reports the spend ceiling', async () => {
    const { runner, held } = holdEveryJob();
    enqueueSearchRerankLiveMiss(job(1), client());
    enqueueSearchRerankLiveMiss(job(2), client());
    await flushImmediates();

    held[0].resolve('spend-ceiling');
    await searchRerankLiveMissIdle();

    expect(runner).toHaveBeenCalledTimes(1);
    expect(searchRerankLiveMissQueueSnapshot().pending).toEqual([]);
    expect(searchRerankLiveMissQueueSnapshot().inFlight).toEqual([]);
    expect(enqueueSearchRerankLiveMiss(job(3), client())).toBe('stopped-for-the-day');

    now = Date.UTC(2026, 10, 10, 23, 59, 59);
    expect(enqueueSearchRerankLiveMiss(job(4), client())).toBe('stopped-for-the-day');
    now = Date.UTC(2026, 10, 11, 0, 0, 0);
    expect(enqueueSearchRerankLiveMiss(job(5), client())).toBe('enqueued');
    await flushImmediates();
    held[1].resolve('written');
    await searchRerankLiveMissIdle();
  });

  it.each<SearchRerankLiveMissJobStatus>([
    'written-still-stale',
    'still-fresh',
    'ineligible',
    'model-failed',
    'malformed-output',
  ])('does not queue a key again the same UTC day after its job ends %s', async (status) => {
    const runner = vi.fn().mockResolvedValue({ status });
    setSearchRerankLiveMissRunner(runner);

    enqueueSearchRerankLiveMiss(job(1), client('ip:first', 'anonymous:first'));
    await searchRerankLiveMissIdle();

    expect(enqueueSearchRerankLiveMiss(job(1), client('ip:second', 'anonymous:second'))).toBe(
      'failed-today',
    );
    expect(enqueueSearchRerankLiveMiss(job(2), client('ip:second', 'anonymous:second'))).toBe(
      'enqueued',
    );
    await searchRerankLiveMissIdle();

    now = Date.UTC(2026, 10, 11, 0, 0, 0);
    expect(enqueueSearchRerankLiveMiss(job(1), client('ip:third', 'anonymous:third'))).toBe(
      'enqueued',
    );
    await searchRerankLiveMissIdle();
    expect(runner).toHaveBeenCalledTimes(3);
  });

  it('does not queue a key again the same UTC day after its job throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    setSearchRerankLiveMissRunner(vi.fn().mockRejectedValue(new Error('synthetic failure')));

    enqueueSearchRerankLiveMiss(job(1), client('ip:first', 'anonymous:first'));
    await searchRerankLiveMissIdle();

    expect(enqueueSearchRerankLiveMiss(job(1), client('ip:second', 'anonymous:second'))).toBe(
      'failed-today',
    );
  });

  it.each<SearchRerankLiveMissJobStatus>(['written', 'no-api-key', 'spend-unreadable'])(
    'queues a key again after its job ends %s',
    async (status) => {
      setSearchRerankLiveMissRunner(vi.fn().mockResolvedValue({ status }));

      enqueueSearchRerankLiveMiss(job(1), client('ip:first', 'anonymous:first'));
      await searchRerankLiveMissIdle();

      expect(enqueueSearchRerankLiveMiss(job(1), client('ip:second', 'anonymous:second'))).toBe(
        'enqueued',
      );
      await searchRerankLiveMissIdle();
    },
  );

  it('keeps draining after a job throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const runner = vi
      .fn()
      .mockRejectedValueOnce(new Error('synthetic failure'))
      .mockResolvedValue({ status: 'written' });
    setSearchRerankLiveMissRunner(runner);

    enqueueSearchRerankLiveMiss(job(1), client());
    enqueueSearchRerankLiveMiss(job(2), client());
    await searchRerankLiveMissIdle();

    expect(runner).toHaveBeenCalledTimes(2);
    expect(searchRerankLiveMissQueueSnapshot().inFlight).toEqual([]);
  });

  it('logs each outcome under the caller name without the query text', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    setSearchRerankLiveMissRunner(vi.fn().mockResolvedValue({ status: 'written' }));

    enqueueSearchRerankLiveMiss(job(1, 'synthetic private words'), client());
    await searchRerankLiveMissIdle();

    expect(info).toHaveBeenCalledWith('[search-rerank-live-miss] job written');
    expect(JSON.stringify(info.mock.calls)).not.toContain('synthetic private words');
  });
});
