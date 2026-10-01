import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import apiRouter from '../../routes';
import { mongoKeepAliveTick } from '../connections';

const DATABASE = 'mongo_blip_at_boot_heals_test';
const ABSENT_SLUG = 'synthetic-entity-that-was-never-stored';
const CONNECTED = 1;

let memoryServer: MongoMemoryServer | undefined;
let server: Server | undefined;
let baseUrl = '';

const detailRequestStatus = async (): Promise<number> => {
  const response = await fetch(`${baseUrl}/api/research/${ABSENT_SLUG}`, { redirect: 'manual' });
  await response.arrayBuffer();
  return response.status;
};

describe('a listening server whose mongo connection is missing', () => {
  beforeAll(async () => {
    memoryServer = await MongoMemoryServer.create();
    process.env.MONGODBURL = memoryServer.getUri(DATABASE);

    const app = express();
    app.use(express.json());
    app.use('/api', apiRouter);
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    await mongoose.disconnect();
    await memoryServer?.stop();
    delete process.env.MONGODBURL;
  });

  it('starts serving once the keep-alive pass reaches a connection that was never established', async () => {
    expect(mongoose.connection.readyState).not.toBe(CONNECTED);
    expect(mongoose.connection.db).toBeUndefined();

    await mongoKeepAliveTick();

    expect(mongoose.connection.readyState).toBe(CONNECTED);
    expect(await detailRequestStatus()).toBe(404);
  });

  it('keeps serving after the established connection is torn down under it', async () => {
    expect(await detailRequestStatus()).toBe(404);

    await mongoose.disconnect();
    expect(mongoose.connection.readyState).not.toBe(CONNECTED);

    await mongoKeepAliveTick();

    expect(mongoose.connection.readyState).toBe(CONNECTED);
    expect(await detailRequestStatus()).toBe(404);
  });
});
