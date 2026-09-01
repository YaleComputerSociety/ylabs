import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Account } from '../../models/account';
import { Observation } from '../../models/observation';
import { Researcher } from '../../models/researcher';
import { runRepairSupersededOfficialProfileLinks } from '../repairSupersededOfficialProfileLinks';

const STALE_URL = 'https://example-dept.yale.edu/people/ada-example';
const MOVED_URL = 'https://example-dept.yale.edu/profile/ada-example';

describe('runRepairSupersededOfficialProfileLinks against stored researchers', () => {
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
    for (const name of ['observations', 'researchers', 'accounts']) {
      await db.collection(name).deleteMany({});
    }
  });

  const officialLink = (url: string) => ({
    kind: 'YALE_OFFICIAL' as const,
    purpose: 'PRIMARY_IDENTITY' as const,
    url,
    verifiedAt: new Date('2026-01-01T00:00:00Z'),
    healthStatus: 'UNKNOWN' as const,
  });

  const seedResearcher = async (
    netid: string | undefined,
    displayName: string,
    url: string,
    options: { viaAccountOnly?: boolean } = {},
  ) => {
    const account = netid
      ? await Account.create({ netid, email: `${netid}@example.invalid`, userType: 'faculty' })
      : undefined;
    return Researcher.create({
      displayName,
      ...(account ? { accountId: account._id } : {}),
      ...(netid && !options.viaAccountOnly ? { identifiers: { netid } } : {}),
      profileLinks: [officialLink(url)],
    });
  };

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

  const storedOfficialUrls = async (id: unknown): Promise<string[]> => {
    const stored = (await Researcher.findById(id).lean()) as {
      profileLinks?: Array<{ kind: string; url: string }>;
    } | null;
    return (stored?.profileLinks || [])
      .filter((link) => link.kind === 'YALE_OFFICIAL')
      .map((link) => link.url);
  };

  it('rewrites a stale stored link to the profile page observed for that researcher', async () => {
    const researcher = await seedResearcher('ae123', 'Ada Example', STALE_URL);
    await seedProfileUrlsObservation('ae123', { departmental: MOVED_URL });

    const result = await runRepairSupersededOfficialProfileLinks({ apply: true, limit: 10 });

    expect(result).toMatchObject({ considered: 1, repairable: 1, updated: 1, mode: 'apply' });
    expect(result.rows).toEqual([expect.objectContaining({ before: STALE_URL, after: MOVED_URL })]);
    expect(await storedOfficialUrls(researcher._id)).toEqual([MOVED_URL]);
  });

  it('plans the rewrite without touching the record in dry-run mode', async () => {
    const researcher = await seedResearcher('ae123', 'Ada Example', STALE_URL);
    await seedProfileUrlsObservation('netid:ae123', { departmental: MOVED_URL });

    const result = await runRepairSupersededOfficialProfileLinks({ apply: false });

    expect(result).toMatchObject({ repairable: 1, updated: 0, mode: 'dry-run' });
    expect(await storedOfficialUrls(researcher._id)).toEqual([STALE_URL]);
  });

  it('matches evidence through the account netid when the researcher carries none', async () => {
    const researcher = await seedResearcher('ae123', 'Ada Example', STALE_URL, {
      viaAccountOnly: true,
    });
    await seedProfileUrlsObservation('ae123', { departmental: MOVED_URL });

    await runRepairSupersededOfficialProfileLinks({ apply: true, limit: 10 });

    expect(await storedOfficialUrls(researcher._id)).toEqual([MOVED_URL]);
  });

  it('never borrows another person same-slug profile page as evidence', async () => {
    const researcher = await seedResearcher(
      'bj456',
      'Bo Jones',
      'https://example-dept.yale.edu/lab/jones',
    );
    await seedProfileUrlsObservation('cj789', {
      departmental: 'https://example-dept.yale.edu/profile/jones',
    });

    const result = await runRepairSupersededOfficialProfileLinks({ apply: true, limit: 10 });

    expect(result).toMatchObject({ considered: 1, repairable: 0, updated: 0 });
    expect(await storedOfficialUrls(researcher._id)).toEqual([
      'https://example-dept.yale.edu/lab/jones',
    ]);
  });

  it('ignores a superseded or rollback-retired observation of the profile page', async () => {
    const researcher = await seedResearcher('ae123', 'Ada Example', STALE_URL);
    await seedProfileUrlsObservation(
      'ae123',
      { departmental: MOVED_URL },
      { superseded: true, rollback: { rolledBackAt: new Date('2026-08-10T00:00:00Z') } },
    );

    const result = await runRepairSupersededOfficialProfileLinks({ apply: true, limit: 10 });

    expect(result).toMatchObject({ repairable: 0, updated: 0 });
    expect(await storedOfficialUrls(researcher._id)).toEqual([STALE_URL]);
  });

  it('leaves a stored link alone when the observed page is on another department host', async () => {
    const researcher = await seedResearcher('ae123', 'Ada Example', STALE_URL);
    await seedProfileUrlsObservation('ae123', {
      departmental: 'https://other-dept.yale.edu/profile/ada-example',
    });

    const result = await runRepairSupersededOfficialProfileLinks({ apply: true, limit: 10 });

    expect(result).toMatchObject({ repairable: 0, updated: 0 });
    expect(await storedOfficialUrls(researcher._id)).toEqual([STALE_URL]);
  });
});
