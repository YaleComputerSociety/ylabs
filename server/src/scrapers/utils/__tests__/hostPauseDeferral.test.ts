import { describe, expect, it, vi } from 'vitest';
import {
  HOST_PAUSE_END_OF_RUN_WAIT_MS,
  partitionByHostPause,
  runDeferringPausedHosts,
} from '../hostPauseDeferral';
import { HostPausedError } from '../hostPause';

interface Row {
  id: string;
  host: string;
}

const rows: Row[] = [
  { id: 'a1', host: 'paused.example.org' },
  { id: 'b1', host: 'open.example.org' },
  { id: 'a2', host: 'paused.example.org' },
  { id: 'c1', host: 'expired.example.org' },
  { id: 'd1', host: 'later.example.org' },
];
const hostOf = (row: Row) => row.host;
const NOW = 1_000_000;

function pauses(entries: Record<string, number>) {
  return (host: string) => (entries[host] === undefined ? undefined : new Date(entries[host]));
}

describe('partitionByHostPause', () => {
  it('defers only rows on a paused host, with a count and resume time per host', () => {
    const partition = partitionByHostPause(rows, hostOf, {
      now: () => NOW,
      pausedUntil: pauses({
        'paused.example.org': NOW + 3_600_000,
        'expired.example.org': NOW,
        'later.example.org': NOW + 60_000,
      }),
    });

    expect(partition.ready.map((row) => row.id)).toEqual(['b1', 'c1']);
    expect(partition.paused.map((row) => row.id)).toEqual(['a1', 'a2', 'd1']);
    expect(partition.deferred).toEqual([
      { host: 'later.example.org', pausedUntil: new Date(NOW + 60_000), count: 1 },
      { host: 'paused.example.org', pausedUntil: new Date(NOW + 3_600_000), count: 2 },
    ]);
  });
});

function harness(entries: Record<string, number>) {
  let clock = NOW;
  const stored = new Map(rows.map((row) => [row.id, `reading of ${row.id}`]));
  const order: string[] = [];
  const log = vi.fn();
  const sleep = vi.fn(async (ms: number) => {
    clock += ms;
  });
  const work = vi.fn(async (row: Row) => {
    order.push(row.id);
    stored.set(row.id, `fresh reading of ${row.id}`);
  });
  const run = (extra: Parameters<typeof runDeferringPausedHosts<Row>>[3] = {}) =>
    runDeferringPausedHosts(rows, hostOf, work, {
      now: () => clock,
      pausedUntil: pauses(entries),
      sleep,
      log,
      ...extra,
    });
  return { stored, order, log, sleep, work, run, clock: () => clock };
}

describe('runDeferringPausedHosts', () => {
  it('works the open hosts, then defers a long pause and leaves its stored readings untouched', async () => {
    const pausedUntil = NOW + HOST_PAUSE_END_OF_RUN_WAIT_MS + 1;
    const { stored, order, log, sleep, run } = harness({ 'paused.example.org': pausedUntil });

    const result = await run();

    expect(order).toEqual(['b1', 'c1', 'd1']);
    expect(result).toEqual({
      processed: 3,
      deferred: [{ host: 'paused.example.org', pausedUntil: new Date(pausedUntil), count: 2 }],
    });
    expect(stored.get('a1')).toBe('reading of a1');
    expect(stored.get('a2')).toBe('reading of a2');
    expect(sleep).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      `host pause: paused.example.org: 2 rows deferred, resumes at ${new Date(pausedUntil).toISOString()}`,
    );
  });

  it('re-queues paused rows to the end and waits out a pause ending within five minutes', async () => {
    const { order, sleep, run } = harness({ 'paused.example.org': NOW + 60_000 });

    const result = await run();

    expect(order).toEqual(['b1', 'c1', 'd1', 'a1', 'a2']);
    expect(sleep).toHaveBeenCalledWith(60_000);
    expect(result).toEqual({ processed: 5, deferred: [] });
  });

  it('re-queues a row whose fetch met a pause recorded mid-run, then defers it', async () => {
    const entries: Record<string, number> = {};
    const { stored, run, work } = harness(entries);
    const pausedUntil = new Date(NOW + 3_600_000);
    work.mockImplementation(async (row: Row) => {
      if (row.host !== 'open.example.org') {
        stored.set(row.id, `fresh reading of ${row.id}`);
        return;
      }
      entries['open.example.org'] = pausedUntil.getTime();
      throw new HostPausedError({ host: row.host, until: pausedUntil });
    });

    const result = await run();

    expect(result.deferred).toEqual([{ host: 'open.example.org', pausedUntil, count: 1 }]);
    expect(stored.get('b1')).toBe('reading of b1');
    expect(work).toHaveBeenCalledTimes(5);
  });

  it('defers a row whose pause the store does not hold rather than handing it back forever', async () => {
    const { run, work } = harness({});
    work.mockImplementation(async (row: Row) => {
      if (row.id === 'b1') {
        throw new HostPausedError({
          host: 'redirect-target.example.org',
          until: new Date(NOW + 3_600_000),
        });
      }
    });

    const result = await run();

    expect(result.deferred.map((entry) => [entry.host, entry.count])).toEqual([
      ['open.example.org', 1],
    ]);
    expect(work).toHaveBeenCalledTimes(5);
  });

  it('rethrows a failure that is not a pause', async () => {
    const { run, work } = harness({});
    work.mockRejectedValueOnce(new Error('boom'));
    await expect(run()).rejects.toThrow('boom');
  });
});
