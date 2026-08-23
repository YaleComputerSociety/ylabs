import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Account } from '../../models/account';
import { Researcher } from '../../models/researcher';
import { RoleAssignment } from '../../models/roleAssignment';
import { ResearchEntity } from '../../models/researchEntity';
import { User } from '../../models/user';
import { getProfileByNetid } from '../profileService';

describe('getProfileByNetid research homes from canonical RoleAssignment', () => {
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

  const seedProfessorResearcher = async (netid: string) => {
    const account = await Account.create({
      netid,
      email: `${netid}@example.test`,
      status: 'ACTIVE',
      archived: false,
    });
    const researcher = await Researcher.create({
      displayName: `Professor ${netid}`,
      accountId: account._id,
      profileLinks: [],
      status: 'ACTIVE',
      archived: false,
    });
    await User.create({
      netid,
      email: `${netid}@example.test`,
      fname: 'Pat',
      lname: 'Professor',
      userType: 'professor',
    });
    return researcher._id;
  };

  const seedResearchEntity = async (slug: string, name: string) => {
    const entity = await ResearchEntity.create({
      slug,
      name,
      kind: 'lab',
      studentVisibilityTier: 'student_ready',
      archived: false,
    });
    return entity._id;
  };

  const assignRole = async (
    personId: mongoose.Types.ObjectId,
    entityId: mongoose.Types.ObjectId,
    overrides: Record<string, unknown> = {},
  ) =>
    RoleAssignment.create({
      personId,
      target: { kind: 'RESEARCH_ENTITY', id: entityId },
      role: 'PI',
      state: 'CURRENT',
      confidence: 0.9,
      archived: false,
      ...overrides,
    });

  it('surfaces the entity with the legacy role string mapped from the canonical role', async () => {
    const personId = await seedProfessorResearcher('pi001');
    const entityId = await seedResearchEntity('quantum-lab', 'Quantum Lab');
    await assignRole(personId, entityId, { role: 'CO_PI' });

    const profile: any = await getProfileByNetid('pi001');

    expect(profile.researchEntities).toHaveLength(1);
    expect(profile.researchEntities[0]).toMatchObject({
      name: 'Quantum Lab',
      role: 'co-pi',
    });
  });

  it('excludes HISTORICAL and archived assignments while keeping CURRENT and UNKNOWN', async () => {
    const personId = await seedProfessorResearcher('pi002');
    const current = await seedResearchEntity('current-lab', 'Current Lab');
    const unknown = await seedResearchEntity('unknown-lab', 'Unknown Lab');
    const historical = await seedResearchEntity('historical-lab', 'Historical Lab');
    const archived = await seedResearchEntity('archived-lab', 'Archived Lab');

    await assignRole(personId, current, { state: 'CURRENT' });
    await assignRole(personId, unknown, { state: 'UNKNOWN' });
    await assignRole(personId, historical, { state: 'HISTORICAL', endedAt: new Date('2020-01-01') });
    await assignRole(personId, archived, { state: 'CURRENT', archived: true });

    const profile: any = await getProfileByNetid('pi002');

    const names = profile.researchEntities.map((entity: any) => entity.name).sort();
    expect(names).toEqual(['Current Lab', 'Unknown Lab']);
  });

  it('returns null for a non-faculty account so the profile endpoint 404s', async () => {
    await User.create({
      netid: 'ugrad01',
      email: 'ugrad01@example.test',
      fname: 'Undergrad',
      lname: 'Student',
      userType: 'undergraduate',
    });

    const profile = await getProfileByNetid('ugrad01');

    expect(profile).toBeNull();
  });

  it('returns null for an unknown netid', async () => {
    const profile = await getProfileByNetid('missing99');

    expect(profile).toBeNull();
  });

  it('serves a faculty account stored under the legacy "faculty" userType alias', async () => {
    await User.create({
      netid: 'facalias01',
      email: 'facalias01@example.test',
      fname: 'Faculty',
      lname: 'Alias',
      userType: 'faculty',
    });

    const profile: any = await getProfileByNetid('facalias01');

    expect(profile).not.toBeNull();
    expect(profile.netid).toBe('facalias01');
  });

  it('fails closed with no research homes when the user resolves to no canonical researcher', async () => {
    await User.create({
      netid: 'ghost01',
      email: 'ghost01@example.test',
      fname: 'Ghost',
      lname: 'Professor',
      userType: 'professor',
    });
    const orphanEntity = await seedResearchEntity('orphan-lab', 'Orphan Lab');
    await RoleAssignment.create({
      personId: new mongoose.Types.ObjectId(),
      target: { kind: 'RESEARCH_ENTITY', id: orphanEntity },
      role: 'PI',
      state: 'CURRENT',
      confidence: 0.9,
      archived: false,
    });

    const profile: any = await getProfileByNetid('ghost01');

    expect(profile.researchEntities).toEqual([]);
  });
});
