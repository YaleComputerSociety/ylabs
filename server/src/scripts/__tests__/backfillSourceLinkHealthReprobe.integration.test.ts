import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ResearchEntity } from '../../models/researchEntity';
import { runSourceLinkHealthBackfill } from '../backfillSourceLinkHealth';

const DAY_MS = 86_400_000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);

const FRESH_URL = 'https://fresh-lab.example.edu/';
const STALE_URL = 'https://stale-lab.example.edu/';
const DEAD_URL = 'https://dead-lab.example.edu/';
const NEW_URL = 'https://example.edu/profile/example-person/';

interface StoredEntry {
  url: string;
  healthStatus: string;
  checkedAt?: Date;
}

const storedHealthOf = async (slug: string): Promise<StoredEntry[]> => {
  const row = (await ResearchEntity.findOne({ slug }).lean()) as {
    sourceLinkHealth?: StoredEntry[];
  } | null;
  return row?.sourceLinkHealth ?? [];
};

describe('source-link-health re-probe window (#3568)', () => {
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
    await ResearchEntity.create([
      {
        slug: 'dept-example-fresh',
        name: 'Example Fresh',
        entityType: 'LAB',
        kind: 'lab',
        websiteUrl: FRESH_URL,
        sourceLinkHealth: [
          { url: FRESH_URL, healthStatus: 'HEALTHY', httpStatusCode: 200, checkedAt: daysAgo(2) },
        ],
      },
      {
        slug: 'dept-example-mixed',
        name: 'Example Mixed',
        entityType: 'LAB',
        kind: 'lab',
        websiteUrl: STALE_URL,
        sourceUrls: [DEAD_URL, NEW_URL],
        sourceLinkHealth: [
          { url: STALE_URL, healthStatus: 'HEALTHY', httpStatusCode: 200, checkedAt: daysAgo(10) },
          {
            url: DEAD_URL,
            healthStatus: 'UNAVAILABLE',
            httpStatusCode: 404,
            checkedAt: daysAgo(1),
          },
        ],
      },
    ]);
  });

  const recordingCheckLink = () => {
    const seen: string[] = [];
    return {
      seen,
      checkLink: async (url: string) => {
        seen.push(url);
        return { healthStatus: 'HEALTHY' as const, httpStatusCode: 200 };
      },
    };
  };

  it('probes only urls that are unprobed, not HEALTHY, or HEALTHY past the window', async () => {
    const { seen, checkLink } = recordingCheckLink();
    const result = await runSourceLinkHealthBackfill({
      dryRun: false,
      reprobeHealthyAfterDays: 7,
      checkLink,
      paceDelayMs: 0,
    });

    expect(seen.sort()).toEqual([DEAD_URL, NEW_URL, STALE_URL].sort());
    expect(result.carriedFreshHealthy).toBe(1);
    expect(result.unchangedRows).toBe(1);
    expect(result.updated).toBe(1);

    const fresh = await storedHealthOf('dept-example-fresh');
    expect(fresh[0]?.checkedAt?.getTime()).toBeLessThan(daysAgo(1).getTime());

    const mixed = await storedHealthOf('dept-example-mixed');
    expect(mixed.map((entry) => entry.url).sort()).toEqual([DEAD_URL, NEW_URL, STALE_URL].sort());
  }, 120000);

  it('keeps a carried verdict beside probed ones when the row is rewritten', async () => {
    await ResearchEntity.updateOne(
      { slug: 'dept-example-fresh' },
      { $push: { sourceUrls: NEW_URL } },
    );
    const { seen, checkLink } = recordingCheckLink();
    await runSourceLinkHealthBackfill({
      dryRun: false,
      reprobeHealthyAfterDays: 7,
      checkLink,
      paceDelayMs: 0,
    });

    expect(seen).not.toContain(FRESH_URL);
    const byUrl = new Map(
      (await storedHealthOf('dept-example-fresh')).map((entry) => [entry.url, entry]),
    );
    expect(byUrl.get(FRESH_URL)?.checkedAt?.getTime()).toBeLessThan(daysAgo(1).getTime());
    expect(byUrl.get(NEW_URL)?.healthStatus).toBe('HEALTHY');
  }, 120000);

  it('probes every url without a window, as the explicit full re-probe does', async () => {
    const { seen, checkLink } = recordingCheckLink();
    const result = await runSourceLinkHealthBackfill({ dryRun: true, checkLink, paceDelayMs: 0 });
    expect(seen.sort()).toEqual([DEAD_URL, FRESH_URL, NEW_URL, STALE_URL].sort());
    expect(result.carriedFreshHealthy).toBe(0);
  }, 120000);
});
