import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', () => ({
  syncEntity: vi.fn(async () => true),
}));

import { ResearchEntity } from '../../models/researchEntity';
import { syncEntity } from '../../services/meiliSyncService';
import { recomputeBrowseRankForEntities } from '../../services/researchEntityBrowseRankService';
import { __testing } from '../../services/researchEntityBrowseRank';
import { runSourceLinkHealthBackfill } from '../backfillSourceLinkHealth';

const WEBSITE_URL = 'https://example-lab.example.edu/';

const storedBrowseRankScore = async (): Promise<number | undefined> => {
  const row = (await ResearchEntity.findOne({ slug: 'dept-example-lab' }).lean()) as {
    browseRankScore?: number;
  } | null;
  return row?.browseRankScore;
};

const runWithVerdict = (healthStatus: 'HEALTHY' | 'UNAVAILABLE', httpStatusCode: number) =>
  runSourceLinkHealthBackfill({
    dryRun: false,
    checkLink: async () => ({ healthStatus, httpStatusCode }),
    paceDelayMs: 0,
  });

describe('source-link-health backfill keeps browse rank current', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    await ResearchEntity.deleteMany({});
    const [entity] = await ResearchEntity.create([
      {
        slug: 'dept-example-lab',
        name: 'Example Lab',
        entityType: 'LAB',
        kind: 'lab',
        websiteUrl: WEBSITE_URL,
      },
    ]);
    await recomputeBrowseRankForEntities([entity._id]);
  });

  it('drops website points when a run finds the website gone, and restores them on recovery', async () => {
    const liveScore = await storedBrowseRankScore();
    expect(typeof liveScore).toBe('number');

    await runWithVerdict('UNAVAILABLE', 404);
    expect(await storedBrowseRankScore()).toBe(
      (liveScore as number) - __testing.ENRICHMENT_POINTS.website,
    );

    await runWithVerdict('HEALTHY', 200);
    expect(await storedBrowseRankScore()).toBe(liveScore);
  }, 120000);

  it('counts a row whose new browse rank did not reach Meilisearch', async () => {
    vi.mocked(syncEntity).mockResolvedValueOnce(false);

    const result = await runWithVerdict('UNAVAILABLE', 404);

    expect(result.updated).toBe(1);
    expect(result.indexSyncFailures).toBe(1);
  }, 120000);

  it('counts a resync the hosted runner deferred on purpose as deferred, not failed', async () => {
    vi.mocked(syncEntity).mockResolvedValue(false);
    process.env.SEARCH_INDEX_WRITES = 'deferred';
    try {
      const result = await runWithVerdict('UNAVAILABLE', 404);

      expect(result.updated).toBe(1);
      expect(result.indexSyncFailures).toBe(0);
      expect(result.indexSyncDeferred).toBe(1);
    } finally {
      delete process.env.SEARCH_INDEX_WRITES;
      vi.mocked(syncEntity).mockResolvedValue(true);
    }
  }, 120000);

  it('leaves browse rank untouched in a dry run', async () => {
    const liveScore = await storedBrowseRankScore();
    await runSourceLinkHealthBackfill({
      dryRun: true,
      checkLink: async () => ({ healthStatus: 'UNAVAILABLE' as const, httpStatusCode: 404 }),
      paceDelayMs: 0,
    });
    expect(await storedBrowseRankScore()).toBe(liveScore);
  }, 120000);
});
