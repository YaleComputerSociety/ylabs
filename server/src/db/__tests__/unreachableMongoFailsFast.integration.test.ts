import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import apiRouter from '../../routes';
import { errorHandler } from '../../middleware/errorHandler';
import { ResearchEntity } from '../../models/researchEntity';
import { mongoOptions } from '../connections';

const DATABASE = 'unreachable_mongo_fails_fast_test';
const ABSENT_SLUG = 'synthetic-entity-that-was-never-stored';
const SLOW_QUERY_MS = 7000;
const FAIL_FAST_CEILING_MS = 15000;

let memoryServer: MongoMemoryServer | undefined;
let server: Server | undefined;
let baseUrl = '';

const detailRequest = async () => {
  const response = await fetch(`${baseUrl}/api/research/${ABSENT_SLUG}`, { redirect: 'manual' });
  await response.arrayBuffer();
  return {
    status: response.status as number | string,
    retryAfter: response.headers.get('retry-after'),
  };
};

const detailRequestWithinFailFastCeiling = async () => {
  let stillWaiting: ReturnType<typeof setTimeout> | undefined;
  const ceiling = new Promise<Awaited<ReturnType<typeof detailRequest>>>((resolve) => {
    stillWaiting = setTimeout(
      () => resolve({ status: 'still waiting past the fail-fast ceiling', retryAfter: null }),
      FAIL_FAST_CEILING_MS,
    );
  });
  try {
    return await Promise.race([detailRequest(), ceiling]);
  } finally {
    if (stillWaiting) clearTimeout(stillWaiting);
  }
};

describe('a request issued while the database is unreachable', () => {
  beforeAll(async () => {
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri(DATABASE), mongoOptions);

    const app = express();
    app.use(express.json());
    app.use('/api', apiRouter);
    app.use(errorHandler);
    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    await mongoose.disconnect();
    await memoryServer?.stop();
  });

  it('lets a slow but answered query finish', async () => {
    await ResearchEntity.collection.insertOne({
      slug: 'synthetic-slow-query-subject',
      name: 'Synthetic Slow Query Subject',
      archived: false,
    });

    const busyForMs = SLOW_QUERY_MS;
    const found = await ResearchEntity.find({
      $where: `function () { const until = Date.now() + ${busyForMs}; while (Date.now() < until) {} return true; }`,
    })
      .select({ slug: 1 })
      .lean();

    expect(found).toHaveLength(1);
  }, 29000);

  it('answers 503 with a retry hint instead of hanging into a generic error', async () => {
    expect((await detailRequest()).status).toBe(404);

    await memoryServer?.stop();

    const refused = await detailRequestWithinFailFastCeiling();

    expect(refused.status).toBe(503);
    expect(Number(refused.retryAfter)).toBeGreaterThan(0);
  }, 29000);
});
