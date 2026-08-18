import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Account } from '../../models/account';
import { Person } from '../../models/person';
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
    for (const name of ['accounts', 'people', 'role_assignments']) {
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
    const person = await Person.create({
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

  it('carries Person.profileLinks onto roster entries', async () => {
    const entityId = new mongoose.Types.ObjectId();
    const account = await Account.create({
      netid: 'pl123',
      email: 'pl123@example.test',
      status: 'ACTIVE',
      archived: false,
    });
    const person = await Person.create({
      displayName: 'Person pl123',
      accountId: account._id,
      profileLinks: [
        {
          kind: 'YALE_OFFICIAL',
          purpose: 'PRIMARY_IDENTITY',
          url: 'https://medicine.yale.edu/profile/person-pl123/',
          verifiedAt: new Date('2026-01-01T00:00:00Z'),
          healthStatus: 'HEALTHY',
        },
      ],
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

    const roster = await getResearchEntityRoster(entityId);

    expect(roster).toHaveLength(1);
    expect(roster[0].profileLinks).toHaveLength(1);
    expect(roster[0].profileLinks[0]).toMatchObject({
      kind: 'YALE_OFFICIAL',
      url: 'https://medicine.yale.edu/profile/person-pl123/',
    });
  });

  it('defaults profileLinks to an empty array when the Person has none', async () => {
    const entityId = new mongoose.Types.ObjectId();
    await seedMember(entityId, undefined, 'np777');

    const roster = await getResearchEntityRoster(entityId);

    expect(roster[0].profileLinks).toEqual([]);
  });

  const seedMemberWithState = async (
    entityId: mongoose.Types.ObjectId,
    state: 'CURRENT' | 'HISTORICAL' | 'UNKNOWN',
    netid: string,
  ) => {
    const account = await Account.create({
      netid,
      email: `${netid}@example.test`,
      status: 'ACTIVE',
      archived: false,
    });
    const person = await Person.create({
      displayName: `Person ${netid}`,
      accountId: account._id,
      profileLinks: [],
      status: 'ACTIVE',
      archived: false,
    });
    await RoleAssignment.create({
      personId: person._id,
      target: { kind: 'RESEARCH_ENTITY', id: entityId },
      role: 'PI',
      state,
      confidence: 0.9,
    });
  };

  it('treats CURRENT and UNKNOWN assignments as current members but not HISTORICAL', async () => {
    const currentEntity = new mongoose.Types.ObjectId();
    const unknownEntity = new mongoose.Types.ObjectId();
    const historicalEntity = new mongoose.Types.ObjectId();
    await seedMemberWithState(currentEntity, 'CURRENT', 'cur001');
    await seedMemberWithState(unknownEntity, 'UNKNOWN', 'unk001');
    await seedMemberWithState(historicalEntity, 'HISTORICAL', 'his001');

    const [current] = await getResearchEntityRoster(currentEntity);
    const [unknown] = await getResearchEntityRoster(unknownEntity);
    const [historical] = await getResearchEntityRoster(historicalEntity);

    expect(current.isCurrentMember).toBe(true);
    expect(unknown.isCurrentMember).toBe(true);
    expect(historical.isCurrentMember).toBe(false);
  });
});
