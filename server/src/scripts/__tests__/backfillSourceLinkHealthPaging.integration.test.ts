/**
 * The traversal, not the verdicts. #2539's full re-probe died after ~30 minutes on
 * Development with `MongoServerError: cursor id ... not found`: the loop held one
 * cursor open while probing URLs, and Atlas expired it. The `getMore` happens at
 * loop advance, outside the body's try/catch, so nothing caught it and no report was
 * written.
 *
 * These cases pin what replaced it: every row is visited exactly once across page
 * boundaries, the walk terminates, and `--limit` still stops it.
 */
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ResearchEntity } from '../../models/researchEntity';
import { runSourceLinkHealthBackfill } from '../backfillSourceLinkHealth';

const ROW_COUNT = 7;

describe('source-link-health paging (#2539)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 120000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  beforeEach(async () => {
    await ResearchEntity.deleteMany({});
    for (let index = 0; index < ROW_COUNT; index += 1) {
      await ResearchEntity.create({
        slug: `dept-example-row-${index}`,
        name: `Example Row ${index}`,
        entityType: 'LAB',
        kind: 'lab',
        websiteUrl: `https://example-${index}.yale.edu/`,
      });
    }
  });

  const countingCheckLink = () => {
    const seen: string[] = [];
    return {
      seen,
      checkLink: async (url: string) => {
        seen.push(url);
        return { url, healthStatus: 'HEALTHY' as const, checkedAt: new Date() };
      },
    };
  };

  it('visits every row exactly once when the corpus spans several pages', async () => {
    const { seen, checkLink } = countingCheckLink();

    const result = await runSourceLinkHealthBackfill({
      dryRun: true,
      pageSize: 3,
      checkLink,
    });

    expect(result.scanned).toBe(ROW_COUNT);
    expect(result.errors).toBe(0);
    expect(new Set(seen).size).toBe(ROW_COUNT);
    expect(seen).toHaveLength(ROW_COUNT);
  }, 120000);

  it('reaches the same rows whether or not a page boundary falls on the corpus size', async () => {
    const exact = await runSourceLinkHealthBackfill({
      dryRun: true,
      pageSize: ROW_COUNT,
      checkLink: countingCheckLink().checkLink,
    });
    const ragged = await runSourceLinkHealthBackfill({
      dryRun: true,
      pageSize: 2,
      checkLink: countingCheckLink().checkLink,
    });

    expect(exact.scanned).toBe(ROW_COUNT);
    expect(ragged.scanned).toBe(ROW_COUNT);
  }, 120000);

  it('still honours --limit across a page boundary', async () => {
    const { seen, checkLink } = countingCheckLink();

    const result = await runSourceLinkHealthBackfill({
      dryRun: true,
      pageSize: 2,
      limit: 5,
      checkLink,
    });

    expect(result.scanned).toBe(5);
    expect(seen).toHaveLength(5);
  }, 120000);

  it('writes a verdict for every row in apply mode across pages', async () => {
    const { checkLink } = countingCheckLink();

    await runSourceLinkHealthBackfill({
      dryRun: false,
      pageSize: 3,
      checkLink,
    });

    const withHealth = await ResearchEntity.countDocuments({
      'sourceLinkHealth.0': { $exists: true },
    });
    expect(withHealth).toBe(ROW_COUNT);
  }, 120000);
});
