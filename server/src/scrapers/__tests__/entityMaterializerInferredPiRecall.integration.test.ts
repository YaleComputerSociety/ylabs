import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Account } from '../../models/account';
import { resolveResearcherIdForPersonName } from '../../services/researcherPersonNameResolver';
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

  const seedCanonicalResearcher = async (opts: {
    netid?: string;
    displayName: string;
    orcid?: string;
  }) => {
    let accountId: mongoose.Types.ObjectId | undefined;
    if (opts.netid) {
      const account = await Account.create({
        netid: opts.netid,
        email: `${opts.netid}@yale.edu`,
        status: 'ACTIVE',
        archived: false,
      });
      accountId = account._id as mongoose.Types.ObjectId;
    }
    return Researcher.create({
      schemaVersion: 1,
      displayName: opts.displayName,
      ...(accountId ? { accountId } : {}),
      ...(opts.orcid ? { identifiers: { orcid: opts.orcid } } : {}),
      status: 'ACTIVE',
      archived: false,
    });
  };

  it('fails closed for an email-local-part key that is not a canonical netid and carries no name', async () => {
    const entity = await seedEntity('synthetic-recall-dotted');
    await seedCanonicalResearcher({ netid: 'aparker', displayName: 'Avery Parker' });

    await materializeInferredPiMembership(String(entity._id), [
      inferredPiKeyObservation('avery.parker'),
    ]);

    const leads = await leadRolesForEntity(entity._id as mongoose.Types.ObjectId);
    expect(leads).toHaveLength(0);
  });

  it('attaches a PI lead resolved by name from a synthetic dept key', async () => {
    const entity = await seedEntity('synthetic-recall-orcid');
    const researcher = await seedCanonicalResearcher({
      displayName: 'Sam Lee',
      orcid: '0000-0002-1359-5299',
    });

    await materializeInferredPiMembership(String(entity._id), [
      inferredPiKeyObservation('dept:econ:sam-lee'),
    ]);

    const leads = await leadRolesForEntity(entity._id as mongoose.Types.ObjectId);
    expect(leads).toHaveLength(1);
    expect(String(leads[0].personId)).toBe(String(researcher._id));
  });

  it.each(['ysm', 'bbs', 'yse'])(
    'attaches a PI lead resolved by name from a single-colon %s key (#2799 follow-up)',
    async (namespace) => {
      const entity = await seedEntity(`synthetic-recall-${namespace}`);
      const researcher = await seedCanonicalResearcher({ displayName: 'Rosalind Vance' });

      await materializeInferredPiMembership(String(entity._id), [
        inferredPiKeyObservation(`${namespace}:rosalind-vance`),
      ]);

      const leads = await leadRolesForEntity(entity._id as mongoose.Types.ObjectId);
      expect(leads).toHaveLength(1);
      expect(String(leads[0].personId)).toBe(String(researcher._id));
    },
  );

  it('refuses a nih-pi key, which names a grant PI who may hold no Yale appointment', async () => {
    const entity = await seedEntity('synthetic-recall-nih');
    await seedCanonicalResearcher({ displayName: 'Rosalind Vance' });

    await materializeInferredPiMembership(String(entity._id), [
      inferredPiKeyObservation('nih-pi:rosalind-vance'),
    ]);

    expect(await leadRolesForEntity(entity._id as mongoose.Types.ObjectId)).toHaveLength(0);
  });

  it('never attaches a lead on a bare surname, because the name resolver refuses one token', async () => {
    // Not a guard in this file: `resolveResearcherIdForPersonName` itself declines a
    // single-token name, returning `absent` even when exactly one researcher bears it.
    // Pinned here because a surname-only match is how #2768 put a person who does not lead
    // the lab onto a served page, so if the resolver ever starts matching one token this
    // test is where that shows up.
    const entity = await seedEntity('synthetic-recall-surname');
    const researcher = await seedCanonicalResearcher({ displayName: 'Vance' });

    const resolution = await resolveResearcherIdForPersonName('vance', {});
    expect(resolution.status).toBe('absent');
    expect(researcher._id).toBeDefined();

    await materializeInferredPiMembership(String(entity._id), [
      inferredPiKeyObservation('ysm:vance'),
    ]);

    expect(await leadRolesForEntity(entity._id as mongoose.Types.ObjectId)).toHaveLength(0);
  });

  it('refuses a nih-pi key, which names a grant PI who may hold no Yale appointment', async () => {
    const entity = await seedEntity('synthetic-recall-nih');
    await seedCanonicalResearcher({ displayName: 'Rosalind Vance' });

    await materializeInferredPiMembership(String(entity._id), [
      inferredPiKeyObservation('nih-pi:rosalind-vance'),
    ]);

    expect(await leadRolesForEntity(entity._id as mongoose.Types.ObjectId)).toHaveLength(0);
  });

  it('attaches to an account-backed researcher resolved by a canonical netid', async () => {
    const entity = await seedEntity('synthetic-recall-canonical');
    const researcher = await seedCanonicalResearcher({ netid: 'plr42', displayName: 'Priya Lang' });

    await materializeInferredPiMembership(String(entity._id), [inferredPiKeyObservation('plr42')]);

    const leads = await leadRolesForEntity(entity._id as mongoose.Types.ObjectId);
    expect(leads).toHaveLength(1);
    expect(String(leads[0].personId)).toBe(String(researcher._id));

    const account = await Account.findOne({ netid: 'plr42' }).lean<{
      _id: mongoose.Types.ObjectId;
    }>();
    expect(String(researcher.accountId)).toBe(String(account?._id));
  });

  it('fails closed when no canonical researcher matches the key', async () => {
    const entity = await seedEntity('synthetic-recall-unmatched');

    await materializeInferredPiMembership(String(entity._id), [
      inferredPiKeyObservation('nobody.here'),
    ]);

    const leads = await leadRolesForEntity(entity._id as mongoose.Types.ObjectId);
    expect(leads).toHaveLength(0);
    expect(await Researcher.countDocuments({})).toBe(0);
  });

  it('is idempotent: re-running does not create a second lead', async () => {
    const entity = await seedEntity('synthetic-recall-idempotent');
    await seedCanonicalResearcher({ netid: 'jokoro', displayName: 'Jordan Okoro' });

    const observations = [inferredPiKeyObservation('jokoro')];
    await materializeInferredPiMembership(String(entity._id), observations);
    await materializeInferredPiMembership(String(entity._id), observations);

    const leads = await leadRolesForEntity(entity._id as mongoose.Types.ObjectId);
    expect(leads).toHaveLength(1);
    expect(await Researcher.countDocuments({ displayName: 'Jordan Okoro' })).toBe(1);
  });
});
