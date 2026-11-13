import fs from 'fs';
import os from 'os';
import path from 'path';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ResearchEntity } from '../../models/researchEntity';
import { runSourceLinkHealthBackfill } from '../backfillSourceLinkHealth';
import { readSourceLinkProbeCache } from '../sourceLinkProbeCache';

const OLD = new Date(Date.now() - 30 * 86_400_000);
const DAY_MS = 24 * 60 * 60_000;
const HOST = 'big.example.edu';
const LINK_COUNT = 12;
const linkUrl = (i: number) => `https://${HOST}/people/${i}/`;

describe('link-health dry-run probe cache (#6214)', () => {
  let replSet: MongoMemoryReplSet;
  let cacheDir: string;
  let cacheFile: string;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });
  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'link-health-probe-cache-'));
    cacheFile = path.join(cacheDir, 'probes.json');
    await ResearchEntity.deleteMany({});
    await ResearchEntity.create(
      Array.from({ length: LINK_COUNT }, (_v, i) => ({
        slug: `fixture-cache-${i}`,
        name: `Fixture Cache ${i}`,
        entityType: 'LAB',
        kind: 'lab',
        websiteUrl: linkUrl(i),
        sourceLinkHealth: [
          { url: linkUrl(i), healthStatus: 'HEALTHY', httpStatusCode: 200, checkedAt: OLD },
        ],
      })),
    );
  });

  const recorder = (
    verdict: Record<string, unknown> = { healthStatus: 'UNAVAILABLE', httpStatusCode: 404 },
  ) => {
    const seen: string[] = [];
    return {
      seen,
      checkLink: async (url: string) => {
        seen.push(url);
        return verdict as any;
      },
    };
  };

  const sampledDryRun = (checkLink: (url: string) => Promise<any>, reuseProbesWithinMs = DAY_MS) =>
    runSourceLinkHealthBackfill({
      dryRun: true,
      reprobeHealthyAfterDays: 7,
      samplePerHost: 4,
      reuseProbesWithinMs,
      probeCacheFile: cacheFile,
      checkLink,
      paceDelayMs: 0,
    });

  it('reuses a recent probe on a repeat dry run without spending the per-host sample on it', async () => {
    const first = recorder();
    const firstResult = await sampledDryRun(first.checkLink);
    expect(first.seen).toHaveLength(4);
    expect(firstResult.probesReused).toBe(0);

    const second = recorder();
    const secondResult = await sampledDryRun(second.checkLink);
    expect(second.seen).toHaveLength(4);
    expect(second.seen.filter((url) => first.seen.includes(url))).toEqual([]);
    expect(secondResult.probesReused).toBe(4);
    expect(secondResult.oldestReusedProbeAt).toBeDefined();
    expect(secondResult.dryRunSample).toEqual({
      perHost: 4,
      dueLinks: LINK_COUNT,
      probedLinks: 8,
      hostsCapped: 1,
    });
    expect(secondResult.verdictTransitions).toEqual({ 'HEALTHY->UNAVAILABLE': 8 });
    expect(secondResult.projectedVerdictTransitions).toEqual({
      'HEALTHY->UNAVAILABLE': LINK_COUNT,
    });
  }, 120000);

  it('requests a link again once its cached probe is older than the reuse window', async () => {
    const first = recorder();
    await sampledDryRun(first.checkLink);
    const cached = readSourceLinkProbeCache(cacheFile);
    const aged = Object.fromEntries(
      [...cached].map(([url, entry]) => [
        url,
        { ...entry, probedAt: new Date(Date.now() - 2 * DAY_MS).toISOString() },
      ]),
    );
    fs.writeFileSync(cacheFile, JSON.stringify(aged));

    const second = recorder();
    const result = await sampledDryRun(second.checkLink);
    expect(result.probesReused).toBe(0);
    expect(second.seen).toEqual(first.seen);
  }, 120000);

  it('never reads the cache on an apply, probes every due link afresh and records each one', async () => {
    const first = recorder({ healthStatus: 'HEALTHY', httpStatusCode: 200 });
    await sampledDryRun(first.checkLink);

    const apply = recorder();
    const result = await runSourceLinkHealthBackfill({
      dryRun: false,
      reprobeHealthyAfterDays: 7,
      probeCacheFile: cacheFile,
      checkLink: apply.checkLink,
      paceDelayMs: 0,
    });
    expect(apply.seen).toHaveLength(LINK_COUNT);
    expect(result.probesReused).toBe(0);
    expect(result.verdictTransitions).toEqual({ 'HEALTHY->UNAVAILABLE': LINK_COUNT });
    const cached = readSourceLinkProbeCache(cacheFile);
    expect(cached.size).toBe(LINK_COUNT);
    expect([...cached.values()].every((entry) => entry.health.healthStatus === 'UNAVAILABLE')).toBe(
      true,
    );
  }, 120000);

  it('refuses an apply that asks to reuse cached probes', async () => {
    await expect(
      runSourceLinkHealthBackfill({
        dryRun: false,
        reprobeHealthyAfterDays: 7,
        reuseProbesWithinMs: DAY_MS,
        probeCacheFile: cacheFile,
        checkLink: recorder().checkLink,
        paceDelayMs: 0,
      }),
    ).rejects.toThrow(/never reuses cached probes/);
  });

  it('does not cache a probe that never reached the host', async () => {
    await sampledDryRun(recorder({ healthStatus: 'UNKNOWN' }).checkLink);
    expect(readSourceLinkProbeCache(cacheFile).size).toBe(0);
  }, 120000);
});
