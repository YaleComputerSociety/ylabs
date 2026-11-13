import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return { ...actual, syncEntity: vi.fn().mockResolvedValue(true) };
});

vi.mock('../../services/researchEntityBrowseRankService', async () => {
  const actual = await vi.importActual<
    typeof import('../../services/researchEntityBrowseRankService')
  >('../../services/researchEntityBrowseRankService');
  return { ...actual, recomputeBrowseRankForEntities: vi.fn().mockResolvedValue(undefined) };
});

import { Observation } from '../../models/observation';
import { OrgUnit } from '../../models/orgUnit';
import { ResearchEntity } from '../../models/researchEntity';
import { Researcher } from '../../models/researcher';
import { RoleAssignment } from '../../models/roleAssignment';
import { Source } from '../../models/source';
import { LEAD_PI_SCHOOL_INHERITANCE_SOURCE } from '../../scrapers/entityMaterializer';
import { resetOrgUnitCanonicalizerCache } from '../../scrapers/orgUnitCanonicalization';
import { runLeadDepartmentBackfill } from '../backfillLeadDepartmentInheritance';

describe('runLeadDepartmentBackfill as the lead-department-inheritance sweep stage (#6033)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    resetOrgUnitCanonicalizerCache();
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of [
      'org_units',
      'research_entities',
      'researchers',
      'role_assignments',
      'admin_access_review_projections',
      'observations',
      'sources',
    ]) {
      await db.collection(name).deleteMany({});
    }
    const medicine = await OrgUnit.create({
      slug: 'school-of-medicine',
      name: 'School of Medicine',
      kind: 'SCHOOL',
      status: 'ACTIVE',
    });
    await OrgUnit.create({
      slug: 'genetics',
      name: 'Genetics',
      kind: 'DEPARTMENT',
      parentOrgUnitId: medicine._id,
      status: 'ACTIVE',
    });
    resetOrgUnitCanonicalizerCache();
    await Source.create({
      name: LEAD_PI_SCHOOL_INHERITANCE_SOURCE,
      displayName: 'Lead PI school inheritance',
      defaultWeight: 0.6,
    });
  });

  const seedRowLedBySingleLead = async (
    slug: string,
    shape: Record<string, unknown>,
    primaryDepartment?: string,
  ) => {
    const entity = await ResearchEntity.create({
      slug,
      name: `Synthetic ${slug}`,
      archived: false,
      ...shape,
    });
    const researcher = await Researcher.create({
      displayName: `Synthetic lead of ${slug}`,
      profile: primaryDepartment ? { primaryDepartment } : {},
    });
    await RoleAssignment.create({
      personId: researcher._id,
      target: { kind: 'RESEARCH_ENTITY', id: entity._id },
      role: 'PI',
      state: 'CURRENT',
      confidence: 0.9,
    });
    return { entity, researcher };
  };

  const orgUnitFieldsOf = async (id: unknown) => {
    const row = (await ResearchEntity.findById(id).lean()) as Record<string, any>;
    return { school: row.school ?? '', departments: row.departments ?? [] };
  };

  const corpusSnapshot = async () => ({
    entities: await ResearchEntity.find({}).sort({ _id: 1 }).lean(),
    observations: await Observation.countDocuments({}),
  });

  it('leaves multi-PI kinds school-less while a single-lead lab and a single-lead core facility inherit', async () => {
    const { entity: lab } = await seedRowLedBySingleLead(
      'synthetic-lab',
      { kind: 'lab' },
      'Genetics',
    );
    const excluded = await Promise.all([
      seedRowLedBySingleLead('synthetic-center', { kind: 'center' }, 'Genetics'),
      seedRowLedBySingleLead('synthetic-institute', { kind: 'institute' }, 'Genetics'),
      seedRowLedBySingleLead('synthetic-program', { kind: 'program' }, 'Genetics'),
    ]);
    const cores = await Promise.all([
      seedRowLedBySingleLead('synthetic-core', { kind: 'core_facility' }, 'Genetics'),
      seedRowLedBySingleLead(
        'synthetic-core-by-type',
        { kind: 'lab', entityType: 'CORE_FACILITY' },
        'Genetics',
      ),
    ]);

    const result = await runLeadDepartmentBackfill({ dryRun: false });

    expect(result.mode).toBe('apply');
    expect(result.summary.inherited).toBe(3);
    expect(result.summary.skipped).toEqual({ 'multi-pi-kind': 3 });
    expect(await orgUnitFieldsOf(lab._id)).toEqual({
      school: 'School of Medicine',
      departments: ['Genetics'],
    });
    for (const { entity } of excluded) {
      expect(await orgUnitFieldsOf(entity._id)).toEqual({ school: '', departments: [] });
    }
    for (const { entity } of cores) {
      expect(await orgUnitFieldsOf(entity._id)).toEqual({
        school: 'School of Medicine',
        departments: ['Genetics'],
      });
    }
  });

  it('delivers a department a person-side run gave the lead, then changes nothing on a second pass', async () => {
    const { entity, researcher } = await seedRowLedBySingleLead('synthetic-lab', { kind: 'lab' });
    await seedRowLedBySingleLead('synthetic-center', { kind: 'center' }, 'Genetics');

    const beforeDepartment = await runLeadDepartmentBackfill({ dryRun: false });
    expect(beforeDepartment.summary.inherited).toBe(0);
    expect(beforeDepartment.summary.skipped).toEqual({ 'no-department': 1, 'multi-pi-kind': 1 });

    await Researcher.updateOne(
      { _id: researcher._id },
      { $set: { 'profile.primaryDepartment': 'Genetics' } },
    );

    const first = await runLeadDepartmentBackfill({ dryRun: false });
    expect(first.summary.inherited).toBe(1);
    expect(await orgUnitFieldsOf(entity._id)).toEqual({
      school: 'School of Medicine',
      departments: ['Genetics'],
    });
    const afterFirst = await corpusSnapshot();

    const second = await runLeadDepartmentBackfill({ dryRun: false });

    expect(second.summary.inherited).toBe(0);
    expect(second.summary.scanned).toBe(1);
    expect(second.summary.skipped).toEqual({ 'multi-pi-kind': 1 });
    expect(await corpusSnapshot()).toEqual(afterFirst);
  });
});
