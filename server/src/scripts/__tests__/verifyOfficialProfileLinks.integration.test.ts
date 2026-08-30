import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Observation } from '../../models/observation';
import { Researcher, type ResearcherProfileLinkHealthStatus } from '../../models/researcher';
import type { SourceLinkHealth } from '../../services/sourceLinkHealth';
import { runVerifyOfficialProfileLinks } from '../verifyOfficialProfileLinks';

const DEAD_URL = 'https://example-dept.yale.edu/people/ada-example';
const MOVED_URL = 'https://example-dept.yale.edu/profile/ada-example';

describe('runVerifyOfficialProfileLinks against stored researchers', () => {
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
    for (const name of ['observations', 'researchers']) {
      await db.collection(name).deleteMany({});
    }
  });

  const seedResearcher = async (
    displayName: string,
    url: string,
    healthStatus: ResearcherProfileLinkHealthStatus = 'UNKNOWN',
  ) =>
    Researcher.create({
      displayName,
      profileLinks: [
        {
          kind: 'YALE_OFFICIAL' as const,
          purpose: 'PRIMARY_IDENTITY' as const,
          url,
          verifiedAt: new Date('2026-01-01T00:00:00Z'),
          healthStatus,
        },
      ],
    });

  const seedProfileUrlsObservation = async (
    entityKey: string,
    profileUrls: Record<string, string>,
    overrides: Record<string, unknown> = {},
  ) =>
    Observation.create({
      entityType: 'user',
      entityKey,
      field: 'profileUrls',
      value: profileUrls,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'dept-faculty-roster',
      sourceUrl: 'https://example-dept.yale.edu/faculty',
      confidence: 0.7,
      observedAt: new Date('2026-08-01T00:00:00Z'),
      superseded: false,
      ...overrides,
    });

  const storedOfficialLink = async (
    id: unknown,
  ): Promise<{ url: string; healthStatus: string; verifiedAt: Date } | undefined> => {
    const stored = (await Researcher.findById(id).lean()) as {
      profileLinks?: Array<{ kind: string; url: string; healthStatus: string; verifiedAt: Date }>;
    } | null;
    return (stored?.profileLinks || []).find((link) => link.kind === 'YALE_OFFICIAL');
  };

  const probeReturning = (byUrl: Record<string, SourceLinkHealth>) => {
    const probed: string[] = [];
    const probe = async (url: string): Promise<SourceLinkHealth> => {
      probed.push(url);
      return byUrl[url] ?? { healthStatus: 'UNAVAILABLE', httpStatusCode: 404 };
    };
    return { probe, probed };
  };

  it('serves on a healthy probe by recording HEALTHY without touching the URL', async () => {
    const researcher = await seedResearcher('Ada Example', MOVED_URL);
    const { probe } = probeReturning({
      [MOVED_URL]: { healthStatus: 'HEALTHY', httpStatusCode: 200 },
    });

    const result = await runVerifyOfficialProfileLinks({
      apply: true,
      hostConcurrency: 1,
      limit: 10,
      probe,
    });

    expect(result).toMatchObject({
      mode: 'apply',
      probed: 1,
      healthy: 1,
      dead: 0,
      urlsRepaired: 0,
    });
    expect(await storedOfficialLink(researcher._id)).toMatchObject({
      url: MOVED_URL,
      healthStatus: 'HEALTHY',
    });
  });

  it('replaces a dead link with the observed page that probes live', async () => {
    const researcher = await seedResearcher('Ada Example', DEAD_URL);
    await seedProfileUrlsObservation('ae123', { departmental: MOVED_URL });
    const { probe } = probeReturning({
      [DEAD_URL]: { healthStatus: 'UNAVAILABLE', httpStatusCode: 404 },
      [MOVED_URL]: { healthStatus: 'HEALTHY', httpStatusCode: 200 },
    });

    const result = await runVerifyOfficialProfileLinks({
      apply: true,
      hostConcurrency: 1,
      limit: 10,
      probe,
    });

    expect(result).toMatchObject({ repaired: 1, dead: 0, urlsRepaired: 1, statusesWritten: 1 });
    expect(await storedOfficialLink(researcher._id)).toMatchObject({
      url: MOVED_URL,
      healthStatus: 'HEALTHY',
    });
  });

  it('retires a dead link as UNAVAILABLE when no candidate probes live', async () => {
    const researcher = await seedResearcher('Ada Example', DEAD_URL);
    const { probe } = probeReturning({});

    const result = await runVerifyOfficialProfileLinks({
      apply: true,
      hostConcurrency: 1,
      limit: 10,
      probe,
    });

    expect(result).toMatchObject({ dead: 1, repaired: 0, urlsRepaired: 0 });
    expect(await storedOfficialLink(researcher._id)).toMatchObject({
      url: DEAD_URL,
      healthStatus: 'UNAVAILABLE',
    });
  });

  it('never proposes a same-surname colleague page as the replacement', async () => {
    const deadUrl = 'https://example-dept.yale.edu/people/douglas-example';
    const colleagueUrl = 'https://example-dept.yale.edu/profile/alison-example';
    const researcher = await seedResearcher('A Douglas Example', deadUrl);
    await seedProfileUrlsObservation('de123', { departmental: colleagueUrl });
    const { probe, probed } = probeReturning({
      [colleagueUrl]: { healthStatus: 'HEALTHY', httpStatusCode: 200 },
    });

    const result = await runVerifyOfficialProfileLinks({
      apply: true,
      hostConcurrency: 1,
      limit: 10,
      probe,
    });

    expect(probed).not.toContain(colleagueUrl);
    expect(result).toMatchObject({ dead: 1, repaired: 0, urlsRepaired: 0 });
    expect(await storedOfficialLink(researcher._id)).toMatchObject({
      url: deadUrl,
      healthStatus: 'UNAVAILABLE',
    });
  });

  it('keeps an already-proved-dead link retired when the site refuses to answer', async () => {
    const researcher = await seedResearcher('Ada Example', DEAD_URL, 'UNAVAILABLE');
    const { probe } = probeReturning({
      [DEAD_URL]: { healthStatus: 'UNAVAILABLE', httpStatusCode: 403 },
    });

    const result = await runVerifyOfficialProfileLinks({
      apply: true,
      hostConcurrency: 1,
      limit: 10,
      probe,
    });

    expect(result).toMatchObject({ inconclusive: 1, dead: 0, repaired: 0 });
    expect(await storedOfficialLink(researcher._id)).toMatchObject({
      url: DEAD_URL,
      healthStatus: 'UNAVAILABLE',
    });
  });

  it('adopts an observed off-pattern page a source still publishes', async () => {
    const observedUrl = 'https://example-dept.yale.edu/faculty/ada-example';
    const researcher = await seedResearcher('Ada Example', DEAD_URL);
    await seedProfileUrlsObservation('ae123', { departmental: observedUrl });
    const { probe } = probeReturning({
      [observedUrl]: { healthStatus: 'HEALTHY', httpStatusCode: 200 },
    });

    const result = await runVerifyOfficialProfileLinks({
      apply: true,
      hostConcurrency: 1,
      limit: 10,
      probe,
    });

    expect(result).toMatchObject({ repaired: 1, urlsRepaired: 1 });
    expect(await storedOfficialLink(researcher._id)).toMatchObject({ url: observedUrl });
  });

  it('ignores a superseded or rollback-retired observation as a replacement source', async () => {
    const retiredUrl = 'https://example-dept.yale.edu/faculty/ada-example';
    const researcher = await seedResearcher('Ada Example', DEAD_URL);
    await seedProfileUrlsObservation(
      'ae123',
      { departmental: retiredUrl },
      { superseded: true, rollback: { rolledBackAt: new Date('2026-08-10T00:00:00Z') } },
    );
    const { probe, probed } = probeReturning({
      [retiredUrl]: { healthStatus: 'HEALTHY', httpStatusCode: 200 },
    });

    const result = await runVerifyOfficialProfileLinks({
      apply: true,
      hostConcurrency: 1,
      limit: 10,
      probe,
    });

    expect(probed).not.toContain(retiredUrl);
    expect(result).toMatchObject({ dead: 1, repaired: 0, urlsRepaired: 0 });
    expect(await storedOfficialLink(researcher._id)).toMatchObject({
      url: DEAD_URL,
      healthStatus: 'UNAVAILABLE',
    });
  });

  it('plans without writing in dry-run mode', async () => {
    const researcher = await seedResearcher('Ada Example', DEAD_URL);
    const { probe } = probeReturning({});

    const result = await runVerifyOfficialProfileLinks({
      apply: false,
      hostConcurrency: 1,
      probe,
    });

    expect(result).toMatchObject({ mode: 'dry-run', dead: 1, statusesWritten: 0 });
    expect(await storedOfficialLink(researcher._id)).toMatchObject({
      url: DEAD_URL,
      healthStatus: 'UNKNOWN',
    });
  });

  it('probes only the requested department host', async () => {
    await seedResearcher('Ada Example', DEAD_URL);
    await seedResearcher('Bo Other', 'https://other-dept.yale.edu/people/bo-other');
    const { probe, probed } = probeReturning({});

    const result = await runVerifyOfficialProfileLinks({
      apply: false,
      host: 'other-dept.yale.edu',
      hostConcurrency: 1,
      probe,
    });

    expect(result.probed).toBe(1);
    expect(probed).toContain('https://other-dept.yale.edu/people/bo-other');
    expect(probed).not.toContain(DEAD_URL);
  });
});
