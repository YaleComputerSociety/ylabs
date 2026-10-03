import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import fs from 'fs';
import net from 'net';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hermeticChildEnvironment } from '../../../test/hermeticEnvironment';
import { startSweepHostSlotBroker } from '../../../scripts/runScraperSweep';
import { brokerSocketPath, type HostSlotBroker } from '../hostSlotBroker';
import { MachineHostSlotLimiter, machineHostSlotPaths } from '../machineHostSlotBroker';

const CLIENT_SCRIPT = path.resolve(__dirname, 'fixtures/machineHostSlotClient.ts');
const SERVER_ROOT = path.resolve(__dirname, '../../../..');
const OVERRIDDEN_HOST = 'medicine.yale.edu';

interface ClientLine {
  pid: number;
  event: 'granted' | 'released' | 'done' | 'warn';
  request?: number;
  role?: string;
  grantedAt?: number;
  releasedAt?: number;
  message?: string;
}

interface RunningClient {
  child: ChildProcessWithoutNullStreams;
  lines: ClientLine[];
  exited: Promise<number | null>;
}

let directory: string;
const running: RunningClient[] = [];
const cleanups: Array<() => Promise<void> | void> = [];

beforeEach(() => {
  directory = fs.mkdtempSync('/tmp/ylmhs-');
});

afterEach(async () => {
  for (const client of running.splice(0)) client.child.kill('SIGKILL');
  for (const cleanup of cleanups.splice(0)) await cleanup();
  fs.rmSync(directory, { recursive: true, force: true });
});

function startClient(
  plan: { requests: number; holdMs: number; parallel: number; host?: string },
  extraEnv: NodeJS.ProcessEnv = {},
): RunningClient {
  // Node itself, not the tsx wrapper, so a SIGKILL reaches the process that holds the broker.
  const child = spawn(process.execPath, ['--import', 'tsx', CLIENT_SCRIPT], {
    cwd: SERVER_ROOT,
    env: hermeticChildEnvironment({
      SCRAPER_MACHINE_HOST_SLOTS: 'on',
      SCRAPER_MACHINE_HOST_SLOT_DIR: directory,
      FIXTURE_HOST: plan.host ?? OVERRIDDEN_HOST,
      FIXTURE_REQUESTS: String(plan.requests),
      FIXTURE_HOLD_MS: String(plan.holdMs),
      FIXTURE_PARALLEL: String(plan.parallel),
      ...extraEnv,
    }),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const lines: ClientLine[] = [];
  let buffered = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    buffered += String(chunk);
    let newline = buffered.indexOf('\n');
    while (newline >= 0) {
      const line = buffered.slice(0, newline).trim();
      buffered = buffered.slice(newline + 1);
      if (line.startsWith('{')) lines.push(JSON.parse(line) as ClientLine);
      newline = buffered.indexOf('\n');
    }
  });
  child.stderr.on('data', (chunk) => (stderr += String(chunk)));
  const exited = new Promise<number | null>((resolve) =>
    child.on('exit', (code) => {
      if (code !== 0 && code !== null) console.error(stderr);
      resolve(code);
    }),
  );
  const client = { child, lines, exited };
  running.push(client);
  return client;
}

async function waitFor(predicate: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function intervals(clients: RunningClient[]): Array<{ start: number; end: number }> {
  return clients.flatMap((client) =>
    client.lines
      .filter((line) => line.event === 'released')
      .map((line) => ({ start: line.grantedAt as number, end: line.releasedAt as number })),
  );
}

function peakInFlight(spans: Array<{ start: number; end: number }>): number {
  const edges = spans.flatMap((span) => [
    { at: span.start, delta: 1 },
    { at: span.end, delta: -1 },
  ]);
  edges.sort((a, b) => a.at - b.at || a.delta - b.delta);
  let current = 0;
  let peak = 0;
  for (const edge of edges) {
    current += edge.delta;
    peak = Math.max(peak, current);
  }
  return peak;
}

function smallestGrantGap(spans: Array<{ start: number }>): number {
  const starts = spans.map((span) => span.start).sort((a, b) => a - b);
  let gap = Number.POSITIVE_INFINITY;
  for (let index = 1; index < starts.length; index += 1) {
    gap = Math.min(gap, starts[index] - starts[index - 1]);
  }
  return gap;
}

describe('machine-wide host slot broker across real processes', () => {
  it('holds two concurrent scrape processes to one override budget on the same host', async () => {
    const plan = { requests: 6, holdMs: 900, parallel: 4 };
    const first = startClient(plan);
    const second = startClient(plan);

    expect(await first.exited).toBe(0);
    expect(await second.exited).toBe(0);

    const spans = intervals([first, second]);
    expect(spans).toHaveLength(12);
    expect(peakInFlight(spans)).toBe(2);
    expect(smallestGrantGap(spans)).toBeGreaterThanOrEqual(350);
    const roles = new Set(
      [...first.lines, ...second.lines]
        .filter((line) => line.event === 'granted')
        .map((line) => `${line.pid}:${line.role}`),
    );
    expect([...roles].some((role) => role.endsWith(':host'))).toBe(true);
    expect([...roles].some((role) => role.endsWith(':client'))).toBe(true);
  }, 60_000);

  it('holds a host without an override to the machine-wide default budget', async () => {
    const plan = { requests: 8, holdMs: 200, parallel: 4, host: 'example.yale.edu' };
    const first = startClient(plan);
    const second = startClient(plan);

    expect(await first.exited).toBe(0);
    expect(await second.exited).toBe(0);
    expect(peakInFlight(intervals([first, second]))).toBe(4);
  }, 60_000);

  it('shares one budget between a sweep child and a hand-run lane', async () => {
    const machine = new MachineHostSlotLimiter({
      paths: machineHostSlotPaths({ SCRAPER_MACHINE_HOST_SLOT_DIR: directory }),
      env: { SCRAPER_MACHINE_HOST_SLOTS: 'on' },
      warn: () => {},
    });
    const sweepBroker: HostSlotBroker = await startSweepHostSlotBroker(
      {},
      brokerSocketPath(`ylmhs-sweep-${process.pid}.sock`, directory),
      { machineWide: machine },
    );
    cleanups.push(async () => {
      await sweepBroker.close();
      machine.close();
    });
    (await machine.acquire('warm-up.yale.edu'))();
    expect(machine.role).toBe('host');

    const plan = { requests: 6, holdMs: 900, parallel: 4 };
    const sweepChild = startClient(plan, { SCRAPER_HOST_SLOT_BROKER: sweepBroker.socketPath });
    const handRun = startClient(plan);

    expect(await sweepChild.exited).toBe(0);
    expect(await handRun.exited).toBe(0);
    const spans = intervals([sweepChild, handRun]);
    expect(spans).toHaveLength(12);
    expect(peakInFlight(spans)).toBe(2);
    expect(handRun.lines.find((line) => line.event === 'granted')?.role).toBe('client');
  }, 60_000);

  it('takes over within a bounded time when the broker process is killed mid-run', async () => {
    const broker = startClient({ requests: 2, holdMs: 600_000, parallel: 2 });
    await waitFor(
      () => broker.lines.filter((line) => line.event === 'granted').length === 2,
      20_000,
      'the first process to hold both slots',
    );
    expect(broker.lines[0].role).toBe('host');

    const survivor = startClient({ requests: 4, holdMs: 100, parallel: 2 });
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    expect(survivor.lines.filter((line) => line.event === 'granted')).toHaveLength(0);

    const killedAt = Date.now();
    broker.child.kill('SIGKILL');
    expect(await survivor.exited).toBe(0);

    const grants = survivor.lines.filter((line) => line.event === 'granted');
    expect(grants).toHaveLength(4);
    expect((grants[0].grantedAt as number) - killedAt).toBeLessThan(5_000);
    expect(grants.every((line) => line.role === 'host')).toBe(true);
    expect(survivor.lines.some((line) => line.event === 'warn')).toBe(false);
  }, 60_000);
});

describe('machine-wide host slot broker recovery', () => {
  function limiterIn(
    options: Partial<ConstructorParameters<typeof MachineHostSlotLimiter>[0]> = {},
  ) {
    const warnings: string[] = [];
    const limiter = new MachineHostSlotLimiter({
      paths: machineHostSlotPaths({ SCRAPER_MACHINE_HOST_SLOT_DIR: directory }),
      env: { SCRAPER_MACHINE_HOST_SLOTS: 'on' },
      warn: (message) => warnings.push(message),
      ...options,
    });
    cleanups.push(() => limiter.close());
    return { limiter, warnings };
  }

  async function exitedPid(): Promise<number> {
    const child = spawn(process.execPath, ['-e', '0']);
    await new Promise((resolve) => child.on('exit', resolve));
    return child.pid as number;
  }

  it('clears a stale socket file and a lock left by a dead process, then serves', async () => {
    const { socketPath, lockPath } = machineHostSlotPaths({
      SCRAPER_MACHINE_HOST_SLOT_DIR: directory,
    });
    fs.writeFileSync(socketPath, 'not a socket');
    fs.writeFileSync(lockPath, JSON.stringify({ pid: await exitedPid(), token: 'dead' }));

    const { limiter, warnings } = limiterIn();
    const release = await limiter.acquire(OVERRIDDEN_HOST);
    expect(limiter.role).toBe('host');
    expect(JSON.parse(fs.readFileSync(lockPath, 'utf8')).pid).toBe(process.pid);
    expect(warnings).toEqual([]);
    release();
    limiter.close();
    expect(fs.existsSync(lockPath)).toBe(false);
    expect(fs.existsSync(socketPath)).toBe(false);
  });

  it('breaks an old unreadable lock but waits out a fresh one held by a live process', async () => {
    const { lockPath } = machineHostSlotPaths({ SCRAPER_MACHINE_HOST_SLOT_DIR: directory });
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.ppid, token: 'live' }));
    const fresh = limiterIn({ joinTimeoutMs: 400 });
    const startedAt = Date.now();
    await fresh.limiter.acquire(OVERRIDDEN_HOST);
    expect(Date.now() - startedAt).toBeLessThan(2_000);
    expect(fresh.limiter.role).toBe('fallback');
    expect(fresh.warnings).toHaveLength(1);

    fs.writeFileSync(lockPath, 'garbage');
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(lockPath, old, old);
    const recovered = limiterIn();
    await recovered.limiter.acquire(OVERRIDDEN_HOST);
    expect(recovered.limiter.role).toBe('host');
  });

  it('falls back within a bounded time when the broker accepts but never answers', async () => {
    const { socketPath, lockPath } = machineHostSlotPaths({
      SCRAPER_MACHINE_HOST_SLOT_DIR: directory,
    });
    const accepted: net.Socket[] = [];
    const wedged = net.createServer((socket) => accepted.push(socket));
    await new Promise<void>((resolve) => wedged.listen(socketPath, resolve));
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, token: 'wedged' }));
    cleanups.push(
      () =>
        new Promise<void>((resolve) => {
          for (const socket of accepted) socket.destroy();
          wedged.close(() => resolve());
        }),
    );

    const { limiter, warnings } = limiterIn({ wedgeTimeoutMs: 300 });
    const startedAt = Date.now();
    await limiter.acquire(OVERRIDDEN_HOST);
    expect(Date.now() - startedAt).toBeLessThan(6_000);
    expect(limiter.role).toBe('fallback');
    expect(warnings[0]).toMatch(/has not answered/);
  }, 20_000);

  it('gives up on a slot that a live broker never frees, after the acquire timeout', async () => {
    const holder = limiterIn();
    await holder.limiter.acquire(OVERRIDDEN_HOST);
    await holder.limiter.acquire(OVERRIDDEN_HOST);
    const starved = limiterIn({ acquireTimeoutMs: 300 });
    const startedAt = Date.now();
    await starved.limiter.acquire(OVERRIDDEN_HOST);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(280);
    expect(Date.now() - startedAt).toBeLessThan(3_000);
    expect(starved.warnings[0]).toMatch(/within 300 ms/);
  });

  it('re-registers the slots it holds with the broker that takes over', async () => {
    const first = limiterIn();
    await first.limiter.acquire('takeover.yale.edu');
    const second = limiterIn();
    await second.limiter.acquire(OVERRIDDEN_HOST);
    await second.limiter.acquire(OVERRIDDEN_HOST);
    expect(second.limiter.role).toBe('client');

    let waitingGranted = false;
    void second.limiter.acquire(OVERRIDDEN_HOST).then(() => (waitingGranted = true));
    first.limiter.close();
    const third = limiterIn();
    let thirdGranted = false;
    await new Promise((resolve) => setTimeout(resolve, 500));
    void third.limiter.acquire(OVERRIDDEN_HOST).then(() => (thirdGranted = true));
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(second.limiter.role).toBe('host');
    expect(thirdGranted).toBe(false);
    expect(waitingGranted).toBe(false);
  });

  it('never opens a socket when sharing is switched off or a benchmark replay is active', async () => {
    const off = new MachineHostSlotLimiter({
      paths: machineHostSlotPaths({ SCRAPER_MACHINE_HOST_SLOT_DIR: directory }),
      env: { SCRAPER_MACHINE_HOST_SLOTS: 'off' },
    });
    const replay = limiterIn({ isBypassed: () => true });
    await off.acquire(OVERRIDDEN_HOST);
    await replay.limiter.acquire(OVERRIDDEN_HOST);
    expect(fs.readdirSync(directory)).toEqual([]);
    expect(off.role).toBe('idle');
    expect(replay.limiter.role).toBe('idle');
  });
});
