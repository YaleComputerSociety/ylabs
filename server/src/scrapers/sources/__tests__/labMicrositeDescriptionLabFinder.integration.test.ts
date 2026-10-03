import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { mongoOptions } from '../../../db/connections';
import { ResearchEntity } from '../../../models/researchEntity';
import { VisibilityReleaseQueueItem } from '../../../models/visibilityReleaseQueueItem';
import { defaultLabFinder } from '../labMicrositeDescriptionLLMExtractor';

describe('the description lane finder reaches rows outside the source_description queue (#3931)', () => {
  let server: MongoMemoryServer;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    await mongoose.connect(server.getUri(), mongoOptions);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await server?.stop();
  });

  const queuedId = new mongoose.Types.ObjectId();
  const servedId = new mongoose.Types.ObjectId();

  beforeEach(async () => {
    await mongoose.connection.db!.dropDatabase();
    await ResearchEntity.collection.insertMany([
      {
        _id: servedId,
        slug: 'synthetic-served-lab',
        name: 'Aardvark Served Lab',
        websiteUrl: 'https://served.example.edu/lab/',
        studentVisibilityTier: 'student_ready',
        archived: false,
      },
      {
        _id: queuedId,
        slug: 'synthetic-queued-lab',
        name: 'Zebra Queued Lab',
        websiteUrl: 'https://queued.example.edu/lab/',
        studentVisibilityTier: 'operator_review',
        archived: false,
      },
      {
        _id: new mongoose.Types.ObjectId(),
        slug: 'synthetic-archived-lab',
        name: 'Archived Lab',
        websiteUrl: 'https://archived.example.edu/lab/',
        archived: true,
      },
    ]);
    await VisibilityReleaseQueueItem.collection.insertOne({
      collection: 'research',
      recordId: String(queuedId),
      status: 'open',
      repairStage: 'source_description',
      repairStatus: 'queued',
      lastSeenAt: new Date('2026-10-01T00:00:00Z'),
    });
  });

  it('an exhaustive run with no --only reads every live row, queued rows first', async () => {
    const candidates = await defaultLabFinder({ exhaustive: true });

    expect(candidates.map((candidate) => candidate.slug)).toEqual([
      'synthetic-queued-lab',
      'synthetic-served-lab',
    ]);
  });

  it('a capped default run still reads only the queue', async () => {
    const candidates = await defaultLabFinder({});

    expect(candidates.map((candidate) => candidate.slug)).toEqual(['synthetic-queued-lab']);
  });
});
