import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ResearchEntity } from '../../models/researchEntity';
import { VisibilityReleaseQueueItem } from '../../models/visibilityReleaseQueueItem';
import { defaultLabFinder } from '../sources/labMicrositeDescriptionLLMExtractor';

describe('defaultLabFinder queue ordering (#1802 lab-microsite queue-starvation gap)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri(), { dbName: 'test' });
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  afterEach(async () => {
    await ResearchEntity.deleteMany({});
    await VisibilityReleaseQueueItem.deleteMany({});
  });

  it('serves the oldest-flagged queued entity before a freshly re-flagged one', async () => {
    const stale = await ResearchEntity.create({
      slug: 'stale-lab',
      name: 'Stale Lab',
      entityType: 'LAB',
      websiteUrl: 'https://stalelab.example.edu/',
      archived: false,
    });
    const fresh = await ResearchEntity.create({
      slug: 'fresh-lab',
      name: 'Fresh Lab',
      entityType: 'LAB',
      websiteUrl: 'https://freshlab.example.edu/',
      archived: false,
    });

    await VisibilityReleaseQueueItem.create({
      collection: 'research',
      recordId: String(stale._id),
      status: 'open',
      repairStage: 'source_description',
      repairStatus: 'queued',
      lastSeenAt: new Date('2026-01-01T00:00:00Z'),
    });
    await VisibilityReleaseQueueItem.create({
      collection: 'research',
      recordId: String(fresh._id),
      status: 'open',
      repairStage: 'source_description',
      repairStatus: 'queued',
      lastSeenAt: new Date('2026-08-24T00:00:00Z'),
    });

    const candidates = await defaultLabFinder();
    const slugOrder = candidates.map((candidate) => candidate.slug);

    expect(slugOrder.indexOf('stale-lab')).toBeLessThan(slugOrder.indexOf('fresh-lab'));
  });
});
