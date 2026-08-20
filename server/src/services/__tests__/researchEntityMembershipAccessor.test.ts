import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Account } from '../../models/account';
import { Researcher } from '../../models/researcher';
import { RoleAssignment } from '../../models/roleAssignment';
import { User } from '../../models/user';
import { FacultyMember } from '../../models/facultyMember';
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
});

describe('resolveResearcherIdForLegacyUser faculty fallback', () => {
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
    for (const name of ['accounts', 'researchers', 'role_assignments', 'users', 'faculty_members']) {
      await db.collection(name).deleteMany({});
    }
  });

  it('resolves via the FacultyMember orcid when the User netid does not resolve', async () => {
    const orcid = '0000-0002-1825-0097';
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
      fname: 'Unrelated',
      lname: 'PersonOne',
    });
    const faculty = await FacultyMember.create({
      name: 'Faculty Display Name',
      orcidId: orcid,
    });

    const resolved = await resolveResearcherIdForLegacyUser(user._id, faculty._id);

    expect(resolved?.toString()).toBe(researcher._id.toString());
  });

  it('returns undefined when neither the User nor the FacultyMember resolve', async () => {
    const user = await User.create({
      netid: 'unresolved2',
      email: 'unresolved2@example.test',
      fname: 'Unrelated',
      lname: 'PersonTwo',
    });
    const faculty = await FacultyMember.create({ name: 'Unlinked Faculty' });

    const resolved = await resolveResearcherIdForLegacyUser(user._id, faculty._id);

    expect(resolved).toBeUndefined();
  });
});
