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
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
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
    const person = await Researcher.create({
      displayName: `Person ${netid}`,
      identifiers: { netid, email: `${netid}@example.test` },
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

  it('never carries a course page as a member website', async () => {
    const entityId = new mongoose.Types.ObjectId();
    await seedMember(
      entityId,
      { websiteUrl: 'https://fixturedept.example.test/courses/laboratory-fixture-anatomy' },
      'ef789',
    );

    const [entry] = await getResearchEntityRoster(entityId);

    expect(entry.websiteUrl).toBeUndefined();
  });

  it('reads the roster email from the researcher identifiers', async () => {
    const entityId = new mongoose.Types.ObjectId();
    const personId = await seedMember(entityId, undefined, 'cd456');
    await Researcher.updateOne(
      { _id: personId },
      { $set: { 'identifiers.email': 'researcher.identity@example.test' } },
    );

    const [entry] = await getResearchEntityRoster(entityId);

    expect(entry.email).toBe('researcher.identity@example.test');
    expect(entry.netid).toBe('cd456');
  });

  it('serves the researcher netid and email when the researcher links no account', async () => {
    const entityId = new mongoose.Types.ObjectId();
    const person = await Researcher.create({
      displayName: 'Accountless Person',
      profileLinks: [],
      identifiers: { netid: 'ef789', email: 'accountless@example.test' },
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

    const [entry] = await getResearchEntityRoster(entityId);

    expect(entry.email).toBe('accountless@example.test');
    expect(entry.netid).toBe('ef789');
  });

  it('never resolves identity through a linked account, which names nobody outside its environment', async () => {
    const entityId = new mongoose.Types.ObjectId();
    const account = await Account.create({
      netid: 'gh012',
      email: 'linked.account@example.test',
      status: 'ACTIVE',
      archived: false,
    });
    const person = await Researcher.create({
      displayName: 'Linked Person',
      accountId: account._id,
      profileLinks: [],
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

    const [entry] = await getResearchEntityRoster(entityId);

    expect(entry.netid).toBe('');
    expect(entry.email).toBe('');
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

  it('collapses multiple current assignments for one person to the highest-priority role', async () => {
    const entityId = new mongoose.Types.ObjectId();
    const account = await Account.create({
      netid: 'dup01',
      email: 'dup01@example.test',
      status: 'ACTIVE',
      archived: false,
    });
    const person = await Researcher.create({
      displayName: 'Duplicated Person',
      accountId: account._id,
      profileLinks: [],
      status: 'ACTIVE',
      archived: false,
    });
    await RoleAssignment.create({
      personId: person._id,
      target: { kind: 'RESEARCH_ENTITY', id: entityId },
      role: 'CORE_FACULTY',
      state: 'CURRENT',
      confidence: 0.8,
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
    expect(roster[0].personId.toString()).toBe(person._id.toString());
    expect(roster[0].roleCanonical).toBe('PI');
    expect(roster[0].role).toBe('pi');
  });

  it('surfaces a live lead over a historical assignment for the same person', async () => {
    const entityId = new mongoose.Types.ObjectId();
    const account = await Account.create({
      netid: 'mask01',
      email: 'mask01@example.test',
      status: 'ACTIVE',
      archived: false,
    });
    const person = await Researcher.create({
      displayName: 'Masked Lead',
      accountId: account._id,
      profileLinks: [],
      status: 'ACTIVE',
      archived: false,
    });
    await RoleAssignment.create({
      personId: person._id,
      target: { kind: 'RESEARCH_ENTITY', id: entityId },
      role: 'PI',
      state: 'HISTORICAL',
      startedAt: new Date('2026-05-15T16:58:09.000Z'),
      endedAt: new Date('2026-05-15T18:20:55.000Z'),
      confidence: 0.7,
    });
    await RoleAssignment.create({
      personId: person._id,
      target: { kind: 'RESEARCH_ENTITY', id: entityId },
      role: 'PI',
      state: 'UNKNOWN',
      startedAt: new Date('2026-05-15T16:58:25.000Z'),
      confidence: 0.7,
    });

    const roster = await getResearchEntityRoster(entityId);

    expect(roster).toHaveLength(1);
    expect(roster[0].personId.toString()).toBe(person._id.toString());
    expect(roster[0].state).toBe('UNKNOWN');
    expect(roster[0].role).toBe('pi');
  });
});
