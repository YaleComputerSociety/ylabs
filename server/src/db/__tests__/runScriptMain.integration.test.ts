import { spawn } from 'node:child_process';
import path from 'node:path';

import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hermeticChildEnvironment } from '../../test/hermeticEnvironment';
import {
  SCRIPT_EXIT_FAILED,
  SCRIPT_EXIT_HELD_OPEN,
  SCRIPT_EXIT_WATCHDOG_MS,
  SCRIPT_HELD_OPEN_MESSAGE,
  describeActiveResources,
} from '../connections';

const SERVER_ROOT = path.resolve(__dirname, '../../..');
const SCENARIO_CHILD = path.join(__dirname, 'fixtures', 'runScriptMainChild.ts');
const USER_PROJECTION_CHILD = path.join(__dirname, 'fixtures', 'userProjectionScriptChild.ts');
const CHILD_WATCHDOG_MS = 1_500;
const CHILD_RUN_CEILING_MS = 25_000;

interface ChildRun {
  status: number | null;
  stdout: string;
  stderr: string;
  elapsedMs: number;
}

// Asynchronous on purpose: the in-memory mongod is this process's child and stalls once its log
// pipe fills, so a parent blocked in spawnSync freezes the database the child script is using.
const runChild = (script: string, args: string[], env: NodeJS.ProcessEnv = {}) =>
  new Promise<ChildRun>((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(process.execPath, ['--import', 'tsx', script, ...args], {
      cwd: SERVER_ROOT,
      env: hermeticChildEnvironment(env),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    const ceiling = setTimeout(() => child.kill('SIGKILL'), CHILD_RUN_CEILING_MS);
    child.on('error', reject);
    child.on('close', (status) => {
      clearTimeout(ceiling);
      resolve({ status, stdout, stderr, elapsedMs: Date.now() - startedAt });
    });
  });

const runScenario = (scenario: string, mongoUri = '') =>
  runChild(SCENARIO_CHILD, [scenario, String(CHILD_WATCHDOG_MS), mongoUri]);

describe('runScriptMain exit handling (#5945)', () => {
  let memoryServer: MongoMemoryServer;

  beforeAll(async () => {
    memoryServer = await MongoMemoryServer.create();
  });

  afterAll(async () => {
    await memoryServer?.stop();
  });

  it('defaults to a 30 second watchdog and a held-open code distinct from failure', () => {
    expect(SCRIPT_EXIT_WATCHDOG_MS).toBe(30_000);
    expect(SCRIPT_EXIT_HELD_OPEN).toBe(3);
    expect(SCRIPT_EXIT_FAILED).toBe(1);
  });

  it('exits held-open and names the interval when work leaves a referenced interval', async () => {
    const run = await runScenario('unref-free-interval');

    expect(run.stdout).toContain('work done');
    expect(run.status, run.stderr).toBe(SCRIPT_EXIT_HELD_OPEN);
    expect(run.stderr).toContain(`${SCRIPT_HELD_OPEN_MESSAGE}: `);
    expect(run.stderr).toMatch(/Timeout x\d+/);
    expect(run.elapsedMs).toBeLessThan(CHILD_RUN_CEILING_MS);
  });

  it('exits held-open and names the server when work leaves a listening socket', async () => {
    const run = await runScenario('open-server-socket');

    expect(run.status, run.stderr).toBe(SCRIPT_EXIT_HELD_OPEN);
    expect(run.stderr).toMatch(
      /work completed; process held the event loop open: .*TCPServerWrap x1/,
    );
  });

  it('exits 0 without the held-open message when work leaves nothing open', async () => {
    const run = await runScenario('clean');

    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain('work done');
    expect(run.stderr).not.toContain(SCRIPT_HELD_OPEN_MESSAGE);
  });

  it('exits 1 and logs the error when work throws', async () => {
    const run = await runScenario('throws');

    expect(run.status).toBe(SCRIPT_EXIT_FAILED);
    expect(run.stderr).toContain('scenario failed on purpose');
    expect(run.stderr).not.toContain(SCRIPT_HELD_OPEN_MESSAGE);
  });

  it('exits 0 when work leaves a second script connection open, because it closes it', async () => {
    const run = await runScenario(
      'second-connection',
      memoryServer.getUri('run-script-main-probe'),
    );

    expect(run.stdout).toContain('work done on 2 connections');
    expect(run.status, run.stderr).toBe(0);
    expect(run.stderr).not.toContain(SCRIPT_HELD_OPEN_MESSAGE);
  });

  it('exits 0 after a hundred keys of dry-run user projections, the path the never-exiting probe ran', async () => {
    const run = await runChild(USER_PROJECTION_CHILD, [String(CHILD_WATCHDOG_MS), '100'], {
      MONGODBURL: memoryServer.getUri('run-script-main-user-projection'),
    });

    expect(run.stdout).toContain('projected 100 user keys');
    expect(run.status, run.stderr).toBe(0);
    expect(run.stderr).not.toContain(SCRIPT_HELD_OPEN_MESSAGE);
  });
});

describe('describeActiveResources', () => {
  it('counts each handle type in a stable order', () => {
    expect(describeActiveResources(['Timeout', 'TCPSocketWrap', 'Timeout'])).toBe(
      'TCPSocketWrap x1, Timeout x2',
    );
  });

  it('says so when nothing is reported', () => {
    expect(describeActiveResources([])).toBe('none reported');
  });
});
