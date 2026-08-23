import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { User } from '../../models/user';
import { Account } from '../../models/account';
import { Researcher } from '../../models/researcher';
import { RoleAssignment } from '../../models/roleAssignment';
import { ResearchEntity } from '../../models/researchEntity';
import { materializeInferredPiMembership } from '../entityMaterializer';

type LeanRole = { role: string; state: string; personId: mongoose.Types.ObjectId };

describe('materializeInferredPiMembership resolves leads for users with non-canonical netids (#940)', () => {
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
      'users',
      'accounts',
      'researchers',
      'role_assignments',
      'research_entities',
    ]) {
      await db.collection(name).deleteMany({});
    }
  });

  const seedEntity = async (slug: string) =>
    ResearchEntity.create({
      slug,
      name: 'Synthetic Lab',
      kind: 'lab',
      studentVisibilityTier: 'student_ready',
      archived: false,
    });

  const inferredPiKeyObservation = (value: string) => ({
    field: 'inferredPiUserKey',
    value,
    sourceName: 'official-profile-pi-backfill',
    sourceUrl: 'https://example.edu/profile/synthetic-lead/',
    confidence: 0.88,
    observedAt: new Date('2026-01-01T00:00:00Z'),
  });

  const leadRolesForEntity = async (entityId: mongoose.Types.ObjectId) =>
    RoleAssignment.find({
      'target.kind': 'RESEARCH_ENTITY',
      'target.id': entityId,
      role: 'PI',
      state: { $ne: 'HISTORICAL' },
    }).lean<LeanRole[]>();

  it('materializes a PI lead when the matched user has an email-local-part netid and no orcid', async () => {
    const entity = await seedEntity('synthetic-recall-dotted');
    await User.create({
      netid: 'pat.rivera',
      email: 'pat.rivera@yale.edu',
      fname: 'Pat',
      lname: 'Rivera',
      userType: 'professor',
    });

    await materializeInferredPiMembership(String(entity._id), [
      inferredPiKeyObservation('pat.rivera'),
    ]);

    const leads = await leadRolesForEntity(entity._id as mongoose.Types.ObjectId);
    expect(leads).toHaveLength(1);

    const researcher = await Researcher.findById(leads[0].personId).lean<{
      displayName?: string;
    }>();
    expect(researcher?.displayName).toBe('Pat Rivera');
  });

  it('materializes a PI lead when the matched user has a synthetic key netid but a valid orcid', async () => {
    const entity = await seedEntity('synthetic-recall-orcid');
    await User.create({
      netid: 'dept:econ:sam-lee',
      email: 'sam.lee@example.edu',
      orcid: '0000-0002-1359-5299',
      fname: 'Sam',
      lname: 'Lee',
      userType: 'professor',
    });

    await materializeInferredPiMembership(String(entity._id), [
      inferredPiKeyObservation('dept:econ:sam-lee'),
    ]);

    const leads = await leadRolesForEntity(entity._id as mongoose.Types.ObjectId);
    expect(leads).toHaveLength(1);

    const researcher = await Researcher.findById(leads[0].personId).lean<{
      displayName?: string;
      identifiers?: { orcid?: string };
    }>();
    expect(researcher?.displayName).toBe('Sam Lee');
    expect(researcher?.identifiers?.orcid).toBe('0000-0002-1359-5299');
  });

  it('creates an account-backed researcher when the matched user has a canonical netid', async () => {
    const entity = await seedEntity('synthetic-recall-canonical');
    await User.create({
      netid: 'plr42',
      email: 'plr42@yale.edu',
      fname: 'Priya',
      lname: 'Lang',
      userType: 'professor',
    });

    await materializeInferredPiMembership(String(entity._id), [inferredPiKeyObservation('plr42')]);

    const leads = await leadRolesForEntity(entity._id as mongoose.Types.ObjectId);
    expect(leads).toHaveLength(1);

    const account = await Account.findOne({ netid: 'plr42' }).lean<{
      _id: mongoose.Types.ObjectId;
    }>();
    expect(account).not.toBeNull();
    const researcher = await Researcher.findById(leads[0].personId).lean<{
      accountId?: mongoose.Types.ObjectId;
    }>();
    expect(String(researcher?.accountId)).toBe(String(account?._id));
  });

  it('is idempotent: re-running does not create a second lead', async () => {
    const entity = await seedEntity('synthetic-recall-idempotent');
    await User.create({
      netid: 'jordan.okoro',
      email: 'jordan.okoro@yale.edu',
      fname: 'Jordan',
      lname: 'Okoro',
      userType: 'professor',
    });

    const observations = [inferredPiKeyObservation('jordan.okoro')];
    await materializeInferredPiMembership(String(entity._id), observations);
    await materializeInferredPiMembership(String(entity._id), observations);

    const leads = await leadRolesForEntity(entity._id as mongoose.Types.ObjectId);
    expect(leads).toHaveLength(1);
    expect(await Researcher.countDocuments({ displayName: 'Jordan Okoro' })).toBe(1);
  });
});
