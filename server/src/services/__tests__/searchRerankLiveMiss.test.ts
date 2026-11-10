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
  searchRerankLiveMissStaleBefore,
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

  it('reads a stale-before date only when one parses', () => {
    expect(searchRerankLiveMissStaleBefore({})).toBeNull();
    expect(
      searchRerankLiveMissStaleBefore({ SEARCH_RERANK_LIVE_MISS_STALE_BEFORE: 'soon' }),
    ).toBeNull();
    expect(
      searchRerankLiveMissStaleBefore({ SEARCH_RERANK_LIVE_MISS_STALE_BEFORE: '2026-11-10' }),
    ).toEqual(new Date('2026-11-10'));
  });
});

describe('which cache entries a live-miss job may replace', () => {
  const staleBefore = new Date('2026-11-10T00:00:00Z');
  const before = new Date('2026-11-09T00:00:00Z');
  const after = new Date('2026-11-10T06:00:00Z');
  const lookup = (kind: 'absent' | 'seeded' | 'shadow' | 'served', scoredAt: Date | null) => ({
    kind,
    scoredAt,
    scores: null,
  });

  it('never replaces a seeded full- entry, however stale', () => {
    for (const mode of ['shadow', 'serve'] as const) {
      expect(searchRerankLiveMissWantsEntry(lookup('seeded', before), mode, staleBefore)).toBe(
        false,
      );
    }
  });

  it('fills a miss in either mode', () => {
    expect(searchRerankLiveMissWantsEntry(lookup('absent', null), 'shadow', null)).toBe(true);
    expect(searchRerankLiveMissWantsEntry(lookup('absent', null), 'serve', null)).toBe(true);
  });

  it('never replaces a served entry from shadow mode', () => {
    expect(searchRerankLiveMissWantsEntry(lookup('served', before), 'shadow', staleBefore)).toBe(
      false,
    );
  });

  it('refreshes a stale served entry and keeps a fresh one in serve mode', () => {
    expect(searchRerankLiveMissWantsEntry(lookup('served', before), 'serve', staleBefore)).toBe(
      true,
    );
    expect(searchRerankLiveMissWantsEntry(lookup('served', after), 'serve', staleBefore)).toBe(
      false,
    );
    expect(searchRerankLiveMissWantsEntry(lookup('served', before), 'serve', null)).toBe(false);
  });

  it('promotes a shadow entry to a served one only in serve mode', () => {
    expect(searchRerankLiveMissWantsEntry(lookup('shadow', after), 'serve', staleBefore)).toBe(
      true,
    );
    expect(searchRerankLiveMissWantsEntry(lookup('shadow', after), 'shadow', staleBefore)).toBe(
      false,
    );
    expect(searchRerankLiveMissWantsEntry(lookup('shadow', before), 'shadow', staleBefore)).toBe(
      true,
    );
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
