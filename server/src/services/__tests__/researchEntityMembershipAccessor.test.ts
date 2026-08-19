import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Account } from '../../models/account';
import { Researcher } from '../../models/researcher';
import { RoleAssignment } from '../../models/roleAssignment';
import { getResearchEntityRoster } from '../researchEntityMembershipAccessor';

describe('getResearchEntityRoster display profile projection', () => {
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
    for (const name of ['accounts', 'researchers', 'role_assignments']) {
      await db.collection(name).deleteMany({});
    }
  });

  const seedMember = async (
    entityId: mongoose.Types.ObjectId,
    profile: Record<string, string> | undefined,
    netid: string,
  ) => {
    const account = await Account.create({
      netid,
      email: `${netid}@example.test`,
      status: 'ACTIVE',
      archived: false,
    });
    const person = await Researcher.create({
      displayName: `Person ${netid}`,
      accountId: account._id,
      profileLinks: [],
      ...(profile ? { profile } : {}),
      status: 'ACTIVE',
      archived: false,
    });
    await RoleAssignment.create({
      personId: person._id,
      target: { kind: 'RESEARCH_ENTITY', id: entityId },
      role: 'PI',
      state: 'CURRENT',
      confidence: 0.9,
    });
    return person._id;
  };

  it('carries Person.profile display fields onto roster entries', async () => {
    const entityId = new mongoose.Types.ObjectId();
    await seedMember(
      entityId,
      {
        title: 'Professor of Testing',
        primaryDepartment: 'Department of Testing',
        imageUrl: 'https://img.example.test/u.png',
        websiteUrl: 'https://user.example.test',
      },
      'ab123',
    );

    const roster = await getResearchEntityRoster(entityId);

    expect(roster).toHaveLength(1);
    const [entry] = roster;
    expect(entry.name).toBe('Person ab123');
    expect(entry.netid).toBe('ab123');
    expect(entry.title).toBe('Professor of Testing');
    expect(entry.primaryDepartment).toBe('Department of Testing');
    expect(entry.imageUrl).toBe('https://img.example.test/u.png');
    expect(entry.websiteUrl).toBe('https://user.example.test');
  });

  it('omits display fields when the Person has no profile', async () => {
    const entityId = new mongoose.Types.ObjectId();
    await seedMember(entityId, undefined, 'zz999');

    const roster = await getResearchEntityRoster(entityId);

    expect(roster).toHaveLength(1);
    const [entry] = roster;
    expect(entry.name).toBe('Person zz999');
    expect(entry.title).toBeUndefined();
    expect(entry.primaryDepartment).toBeUndefined();
    expect(entry.imageUrl).toBeUndefined();
    expect(entry.websiteUrl).toBeUndefined();
  });
});
