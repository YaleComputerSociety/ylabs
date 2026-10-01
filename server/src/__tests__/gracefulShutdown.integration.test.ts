import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterEach, beforeAll, afterAll, describe, expect, it } from 'vitest';

import { mongoOptions, startMongoKeepAlive } from '../db/connections';
import { DRAIN_TIMEOUT_MS, PLATFORM_KILL_TIMEOUT_MS, shutdownServer } from '../serverShutdown';

const DATABASE = 'graceful_shutdown_test';
const SLOW_RESPONSE_MS = 1500;
const CONNECTED = 1;

let memoryServer: MongoMemoryServer | undefined;
let server: Server | undefined;
let baseUrl = '';

const startServerWith = async (configure: (app: express.Express) => void) => {
  const app = express();
  configure(app);
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server!.once('listening', () => resolve()));
  baseUrl = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
};

let markReachedHandler: () => void = () => undefined;
const requestReachedHandler = () =>
  new Promise<void>((resolve) => {
    markReachedHandler = resolve;
  });

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('shutting the server down on a stop signal', () => {
  beforeAll(async () => {
    memoryServer = await MongoMemoryServer.create();
    process.env.MONGODBURL = memoryServer.getUri(DATABASE);
  });

  afterEach(async () => {
    if (server?.listening) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
    server = undefined;
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  });

  afterAll(async () => {
    await memoryServer?.stop();
    delete process.env.MONGODBURL;
  });

  it('keeps the drain window inside the platform kill timeout', () => {
    expect(DRAIN_TIMEOUT_MS).toBeLessThan(PLATFORM_KILL_TIMEOUT_MS);
  });

  it('finishes a request that was in flight and refuses a new connection', async () => {
    await startServerWith((app) => {
      app.get('/slow', (_request, response) => {
        markReachedHandler();
        setTimeout(() => response.status(200).json({ finished: true }), SLOW_RESPONSE_MS);
      });
    });

    const reached = requestReachedHandler();
    const inFlight = fetch(`${baseUrl}/slow`);
    await reached;

    const outcome = await shutdownServer({
      server: server!,
      signal: 'SIGTERM',
    });

    const answered = await inFlight;
    expect(answered.status).toBe(200);
    await expect(answered.json()).resolves.toEqual({ finished: true });
    expect(outcome).toBe('drained');

    await expect(fetch(`${baseUrl}/slow`)).rejects.toThrow();
  }, 29000);

  it('cuts a request that outlives the drain window, and says so', async () => {
    await startServerWith((app) => {
      app.get('/never', () => markReachedHandler());
    });

    const reached = requestReachedHandler();
    const abandoned = fetch(`${baseUrl}/never`).catch(() => 'cut');
    await reached;

    const outcome = await shutdownServer({
      server: server!,
      signal: 'SIGTERM',
      drainTimeoutMs: 700,
    });

    expect(outcome).toBe('drain_timed_out');
    await expect(abandoned).resolves.toBe('cut');
  }, 29000);

  it('leaves the database connection closed instead of letting the keep-alive reopen it', async () => {
    await mongoose.connect(process.env.MONGODBURL as string, mongoOptions);
    expect(mongoose.connection.readyState).toBe(CONNECTED);
    startMongoKeepAlive(50);

    await startServerWith((app) => {
      app.get('/ok', (_request, response) => response.status(200).json({ ok: true }));
    });

    await shutdownServer({ server: server!, signal: 'SIGTERM' });
    await delay(400);

    expect(mongoose.connection.readyState).not.toBe(CONNECTED);
  }, 29000);
});
