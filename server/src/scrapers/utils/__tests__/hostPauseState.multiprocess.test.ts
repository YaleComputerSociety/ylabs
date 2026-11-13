import { spawn } from 'child_process';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hermeticChildEnvironment } from '../../../test/hermeticEnvironment';
import { MachineHostBudgetLimiter } from '../machineHostBudget';

const PAUSE_CLIENT = path.resolve(__dirname, 'fixtures/hostPauseClient.ts');
const FETCH_CLIENT = path.resolve(__dirname, 'fixtures/hostPauseFetchClient.ts');
const SERVER_ROOT = path.resolve(__dirname, '../../../..');
const TIMER_SLACK_MS = 40;

interface ClientLine {
  event: 'granted' | 'refused' | 'recorded' | 'fetched';
  startedAt?: number;
  grantedAt?: number;
  pausedUntil?: number;
  storedPause?: number;
  status?: number;
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
    expect(state?.backoff?.level).toBe(0);
  }, 60_000);
});

// RFC 5737 reserves 192.0.2.0/24 for documentation, so the synthetic notice names an address that
// can belong to nobody; a real notice names this machine and is never copied into the repository.
const SYNTHETIC_NOTICE =
  'Your address 192.0.2.10 has been blocked until Fri, 20 Nov 2099 07:32:40 +0000 for excessive requests.';

describe('a pause one process recorded, read by a fresh process before any socket opens', () => {
  it('refuses the paused host with no connection, and still connects for an unpaused one', async () => {
    const connections: string[] = [];
    const server = http.createServer((_request, response) => response.end('<html></html>'));
    server.on('connection', (socket) => connections.push(String(socket.remoteAddress)));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };

    const fetchArm = {
      FIXTURE_HOST: '127.0.0.1',
      FIXTURE_MODE: 'fetch',
      FIXTURE_URL: `http://127.0.0.1:${port}/a`,
    };

    try {
      const [allowed] = await runClient(fetchArm, FETCH_CLIENT);
      expect(allowed).toMatchObject({ event: 'fetched', status: 200 });
      expect(connections).toHaveLength(1);

      const [recorded] = await runClient(
        {
          FIXTURE_HOST: '127.0.0.1',
          FIXTURE_MODE: 'record-notice',
          FIXTURE_NOTICE: SYNTHETIC_NOTICE,
        },
        FETCH_CLIENT,
      );
      expect(recorded).toMatchObject({ event: 'recorded' });

      const [refused] = await runClient(fetchArm, FETCH_CLIENT);

      expect(refused).toMatchObject({
        event: 'refused',
        error: 'HostPausedError',
        pausedUntil: recorded.pausedUntil,
        storedPause: recorded.pausedUntil,
      });
      expect(connections).toHaveLength(1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 120_000);
});
