import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { hermeticChildEnvironment } from '../test/hermeticEnvironment';

const FIXTURE = path.resolve(__dirname, 'fixtures/shutdownSignalServer.ts');
const TSX_BIN = path.resolve(__dirname, '../../node_modules/.bin/tsx');
const SERVER_ROOT = path.resolve(__dirname, '../..');

let child: ChildProcess | undefined;

const startFixtureServer = async (signalHandling: '--graceful' | '--default') => {
  child = spawn(TSX_BIN, [FIXTURE, signalHandling], {
    cwd: SERVER_ROOT,
    env: hermeticChildEnvironment({ NODE_ENV: 'development' }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const baseUrl = await new Promise<string>((resolve, reject) => {
    let output = '';
    child!.stdout?.on('data', (chunk) => {
      output += String(chunk);
      const ready = /READY (\d+)/.exec(output);
      if (ready) resolve(`http://127.0.0.1:${ready[1]}`);
    });
    child!.on('exit', (code) => reject(new Error(`fixture server exited early with ${code}`)));
  });
  return baseUrl;
};

const exitCode = () =>
  new Promise<number | null>((resolve) => child!.on('exit', (code) => resolve(code)));

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('a real stop signal sent to the running server', () => {
  afterEach(() => {
    if (child && child.exitCode === null) child.kill('SIGKILL');
    child = undefined;
  });

  it('lets a request in flight finish, then exits cleanly', async () => {
    const baseUrl = await startFixtureServer('--graceful');

    const inFlight = fetch(`${baseUrl}/slow`);
    await delay(300);
    child!.kill('SIGTERM');

    const answered = await inFlight;
    expect(answered.status).toBe(200);
    await expect(answered.json()).resolves.toEqual({ finished: true });
    await expect(exitCode()).resolves.toBe(0);
  }, 29000);

  it('keeps draining when a second stop signal of the other kind arrives', async () => {
    const baseUrl = await startFixtureServer('--graceful');

    const inFlight = fetch(`${baseUrl}/slow`);
    await delay(300);
    child!.kill('SIGTERM');
    await delay(300);
    child!.kill('SIGINT');

    const answered = await inFlight;
    expect(answered.status).toBe(200);
    await expect(answered.json()).resolves.toEqual({ finished: true });
    await expect(exitCode()).resolves.toBe(0);
  }, 29000);

  it('cuts the same request when the signal is left to its default action', async () => {
    const baseUrl = await startFixtureServer('--default');

    const cut = fetch(`${baseUrl}/slow`).then(
      () => 'answered',
      () => 'cut',
    );
    await delay(300);
    child!.kill('SIGTERM');

    await expect(cut).resolves.toBe('cut');
  }, 29000);
});
