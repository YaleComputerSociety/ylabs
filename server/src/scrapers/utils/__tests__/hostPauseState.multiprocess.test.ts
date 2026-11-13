import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hermeticChildEnvironment } from '../../../test/hermeticEnvironment';
import { MachineHostBudgetLimiter } from '../machineHostBudget';

const BUDGET_CLIENT = path.resolve(__dirname, 'fixtures/machineHostBudgetClient.ts');
const PAUSE_CLIENT = path.resolve(__dirname, 'fixtures/hostPauseClient.ts');
const SERVER_ROOT = path.resolve(__dirname, '../../../..');
const TIMER_SLACK_MS = 40;

interface ClientLine {
  event: 'granted' | 'refused' | 'recorded';
  startedAt?: number;
  grantedAt?: number;
  pausedUntil?: number;
  error?: string;
  level?: number;
}

let directory: string;
const children: Array<ReturnType<typeof spawn>> = [];

beforeEach(() => {
  directory = fs.mkdtempSync('/tmp/ylhps-');
});

afterEach(() => {
  for (const child of children.splice(0)) child.kill('SIGKILL');
  fs.rmSync(directory, { recursive: true, force: true });
});

function runClient(env: NodeJS.ProcessEnv, script = PAUSE_CLIENT): Promise<ClientLine[]> {
  const child = spawn(process.execPath, ['--import', 'tsx', script], {
    cwd: SERVER_ROOT,
    env: hermeticChildEnvironment({
      SCRAPER_MACHINE_HOST_SLOTS: 'on',
      SCRAPER_MACHINE_HOST_SLOT_DIR: directory,
      ...env,
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk) => (stdout += String(chunk)));
  child.stderr?.on('data', (chunk) => (stderr += String(chunk)));
  return new Promise((resolve, reject) =>
    child.on('exit', (code) => {
      if (code !== 0) reject(new Error(`client exited ${code}: ${stderr}`));
      else
        resolve(
          stdout
            .split('\n')
            .filter((line) => line.startsWith('{'))
            .map((line) => JSON.parse(line) as ClientLine),
        );
    }),
  );
}

const thisProcess = () =>
  new MachineHostBudgetLimiter({
    env: { SCRAPER_MACHINE_HOST_SLOTS: 'on', SCRAPER_MACHINE_HOST_SLOT_DIR: directory },
    warn: () => {},
  });

describe('shared host backoff across real processes', () => {
  it('holds another process acquire through a short pause and resumes it on its own', async () => {
    const host = 'pause-short.example.org';
    const startAt = Date.now() + 3_000;
    const client = runClient({
      FIXTURE_HOST: host,
      FIXTURE_MODE: 'acquire',
      FIXTURE_START_AT: String(startAt),
    });
    const recorded = await thisProcess().recordBackoff(host, {
      status: 429,
      statedUntil: new Date(startAt + 1_500),
    });

    const [line] = await client;

    expect(line.event).toBe('granted');
    expect(line.startedAt).toBeLessThan((recorded as Date).getTime());
    expect(line.grantedAt).toBeGreaterThanOrEqual((recorded as Date).getTime() - TIMER_SLACK_MS);
  }, 60_000);

  it('makes another process fail fast on a long pause, naming when it ends', async () => {
    const host = 'pause-long.example.org';
    const recorded = await thisProcess().recordBackoff(host, {
      status: 403,
      statedUntil: new Date(Date.now() + 3_600_000),
    });

    const [line] = await runClient({ FIXTURE_HOST: host, FIXTURE_MODE: 'acquire' });

    expect(line).toMatchObject({
      event: 'refused',
      error: 'HostPausedError',
      pausedUntil: (recorded as Date).getTime(),
    });
  }, 60_000);

  it('never lets a shorter verdict from another process shorten a pause, and loses no record', async () => {
    const host = 'pause-race.example.org';
    const far = Date.now() + 3 * 86_400_000;
    const startAt = String(Date.now() + 2_500);
    const results = await Promise.all([
      runClient({
        FIXTURE_HOST: host,
        FIXTURE_MODE: 'record',
        FIXTURE_START_AT: startAt,
        FIXTURE_STATED_UNTIL: String(far),
      }),
      ...[1_000, 2_000, 5_000].map((retryAfterMs) =>
        runClient({
          FIXTURE_HOST: host,
          FIXTURE_MODE: 'record',
          FIXTURE_START_AT: startAt,
          FIXTURE_RETRY_AFTER_MS: String(retryAfterMs),
        }),
      ),
    ]);
    expect(results.flat().every((line) => line.event === 'recorded')).toBe(true);

    const state = thisProcess().readState(host);
    expect(state?.backoff?.pausedUntil).toBe(far);
    expect(state?.backoff?.level).toBe(3);
  }, 60_000);

  it('spaces two other processes by a crawl delay stricter than the budget', async () => {
    const host = 'crawl-delay.example.org';
    await thisProcess().setMinInterval(host, 1_200);
    const plan = {
      FIXTURE_HOST: host,
      FIXTURE_REQUESTS: '2',
      FIXTURE_HOLD_MS: '20',
      FIXTURE_PARALLEL: '1',
      FIXTURE_LAYERS: 'budget-only',
    };

    const lines = (
      await Promise.all([runClient(plan, BUDGET_CLIENT), runClient(plan, BUDGET_CLIENT)])
    ).flat();

    const grants = lines
      .filter((line) => (line.event as string) === 'released')
      .map((line) => line.grantedAt as number)
      .sort((a, b) => a - b);
    expect(grants).toHaveLength(4);
    const gaps = grants.slice(1).map((at, index) => at - grants[index]);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(1_200 - TIMER_SLACK_MS);
  }, 60_000);
});
