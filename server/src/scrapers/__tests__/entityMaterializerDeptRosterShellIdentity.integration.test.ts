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
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
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
      'accounts',
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

  describe('when every PI-linked row is a cross-listed department roster row (#4371)', () => {
    const crossListedRow = async (department: string, overrides: Record<string, unknown> = {}) =>
      ResearchEntity.create({
        slug: `dept-${department.toLowerCase()}-jane-smith`,
        name: 'Jane Smith Faculty Research',
        kind: 'individual',
        entityType: 'FACULTY_RESEARCH_AREA',
        studentVisibilityTier: 'operator_review',
        departments: [department],
        archived: false,
        ...overrides,
      });

    const researcherNamed = async (netid: string) => {
      const account = await Account.create({
        netid,
        email: `${netid}@yale.edu`,
        status: 'ACTIVE',
      });
      return Researcher.create({ displayName: 'Jane Smith', accountId: account._id });
    };

    const piEdge = async (personId: unknown, entityId: unknown) =>
      RoleAssignment.create({
        personId,
        target: { kind: 'RESEARCH_ENTITY', id: entityId },
        role: 'PI',
        state: 'CURRENT',
        confidence: 0.9,
        archived: false,
      });

    const rematerialize = async (department: string) => {
      const entityKey = `dept-${department.toLowerCase()}-jane-smith`;
      await seedDeptRosterObservation({ entityKey, field: 'departments', value: [department] });
      await materializeEntity('researchEntity', { entityKey }, {});
    };

    const liveRows = async () =>
      ResearchEntity.find({ archived: { $ne: true } })
        .select('slug departments')
        .lean<Array<{ slug: string; departments?: string[] }>>();

    it('folds every row into the one that serves, so the person is one row across departments', async () => {
      const researcher = await researcherNamed('jane.smith');
      const chemistry = await crossListedRow('Chemistry', {
        createdAt: new Date('2026-09-10T00:00:00Z'),
      });
      const physics = await crossListedRow('Physics', {
        studentVisibilityTier: 'student_ready',
        createdAt: new Date('2026-09-12T00:00:00Z'),
      });
      const biology = await crossListedRow('Biology', {
        createdAt: new Date('2026-09-01T00:00:00Z'),
      });
      for (const row of [chemistry, physics, biology]) await piEdge(researcher._id, row._id);

      for (const department of ['Chemistry', 'Physics', 'Biology']) {
        await rematerialize(department);
      }

      const live = await liveRows();
      expect(live.map((row) => row.slug)).toEqual([physics.slug]);
      expect(live[0].departments).toEqual(
        expect.arrayContaining(['Chemistry', 'Physics', 'Biology']),
      );
      for (const folded of [chemistry, biology]) {
        const stored = await ResearchEntity.findById(folded._id).lean<{
          archived?: boolean;
          canonicalGroupId?: unknown;
        }>();
        expect(stored?.archived).toBe(true);
        expect(String(stored?.canonicalGroupId)).toBe(String(physics._id));
      }

      await rematerialize('Physics');
      expect((await liveRows()).map((row) => row.slug)).toEqual([physics.slug]);
    });

    it('folds into the oldest row when none serves yet', async () => {
      const researcher = await researcherNamed('jane.smith');
      const chemistry = await crossListedRow('Chemistry', {
        createdAt: new Date('2026-09-10T00:00:00Z'),
      });
      const biology = await crossListedRow('Biology', {
        createdAt: new Date('2026-09-01T00:00:00Z'),
      });
      for (const row of [chemistry, biology]) await piEdge(researcher._id, row._id);

      await rematerialize('Chemistry');
      await rematerialize('Biology');

      expect((await liveRows()).map((row) => row.slug)).toEqual([biology.slug]);
    });

    it('folds nothing when the name belongs to two researchers', async () => {
      const first = await researcherNamed('jane.smith');
      await researcherNamed('jane.smith2');
      const chemistry = await crossListedRow('Chemistry');
      const physics = await crossListedRow('Physics', { studentVisibilityTier: 'student_ready' });
      for (const row of [chemistry, physics]) await piEdge(first._id, row._id);

      await rematerialize('Chemistry');

      expect((await liveRows()).map((row) => row.slug).sort()).toEqual(
        [chemistry.slug, physics.slug].sort(),
      );
      expect(deleteFromIndexMock).not.toHaveBeenCalled();
    });

    it('folds no person row into an organization the person directs', async () => {
      const researcher = await researcherNamed('jane.smith');
      const chemistry = await crossListedRow('Chemistry');
      const center = await crossListedRow('Physics', {
        slug: 'dept-physics-jane-smith-center',
        name: 'Jane Smith Center',
        kind: 'center',
        entityType: 'CENTER',
        studentVisibilityTier: 'student_ready',
      });
      for (const row of [chemistry, center]) await piEdge(researcher._id, row._id);

      await rematerialize('Chemistry');

      expect((await liveRows()).map((row) => row.slug).sort()).toEqual(
        [chemistry.slug, center.slug].sort(),
      );
    });
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
