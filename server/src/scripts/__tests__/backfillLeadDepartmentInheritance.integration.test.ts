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
import {
  LEAD_PI_SCHOOL_INHERITANCE_SOURCE,
  inheritSchoolFromLeadPi,
} from '../../scrapers/entityMaterializer';
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
    const arts = await OrgUnit.create({
      slug: 'faculty-of-arts-and-sciences',
      name: 'Faculty of Arts and Sciences',
      kind: 'DIVISION',
      status: 'ACTIVE',
    });
    await OrgUnit.create({
      slug: 'chemistry',
      name: 'Chemistry',
      kind: 'DEPARTMENT',
      parentOrgUnitId: arts._id,
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
    expect(second.summary.scanned).toBe(2);
    expect(second.summary.skipped).toEqual({ 'multi-pi-kind': 1, 'inherited-matches-lead': 1 });
    expect(await corpusSnapshot()).toEqual(afterFirst);
  });

  describe('when the lead later moves department (#6053)', () => {
    const moveLead = async (researcherId: unknown, primaryDepartment: string) => {
      await Researcher.updateOne(
        { _id: researcherId },
        { $set: { 'profile.primaryDepartment': primaryDepartment } },
      );
    };

    const liveInheritanceObservations = async (field: string) =>
      Observation.find({
        sourceName: LEAD_PI_SCHOOL_INHERITANCE_SOURCE,
        field,
        superseded: false,
      }).lean<Array<{ _id: unknown; value?: unknown }>>();

    const seedFieldFrom = async (
      entity: { _id: mongoose.Types.ObjectId; slug?: string | null },
      sourceName: string,
      field: 'school' | 'departments',
      value: string | string[],
    ) => {
      const source =
        (await Source.findOne({ name: sourceName })) ??
        (await Source.create({ name: sourceName, displayName: sourceName, defaultWeight: 0.9 }));
      const observation = await Observation.create({
        entityType: 'researchEntity',
        entityId: entity._id,
        entityKey: entity.slug ?? undefined,
        field,
        value,
        sourceId: source._id,
        sourceName,
        observedAt: new Date('2026-01-01T00:00:00Z'),
        confidence: 0.9,
        superseded: false,
      });
      await ResearchEntity.updateOne(
        { _id: entity._id },
        {
          $set: {
            [field]: value,
            ...(field === 'school' ? { schools: [value] } : {}),
            [`fieldProvenance.${field}`]: {
              sourceId: source._id,
              sourceName,
              sourceUrl: '',
              observationId: observation._id,
              observedAt: observation.observedAt,
              confidence: 0.9,
            },
          },
        },
      );
    };

    it("re-derives an inherited school and department from the lead's new department, then plans nothing", async () => {
      const { entity, researcher } = await seedRowLedBySingleLead(
        'synthetic-lab',
        { kind: 'lab' },
        'Genetics',
      );
      await runLeadDepartmentBackfill({ dryRun: false });
      await moveLead(researcher._id, 'Chemistry');

      const planned = await runLeadDepartmentBackfill({ dryRun: true });
      expect(planned.summary).toMatchObject({ inherited: 1, refreshed: 1 });
      expect(await orgUnitFieldsOf(entity._id)).toEqual({
        school: 'School of Medicine',
        departments: ['Genetics'],
      });

      const applied = await runLeadDepartmentBackfill({ dryRun: false });

      expect(applied.summary).toMatchObject({ inherited: 1, refreshed: 1 });
      expect(await orgUnitFieldsOf(entity._id)).toEqual({
        school: 'Faculty of Arts and Sciences',
        departments: ['Chemistry'],
      });
      const row = (await ResearchEntity.findById(entity._id).lean()) as Record<string, any>;
      expect(row.manuallyLockedFields ?? []).toEqual([]);
      for (const [field, value] of [
        ['school', 'Faculty of Arts and Sciences'],
        ['departments', ['Chemistry']],
      ] as const) {
        const live = await liveInheritanceObservations(field);
        expect(live.map((observation) => observation.value)).toEqual([value]);
        expect(String(row.fieldProvenance?.[field]?.observationId)).toBe(String(live[0]._id));
        expect(row.fieldProvenance?.[field]?.sourceName).toBe(LEAD_PI_SCHOOL_INHERITANCE_SOURCE);
      }
      const afterRefresh = await corpusSnapshot();

      const second = await runLeadDepartmentBackfill({ dryRun: false });

      expect(second.summary).toMatchObject({ inherited: 0, refreshed: 0 });
      expect(second.summary.skipped).toEqual({ 'inherited-matches-lead': 1 });
      expect(await corpusSnapshot()).toEqual(afterRefresh);
    });

    it('re-derives only the inherited department when another source stated the school', async () => {
      const { entity, researcher } = await seedRowLedBySingleLead(
        'synthetic-lab',
        { kind: 'lab' },
        'Genetics',
      );
      await seedFieldFrom(entity, 'dept-faculty-roster', 'school', 'School of Medicine');
      await seedFieldFrom(entity, LEAD_PI_SCHOOL_INHERITANCE_SOURCE, 'departments', ['Genetics']);
      await moveLead(researcher._id, 'Chemistry');

      const applied = await runLeadDepartmentBackfill({ dryRun: false });

      expect(applied.summary).toMatchObject({ inherited: 1, refreshed: 1 });
      const row = (await ResearchEntity.findById(entity._id).lean()) as Record<string, any>;
      expect(row.departments).toEqual(['Chemistry']);
      expect(row.school).toBe('School of Medicine');
      expect(row.schools).toEqual(['School of Medicine', 'Faculty of Arts and Sciences']);
      expect(row.orgAffiliationLabels ?? []).not.toContain('Genetics');
      expect(row.fieldProvenance?.school?.sourceName).toBe('dept-faculty-roster');
      expect(row.fieldProvenance?.departments?.sourceName).toBe(LEAD_PI_SCHOOL_INHERITANCE_SOURCE);
    });

    it('keeps a school and department another source stated when the lead moves', async () => {
      const { entity, researcher } = await seedRowLedBySingleLead(
        'synthetic-lab',
        { kind: 'lab' },
        'Genetics',
      );
      await seedFieldFrom(entity, 'dept-faculty-roster', 'school', 'School of Medicine');
      await seedFieldFrom(entity, 'dept-faculty-roster', 'departments', ['Genetics']);
      await moveLead(researcher._id, 'Chemistry');
      const before = await corpusSnapshot();

      const applied = await runLeadDepartmentBackfill({ dryRun: false });

      expect(applied.summary).toMatchObject({ scanned: 0, inherited: 0, refreshed: 0 });
      expect(await orgUnitFieldsOf(entity._id)).toEqual({
        school: 'School of Medicine',
        departments: ['Genetics'],
      });
      expect(await corpusSnapshot()).toEqual(before);
    });

    it('refuses at the engine to touch a school and department another source stated', async () => {
      const { entity, researcher } = await seedRowLedBySingleLead(
        'synthetic-lab',
        { kind: 'lab' },
        'Genetics',
      );
      await seedFieldFrom(entity, 'dept-faculty-roster', 'school', 'School of Medicine');
      await seedFieldFrom(entity, 'dept-faculty-roster', 'departments', ['Genetics']);
      await moveLead(researcher._id, 'Chemistry');
      const before = await corpusSnapshot();

      const result = await inheritSchoolFromLeadPi(String(entity._id));

      expect(result).toEqual({ inherited: false, skipped: 'has-school-and-department' });
      expect(await corpusSnapshot()).toEqual(before);
    });

    it('re-derives only the inherited school when another source stated the department', async () => {
      const { entity, researcher } = await seedRowLedBySingleLead(
        'synthetic-lab',
        { kind: 'lab' },
        'Genetics',
      );
      await seedFieldFrom(
        entity,
        LEAD_PI_SCHOOL_INHERITANCE_SOURCE,
        'school',
        'School of Medicine',
      );
      await seedFieldFrom(entity, 'dept-faculty-roster', 'departments', ['Genetics']);
      const seeded = (await ResearchEntity.findById(entity._id).lean()) as Record<string, any>;
      await moveLead(researcher._id, 'Chemistry');

      const result = await inheritSchoolFromLeadPi(String(entity._id));

      expect(result).toMatchObject({
        inherited: true,
        school: 'Faculty of Arts and Sciences',
        refreshed: ['school'],
      });
      const row = (await ResearchEntity.findById(entity._id).lean()) as Record<string, any>;
      expect(row.school).toBe('Faculty of Arts and Sciences');
      expect(row.departments).toEqual(['Genetics']);
      expect(row.fieldProvenance?.departments).toEqual(seeded.fieldProvenance?.departments);
      expect(row.fieldProvenance?.school?.sourceName).toBe(LEAD_PI_SCHOOL_INHERITANCE_SOURCE);
      expect(row.manuallyLockedFields ?? []).toEqual([]);
      const liveDepartments = await Observation.find({
        field: 'departments',
        superseded: false,
      }).lean<Array<{ sourceName?: string }>>();
      expect(liveDepartments.map((observation) => observation.sourceName)).toEqual([
        'dept-faculty-roster',
      ]);
    });

    it('still skips a multi-PI kind whose stored values cite the lane', async () => {
      const { entity, researcher } = await seedRowLedBySingleLead(
        'synthetic-center',
        { kind: 'center' },
        'Genetics',
      );
      await seedFieldFrom(
        entity,
        LEAD_PI_SCHOOL_INHERITANCE_SOURCE,
        'school',
        'School of Medicine',
      );
      await seedFieldFrom(entity, LEAD_PI_SCHOOL_INHERITANCE_SOURCE, 'departments', ['Genetics']);
      await moveLead(researcher._id, 'Chemistry');
      const before = await corpusSnapshot();

      const applied = await runLeadDepartmentBackfill({ dryRun: false });

      expect(applied.summary).toMatchObject({ scanned: 1, inherited: 0, refreshed: 0 });
      expect(applied.summary.skipped).toEqual({ 'multi-pi-kind': 1 });
      expect(await corpusSnapshot()).toEqual(before);
    });

    it('leaves an inherited value as stored when the lead no longer has a catalog department', async () => {
      const { researcher } = await seedRowLedBySingleLead(
        'synthetic-lab',
        { kind: 'lab' },
        'Genetics',
      );
      await runLeadDepartmentBackfill({ dryRun: false });
      await moveLead(researcher._id, 'An Uncatalogued Appointment');
      const before = await corpusSnapshot();

      const applied = await runLeadDepartmentBackfill({ dryRun: false });

      expect(applied.summary).toMatchObject({ inherited: 0, refreshed: 0 });
      expect(applied.summary.skipped).toEqual({ 'no-department': 1 });
      expect(await corpusSnapshot()).toEqual(before);
    });
  });
});
