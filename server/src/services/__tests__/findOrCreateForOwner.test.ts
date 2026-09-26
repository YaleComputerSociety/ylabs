import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Researcher } from '../../models/researcher';
import { RoleAssignment } from '../../models/roleAssignment';
import { ResearchEntity } from '../../models/researchEntity';
import { findOrCreateForOwner } from '../researchGroupService';

describe('findOrCreateForOwner canonical PI assignment', () => {
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
      'users',
      'research_entities',
    ]) {
      await db.collection(name).deleteMany({});
    }
  });

  it('resolves-or-creates the owner Researcher and writes a PI RoleAssignment for an un-materialized owner', async () => {
    const ownerId = new mongoose.Types.ObjectId();
    expect(await Researcher.countDocuments({})).toBe(0);

    const { group } = await findOrCreateForOwner({
      _id: ownerId,
      netid: 'pi001',
      fname: 'Pat',
      lname: 'Investigator',
    });

    expect(group?._id).toBeTruthy();

    const researcher: any = await Researcher.findOne({}).lean();
    expect(researcher).toBeTruthy();

    const assignment: any = await RoleAssignment.findOne({
      'target.kind': 'RESEARCH_ENTITY',
      'target.id': group._id,
      role: 'PI',
    }).lean();
    expect(assignment).toBeTruthy();
    expect(assignment.personId.toString()).toBe(researcher._id.toString());
    expect(assignment.state).toBe('CURRENT');
  });

  it('reuses the existing PI group on a second call for the same owner', async () => {
    const ownerId = new mongoose.Types.ObjectId();

    const first = await findOrCreateForOwner({
      _id: ownerId,
      netid: 'pi002',
      fname: 'Robin',
      lname: 'Scholar',
    });
    const second = await findOrCreateForOwner({
      _id: ownerId,
      netid: 'pi002',
      fname: 'Robin',
      lname: 'Scholar',
    });

    expect(second.group._id.toString()).toBe(first.group._id.toString());
    expect(await ResearchEntity.countDocuments({})).toBe(1);
    expect(
      await RoleAssignment.countDocuments({ 'target.kind': 'RESEARCH_ENTITY', role: 'PI' }),
    ).toBe(1);
  });
});
