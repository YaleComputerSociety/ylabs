import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ResearchEntity } from '../../models/researchEntity';
import { runSourceLinkHealthBackfill } from '../backfillSourceLinkHealth';
import { ResolverUnhealthyError } from '../../scrapers/utils/resolverCircuitBreaker';

const DAY_MS = 86_400_000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);
const HOSTS = 7;
const urlOf = (i: number) => `https://gone-${i}.example.edu/lab`;

const seedRows = async (storedVerdict: 'unresolvable' | 'none') => {
  await ResearchEntity.create(
    Array.from({ length: HOSTS }, (_, i) => ({
      slug: `dept-example-gone-${i}`,
      name: `Example Gone ${i}`,
      entityType: 'LAB',
      kind: 'lab',
      websiteUrl: urlOf(i),
      ...(storedVerdict === 'unresolvable'
        ? {
            sourceLinkHealth: [
              { url: urlOf(i), healthStatus: 'UNAVAILABLE', checkedAt: daysAgo(1) },
            ],
          }
        : {}),
    })),
  );
};

const deadCheckLink = async () => ({ healthStatus: 'UNAVAILABLE' as const });

describe('source-link-health resolver breaker on a dead-heavy re-probe (#4865)', () => {
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
  });

  it('does not count hosts already stored as unresolvable, so it never asks the control', async () => {
    await seedRows('unresolvable');
    let controlChecks = 0;
    const result = await runSourceLinkHealthBackfill({
      dryRun: true,
      reprobeHealthyAfterDays: 7,
      checkLink: deadCheckLink,
      paceDelayMs: 0,
      resolverControlProbe: async () => {
        controlChecks += 1;
        return { healthy: false, detail: 'control: ENOTFOUND' };
      },
    });
    expect(result.checked).toBe(HOSTS);
    expect(controlChecks).toBe(0);
    expect(result.resolver).toMatchObject({
      controlChecks: 0,
      trips: 0,
      knownUnresolvableFailuresIgnored: HOSTS,
    });
  }, 120000);

  it('finishes past the threshold of newly dead hosts while the control answers', async () => {
    await seedRows('none');
    const result = await runSourceLinkHealthBackfill({
      dryRun: true,
      checkLink: deadCheckLink,
      paceDelayMs: 0,
      sleep: async () => undefined,
      resolverControlProbe: async () => ({ healthy: true, detail: 'control answered HTTP 200' }),
    });
    expect(result.checked).toBe(HOSTS);
    expect(result.byStatus.UNAVAILABLE).toBe(HOSTS);
    expect(result.resolver.controlChecks).toBeGreaterThanOrEqual(1);
    expect(result.resolver.tripsAvoided).toBe(result.resolver.controlChecks);
    expect(result.resolver.trips).toBe(0);
    expect(result.resolver.lastControl).toBe('control answered HTTP 200');
  }, 120000);

  it('halts before writing when the control fails too, as a real outage does', async () => {
    await seedRows('none');
    const run = runSourceLinkHealthBackfill({
      dryRun: false,
      checkLink: deadCheckLink,
      paceDelayMs: 0,
      sleep: async () => undefined,
      resolverControlProbe: async () => ({ healthy: false, detail: 'control: ENOTFOUND' }),
    });
    await expect(run).rejects.toBeInstanceOf(ResolverUnhealthyError);
    await expect(run).rejects.toThrow(/control check failed \(control: ENOTFOUND\)/);
    const written = await ResearchEntity.countDocuments({
      'sourceLinkHealth.0': { $exists: true },
    });
    expect(written).toBe(0);
  }, 120000);
});
