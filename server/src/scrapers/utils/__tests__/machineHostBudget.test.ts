import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HOST_THROTTLE_OVERRIDES,
  HostSlotWaitTimeoutError,
  YALE_HOST_DEFAULT_THROTTLE,
  type HostSlotLimiter,
} from '../hostConcurrencyLimiter';
import { fetchPageWithPolicy, HostRateLimiter, type HttpRequestFn } from '../httpFetch';
import {
  HostBudgetUnavailableError,
  MACHINE_DEFAULT_HOST_BUDGET,
  MACHINE_HOST_CORRUPT_STATE_PAUSE_MS,
  MACHINE_HOST_LOCK_STALE_MS,
  MachineHostBudgetLimiter,
  machineHostBudgetFor,
  type MachineHostBudgetLimiterOptions,
  type MachineHostBudgetState,
} from '../machineHostBudget';

const DEAD_PID = 4_000_001;
const OTHER_LIVE_PID = 4_000_002;

let root: string;
let clock: number;
let waits: number[];

beforeEach(() => {
  root = fs.mkdtempSync('/tmp/ylmhb-unit-');
  clock = 1_000_000;
  waits = [];
});

afterEach(() => {
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
    isProcessAlive: (pid) => pid !== DEAD_PID,
    warn: () => {},
    ...options,
  });
}

function seedState(limiter: MachineHostBudgetLimiter, state: MachineHostBudgetState): void {
  fs.mkdirSync(limiter.directory, { recursive: true });
  fs.writeFileSync(limiter.statePath(state.host), JSON.stringify(state));
}

const heldBy = (host: string, pid: number, expiresAt: number): MachineHostBudgetState => ({
  v: 1,
  host,
  nextGrantAt: 0,
  lastGrantAt: 0,
  slots: [{ id: `${pid}-held`, pid, grantedAt: 0, expiresAt }],
});

const passthroughAssert = async (url: string) => ({ toString: () => url });

describe('machine-wide budget per host', () => {
  it('gives a Yale host without an override one request at a time, 1.5 s apart', () => {
    expect(YALE_HOST_DEFAULT_THROTTLE).toEqual({ concurrency: 1, minIntervalMs: 1_500 });
    expect(machineHostBudgetFor('physics.yale.edu')).toEqual(YALE_HOST_DEFAULT_THROTTLE);
    expect(machineHostBudgetFor('www.yale.edu')).toEqual(YALE_HOST_DEFAULT_THROTTLE);
    expect(machineHostBudgetFor('yale.edu.')).toEqual(YALE_HOST_DEFAULT_THROTTLE);
  });

  it('keeps four concurrent requests 400 ms apart for a host outside Yale', () => {
    expect(MACHINE_DEFAULT_HOST_BUDGET).toEqual({ concurrency: 4, minIntervalMs: 400 });
    expect(machineHostBudgetFor('lab.example.org')).toEqual(MACHINE_DEFAULT_HOST_BUDGET);
    expect(machineHostBudgetFor('notyale.edu')).toEqual(MACHINE_DEFAULT_HOST_BUDGET);
  });

  it('lets an explicit override win over the Yale default', () => {
    const { concurrency, minIntervalMs } = HOST_THROTTLE_OVERRIDES['medicine.yale.edu'];
    expect(machineHostBudgetFor('medicine.yale.edu')).toEqual({ concurrency, minIntervalMs });
  });
});

describe('MachineHostBudgetLimiter failing safe', () => {
  it('pauses a host whose state file is unreadable, then starts its budget again', async () => {
    const warn = vi.fn();
    const limiter = budget({ warn });
    fs.mkdirSync(limiter.directory, { recursive: true });
    fs.writeFileSync(limiter.statePath('lab.example.org'), '{not json');
    const startedAt = clock;

    const release = await limiter.acquire('lab.example.org');
    release();

    expect(clock - startedAt).toBeGreaterThanOrEqual(MACHINE_HOST_CORRUPT_STATE_PAUSE_MS);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('is unreadable'));
    expect(limiter.readState('lab.example.org')?.v).toBe(1);
  });

  it('throws without sending when the budget directory cannot be written', async () => {
    const blocker = path.join(root, 'not-a-directory');
    fs.writeFileSync(blocker, '');
    const limiter = budget({
      directory: path.join(blocker, 'budget'),
      unavailableTimeoutMs: 1_000,
    });
    const request = vi.fn<HttpRequestFn>(async (url) => ({ status: 200, data: '', finalUrl: url }));

    await expect(
      fetchPageWithPolicy('https://lab.example.org/page', {
        assertUrl: passthroughAssert,
        request,
        sleep: async () => {},
        limiter: new HostRateLimiter({ minIntervalMs: 0, machineWide: () => limiter }),
      }),
    ).rejects.toBeInstanceOf(HostBudgetUnavailableError);
    expect(request).not.toHaveBeenCalled();
  });
});

describe('MachineHostBudgetLimiter reclaiming slots', () => {
  it('reclaims the slot of a holder whose process has died', async () => {
    const limiter = budget({ acquireTimeoutMs: 1_000 });
    seedState(limiter, heldBy('fixture-dead.yale.edu', DEAD_PID, clock + 600_000));

    const release = await limiter.acquire('fixture-dead.yale.edu');

    expect(limiter.readState('fixture-dead.yale.edu')?.slots.map((slot) => slot.pid)).toEqual([
      process.pid,
    ]);
    release();
  });

  it('reclaims a live holder whose slot has outlived its expiry', async () => {
    const limiter = budget({ acquireTimeoutMs: 1_000 });
    seedState(limiter, heldBy('fixture-expired.yale.edu', OTHER_LIVE_PID, clock - 1));

    const release = await limiter.acquire('fixture-expired.yale.edu');

    expect(limiter.readState('fixture-expired.yale.edu')?.slots).toHaveLength(1);
    release();
  });

  it('keeps waiting on a live holder whose slot has not expired', async () => {
    const limiter = budget({ acquireTimeoutMs: 1_000 });
    seedState(limiter, heldBy('fixture-live.yale.edu', OTHER_LIVE_PID, clock + 600_000));

    await expect(limiter.acquire('fixture-live.yale.edu')).rejects.toBeInstanceOf(
      HostSlotWaitTimeoutError,
    );
  });

  it('breaks a lock left by a process that died inside its read-modify-write', async () => {
    const limiter = budget();
    fs.mkdirSync(limiter.directory, { recursive: true });
    const lockPath = limiter.statePath('lab.example.org').replace(/\.json$/, '.lock');
    fs.writeFileSync(lockPath, JSON.stringify({ pid: DEAD_PID, token: 'dead' }));

    const release = await limiter.acquire('lab.example.org');

    expect(waits.filter((ms) => ms > 0)).toEqual([]);
    release();
  });

  it(`breaks a live process's lock once it is older than ${MACHINE_HOST_LOCK_STALE_MS} ms`, async () => {
    const limiter = budget();
    fs.mkdirSync(limiter.directory, { recursive: true });
    const lockPath = limiter.statePath('lab.example.org').replace(/\.json$/, '.lock');
    fs.writeFileSync(lockPath, JSON.stringify({ pid: OTHER_LIVE_PID, token: 'paused' }));
    const old = new Date(Date.now() - MACHINE_HOST_LOCK_STALE_MS - 1_000);
    fs.utimesSync(lockPath, old, old);

    const release = await limiter.acquire('lab.example.org');

    release();
    expect(limiter.readState('lab.example.org')).toBeDefined();
  });
});

describe('fetchPageWithPolicy redirects', () => {
  function recordingGate(): { gate: HostSlotLimiter; hosts: string[] } {
    const hosts: string[] = [];
    return {
      hosts,
      gate: {
        acquire: async (host) => {
          hosts.push(host);
          return () => {};
        },
      },
    };
  }

  const redirectingRequest = (): HttpRequestFn =>
    vi.fn<HttpRequestFn>(async (url) =>
      url.startsWith('https://alias.example.org/')
        ? { status: 301, data: '', finalUrl: url, location: 'https://pages.example.org/landing' }
        : { status: 200, data: '<html>landing</html>', finalUrl: url },
    );

  it('charges a 301 hop to the budget of the host that receives it', async () => {
    const { gate, hosts } = recordingGate();
    const request = redirectingRequest();

    const page = await fetchPageWithPolicy('https://alias.example.org/short', {
      assertUrl: passthroughAssert,
      request,
      limiter: new HostRateLimiter({ minIntervalMs: 0, machineWide: () => gate }),
    });

    expect(hosts).toEqual(['alias.example.org', 'pages.example.org']);
    expect(page).toMatchObject({ url: 'https://pages.example.org/landing', status: 200 });
    expect(request).toHaveBeenCalledWith(
      'https://alias.example.org/short',
      expect.objectContaining({ maxRedirects: 0 }),
    );
  });

  const credentialHeaders = {
    'User-Agent': 'fixture-agent',
    Cookie: 'Session=fixture',
    Authorization: 'Bearer fixture',
    'Proxy-Authorization': 'Basic fixture',
  };

  const headersSentTo = (request: HttpRequestFn, url: string) =>
    vi.mocked(request).mock.calls.find(([target]) => target === url)?.[1].headers;

  it('drops credentials on a hop to another host, as axios would', async () => {
    const request = redirectingRequest();

    await fetchPageWithPolicy('https://alias.example.org/short', {
      assertUrl: passthroughAssert,
      request,
      headers: credentialHeaders,
      limiter: new HostRateLimiter({ minIntervalMs: 0, machineWide: () => undefined }),
    });

    expect(headersSentTo(request, 'https://alias.example.org/short')).toEqual(credentialHeaders);
    expect(headersSentTo(request, 'https://pages.example.org/landing')).toEqual({
      'User-Agent': 'fixture-agent',
    });
  });

  it('keeps credentials on a hop to the same host or one of its subdomains', async () => {
    const request = vi.fn<HttpRequestFn>(async (url) => {
      if (url === 'https://portal.example.org/start') {
        return { status: 302, data: '', finalUrl: url, location: '/next' };
      }
      if (url === 'https://portal.example.org/next') {
        return {
          status: 302,
          data: '',
          finalUrl: url,
          location: 'https://www.portal.example.org/done',
        };
      }
      return { status: 200, data: '<html>done</html>', finalUrl: url };
    });

    await fetchPageWithPolicy('https://portal.example.org/start', {
      assertUrl: passthroughAssert,
      request,
      headers: credentialHeaders,
      limiter: new HostRateLimiter({ minIntervalMs: 0, machineWide: () => undefined }),
    });

    expect(headersSentTo(request, 'https://portal.example.org/next')).toEqual(credentialHeaders);
    expect(headersSentTo(request, 'https://www.portal.example.org/done')).toEqual(
      credentialHeaders,
    );
  });

  it('drops credentials on a hop that downgrades https to http on the same host', async () => {
    const request = vi.fn<HttpRequestFn>(async (url) =>
      url.startsWith('https://')
        ? { status: 301, data: '', finalUrl: url, location: 'http://portal.example.org/plain' }
        : { status: 200, data: '<html>plain</html>', finalUrl: url },
    );

    await fetchPageWithPolicy('https://portal.example.org/secure', {
      assertUrl: passthroughAssert,
      request,
      headers: credentialHeaders,
      limiter: new HostRateLimiter({ minIntervalMs: 0, machineWide: () => undefined }),
    });

    expect(headersSentTo(request, 'http://portal.example.org/plain')).toEqual({
      'User-Agent': 'fixture-agent',
    });
  });

  it('turns a redirected form post into a plain GET, as axios would', async () => {
    const request = vi.fn<HttpRequestFn>(async (url, config) =>
      config.method === 'POST'
        ? { status: 302, data: '', finalUrl: url, location: '/results' }
        : { status: 200, data: '<html>results</html>', finalUrl: url },
    );

    const { postFormWithPolicy } = await import('../httpFetch');
    await postFormWithPolicy('https://portal.example.org/search', new URLSearchParams('a=1'), {
      assertUrl: passthroughAssert,
      request,
      limiter: new HostRateLimiter({ minIntervalMs: 0, machineWide: () => undefined }),
    });

    const followUp = request.mock.calls[1];
    expect(followUp[0]).toBe('https://portal.example.org/results');
    expect(followUp[1].method).toBeUndefined();
    expect(followUp[1].body).toBeUndefined();
    expect(followUp[1].headers).not.toHaveProperty('Content-Type');
  });

  it('still returns a redirect status unchanged when the caller asked for no redirects', async () => {
    const request = redirectingRequest();

    await expect(
      fetchPageWithPolicy('https://alias.example.org/short', {
        assertUrl: passthroughAssert,
        request,
        maxRedirects: 0,
        limiter: new HostRateLimiter({ minIntervalMs: 0, machineWide: () => undefined }),
      }),
    ).rejects.toMatchObject({ status: 301 });
    expect(request).toHaveBeenCalledTimes(1);
  });
});
