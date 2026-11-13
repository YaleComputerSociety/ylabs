import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hermeticChildEnvironment } from '../../../test/hermeticEnvironment';

const BUDGET_CLIENT = path.resolve(__dirname, 'fixtures/machineHostBudgetClient.ts');
const BROKER_ONLY_CLIENT = path.resolve(__dirname, 'fixtures/machineHostSlotClient.ts');
const SERVER_ROOT = path.resolve(__dirname, '../../../..');
const TIMER_SLACK_MS = 40;

interface ClientLine {
  pid: number;
  event: 'granted' | 'released' | 'done' | 'warn';
  grantedAt?: number;
  releasedAt?: number;
}

interface RunningClient {
  child: ChildProcessWithoutNullStreams;
  lines: ClientLine[];
  exited: Promise<number | null>;
}

interface Plan {
  host: string;
  requests: number;
  holdMs: number;
  parallel: number;
}

let directory: string;
const running: RunningClient[] = [];

beforeEach(() => {
  directory = fs.mkdtempSync('/tmp/ylmhb-');
});

afterEach(() => {
  for (const client of running.splice(0)) client.child.kill('SIGKILL');
  fs.rmSync(directory, { recursive: true, force: true });
});

function startClient(script: string, plan: Plan, extraEnv: NodeJS.ProcessEnv = {}): RunningClient {
  const child = spawn(process.execPath, ['--import', 'tsx', script], {
    cwd: SERVER_ROOT,
    env: hermeticChildEnvironment({
      SCRAPER_MACHINE_HOST_SLOTS: 'on',
      SCRAPER_MACHINE_HOST_SLOT_DIR: directory,
      FIXTURE_HOST: plan.host,
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

const startBudgetClient = (plan: Plan, extraEnv: NodeJS.ProcessEnv = {}) =>
  startClient(BUDGET_CLIENT, plan, extraEnv);

async function waitFor(predicate: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function spans(clients: RunningClient[]): Array<{ start: number; end: number }> {
  return clients.flatMap((client) =>
    client.lines
      .filter((line) => line.event === 'released')
      .map((line) => ({ start: line.grantedAt as number, end: line.releasedAt as number })),
  );
}

function peakInFlight(intervals: Array<{ start: number; end: number }>): number {
  const edges = intervals.flatMap((span) => [
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

function smallestGrantGap(intervals: Array<{ start: number }>): number {
  const starts = intervals.map((span) => span.start).sort((a, b) => a - b);
  let gap = Number.POSITIVE_INFINITY;
  for (let index = 1; index < starts.length; index += 1) {
    gap = Math.min(gap, starts[index] - starts[index - 1]);
  }
  return gap;
}

async function runPair(plan: Plan, extraEnv: NodeJS.ProcessEnv = {}) {
  const first = startBudgetClient(plan, extraEnv);
  const second = startBudgetClient(plan, extraEnv);
  expect(await first.exited).toBe(0);
  expect(await second.exited).toBe(0);
  const granted = spans([first, second]);
  expect(granted).toHaveLength(plan.requests * 2);
  return granted;
}

describe('machine-wide host budget across real processes', () => {
  it('holds two processes on one Yale host to one request at a time, 1.5 s apart', async () => {
    const granted = await runPair(
      { host: 'fixture-dept.yale.edu', requests: 3, holdMs: 100, parallel: 3 },
      { FIXTURE_LAYERS: 'budget-only' },
    );
    expect(peakInFlight(granted)).toBe(1);
    expect(smallestGrantGap(granted)).toBeGreaterThanOrEqual(1_500 - TIMER_SLACK_MS);
  }, 60_000);

  it('keeps a host outside Yale at four concurrent requests 400 ms apart', async () => {
    const granted = await runPair(
      { host: 'budget-fixture.example.org', requests: 4, holdMs: 2_000, parallel: 4 },
      { FIXTURE_LAYERS: 'budget-only' },
    );
    expect(peakInFlight(granted)).toBe(4);
    expect(smallestGrantGap(granted)).toBeGreaterThanOrEqual(400 - TIMER_SLACK_MS);
  }, 60_000);

  it('holds an overridden Yale host to its own override rather than the Yale default', async () => {
    const granted = await runPair(
      { host: 'ysph.yale.edu', requests: 3, holdMs: 1_500, parallel: 3 },
      { FIXTURE_LAYERS: 'budget-only' },
    );
    expect(peakInFlight(granted)).toBe(2);
    expect(smallestGrantGap(granted)).toBeGreaterThanOrEqual(400 - TIMER_SLACK_MS);
    expect(smallestGrantGap(granted)).toBeLessThan(1_500 - TIMER_SLACK_MS);
  }, 60_000);

  it('reclaims the slot of a holder that was killed, so the host is not blocked', async () => {
    const plan = { host: 'fixture-killed.yale.edu', requests: 1, holdMs: 600_000, parallel: 1 };
    const holder = startBudgetClient(plan, { FIXTURE_LAYERS: 'budget-only' });
    await waitFor(
      () => holder.lines.some((line) => line.event === 'granted'),
      20_000,
      'the first process to hold the only slot',
    );
    holder.child.kill('SIGKILL');
    await holder.exited;

    const survivor = startBudgetClient({ ...plan, holdMs: 50 }, { FIXTURE_LAYERS: 'budget-only' });
    expect(await survivor.exited).toBe(0);
    expect(spans([survivor])).toHaveLength(1);
  }, 60_000);

  it('keeps a broker-only process and a budget-and-broker process within the broker limit', async () => {
    const plan = { host: 'ysph.yale.edu', requests: 4, holdMs: 900, parallel: 4 };
    const brokerOnly = startClient(BROKER_ONLY_CLIENT, plan);
    const layered = startBudgetClient(plan);
    expect(await brokerOnly.exited).toBe(0);
    expect(await layered.exited).toBe(0);
    const granted = spans([brokerOnly, layered]);
    expect(granted).toHaveLength(8);
    expect(peakInFlight(granted)).toBe(2);
  }, 60_000);
});
