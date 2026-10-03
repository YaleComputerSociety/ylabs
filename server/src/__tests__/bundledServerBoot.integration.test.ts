import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';

import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hermeticChildEnvironment } from '../test/hermeticEnvironment';
import { buildServerBundle, SERVER_ROOT, type ServerBundle } from '../test/serverBundle';

const BOOT_BUDGET_MS = 60000;
const CONNECTION_WATCH_MS = 4000;
const SCHEDULER_LINE = /\[gate-refresh\] scheduler enabled: .* in (.+)$/m;

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

  beforeAll(async () => {
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
        SESSION_SECRET: 'bundled-boot-session-secret-0123456789-abcdefghij',
        GATE_REFRESH_INTERVAL_MINUTES: '60',
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
  });

  it('keeps its database connection and runs no script CLI body', async () => {
    const deadline = Date.now() + CONNECTION_WATCH_MS;
    while (Date.now() < deadline) {
      expect(await readMongoReadiness()).toBe(true);
      await delay(250);
    }

    expect(output).not.toMatch(/MongoDB: disconnected/);
    expect(output).not.toMatch(/"sourceCount"|"mode": "dry-run"/);
  });

  it('starts the gate refresh scheduler in the server package directory', async () => {
    const [, workingDirectory] = await waitForOutput(SCHEDULER_LINE);

    expect(workingDirectory.trim()).toBe(SERVER_ROOT);
  });
});
