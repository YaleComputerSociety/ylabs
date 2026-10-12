import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Account } from '../../models/account';
import { Researcher } from '../../models/researcher';
import {
  profileUsersByNetids,
  resolveExistingUserForIdentity,
  selectDirectVisibleProfileBioUserTargets,
} from '../sources/officialProfilePiBackfillScraper';
import { netidForAdvisorResearcher } from '../sources/undergradFellowshipRecipientScraper';

const profileUrl = 'https://medicine.yale.edu/profile/jules-fixture/';

const identity = (email: string) => ({
  canonicalUrl: '',
  fetchedUrl: '',
  displayName: 'Jules Fixture',
  email,
  title: 'Professor',
  departments: [],
  researchInterests: [],
});

describe('official profile backfill reads researcher-held identity (#5000)', () => {
  let server: MongoMemoryServer;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    await mongoose.connect(server.getUri(), { autoIndex: false });
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await server?.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db!;
    await db.collection('researchers').deleteMany({});
    await db.collection('accounts').deleteMany({});
  });

  const seedIdentityHolder = (overrides: Record<string, unknown> = {}) =>
    Researcher.create({
      displayName: 'Jules Fixture',
      identifiers: { netid: 'jf777', email: 'jules.fixture@example.test' },
      profileLinks: [
        {
          kind: 'YALE_OFFICIAL',
          purpose: 'PRIMARY_IDENTITY',
          url: profileUrl,
          verifiedAt: new Date('2026-01-01T00:00:00Z'),
        },
      ],
      status: 'ACTIVE',
      archived: false,
      ...overrides,
    });

  it('finds a profile user by the netid the researcher holds with no account row', async () => {
    const researcher = await seedIdentityHolder();

    const users = await profileUsersByNetids(['JF777']);

    expect(await Account.countDocuments({})).toBe(0);
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({
      _id: String(researcher._id),
      netid: 'jf777',
      email: 'jules.fixture@example.test',
    });
  });

  it('still finds a profile user through a linked account when the researcher holds no netid', async () => {
    const account = await Account.create({
      netid: 'jf777',
      email: 'jules.fixture@example.test',
      status: 'ACTIVE',
      archived: false,
    });
    const researcher = await seedIdentityHolder({ identifiers: {}, accountId: account._id });

    const users = await profileUsersByNetids(['jf777']);

    expect(users.map((user) => [user._id, user.netid, user.email])).toEqual([
      [String(researcher._id), 'jf777', 'jules.fixture@example.test'],
    ]);
  });

  it('resolves nobody when two researchers answer for one netid', async () => {
    const account = await Account.create({
      netid: 'jf777',
      email: 'jules.fixture@example.test',
      status: 'ACTIVE',
      archived: false,
    });
    await seedIdentityHolder();
    await seedIdentityHolder({ identifiers: {}, accountId: account._id });

    expect(await profileUsersByNetids(['jf777'])).toEqual([]);
  });

  it('selects a direct visible-bio target that holds a netid but links no account', async () => {
    const researcher = await seedIdentityHolder();

    const targets = await selectDirectVisibleProfileBioUserTargets(10, new Set());

    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ _id: String(researcher._id), netid: 'jf777' });
    expect(targets[0].leadProfileUrls).toContain(profileUrl);
  });

  it('resolves a profile email to the researcher that holds it with no account row', async () => {
    const researcher = await seedIdentityHolder();

    const match = await resolveExistingUserForIdentity(identity('Jules.Fixture@example.test'));

    expect(match).toEqual({
      _id: String(researcher._id),
      netid: 'jf777',
      email: 'jules.fixture@example.test',
    });
  });

  it('reads an advisor netid from the researcher before any linked account', async () => {
    const account = await Account.create({
      netid: 'old9',
      email: 'jules.fixture@example.test',
      status: 'ACTIVE',
      archived: false,
    });

    expect(await netidForAdvisorResearcher({ identifiers: { netid: 'jf777' } })).toBe('jf777');
    expect(
      await netidForAdvisorResearcher({ identifiers: { netid: 'jf777' }, accountId: account._id }),
    ).toBe('jf777');
    expect(await netidForAdvisorResearcher({ identifiers: {}, accountId: account._id })).toBe(
      'old9',
    );
    expect(await netidForAdvisorResearcher({ identifiers: {} })).toBe('');
  });
});
