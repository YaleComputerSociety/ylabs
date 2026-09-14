/**
 * Why this exists. `repairSupersededOfficialProfileLinks` was retired in #2653
 * because the engine already performs the same replacement: `entityMaterializer`
 * rewrites a stored `YALE_OFFICIAL` profile link when a newer observed URL
 * supersedes it, from the same `supersedesOfficialProfileUrl` predicate the repair
 * imported. Its dry run reported `considered 4517, repairable 0` on Development,
 * which is what a redundant repair looks like.
 *
 * A count of zero is not a reason to delete anything, though - it is equally what a
 * repair that already ran looks like. These cases are the actual grounds: they drive
 * the real materializer and assert the replacement happens there, so the behaviour is
 * pinned to the engine rather than to a script that no longer exists.
 *
 * The scenarios are carried over from the retired repair's integration test, so the
 * refusals it was careful about are still pinned: another host, another person's
 * same-slug page, and a retired observation.
 */
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Account } from '../../models/account';
import { Observation } from '../../models/observation';
import { Researcher } from '../../models/researcher';
import { materializeEntity } from '../entityMaterializer';

const STALE_URL = 'https://example-dept.yale.edu/people/ada-example';
const MOVED_URL = 'https://example-dept.yale.edu/profile/ada-example';

describe('the engine supersedes a stale official profile link (#2653)', () => {
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

  const seedResearcher = async (netid: string, displayName: string, url: string) => {
    const account = await Account.create({
      netid,
      email: `${netid}@example.invalid`,
      userType: 'faculty',
    });
    return Researcher.create({
      displayName,
      accountId: account._id,
      identifiers: { netid },
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

  it('rewrites a stale stored link to the observed profile page, with no repair pass', async () => {
    const researcher = await seedResearcher('ae123', 'Ada Example', STALE_URL);
    await seedProfileUrlsObservation('ae123', { departmental: MOVED_URL });

    await materializeEntity('user', { entityKey: 'ae123' }, {});

    expect(await storedOfficialUrls(researcher._id)).toEqual([MOVED_URL]);
  });

  it('keeps it rewritten on a second pass, so the correction is not one-shot', async () => {
    const researcher = await seedResearcher('ae123', 'Ada Example', STALE_URL);
    await seedProfileUrlsObservation('ae123', { departmental: MOVED_URL });

    await materializeEntity('user', { entityKey: 'ae123' }, {});
    await materializeEntity('user', { entityKey: 'ae123' }, {});

    expect(await storedOfficialUrls(researcher._id)).toEqual([MOVED_URL]);
  });

  it('leaves a stored link alone when the observed page is on another department host', async () => {
    const researcher = await seedResearcher('ae123', 'Ada Example', STALE_URL);
    await seedProfileUrlsObservation('ae123', {
      departmental: 'https://other-dept.yale.edu/profile/ada-example',
    });

    await materializeEntity('user', { entityKey: 'ae123' }, {});

    expect(await storedOfficialUrls(researcher._id)).toEqual([STALE_URL]);
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

    await materializeEntity('user', { entityKey: 'bj456' }, {});

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

    await materializeEntity('user', { entityKey: 'ae123' }, {});

    expect(await storedOfficialUrls(researcher._id)).toEqual([STALE_URL]);
  });
});
