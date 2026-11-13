import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchPageWithPolicy, HostRateLimiter, type HttpRequestFn } from '../httpFetch';
import {
  HOST_BACKOFF_BASE_MS,
  HOST_BACKOFF_CAP_MS,
  HOST_BACKOFF_JITTER_RATIO,
  HOST_BACKOFF_QUIET_RESET_MS,
  HOST_PAUSE_INLINE_WAIT_MS,
  HostBudgetUnavailableError,
  MACHINE_HOST_CORRUPT_STATE_PAUSE_MS,
  MachineHostBudgetLimiter,
  type MachineHostBudgetLimiterOptions,
} from '../machineHostBudget';
import { HostPausedError } from '../hostPause';
import * as seam from '../hostPauseState';

let root: string;
let clock: number;
let waits: number[];

beforeEach(() => {
  root = fs.mkdtempSync('/tmp/ylhps-unit-');
  clock = 1_000_000;
  waits = [];
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(root, { recursive: true, force: true });
});

function budget(options: MachineHostBudgetLimiterOptions = {}): MachineHostBudgetLimiter {
  return new MachineHostBudgetLimiter({
    env: { SCRAPER_MACHINE_HOST_SLOTS: 'on' },
    directory: path.join(root, 'budget'),
    now: () => clock,
    sleep: async (ms) => {
      waits.push(ms);
      clock += Math.max(1, ms);
    },
    random: () => 0.5,
    warn: () => {},
    ...options,
  });
}

const HOST = 'lab.example.org';
const pauseMs = (limiter: MachineHostBudgetLimiter, host = HOST) =>
  (limiter.pausedUntil(host)?.getTime() ?? clock) - clock;

describe('the host pause seam', () => {
  it('names the agreed constants and re-exports the store from the budget', () => {
    expect(seam.HOST_BACKOFF_BASE_MS).toBe(30_000);
    expect(seam.HOST_BACKOFF_CAP_MS).toBe(3_600_000);
    expect(seam.HOST_BACKOFF_QUIET_RESET_MS).toBe(600_000);
    expect(seam.HOST_BACKOFF_JITTER_RATIO).toBe(0.1);
    expect(HOST_PAUSE_INLINE_WAIT_MS).toBe(2_000);
    expect(Object.keys(seam).sort()).toEqual(
      [
        'HOST_BACKOFF_BASE_MS',
        'HOST_BACKOFF_CAP_MS',
        'HOST_BACKOFF_JITTER_RATIO',
        'HOST_BACKOFF_QUIET_RESET_MS',
        'hostBackoffState',
        'hostPausedUntil',
        'recordHostBackoff',
        'recordHostSuccess',
        'resetHostPauseStateForTests',
        'setHostPauseStateForTests',
      ].sort(),
    );
  });
});

describe('recording host backoff', () => {
  it('doubles the pause from the base up to the cap', async () => {
    const limiter = budget();
    const pauses: number[] = [];
    for (let attempt = 0; attempt < 9; attempt += 1) {
      await limiter.recordBackoff(HOST, { status: 429 });
      pauses.push(pauseMs(limiter));
      clock = limiter.pausedUntil(HOST)!.getTime();
    }
    expect(pauses).toEqual([
      30_000, 60_000, 120_000, 240_000, 480_000, 960_000, 1_920_000, 3_600_000, 3_600_000,
    ]);
    expect(limiter.backoffState(HOST)).toMatchObject({ level: 8, lastStatus: 429 });
  });

  it('counts refusals that arrive while a pause holds as covered by it, not as further steps', async () => {
    const limiter = budget();
    await limiter.recordBackoff(HOST, { status: 429 });
    await limiter.recordBackoff(HOST, { status: 429 });
    await limiter.recordBackoff(HOST, { status: 429 });
    expect(pauseMs(limiter)).toBe(30_000);
    expect(limiter.backoffState(HOST)?.level).toBe(0);

    clock = limiter.pausedUntil(HOST)!.getTime();
    await limiter.recordBackoff(HOST, { status: 429 });
    expect(pauseMs(limiter)).toBe(60_000);
  });

  it('restarts at the base step only after a quiet window past the end of the pause', async () => {
    const limiter = budget();
    await limiter.recordBackoff(HOST, { status: 429 });
    clock = limiter.pausedUntil(HOST)!.getTime();
    await limiter.recordBackoff(HOST, { status: 429 });
    const pauseEnd = limiter.pausedUntil(HOST)!.getTime();

    clock = pauseEnd + HOST_BACKOFF_QUIET_RESET_MS - 1;
    await limiter.recordBackoff(HOST, { status: 429 });
    expect(pauseMs(limiter)).toBe(HOST_BACKOFF_BASE_MS * 4);
    expect(limiter.backoffState(HOST)?.level).toBe(2);

    clock = limiter.pausedUntil(HOST)!.getTime() + HOST_BACKOFF_QUIET_RESET_MS;
    await limiter.recordBackoff(HOST, { status: 503 });
    expect(pauseMs(limiter)).toBe(HOST_BACKOFF_BASE_MS);
    expect(limiter.backoffState(HOST)).toMatchObject({ level: 0, since: new Date(clock) });
  });

  it('keeps the jitter within the ratio on either side of the step', async () => {
    const low = budget({ random: () => 0 });
    const high = budget({ random: () => 0.999_999, directory: path.join(root, 'high') });
    await low.recordBackoff(HOST, { status: 503 });
    await high.recordBackoff(HOST, { status: 503 });
    const spread = HOST_BACKOFF_BASE_MS * HOST_BACKOFF_JITTER_RATIO;
    expect(pauseMs(low)).toBe(HOST_BACKOFF_BASE_MS - spread);
    expect(pauseMs(high)).toBeGreaterThan(HOST_BACKOFF_BASE_MS + spread - 2);
    expect(pauseMs(high)).toBeLessThanOrEqual(HOST_BACKOFF_BASE_MS + spread);
  });

  it('honours a Retry-After longer than the backoff step', async () => {
    const limiter = budget({ random: () => 0.999_999 });
    await limiter.recordBackoff(HOST, { status: 429, retryAfterMs: 120_000 });
    expect(pauseMs(limiter)).toBe(120_000);
  });

  it('honours a stated date beyond the cap', async () => {
    const limiter = budget();
    const stated = new Date(clock + 3 * 86_400_000);
    await limiter.recordBackoff(HOST, { status: 403, statedUntil: stated });
    expect(limiter.pausedUntil(HOST)).toEqual(stated);
    expect(stated.getTime() - clock).toBeGreaterThan(HOST_BACKOFF_CAP_MS);
  });

  it('never shortens a pause when a shorter verdict arrives later', async () => {
    const limiter = budget();
    const stated = new Date(clock + 86_400_000);
    await limiter.recordBackoff(HOST, { status: 403, statedUntil: stated });
    await limiter.recordBackoff(HOST, { status: 429, retryAfterMs: 1_000 });
    await limiter.recordBackoff(HOST, { status: 403, statedUntil: new Date(clock + 60_000) });
    expect(limiter.pausedUntil(HOST)).toEqual(stated);
  });

  it('keeps the backoff when the budget later takes and hands back a slot', async () => {
    const limiter = budget();
    await limiter.recordBackoff(HOST, { status: 429 });
    clock += HOST_BACKOFF_BASE_MS;
    const release = await limiter.acquire(HOST);
    release();
    await new Promise((resolve) => setImmediate(resolve));
    expect(limiter.readState(HOST)?.backoff?.level).toBe(0);
  });
});

describe('a process opted out of the machine budget', () => {
  it('keeps its backoff to itself and writes nothing a live scrape could read', async () => {
    const env = { SCRAPER_MACHINE_HOST_SLOTS: 'off' };
    const optedOut = budget({ env });
    await optedOut.recordBackoff(HOST, { status: 429 });

    expect(pauseMs(optedOut)).toBe(HOST_BACKOFF_BASE_MS);
    expect(fs.existsSync(optedOut.directory)).toBe(false);
    expect(budget().pausedUntil(HOST)).toBeUndefined();
    expect(budget({ env }).pausedUntil(HOST)).toBeUndefined();
  });
});

describe('recording host success', () => {
  it('resets the level only after a quiet window past the end of the pause', async () => {
    const limiter = budget();
    await limiter.recordBackoff(HOST, { status: 429 });
    clock = limiter.pausedUntil(HOST)!.getTime();
    await limiter.recordBackoff(HOST, { status: 429 });
    const pauseEnd = limiter.pausedUntil(HOST)!.getTime();

    clock = pauseEnd + HOST_BACKOFF_QUIET_RESET_MS - 1;
    await limiter.recordSuccess(HOST);
    expect(limiter.backoffState(HOST)?.level).toBe(1);

    clock = pauseEnd + HOST_BACKOFF_QUIET_RESET_MS;
    await limiter.recordSuccess(HOST);
    expect(limiter.backoffState(HOST)).toBeUndefined();
    await limiter.recordBackoff(HOST, { status: 429 });
    expect(pauseMs(limiter)).toBe(HOST_BACKOFF_BASE_MS);
  });

  it('never clears an active pause', async () => {
    const limiter = budget();
    const stated = new Date(clock + 86_400_000);
    await limiter.recordBackoff(HOST, { status: 403, statedUntil: stated });
    clock += HOST_BACKOFF_QUIET_RESET_MS * 3;
    await limiter.recordSuccess(HOST);
    expect(limiter.pausedUntil(HOST)).toEqual(stated);
  });

  it('warns rather than failing the page when the reset cannot be written', async () => {
    const warn = vi.fn();
    const limiter = budget({ warn, unavailableTimeoutMs: 1_000 });
    await limiter.recordBackoff(HOST, { status: 429 });
    clock = limiter.pausedUntil(HOST)!.getTime() + HOST_BACKOFF_QUIET_RESET_MS;
    fs.chmodSync(limiter.directory, 0o500);
    try {
      await expect(limiter.recordSuccess(HOST)).resolves.toBeUndefined();
    } finally {
      fs.chmodSync(limiter.directory, 0o700);
    }

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(`could not reset the ${HOST} backoff`),
    );
    expect(limiter.backoffState(HOST)?.level).toBe(0);
  });
});

describe('which host a pause covers', () => {
  it('keys the exact host, folding case, www. and a trailing dot', async () => {
    const limiter = budget();
    await limiter.recordBackoff('Economics.Example.EDU.', { status: 429 });
    expect(limiter.pausedUntil('economics.example.edu')).toBeDefined();
    expect(limiter.pausedUntil('economics.example.edu.')).toBeDefined();
    expect(limiter.pausedUntil('www.economics.example.edu')).toBeDefined();
  });

  it('leaves a parent, a sibling and a subdomain to the policy layer', async () => {
    const limiter = budget();
    await limiter.recordBackoff('economics.example.edu', { status: 429 });
    expect(limiter.pausedUntil('example.edu')).toBeUndefined();
    expect(limiter.pausedUntil('physics.example.edu')).toBeUndefined();
    expect(limiter.pausedUntil('lab.economics.example.edu')).toBeUndefined();
  });
});

describe('an automatic pause on a Yale host', () => {
  it('pauses www.yale.edu as yale.edu and never a department under it', async () => {
    const limiter = budget();
    await limiter.recordBackoff('www.yale.edu', { status: 429 });
    expect(limiter.pausedUntil('yale.edu')).toBeDefined();
    expect(limiter.pausedUntil('medicine.yale.edu')).toBeUndefined();
    expect(limiter.pausedUntil('ysph.yale.edu')).toBeUndefined();
    expect(limiter.pausedUntil('cs.yale.edu')).toBeUndefined();
  });

  it('never pauses yale.edu for a pause on medicine.yale.edu', async () => {
    const limiter = budget();
    await limiter.recordBackoff('medicine.yale.edu', { status: 429 });
    expect(limiter.pausedUntil('medicine.yale.edu')).toBeDefined();
    expect(limiter.pausedUntil('yale.edu')).toBeUndefined();
    expect(limiter.pausedUntil('www.yale.edu')).toBeUndefined();
  });
});

describe('the hot-path read', () => {
  it('costs one stat per check and rereads only after a write from any process', async () => {
    const limiter = budget();
    const otherProcess = budget({ pid: 4_000_003 });
    await limiter.recordBackoff(HOST, { status: 429 });
    limiter.pausedUntil(HOST);
    const stat = vi.spyOn(fs, 'statSync');
    const read = vi.spyOn(fs, 'readFileSync');

    for (let check = 0; check < 5; check += 1) limiter.pausedUntil(HOST);
    expect(stat).toHaveBeenCalledTimes(5);
    expect(read).not.toHaveBeenCalled();

    const stated = new Date(clock + 86_400_000);
    await otherProcess.recordBackoff(HOST, { status: 403, statedUntil: stated });
    stat.mockClear();
    read.mockClear();
    expect(limiter.pausedUntil(HOST)).toEqual(stated);
    expect(stat).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('skips the lock when a success finds nothing recorded', async () => {
    const limiter = budget();
    const write = vi.spyOn(fs, 'writeFileSync');
    await limiter.recordSuccess(HOST);
    expect(write).not.toHaveBeenCalled();
  });
});

describe('acquiring a paused host', () => {
  it('waits out a pause that ends within the inline bound, then grants', async () => {
    const limiter = budget();
    const stated = clock + HOST_PAUSE_INLINE_WAIT_MS;
    await limiter.recordBackoff(HOST, { status: 429, statedUntil: new Date(stated) });

    const release = await limiter.acquire(HOST);
    release();

    expect(waits[0]).toBe(HOST_PAUSE_INLINE_WAIT_MS);
    expect(clock).toBeGreaterThanOrEqual(stated);
  });

  it('fails fast on a longer pause, naming the host and when it ends', async () => {
    const limiter = budget();
    const stated = new Date(clock + HOST_PAUSE_INLINE_WAIT_MS + 1);
    await limiter.recordBackoff(HOST, { status: 429, statedUntil: stated });

    const refusal = await limiter.acquire(HOST).catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(HostPausedError);
    expect(refusal).toMatchObject({ pause: { host: HOST, until: stated } });
    expect(waits).toEqual([]);
  });

  it('hands its slot back and refuses when a pause lands while it waits for its slot', async () => {
    const yaleHost = 'fixture-dept.yale.edu';
    const otherProcess = budget({ pid: 4_000_004 });
    let duringWait: (() => Promise<unknown>) | undefined;
    const limiter = budget({
      sleep: async (ms) => {
        waits.push(ms);
        const hook = duringWait;
        duringWait = undefined;
        await hook?.();
        clock += Math.max(1, ms);
      },
    });
    const first = await limiter.acquire(yaleHost);
    first();
    await new Promise((resolve) => setImmediate(resolve));
    duringWait = () =>
      otherProcess.recordBackoff(yaleHost, {
        status: 403,
        statedUntil: new Date(clock + 3_600_000),
      });

    await expect(limiter.acquire(yaleHost)).rejects.toBeInstanceOf(HostPausedError);
    expect(waits.some((ms) => ms > 0)).toBe(true);
    expect(limiter.readState(yaleHost)?.slots).toEqual([]);
  });

  it('sends nothing and does not retry when fetchPageWithPolicy meets a pause', async () => {
    const limiter = budget();
    await limiter.recordBackoff(HOST, { status: 429, retryAfterMs: 600_000 });
    const request = vi.fn<HttpRequestFn>(async (url) => ({ status: 200, data: '', finalUrl: url }));
    const sleep = vi.fn(async () => {});

    await expect(
      fetchPageWithPolicy(`https://${HOST}/page`, {
        assertUrl: async (url: string) => ({ toString: () => url }),
        request,
        sleep,
        limiter: new HostRateLimiter({ minIntervalMs: 0, machineWide: () => limiter }),
      }),
    ).rejects.toBeInstanceOf(HostPausedError);
    expect(request).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
  });
});

describe('failing closed', () => {
  it('reads a corrupt state file as paused without writing it', () => {
    const limiter = budget();
    fs.mkdirSync(limiter.directory, { recursive: true });
    fs.writeFileSync(limiter.statePath(HOST), '{"v":1,"host":"lab.example.org","backoff":7}');
    const write = vi.spyOn(fs, 'writeFileSync');

    expect(pauseMs(limiter)).toBe(MACHINE_HOST_CORRUPT_STATE_PAUSE_MS);
    expect(limiter.backoffState(HOST)?.pausedUntil.getTime()).toBe(
      clock + MACHINE_HOST_CORRUPT_STATE_PAUSE_MS,
    );
    expect(write).not.toHaveBeenCalled();
  });

  it('reads an unreachable budget directory as paused and refuses to record', async () => {
    const blocker = path.join(root, 'not-a-directory');
    fs.writeFileSync(blocker, '');
    const limiter = budget({
      directory: path.join(blocker, 'budget'),
      unavailableTimeoutMs: 1_000,
    });

    expect(pauseMs(limiter)).toBe(MACHINE_HOST_CORRUPT_STATE_PAUSE_MS);
    await expect(limiter.recordBackoff(HOST, { status: 429 })).rejects.toBeInstanceOf(
      HostBudgetUnavailableError,
    );
    await expect(limiter.acquire(HOST)).rejects.toBeInstanceOf(HostBudgetUnavailableError);
  });
});

async function grantGapMs(limiter: MachineHostBudgetLimiter, host: string): Promise<number> {
  const first = await limiter.acquire(host);
  const firstAt = clock;
  first();
  await new Promise((resolve) => setImmediate(resolve));
  const second = await limiter.acquire(host);
  const gap = clock - firstAt;
  second();
  await new Promise((resolve) => setImmediate(resolve));
  return gap;
}
