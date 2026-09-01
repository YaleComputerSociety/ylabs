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

import { OrgUnit } from '../../models/orgUnit';
import { ResearchEntity } from '../../models/researchEntity';
import { Researcher } from '../../models/researcher';
import { RoleAssignment } from '../../models/roleAssignment';
import { LEAD_PI_SCHOOL_INHERITANCE_SOURCE, inheritSchoolFromLeadPi } from '../entityMaterializer';
import { resetOrgUnitCanonicalizerCache } from '../orgUnitCanonicalization';

describe('inheritSchoolFromLeadPi (#2158)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    resetOrgUnitCanonicalizerCache();
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
      'org_units',
      'research_entities',
      'researchers',
      'role_assignments',
      'admin_access_review_projections',
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

  it('leaves an entity that already carries a schools[] facet untouched', async () => {
    const entity = await seedShell({ schools: ['School of the Environment'] });
    await seedLead(entity._id, 'Genetics');

    const result = await inheritSchoolFromLeadPi(String(entity._id));

    expect(result).toEqual({ inherited: false, skipped: 'has-school' });
    const after = await persisted(entity._id);
    expect(after.schools).toEqual(['School of the Environment']);
    expect(after.school ?? '').toBe('');
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
});
