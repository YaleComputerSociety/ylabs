import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return { ...actual, syncEntity: vi.fn().mockResolvedValue(undefined) };
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
import { LEAD_PI_SCHOOL_INHERITANCE_SOURCE, inheritSchoolFromLeadPi } from '../entityMaterializer';
import { resetOrgUnitCanonicalizerCache } from '../orgUnitCanonicalization';
import { planFieldValueRefusal } from '../../utils/researchEntityFieldValueRefusals';

describe('inheritSchoolFromLeadPi (#2158)', () => {
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

  afterEach(() => {
    vi.clearAllMocks();
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
    const arts = await OrgUnit.create({
      slug: 'faculty-of-arts-and-sciences',
      name: 'Faculty of Arts and Sciences',
      kind: 'DIVISION',
      status: 'ACTIVE',
    });
    await OrgUnit.create({
      slug: 'genetics',
      name: 'Genetics',
      kind: 'DEPARTMENT',
      parentOrgUnitId: medicine._id,
      status: 'ACTIVE',
    });
    await OrgUnit.create({
      slug: 'chemistry',
      name: 'Chemistry',
      kind: 'DEPARTMENT',
      parentOrgUnitId: arts._id,
      status: 'ACTIVE',
    });
    await OrgUnit.create({
      slug: 'unparented-studies',
      name: 'Unparented Studies',
      kind: 'DEPARTMENT',
      status: 'ACTIVE',
    });
    resetOrgUnitCanonicalizerCache();
    await Source.create({
      name: LEAD_PI_SCHOOL_INHERITANCE_SOURCE,
      displayName: 'Lead PI school inheritance',
      defaultWeight: 0.6,
    });
  });

  const seedShell = async (overrides: Record<string, unknown> = {}) =>
    ResearchEntity.create({
      slug: 'grant-shell-avery-lin',
      name: 'Avery Lin Research',
      kind: 'lab',
      archived: false,
      ...overrides,
    });

  const seedLead = async (
    researchEntityId: mongoose.Types.ObjectId,
    primaryDepartment: string,
    displayName = 'Avery Lin',
  ) => {
    const researcher = await Researcher.create({
      displayName,
      profile: { primaryDepartment },
    });
    await RoleAssignment.create({
      personId: researcher._id,
      target: { kind: 'RESEARCH_ENTITY', id: researchEntityId },
      role: 'PI',
      state: 'CURRENT',
      confidence: 0.9,
    });
    return researcher;
  };

  const persisted = async (id: unknown) =>
    (await ResearchEntity.findById(id).lean()) as Record<string, any>;

  it("inherits the lead's canonical department and parent school onto a school-less shell", async () => {
    const entity = await seedShell();
    await seedLead(entity._id, 'Dept. of Genetics');

    const result = await inheritSchoolFromLeadPi(String(entity._id));

    expect(result).toMatchObject({ inherited: true, school: 'School of Medicine' });
    const after = await persisted(entity._id);
    expect(after.school).toBe('School of Medicine');
    expect(after.schools).toEqual(['School of Medicine']);
    expect(after.departments).toEqual(['Genetics']);
    expect(after.confidenceByField?.school).toBeGreaterThan(0);
    expect(after.fieldProvenance?.school?.sourceName).toBe(LEAD_PI_SCHOOL_INHERITANCE_SOURCE);
  });

  it('cites the observation it asserted in every provenance entry it writes (#3769)', async () => {
    const entity = await seedShell();
    await seedLead(entity._id, 'Dept. of Genetics');

    await inheritSchoolFromLeadPi(String(entity._id));

    const after = await persisted(entity._id);
    for (const field of ['school', 'departments']) {
      const observation = await Observation.findById(
        after.fieldProvenance?.[field]?.observationId,
      ).lean<{
        field?: string;
        sourceName?: string;
        superseded?: boolean;
      }>();
      expect(observation).toMatchObject({
        field,
        sourceName: LEAD_PI_SCHOOL_INHERITANCE_SOURCE,
        superseded: false,
      });
      expect(String(after.fieldProvenance?.[field]?.sourceId)).toBe(
        String((await Source.findOne({ name: LEAD_PI_SCHOOL_INHERITANCE_SOURCE }))?._id),
      );
    }
  });

  it('writes nothing when it cannot record the evidence, rather than an unbacked value (#3769)', async () => {
    await Source.deleteMany({});
    const entity = await seedShell();
    await seedLead(entity._id, 'Dept. of Genetics');

    const result = await inheritSchoolFromLeadPi(String(entity._id));

    expect(result).toEqual({ inherited: false, observationSkipped: 'source-not-registered' });
    const after = await persisted(entity._id);
    expect(after.school ?? '').toBe('');
    expect(after.departments ?? []).toEqual([]);
    expect(after.fieldProvenance ?? {}).toEqual({});
  });

  it("fails closed when the lead's department matches no OrgUnit, never writing a raw HR string", async () => {
    const entity = await seedShell();
    await seedLead(entity._id, 'ENVACC Internal Medicine Section 4');

    const result = await inheritSchoolFromLeadPi(String(entity._id));

    expect(result).toEqual({ inherited: false, skipped: 'no-school-derivable' });
    const after = await persisted(entity._id);
    expect(after.school ?? '').toBe('');
    expect(after.departments ?? []).toEqual([]);
  });

  it("fails closed when the lead's department has no parent school", async () => {
    const entity = await seedShell();
    await seedLead(entity._id, 'Unparented Studies');

    const result = await inheritSchoolFromLeadPi(String(entity._id));

    expect(result).toEqual({ inherited: false, skipped: 'no-school-derivable' });
    const after = await persisted(entity._id);
    expect(after.school ?? '').toBe('');
    expect(after.departments ?? []).toEqual([]);
  });

  it('never manufactures a department facet for an entity that already has its own departments', async () => {
    const entity = await seedShell({ departments: ['Chemistry'] });
    await seedLead(entity._id, 'Genetics');

    const result = await inheritSchoolFromLeadPi(String(entity._id));

    expect(result.inherited).toBe(true);
    const after = await persisted(entity._id);
    expect(after.departments).toEqual(['Chemistry']);
    expect(after.school).toBe('School of Medicine');
    expect(after.schools).toEqual(
      expect.arrayContaining(['School of Medicine', 'Faculty of Arts and Sciences']),
    );
  });

  it('inherits the department but never rewrites a school the entity already carries', async () => {
    const entity = await seedShell({ schools: ['School of the Environment'] });
    await seedLead(entity._id, 'Genetics');

    const result = await inheritSchoolFromLeadPi(String(entity._id));

    // The invariant is that no school is inherited, so it is asserted on `school`
    // directly rather than by whole-object equality: the result also reports whether the
    // inherited value was asserted as an observation, and a deep-equal here would fail on
    // that key while saying nothing about the school (#3362).
    expect(result).toMatchObject({ inherited: true, departments: ['Genetics'] });
    expect(result.school).toBeUndefined();
    const after = await persisted(entity._id);
    expect(after.departments).toEqual(['Genetics']);
    expect(after.schools).toEqual(['School of the Environment']);
    expect(after.school ?? '').toBe('');
  });

  it('skips an entity that already carries both a school and a department', async () => {
    const entity = await seedShell({
      schools: ['School of the Environment'],
      departments: ['Chemistry'],
    });
    await seedLead(entity._id, 'Genetics');

    const result = await inheritSchoolFromLeadPi(String(entity._id));

    expect(result).toEqual({ inherited: false, skipped: 'has-school-and-department' });
    const after = await persisted(entity._id);
    expect(after.departments).toEqual(['Chemistry']);
    expect(after.schools).toEqual(['School of the Environment']);
  });

  it('fails closed when more than one current lead is assigned', async () => {
    const entity = await seedShell();
    await seedLead(entity._id, 'Genetics', 'Avery Lin');
    await seedLead(entity._id, 'Chemistry', 'Rowan Diaz');

    const result = await inheritSchoolFromLeadPi(String(entity._id));

    expect(result).toEqual({ inherited: false, skipped: 'no-single-lead' });
    const after = await persisted(entity._id);
    expect(after.school ?? '').toBe('');
  });

  it('honors a manual lock on school', async () => {
    const entity = await seedShell({ manuallyLockedFields: ['school'] });
    await seedLead(entity._id, 'Genetics');

    const result = await inheritSchoolFromLeadPi(String(entity._id), {
      manuallyLockedFields: ['school'],
    });

    expect(result).toEqual({ inherited: false, skipped: 'locked' });
    const after = await persisted(entity._id);
    expect(after.school ?? '').toBe('');
  });

  it('does not inherit a school the row refuses, so a refusal survives the next materialize (#6155)', async () => {
    const refusal = planFieldValueRefusal(undefined, {
      field: 'school',
      value: 'School of Medicine',
      rule: 'operator_judgement',
      refusedBy: 'synthetic reviewer',
      note: 'synthetic refusal',
    });
    const entity = await seedShell({
      fieldValueRefusals: { school: refusal['fieldValueRefusals.school'] },
    });
    await seedLead(entity._id, 'Dept. of Genetics');

    const result = await inheritSchoolFromLeadPi(String(entity._id));

    expect(result).toMatchObject({ inherited: false, skipped: 'no-school-derivable' });
    const after = await persisted(entity._id);
    expect(after.school ?? '').toBe('');
    expect(after.schools ?? []).not.toContain('School of Medicine');
  });

  describe("adds the lead's first-hand section beside its parent (#6381)", () => {
    const LEAD_PAGE = 'https://fixture-medicine.example.edu/profile/fixture-lead/';

    beforeEach(async () => {
      await Observation.syncIndexes();
      const medicine = await OrgUnit.findOne({ slug: 'school-of-medicine' }).lean();
      const internalMedicine = await OrgUnit.create({
        slug: 'internal-medicine',
        name: 'Internal Medicine',
        kind: 'DEPARTMENT',
        parentOrgUnitId: medicine?._id,
        status: 'ACTIVE',
      });
      await OrgUnit.create({
        slug: 'cardiovascular-medicine',
        name: 'Cardiovascular Medicine',
        kind: 'SECTION',
        parentOrgUnitId: internalMedicine._id,
        status: 'ACTIVE',
      });
      await OrgUnit.create({
        slug: 'surgery',
        name: 'Surgery',
        kind: 'DEPARTMENT',
        parentOrgUnitId: medicine?._id,
        status: 'ACTIVE',
      });
      resetOrgUnitCanonicalizerCache();
    });

    const leadReading = (
      researcherId: mongoose.Types.ObjectId,
      field: string,
      value: unknown,
      sourceName: string,
      extra: Record<string, unknown> = {},
    ) => ({
      entityType: 'user',
      entityId: researcherId,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName,
      sourceUrl: LEAD_PAGE,
      confidence: 0.9,
      observedAt: new Date('2026-10-01T00:00:00Z'),
      superseded: false,
      field,
      value,
      ...extra,
    });

    const seedRowWithParent = (departments: string[]) =>
      seedShell({
        school: 'School of Medicine',
        schools: ['School of Medicine'],
        departments,
        fieldProvenance: {
          departments: {
            sourceName: 'ysm-faculty-directory',
            observationId: new mongoose.Types.ObjectId(),
            confidence: 0.9,
          },
        },
      });

    it('adds the section a first-hand profile read states beside the parent the row carries', async () => {
      const entity = await seedRowWithParent(['Internal Medicine']);
      const lead = await seedLead(entity._id, 'Cardiovascular Medicine');
      await Observation.insertMany([
        leadReading(
          lead._id,
          'primaryDepartment',
          'Cardiovascular Medicine',
          'ysm-faculty-directory',
        ),
      ]);

      const result = await inheritSchoolFromLeadPi(String(entity._id));

      expect(result).toMatchObject({
        inherited: true,
        addedSection: 'Cardiovascular Medicine',
        departments: ['Internal Medicine', 'Cardiovascular Medicine'],
      });
      expect((await persisted(entity._id)).departments).toEqual([
        'Internal Medicine',
        'Cardiovascular Medicine',
      ]);
    });

    it('adds the section when only a first-hand title names it', async () => {
      const entity = await seedRowWithParent(['Internal Medicine']);
      const lead = await seedLead(entity._id, 'Cardiovascular Medicine');
      await Observation.insertMany([
        leadReading(
          lead._id,
          'title',
          'Associate Professor of Medicine (Cardiovascular Medicine)',
          'ysm-faculty-directory',
        ),
      ]);

      const result = await inheritSchoolFromLeadPi(String(entity._id));

      expect(result.addedSection).toBe('Cardiovascular Medicine');
    });

    it('does not add the section to a row that does not carry its parent', async () => {
      const entity = await seedRowWithParent(['Surgery']);
      const lead = await seedLead(entity._id, 'Cardiovascular Medicine');
      await Observation.insertMany([
        leadReading(
          lead._id,
          'primaryDepartment',
          'Cardiovascular Medicine',
          'ysm-faculty-directory',
        ),
      ]);

      const result = await inheritSchoolFromLeadPi(String(entity._id));

      expect(result).toMatchObject({ inherited: false, skipped: 'has-school-and-department' });
      expect((await persisted(entity._id)).departments).toEqual(['Surgery']);
    });

    it('does not add a section that only department roster reads state', async () => {
      const entity = await seedRowWithParent(['Internal Medicine']);
      const lead = await seedLead(entity._id, 'Cardiovascular Medicine');
      await Observation.insertMany([
        leadReading(
          lead._id,
          'primaryDepartment',
          'Cardiovascular Medicine',
          'dept-faculty-roster',
        ),
        leadReading(
          lead._id,
          'title',
          'Professor of Medicine (Cardiovascular Medicine)',
          'dept-faculty-roster',
          { extraction: { source: 'profileTitleBlock' } },
        ),
      ]);

      const result = await inheritSchoolFromLeadPi(String(entity._id));

      expect(result).toMatchObject({ inherited: false, skipped: 'has-school-and-department' });
      expect((await persisted(entity._id)).departments).toEqual(['Internal Medicine']);
    });

    it('keeps every department, the school and the provenance the row already had', async () => {
      const entity = await seedRowWithParent(['Internal Medicine', 'Genetics']);
      const lead = await seedLead(entity._id, 'Cardiovascular Medicine');
      await Observation.insertMany([
        leadReading(
          lead._id,
          'primaryDepartment',
          'Cardiovascular Medicine',
          'ysm-faculty-directory',
        ),
      ]);
      const before = await persisted(entity._id);

      await inheritSchoolFromLeadPi(String(entity._id));

      const after = await persisted(entity._id);
      expect(after.departments).toEqual([
        'Internal Medicine',
        'Genetics',
        'Cardiovascular Medicine',
      ]);
      expect(after.school).toBe(before.school);
      expect(after.schools).toEqual(before.schools);
      expect(after.fieldProvenance.departments).toEqual(before.fieldProvenance.departments);
    });

    it('writes nothing on a second run', async () => {
      const entity = await seedRowWithParent(['Internal Medicine']);
      const lead = await seedLead(entity._id, 'Cardiovascular Medicine');
      await Observation.insertMany([
        leadReading(
          lead._id,
          'primaryDepartment',
          'Cardiovascular Medicine',
          'ysm-faculty-directory',
        ),
      ]);
      await inheritSchoolFromLeadPi(String(entity._id));
      const afterFirst = await persisted(entity._id);

      const second = await inheritSchoolFromLeadPi(String(entity._id));

      expect(second).toMatchObject({ inherited: false, skipped: 'has-school-and-department' });
      expect(await persisted(entity._id)).toEqual(afterFirst);
    });
  });
});
