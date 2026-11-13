import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ResearchEntity } from '../../models/researchEntity';
import {
  parseSourceLinkHealthBackfillArgs,
  runSourceLinkHealthBackfill,
  sourceLinkHealthRunOptions,
} from '../backfillSourceLinkHealth';

const DAY_MS = 86_400_000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);

const BANNED_SITE = 'https://banned.example.edu/people/fixture/';
const BANNED_SUBDOMAIN = 'https://www.lab.banned.example.edu/';
const OPEN_SITE = 'https://open.example.edu/fixture/';
const STORED_CHECKED_AT = daysAgo(30);

const storedHealthOf = async (slug: string) =>
  (
    (await ResearchEntity.findOne({ slug }).lean()) as {
      sourceLinkHealth?: Array<Record<string, unknown>>;
    } | null
  )?.sourceLinkHealth ?? [];

describe('source-link-health --exclude-host', () => {
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
    await ResearchEntity.create({
      slug: 'fixture-excluded-host',
      name: 'Fixture Excluded Host',
      entityType: 'LAB',
      kind: 'lab',
      websiteUrl: BANNED_SITE,
      sourceUrls: [BANNED_SUBDOMAIN, OPEN_SITE],
      sourceLinkHealth: [
        {
          url: BANNED_SITE,
          healthStatus: 'HEALTHY',
          httpStatusCode: 200,
          checkedAt: STORED_CHECKED_AT,
        },
        {
          url: OPEN_SITE,
          healthStatus: 'HEALTHY',
          httpStatusCode: 200,
          checkedAt: STORED_CHECKED_AT,
        },
      ],
    });
  });

  const failingCheckLink = () => {
    const seen: string[] = [];
    return {
      seen,
      checkLink: async (url: string) => {
        seen.push(url);
        return { healthStatus: 'UNAVAILABLE' as const, httpStatusCode: 404 };
      },
    };
  };

  it('never fetches an excluded host or its subdomains and leaves their stored verdicts untouched', async () => {
    const { seen, checkLink } = failingCheckLink();
    const result = await runSourceLinkHealthBackfill({
      dryRun: false,
      reprobeHealthyAfterDays: 7,
      excludeHosts: ['banned.example.edu'],
      checkLink,
      paceDelayMs: 0,
    });

    expect(seen).toEqual([OPEN_SITE]);
    expect(result.excludedHostLinks).toBe(2);
    expect(result.carriedFreshHealthy).toBe(0);

    const byUrl = new Map(
      (await storedHealthOf('fixture-excluded-host')).map((entry) => [entry.url, entry]),
    );
    expect(byUrl.get(BANNED_SITE)).toMatchObject({ healthStatus: 'HEALTHY', httpStatusCode: 200 });
    expect((byUrl.get(BANNED_SITE)?.checkedAt as Date).getTime()).toBe(STORED_CHECKED_AT.getTime());
    expect(byUrl.get(BANNED_SITE)).not.toHaveProperty('lastAttemptedAt');
    expect(byUrl.has(BANNED_SUBDOMAIN)).toBe(false);
    expect(byUrl.get(OPEN_SITE)).toMatchObject({
      healthStatus: 'UNAVAILABLE',
      httpStatusCode: 404,
    });
  }, 120000);

  it('fetches every host when nothing is excluded', async () => {
    const { seen, checkLink } = failingCheckLink();
    const result = await runSourceLinkHealthBackfill({
      dryRun: true,
      reprobeHealthyAfterDays: 7,
      checkLink,
      paceDelayMs: 0,
    });

    expect(seen.sort()).toEqual([BANNED_SITE, BANNED_SUBDOMAIN, OPEN_SITE].sort());
    expect(result.excludedHostLinks).toBe(0);
  }, 120000);

  it('carries a repeatable, normalized --exclude-host from the CLI to the run', () => {
    const options = parseSourceLinkHealthBackfillArgs([
      '--exclude-host',
      'WWW.Banned.Example.edu',
      '--exclude-host=other.example.edu',
    ]);
    expect(sourceLinkHealthRunOptions(options).excludeHosts).toEqual([
      'banned.example.edu',
      'other.example.edu',
    ]);
    expect(() => parseSourceLinkHealthBackfillArgs(['--exclude-host', '--apply'])).toThrow(
      /--exclude-host requires a host name/,
    );
  });
});
