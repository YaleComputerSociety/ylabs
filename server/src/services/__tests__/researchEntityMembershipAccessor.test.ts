import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Account } from '../../models/account';
import { Researcher } from '../../models/researcher';
import { RoleAssignment } from '../../models/roleAssignment';
import { User } from '../../models/user';
import {
  getResearchEntityRoster,
  resolveResearcherIdForLegacyUser,
} from '../researchEntityMembershipAccessor';

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

  it('prefers a live UNKNOWN assignment over a stale HISTORICAL one for the same person and role (#1071)', async () => {
    const entityId = new mongoose.Types.ObjectId();
    const account = await Account.create({
      netid: 'lead01',
      email: 'lead01@example.test',
      status: 'ACTIVE',
      archived: false,
    });
    const person = await Researcher.create({
      displayName: 'Live Lead',
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
      startedAt: new Date('2020-01-01'),
      endedAt: new Date('2021-01-01'),
      confidence: 0.6,
    });
    await RoleAssignment.create({
      personId: person._id,
      target: { kind: 'RESEARCH_ENTITY', id: entityId },
      role: 'PI',
      state: 'UNKNOWN',
      confidence: 0.7,
    });

    const roster = await getResearchEntityRoster(entityId);

    expect(roster).toHaveLength(1);
    expect(roster[0].personId.toString()).toBe(person._id.toString());
    expect(roster[0].state).toBe('UNKNOWN');
  });
});

describe('resolveResearcherIdForLegacyUser canonical resolution', () => {
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
    for (const name of ['accounts', 'researchers', 'role_assignments', 'users']) {
      await db.collection(name).deleteMany({});
    }
  });

  it('resolves via the netid to Account to Researcher chain', async () => {
    const account = await Account.create({
      netid: 'resolvenetid',
      email: 'resolvenetid@example.test',
      status: 'ACTIVE',
      archived: false,
    });
    const researcher = await Researcher.create({
      displayName: 'Netid Researcher',
      accountId: account._id,
      profileLinks: [],
      status: 'ACTIVE',
      archived: false,
    });
    const user = await User.create({
      netid: 'ResolveNetid',
      email: 'resolvenetid@example.test',
      fname: 'Netid',
      lname: 'Researcher',
    });

    const resolved = await resolveResearcherIdForLegacyUser(user._id);

    expect(resolved?.toString()).toBe(researcher._id.toString());
  });

  it('falls back to the User orcid when the netid does not resolve', async () => {
    const orcid = '0009-0009-0009-0003';
    const researcher = await Researcher.create({
      displayName: 'Canonical Researcher Name',
      identifiers: { orcid },
      profileLinks: [],
      status: 'ACTIVE',
      archived: false,
    });
    const user = await User.create({
      netid: 'unresolved1',
      email: 'unresolved1@example.test',
      orcid,
      fname: 'Unrelated',
      lname: 'PersonOne',
    });

    const resolved = await resolveResearcherIdForLegacyUser(user._id);

    expect(resolved?.toString()).toBe(researcher._id.toString());
  });

  it('falls back to a single displayName match when neither netid nor orcid resolve', async () => {
    const researcher = await Researcher.create({
      displayName: 'Solo Matcher',
      profileLinks: [],
      status: 'ACTIVE',
      archived: false,
    });
    const user = await User.create({
      netid: 'unresolved3',
      email: 'unresolved3@example.test',
      fname: 'Solo',
      lname: 'Matcher',
    });

    const resolved = await resolveResearcherIdForLegacyUser(user._id);

    expect(resolved?.toString()).toBe(researcher._id.toString());
  });

  it('returns undefined when the User does not resolve to any Researcher', async () => {
    const user = await User.create({
      netid: 'unresolved2',
      email: 'unresolved2@example.test',
      fname: 'Unrelated',
      lname: 'PersonTwo',
    });

    const resolved = await resolveResearcherIdForLegacyUser(user._id);

    expect(resolved).toBeUndefined();
  });
});
