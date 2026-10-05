import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Fellowship } from '../../models/fellowship';
import { runFellowshipSourceLinkHealthBackfill } from '../backfillFellowshipSourceLinkHealth';
import { ResolverUnhealthyError } from '../../scrapers/utils/resolverCircuitBreaker';

const DAY_MS = 86_400_000;
const HOSTS = 7;
const urlOf = (i: number) => `https://gone-${i}.example.edu/program`;

const seedPrograms = async (storedVerdict: 'unresolvable' | 'none') => {
  await Fellowship.create(
    Array.from({ length: HOSTS }, (_, i) => ({
      title: `Example Program ${i}`,
      sourceUrl: urlOf(i),
      ...(storedVerdict === 'unresolvable'
        ? {
            sourceLinkHealth: {
              url: urlOf(i),
              healthStatus: 'UNAVAILABLE' as const,
              checkedAt: new Date(Date.now() - DAY_MS),
            },
          }
        : {}),
    })),
  );
};

const deadCheckLink = async () => ({ healthStatus: 'UNAVAILABLE' as const });

const countCheckedSince = (since: Date) =>
  Fellowship.countDocuments({ 'sourceLinkHealth.checkedAt': { $gte: since } });

describe('program source-link-health resolver breaker (#4882)', () => {
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
    await Fellowship.deleteMany({});
  });

  it('halts before writing any verdict when the control fails too, as a real outage does', async () => {
    await seedPrograms('none');
    const run = runFellowshipSourceLinkHealthBackfill({
      dryRun: false,
      checkLink: deadCheckLink,
      paceDelayMs: 0,
      sleep: async () => undefined,
      resolverControlProbe: async () => ({ healthy: false, detail: 'control: ENOTFOUND' }),
    });
    await expect(run).rejects.toBeInstanceOf(ResolverUnhealthyError);
    await expect(run).rejects.toThrow(/control check failed \(control: ENOTFOUND\)/);
    expect(await Fellowship.countDocuments({ sourceLinkHealth: { $exists: true } })).toBe(0);
  }, 120000);

  it('records genuinely dead program links while the control answers', async () => {
    await seedPrograms('none');
    const startedAt = new Date();
    const result = await runFellowshipSourceLinkHealthBackfill({
      dryRun: false,
      checkLink: deadCheckLink,
      paceDelayMs: 0,
      sleep: async () => undefined,
      resolverControlProbe: async () => ({ healthy: true, detail: 'control answered HTTP 200' }),
    });
    expect(result.checked).toBe(HOSTS);
    expect(result.updated).toBe(HOSTS);
    expect(result.byStatus.UNAVAILABLE).toBe(HOSTS);
    expect(result.resolver.controlChecks).toBeGreaterThanOrEqual(1);
    expect(result.resolver.tripsAvoided).toBe(result.resolver.controlChecks);
    expect(result.resolver.trips).toBe(0);
    expect(result.resolver.lastControl).toBe('control answered HTTP 200');
    expect(await countCheckedSince(startedAt)).toBe(HOSTS);
  }, 120000);

  it('does not count hosts already stored as unresolvable, so it never asks the control', async () => {
    await seedPrograms('unresolvable');
    let controlChecks = 0;
    const result = await runFellowshipSourceLinkHealthBackfill({
      dryRun: true,
      checkLink: deadCheckLink,
      paceDelayMs: 0,
      sleep: async () => undefined,
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
});
