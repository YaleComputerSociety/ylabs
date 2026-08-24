import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ResearchEntity } from '../../models/researchEntity';
import { VisibilityReleaseQueueItem } from '../../models/visibilityReleaseQueueItem';
import { LabMicrositeDescriptionLLMExtractor } from '../sources/labMicrositeDescriptionLLMExtractor';
import type { ObservationInput, ScraperContext } from '../types';

function makeContext(limit: number): { ctx: ScraperContext; emitted: ObservationInput[] } {
  const emitted: ObservationInput[] = [];
  return {
    emitted,
    ctx: {
      scrapeRunId: 'test-run',
      sourceId: 'source-1',
      sourceName: 'lab-microsite-description-llm',
      sourceWeight: 0.5,
      options: { dryRun: true, useCache: false, release: false, limit, ignoreWorkPlanner: true },
      emit: async (obs) => {
        emitted.push(...(Array.isArray(obs) ? obs : [obs]));
      },
      log: () => {},
    },
  };
}

describe('LabMicrositeDescriptionLLMExtractor default queue ordering (#1843, #1840)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['research_entities', 'visibility_release_queue_items']) {
      await db.collection(name).deleteMany({});
    }
  });

  it('drains the never-attempted, longest-stuck entity before a freshly re-flagged one', async () => {
    const stuck = await ResearchEntity.create({
      slug: 'never-attempted-lab',
      name: 'Never Attempted Lab',
      kind: 'lab',
      websiteUrl: 'https://example.yale.edu/lab/never-attempted/',
      archived: false,
    });
    const freshlyReflagged = await ResearchEntity.create({
      slug: 'freshly-reflagged-lab',
      name: 'Freshly Reflagged Lab',
      kind: 'lab',
      websiteUrl: 'https://example.yale.edu/lab/freshly-reflagged/',
      archived: false,
    });

    await VisibilityReleaseQueueItem.create({
      collection: 'research',
      recordId: String(stuck._id),
      repairStage: 'source_description',
      repairStatus: 'queued',
      status: 'open',
      lastSeenAt: new Date('2026-01-01T00:00:00Z'),
    });
    await VisibilityReleaseQueueItem.create({
      collection: 'research',
      recordId: String(freshlyReflagged._id),
      repairStage: 'source_description',
      repairStatus: 'queued',
      status: 'open',
      lastSeenAt: new Date('2026-08-20T00:00:00Z'),
    });

    const { ctx } = makeContext(1);
    const fetchPage = vi.fn().mockResolvedValue(null);
    const scraper = new LabMicrositeDescriptionLLMExtractor({ apiKey: 'test-key', fetchPage });

    await scraper.run(ctx);

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith('https://example.yale.edu/lab/never-attempted/');
  });
});
