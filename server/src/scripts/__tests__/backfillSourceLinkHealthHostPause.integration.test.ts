import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ResearchEntity } from '../../models/researchEntity';
import { runSourceLinkHealthBackfill } from '../backfillSourceLinkHealth';
import {
  recordHostBackoff,
  resetHostPauseStateForTests,
} from '../../scrapers/utils/hostPauseState';

const DAY_MS = 86_400_000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);
const PAUSED_UNTIL = new Date(Date.now() + 7 * DAY_MS);

const BANNED_SITE = 'https://banned.example.edu/people/fixture/';
const BANNED_PROFILE = 'https://banned.example.edu/people/other-fixture/';
const OPEN_SITE = 'https://open.example.edu/fixture/';
const STORED_CHECKED_AT = daysAgo(30);

const storedEntry = (url: string) => ({
  url,
  healthStatus: 'HEALTHY',
  httpStatusCode: 200,
  redirectLandingUrl: `${url}landing/`,
  checkedAt: STORED_CHECKED_AT,
  lastAttemptedAt: STORED_CHECKED_AT,
});

const storedHealthByUrl = async () =>
  new Map(
    (
      (
        (await ResearchEntity.findOne({ slug: 'fixture-banned-host' }).lean()) as {
          sourceLinkHealth?: Array<Record<string, unknown>>;
        } | null
      )?.sourceLinkHealth ?? []
    ).map((entry) => [entry.url as string, entry]),
  );

const expectUntouched = (entry: Record<string, unknown> | undefined, url: string) => {
  const { _id: _ignored, ...kept } = entry ?? {};
  expect(kept).toEqual(storedEntry(url));
};

describe('source-link-health when a host is pausing this run', () => {
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
      slug: 'fixture-banned-host',
      name: 'Fixture Banned Host',
      entityType: 'LAB',
      kind: 'lab',
      websiteUrl: BANNED_SITE,
      sourceUrls: [BANNED_PROFILE, OPEN_SITE],
      sourceLinkHealth: [
        storedEntry(BANNED_SITE),
        storedEntry(BANNED_PROFILE),
        storedEntry(OPEN_SITE),
      ],
    });
  });

  afterEach(() => resetHostPauseStateForTests());

  it('keeps the stored verdict of every link it skips for a pause known before the run', async () => {
    await recordHostBackoff('banned.example.edu', { status: 403, statedUntil: PAUSED_UNTIL });
    const seen: string[] = [];

    await runSourceLinkHealthBackfill({
      dryRun: false,
      reprobeHealthyAfterDays: 7,
      checkLink: async (url: string) => {
        seen.push(url);
        return { healthStatus: 'HEALTHY', httpStatusCode: 200 };
      },
      paceDelayMs: 0,
    });

    expect(seen).toEqual([OPEN_SITE]);
    const byUrl = await storedHealthByUrl();
    expectUntouched(byUrl.get(BANNED_SITE), BANNED_SITE);
    expectUntouched(byUrl.get(BANNED_PROFILE), BANNED_PROFILE);
  }, 120000);

  it('keeps the stored verdicts when the pause starts mid-run', async () => {
    const seen: string[] = [];

    const result = await runSourceLinkHealthBackfill({
      dryRun: false,
      reprobeHealthyAfterDays: 7,
      checkLink: async (url: string) => {
        seen.push(url);
        if (url.startsWith('https://banned.example.edu/')) {
          await recordHostBackoff('banned.example.edu', { status: 403, statedUntil: PAUSED_UNTIL });
          return { healthStatus: 'UNKNOWN', httpStatusCode: 403 };
        }
        return { healthStatus: 'HEALTHY', httpStatusCode: 200 };
      },
      paceDelayMs: 0,
    });

    expect(seen.filter((url) => url.startsWith('https://banned.example.edu/'))).toHaveLength(1);
    expect(result.deferredPausedHost).toBe(2);
    expect(result.pausedHosts).toContain('banned.example.edu resumes at');
    const byUrl = await storedHealthByUrl();
    expectUntouched(byUrl.get(BANNED_SITE), BANNED_SITE);
    expectUntouched(byUrl.get(BANNED_PROFILE), BANNED_PROFILE);
    expect(byUrl.has(OPEN_SITE)).toBe(true);
  }, 120000);
});
