import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ResearchEntity } from '../../models/researchEntity';
import { runSourceLinkHealthBackfill } from '../backfillSourceLinkHealth';

const OLD = new Date(Date.now() - 30 * 86_400_000);
const BIG = 'big.example.edu';
const SMALL = 'small.example.edu';
const bigUrl = (i: number) => `https://${BIG}/people/${i}/`;
const SMALL_URL = `https://${SMALL}/lab/`;
const BIG_COUNT = 40;

const storedFor = async (slug: string) =>
  (((await ResearchEntity.findOne({ slug }).lean()) as { sourceLinkHealth?: any[] } | null)
    ?.sourceLinkHealth ?? []) as Array<Record<string, any>>;

describe('link-health bounded runs (#6182)', () => {
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
    await ResearchEntity.create(
      Array.from({ length: BIG_COUNT }, (_v, i) => ({
        slug: `fixture-big-${i}`,
        name: `Fixture Big ${i}`,
        entityType: 'LAB',
        kind: 'lab',
        websiteUrl: bigUrl(i),
        sourceLinkHealth: [
          { url: bigUrl(i), healthStatus: 'HEALTHY', httpStatusCode: 200, checkedAt: OLD },
        ],
      })).concat([
        {
          slug: 'fixture-small',
          name: 'Fixture Small',
          entityType: 'LAB',
          kind: 'lab',
          websiteUrl: SMALL_URL,
          sourceLinkHealth: [
            { url: SMALL_URL, healthStatus: 'HEALTHY', httpStatusCode: 200, checkedAt: OLD },
          ],
        },
      ]),
    );
  });

  const recorder = (verdict: (url: string) => Record<string, unknown>) => {
    const seen: string[] = [];
    return {
      seen,
      checkLink: async (url: string) => {
        seen.push(url);
        return verdict(url) as any;
      },
    };
  };
  const hostCount = (seen: string[], host: string) => seen.filter((u) => u.includes(host)).length;

  it('caps a sampled dry run per host and projects its transitions to every due link', async () => {
    const { seen, checkLink } = recorder(() => ({
      healthStatus: 'UNAVAILABLE',
      httpStatusCode: 404,
    }));
    const result = await runSourceLinkHealthBackfill({
      dryRun: true,
      reprobeHealthyAfterDays: 7,
      samplePerHost: 5,
      checkLink,
      paceDelayMs: 0,
    });

    expect(hostCount(seen, BIG)).toBe(5);
    expect(hostCount(seen, SMALL)).toBe(1);
    expect(result.probesByHost).toEqual({ [BIG]: 5, [SMALL]: 1 });
    expect(result.dryRunSample).toEqual({
      perHost: 5,
      dueLinks: BIG_COUNT + 1,
      probedLinks: 6,
      hostsCapped: 1,
    });
    expect(result.verdictTransitions).toEqual({ 'HEALTHY->UNAVAILABLE': 6 });
    expect(result.projectedVerdictTransitions).toEqual({ 'HEALTHY->UNAVAILABLE': BIG_COUNT + 1 });
  }, 120000);

  it('draws the same sample on a repeat dry run', async () => {
    const first = recorder(() => ({ healthStatus: 'HEALTHY', httpStatusCode: 200 }));
    await runSourceLinkHealthBackfill({
      dryRun: true,
      reprobeHealthyAfterDays: 7,
      samplePerHost: 5,
      checkLink: first.checkLink,
      paceDelayMs: 0,
    });
    const second = recorder(() => ({ healthStatus: 'HEALTHY', httpStatusCode: 200 }));
    await runSourceLinkHealthBackfill({
      dryRun: true,
      reprobeHealthyAfterDays: 7,
      samplePerHost: 5,
      checkLink: second.checkLink,
      paceDelayMs: 0,
    });
    expect(second.seen).toEqual(first.seen);
  }, 120000);

  it('probes only a url scope, in its order, and leaves every other stored verdict untouched', async () => {
    const scope = [bigUrl(7), SMALL_URL, bigUrl(3)];
    const { seen, checkLink } = recorder(() => ({
      healthStatus: 'UNAVAILABLE',
      httpStatusCode: 404,
    }));
    await runSourceLinkHealthBackfill({
      dryRun: false,
      reprobeHealthyAfterDays: 7,
      urlScope: scope,
      checkLink,
      paceDelayMs: 0,
      hostConcurrency: 1,
    });

    expect(seen).toEqual([bigUrl(7), bigUrl(3), SMALL_URL]);
    expect((await storedFor('fixture-big-7'))[0]).toMatchObject({ healthStatus: 'UNAVAILABLE' });
    const untouched = (await storedFor('fixture-big-8'))[0];
    expect(untouched).toMatchObject({ healthStatus: 'HEALTHY', httpStatusCode: 200 });
    expect(new Date(untouched.checkedAt).getTime()).toBe(OLD.getTime());
  }, 120000);

  it('stops probing a host at a stop status and keeps the rest of its stored verdicts byte for byte', async () => {
    const scope = [bigUrl(1), bigUrl(2), bigUrl(3), SMALL_URL];
    const { seen, checkLink } = recorder((url) =>
      url === bigUrl(2)
        ? { healthStatus: 'UNKNOWN', httpStatusCode: 403 }
        : { healthStatus: 'HEALTHY', httpStatusCode: 200 },
    );
    const result = await runSourceLinkHealthBackfill({
      dryRun: false,
      reprobeHealthyAfterDays: 7,
      urlScope: scope,
      stopOnStatuses: [403, 429],
      checkLink,
      paceDelayMs: 0,
    });

    expect(seen).toContain(bigUrl(1));
    expect(seen).toContain(bigUrl(2));
    expect(seen).not.toContain(bigUrl(3));
    expect(seen).toContain(SMALL_URL);
    expect(result.stoppedHosts).toEqual([BIG]);
    const kept = (await storedFor('fixture-big-3'))[0];
    expect(kept).toEqual(
      expect.objectContaining({ url: bigUrl(3), healthStatus: 'HEALTHY', httpStatusCode: 200 }),
    );
    expect(new Date(kept.checkedAt).getTime()).toBe(OLD.getTime());
    expect(kept).not.toHaveProperty('lastAttemptedAt');
  }, 120000);

  it('keeps a stored verdict when its probe throws instead of dropping it from the rewritten row', async () => {
    const SECOND = 'https://other.example.edu/page/';
    await ResearchEntity.updateOne(
      { slug: 'fixture-small' },
      {
        $set: {
          sourceUrls: [SECOND],
          sourceLinkHealth: [
            { url: SMALL_URL, healthStatus: 'HEALTHY', httpStatusCode: 200, checkedAt: OLD },
            { url: SECOND, healthStatus: 'HEALTHY', httpStatusCode: 200, checkedAt: OLD },
          ],
        },
      },
    );
    const result = await runSourceLinkHealthBackfill({
      dryRun: false,
      reprobeHealthyAfterDays: 7,
      checkLink: async (url: string) => {
        if (url === SMALL_URL) throw new Error('probe exploded');
        return { healthStatus: 'HEALTHY', httpStatusCode: 200 };
      },
      paceDelayMs: 0,
    });

    expect(result.errors).toBeGreaterThan(0);
    const kept = new Map((await storedFor('fixture-small')).map((entry) => [entry.url, entry]));
    expect(kept.get(SMALL_URL)).toMatchObject({ healthStatus: 'HEALTHY', httpStatusCode: 200 });
    expect(new Date(kept.get(SMALL_URL)!.checkedAt).getTime()).toBe(OLD.getTime());
    expect(kept.has(SECOND)).toBe(true);
  }, 120000);
});
