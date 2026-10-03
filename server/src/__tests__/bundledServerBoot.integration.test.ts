import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hermeticChildEnvironment } from '../test/hermeticEnvironment';
import { buildServerBundle, SERVER_ROOT, type ServerBundle } from '../test/serverBundle';

const BOOT_BUDGET_MS = 60000;
const CONNECTION_WATCH_MS = 4000;
const GATE_REFRESH_KICKOFF_BUDGET_MS = 45000;

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() =>
        typeof address === 'object' && address
          ? resolve(address.port)
          : reject(new Error('no port')),
      );
    });
  });

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('the bundled server at boot', () => {
  let bundle: ServerBundle;
  let memoryServer: MongoMemoryServer;
  let server: ChildProcess | undefined;
  let output = '';
  let port = 0;
  let yarnStubDirectory = '';
  let yarnInvocationPath = '';

  const waitForOutput = async (pattern: RegExp): Promise<RegExpMatchArray> => {
    const deadline = Date.now() + BOOT_BUDGET_MS;
    for (;;) {
      const match = output.match(pattern);
      if (match) return match;
      if (server?.exitCode !== null) throw new Error(`server exited before ${pattern}:\n${output}`);
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${pattern}:\n${output}`);
      await delay(100);
    }
  };

  const readMongoReadiness = async (): Promise<boolean> => {
    const response = await fetch(`http://127.0.0.1:${port}/api/ready`);
    const body = (await response.json()) as { mongo?: boolean };
    return body.mongo === true;
  };

  const installYarnStub = () => {
    yarnStubDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'bundled-boot-yarn-'));
    yarnInvocationPath = path.join(yarnStubDirectory, 'invocation.txt');
    const stubPath = path.join(yarnStubDirectory, 'yarn');
    fs.writeFileSync(
      stubPath,
      [
        '#!/bin/sh',
        `printf '%s\\n%s\\n' "$(pwd -P)" "$*" > '${yarnInvocationPath}.partial'`,
        `mv '${yarnInvocationPath}.partial' '${yarnInvocationPath}'`,
        '',
      ].join('\n'),
    );
    fs.chmodSync(stubPath, 0o755);
  };

  const waitForYarnInvocation = async (): Promise<string[]> => {
    const deadline = Date.now() + GATE_REFRESH_KICKOFF_BUDGET_MS;
    while (!fs.existsSync(yarnInvocationPath)) {
      if (Date.now() > deadline) throw new Error(`gates:refresh never spawned:\n${output}`);
      await delay(250);
    }
    return fs.readFileSync(yarnInvocationPath, 'utf8').trim().split('\n');
  };

  beforeAll(async () => {
    installYarnStub();
    bundle = await buildServerBundle('bundled-server-boot');
    memoryServer = await MongoMemoryServer.create();
    port = await freePort();
    server = spawn(process.execPath, [bundle.entryPath], {
      cwd: SERVER_ROOT,
      detached: true,
      env: hermeticChildEnvironment({
        NODE_ENV: 'development',
        MONGODBURL: memoryServer.getUri('bundled-server-boot'),
        PORT: String(port),
        SERVER_BASE_URL: `http://localhost:${port}`,
        SESSION_SECRET: crypto.randomBytes(48).toString('base64'),
        GATE_REFRESH_INTERVAL_MINUTES: '60',
        PATH: `${yarnStubDirectory}${path.delimiter}${process.env.PATH ?? ''}`,
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stdout?.on('data', (chunk) => {
      output += String(chunk);
    });
    server.stderr?.on('data', (chunk) => {
      output += String(chunk);
    });
    await waitForOutput(/Server is ready at:/);
  });

  afterAll(async () => {
    if (server?.pid && server.exitCode === null) {
      try {
        process.kill(-server.pid, 'SIGKILL');
      } catch {
        server.kill('SIGKILL');
      }
    }
    await memoryServer?.stop();
    bundle?.remove();
    if (yarnStubDirectory) fs.rmSync(yarnStubDirectory, { recursive: true, force: true });
  });

  it('keeps its database connection and runs no script CLI body', async () => {
    const deadline = Date.now() + CONNECTION_WATCH_MS;
    while (Date.now() < deadline) {
      expect(await readMongoReadiness()).toBe(true);
      await delay(250);
    }

    expect(server?.exitCode).toBeNull();
    expect(output).not.toMatch(/MongoDB: disconnected/);
    expect(output).not.toMatch(/"sourceCount"|"mode": "dry-run"/);
  });

  it(
    'runs gates:refresh from the server package directory',
    async () => {
      const [workingDirectory, args] = await waitForYarnInvocation();

      expect(workingDirectory).toBe(fs.realpathSync(SERVER_ROOT));
      expect(args).toBe('gates:refresh');
    },
    GATE_REFRESH_KICKOFF_BUDGET_MS + 5000,
  );
});
