import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { deleteFromIndexMock } = vi.hoisted(() => ({
  deleteFromIndexMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return {
    ...actual,
    syncEntity: vi.fn().mockResolvedValue(undefined),
    deleteFromIndex: deleteFromIndexMock,
  };
});

vi.mock('../../services/researchEntityBrowseRankService', async () => {
  const actual = await vi.importActual<
    typeof import('../../services/researchEntityBrowseRankService')
  >('../../services/researchEntityBrowseRankService');
  return { ...actual, recomputeBrowseRankForEntities: vi.fn().mockResolvedValue(undefined) };
});

import { Observation } from '../../models/observation';
import { ResearchEntity } from '../../models/researchEntity';
import { RoleAssignment } from '../../models/roleAssignment';
import { Researcher } from '../../models/researcher';
import { Account } from '../../models/account';
import { materializeEntity } from '../entityMaterializer';

describe('materializeEntity folds dept-roster shells into their canonical PI-linked home (#1364)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of [
      'observations',
      'research_entities',
      'role_assignments',
      'researchers',
      'users',
    ]) {
      await db.collection(name).deleteMany({});
    }
  });

  const seedDeptRosterObservation = async (input: {
    entityKey: string;
    field: string;
    value: unknown;
  }) =>
    Observation.create({
      entityType: 'researchEntity',
      entityKey: input.entityKey,
      field: input.field,
      value: input.value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'dept-faculty-roster',
      sourceUrl: 'https://chemistry.yale.edu/people/jane-smith',
      confidence: 0.7,
      observedAt: new Date('2026-02-01T00:00:00Z'),
      superseded: false,
    });

  it('folds a newly-minted dept-roster shell into the PI-linked lab instead of leaving it an orphan', async () => {
    const lab = await ResearchEntity.create({
      slug: 'jane-smith-lab',
      name: 'Jane Smith Lab',
      kind: 'lab',
      studentVisibilityTier: 'student_ready',
      departments: ['Molecular Biophysics'],
      archived: false,
    });

    const account = await Account.create({
      netid: 'jane.smith',
      email: 'jane.smith@yale.edu',
      status: 'ACTIVE',
    });
    const researcher = await Researcher.create({
      displayName: 'Jane Smith',
      accountId: account._id,
    });
    await RoleAssignment.create({
      personId: researcher._id,
      target: { kind: 'RESEARCH_ENTITY', id: lab._id },
      role: 'PI',
      state: 'CURRENT',
      confidence: 0.9,
      archived: false,
    });

    const deptRosterKey = 'dept-chemistry-jane-smith';
    await seedDeptRosterObservation({
      entityKey: deptRosterKey,
      field: 'name',
      value: 'Jane Smith Faculty Research',
    });
    await seedDeptRosterObservation({
      entityKey: deptRosterKey,
      field: 'departments',
      value: ['Chemistry'],
    });
    await seedDeptRosterObservation({
      entityKey: deptRosterKey,
      field: 'sourceUrls',
      value: ['https://chemistry.yale.edu/people/jane-smith'],
    });

    await materializeEntity('researchEntity', { entityKey: deptRosterKey }, {});

    const shell = await ResearchEntity.findOne({ slug: deptRosterKey }).lean<{
      _id: mongoose.Types.ObjectId;
      archived?: boolean;
      canonicalGroupId?: mongoose.Types.ObjectId;
    }>();
    expect(shell?.archived).toBe(true);
    expect(String(shell?.canonicalGroupId)).toBe(String(lab._id));
    expect(deleteFromIndexMock).toHaveBeenCalledWith('researchEntity', String(shell?._id));

    const canonical = await ResearchEntity.findById(lab._id).lean<{ departments?: string[] }>();
    expect(canonical?.departments).toEqual(
      expect.arrayContaining(['Molecular Biophysics', 'Chemistry']),
    );

    expect(await ResearchEntity.countDocuments({ archived: { $ne: true } })).toBe(1);
  });

  it('still mints a live shell when the person has no existing PI-linked research home', async () => {
    const deptRosterKey = 'dept-chemistry-alex-doe';
    await seedDeptRosterObservation({
      entityKey: deptRosterKey,
      field: 'name',
      value: 'Alex Doe Faculty Research',
    });

    await materializeEntity('researchEntity', { entityKey: deptRosterKey }, {});

    const shell = await ResearchEntity.findOne({ slug: deptRosterKey }).lean<{
      archived?: boolean;
      canonicalGroupId?: unknown;
    }>();
    expect(shell).not.toBeNull();
    expect(shell?.archived).not.toBe(true);
    expect(shell?.canonicalGroupId ?? undefined).toBeUndefined();
    expect(deleteFromIndexMock).not.toHaveBeenCalled();
  });
});
