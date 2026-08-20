import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Account } from '../../models/account';
import { Researcher } from '../../models/researcher';
import { RoleAssignment } from '../../models/roleAssignment';
import { ResearchEntity } from '../../models/researchEntity';
import { User } from '../../models/user';
import { selectVisibleProfileBioTargets } from '../sources/officialProfilePiBackfillScraper';

describe('selectVisibleProfileBioTargets canonical roster reads', () => {
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
    for (const name of [
      'accounts',
      'researchers',
      'role_assignments',
      'research_entities',
      'users',
    ]) {
      await db.collection(name).deleteMany({});
    }
  });

  const seedEntity = async () => {
    const entity = await ResearchEntity.create({
      slug: 'fixture-lab',
      name: 'Fixture Lab',
      kind: 'lab',
      studentVisibilityTier: 'student_ready',
      archived: false,
    });
    return entity._id as mongoose.Types.ObjectId;
  };

  const seedCanonicalLead = async (
    entityId: mongoose.Types.ObjectId,
    accountNetid: string,
    profileUrl: string,
    roleOverrides: Record<string, unknown> = {},
  ) => {
    const account = await Account.create({
      netid: accountNetid,
      email: `${accountNetid}@example.test`,
      status: 'ACTIVE',
      archived: false,
    });
    const researcher = await Researcher.create({
      displayName: 'Jules Fixture',
      accountId: account._id,
      profileLinks: [],
      status: 'ACTIVE',
      archived: false,
    });
    await RoleAssignment.create({
      personId: researcher._id,
      target: { kind: 'RESEARCH_ENTITY', id: entityId },
      role: 'PI',
      state: 'CURRENT',
      confidence: 0.9,
      archived: false,
      rosterProvenance: { profileUrl },
      ...roleOverrides,
    });
    return { account, researcher };
  };

  it('joins a mixed-case User.netid to the lowercase Account.netid roster lead', async () => {
    const profileUrl = 'https://medicine.yale.edu/profile/jules-fixture/';
    const entityId = await seedEntity();
    await seedCanonicalLead(entityId, 'jf777', profileUrl);
    await User.create({
      netid: 'JF777',
      email: 'jules.fixture@yale.edu',
      fname: 'Jules',
      lname: 'Fixture',
      userType: 'professor',
      bio: '',
    });

    const targets = await selectVisibleProfileBioTargets(10);

    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ netid: 'JF777' });
    expect(targets[0].leadProfileUrls).toContain(profileUrl);
  });

  it('does not select a lead whose only role assignment is HISTORICAL', async () => {
    const profileUrl = 'https://medicine.yale.edu/profile/jules-fixture/';
    const entityId = await seedEntity();
    await seedCanonicalLead(entityId, 'jf777', profileUrl, {
      state: 'HISTORICAL',
      endedAt: new Date('2020-01-01'),
    });
    await User.create({
      netid: 'JF777',
      email: 'jules.fixture@yale.edu',
      fname: 'Jules',
      lname: 'Fixture',
      userType: 'professor',
      bio: '',
    });

    const targets = await selectVisibleProfileBioTargets(10);

    expect(targets).toHaveLength(0);
  });
});
