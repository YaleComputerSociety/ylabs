import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ResearchEntity } from '../../models/researchEntity';
import { isMongoUnavailableError, mongoOptions } from '../connections';

const DATABASE = 'buffered_mongo_operation_fails_fast_test';
const MONGOOSE_BUFFER_DEFAULT_MS = 10000;

let memoryServer: MongoMemoryServer | undefined;

const bufferBoundMongooseWillApply = (): number =>
  (mongoose.connection as unknown as { _getBufferTimeoutMS: () => number })._getBufferTimeoutMS();

describe('an operation issued while the connection is down', () => {
  beforeAll(async () => {
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri(DATABASE), mongoOptions);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await memoryServer?.stop();
  });

  it('would wait only the serving buffer bound, not the driver default', () => {
    expect(bufferBoundMongooseWillApply()).toBe(mongoOptions.bufferTimeoutMS);
    expect(bufferBoundMongooseWillApply()).toBeLessThan(MONGOOSE_BUFFER_DEFAULT_MS);
  });

  it('fails as an unavailable database rather than waiting out a buffer', async () => {
    await mongoose.disconnect();
    const startedAt = Date.now();

    const failure = await ResearchEntity.findOne({ slug: 'synthetic-absent-subject' })
      .lean()
      .then(
        () => null,
        (error: unknown) => error,
      );

    expect(failure).toBeTruthy();
    expect(isMongoUnavailableError(failure)).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(MONGOOSE_BUFFER_DEFAULT_MS);
  }, 29000);
});
