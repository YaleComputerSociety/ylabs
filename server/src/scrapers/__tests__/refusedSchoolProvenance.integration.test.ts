import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
import { LEAD_DEPARTMENT_INHERITANCE_CANDIDATE_FILTER } from '../../scripts/backfillLeadDepartmentInheritance';
import { planFieldValueRefusal } from '../../utils/researchEntityFieldValueRefusals';
import { LEAD_PI_SCHOOL_INHERITANCE_SOURCE, materializeEntity } from '../entityMaterializer';
import { resetOrgUnitCanonicalizerCache } from '../orgUnitCanonicalization';
import { withoutRefusedSchoolsOrTheirProvenance } from '../refusedSchools';

const REFUSED_SCHOOL = 'Synthetic School of Alpha';
const OTHER_SCHOOL = 'Synthetic School of Beta';

const refusalOf = (school: string) =>
  planFieldValueRefusal(undefined, {
    field: 'school',
    value: school,
    rule: 'operator_judgement',
    refusedBy: 'synthetic reviewer',
    note: 'synthetic refusal',
  })['fieldValueRefusals.school'];

const leadInheritanceProvenance = {
  sourceName: LEAD_PI_SCHOOL_INHERITANCE_SOURCE,
  sourceUrl: 'https://example.org/synthetic-lead',
  observationId: new mongoose.Types.ObjectId('000000000000000000000abc'),
};

const resolvedSet = (school: string) => ({
  school,
  schools: [school, OTHER_SCHOOL],
  'fieldProvenance.school': leadInheritanceProvenance,
});

describe('a refusal that moves the school drops the stamp of the value it refused (#6175)', () => {
  it('drops and unsets the winner provenance when the school falls back', () => {
    const set: Record<string, unknown> = resolvedSet(REFUSED_SCHOOL);
    const unset: Record<string, ''> = {};
    withoutRefusedSchoolsOrTheirProvenance(set, unset, { school: refusalOf(REFUSED_SCHOOL) });
    expect(set.school).toBe(OTHER_SCHOOL);
    expect(set).not.toHaveProperty('fieldProvenance.school');
    expect(unset).toEqual({ 'fieldProvenance.school': '' });
  });

  it('drops the stamp when no admissible school is left', () => {
    const set: Record<string, unknown> = {
      school: REFUSED_SCHOOL,
      'fieldProvenance.school': leadInheritanceProvenance,
    };
    const unset: Record<string, ''> = {};
    withoutRefusedSchoolsOrTheirProvenance(set, unset, { school: refusalOf(REFUSED_SCHOOL) });
    expect(set).not.toHaveProperty('school');
    expect(set).not.toHaveProperty('fieldProvenance.school');
    expect(unset).toEqual({ 'fieldProvenance.school': '' });
  });

  it('keeps the stamp of a school no refusal touches', () => {
    const set: Record<string, unknown> = resolvedSet(OTHER_SCHOOL);
    const unset: Record<string, ''> = {};
    withoutRefusedSchoolsOrTheirProvenance(set, unset, { school: refusalOf(REFUSED_SCHOOL) });
    expect(set['fieldProvenance.school']).toEqual(leadInheritanceProvenance);
    expect(unset).toEqual({});
  });
});

describe('backfillLeadDepartmentInheritance after a refusal fallback (#6175)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    for (const name of ['research_entities', 'observations', 'org_units']) {
      await mongoose.connection.db?.collection(name).deleteMany({});
    }
  });

  it('no longer selects a row whose lead-inherited school a refusal replaced', async () => {
    const row = await ResearchEntity.create({
      slug: 'synthetic-fallback-row',
      name: 'Synthetic Fallback Research',
      entityType: 'LAB',
      school: REFUSED_SCHOOL,
      schools: [REFUSED_SCHOOL, OTHER_SCHOOL],
      departments: ['Synthetic Beta Studies'],
      fieldProvenance: { school: leadInheritanceProvenance },
      fieldValueRefusals: { school: refusalOf(REFUSED_SCHOOL) },
    });
    const set: Record<string, unknown> = resolvedSet(REFUSED_SCHOOL);
    const unset: Record<string, ''> = {};
    withoutRefusedSchoolsOrTheirProvenance(set, unset, row.fieldValueRefusals);
    await ResearchEntity.updateOne({ _id: row._id }, { $set: set, $unset: unset });

    const stored = await ResearchEntity.findById(row._id).lean();
    expect(stored?.school).toBe(OTHER_SCHOOL);
    const selected = await ResearchEntity.find({
      _id: row._id,
      ...LEAD_DEPARTMENT_INHERITANCE_CANDIDATE_FILTER,
    }).lean();
    expect(selected).toHaveLength(0);
  });

  it('unsets the stale stamp on a real resolve that falls back to the next school', async () => {
    resetOrgUnitCanonicalizerCache();
    const alpha = await OrgUnit.create({
      slug: 'synthetic-alpha-school',
      name: REFUSED_SCHOOL,
      kind: 'SCHOOL',
      status: 'ACTIVE',
    });
    const beta = await OrgUnit.create({
      slug: 'synthetic-beta-school',
      name: OTHER_SCHOOL,
      kind: 'SCHOOL',
      status: 'ACTIVE',
    });
    await OrgUnit.create({
      slug: 'synthetic-alpha-dept',
      name: 'Synthetic Alpha Studies',
      kind: 'DEPARTMENT',
      status: 'ACTIVE',
      parentOrgUnitId: alpha._id,
    });
    await OrgUnit.create({
      slug: 'synthetic-beta-dept',
      name: 'Synthetic Beta Studies',
      kind: 'DEPARTMENT',
      status: 'ACTIVE',
      parentOrgUnitId: beta._id,
    });
    const entityKey = 'synthetic-resolve-fallback-row';
    const observation = async (field: string, value: unknown) =>
      Observation.create({
        entityType: 'researchEntity',
        entityKey,
        field,
        value,
        sourceId: new mongoose.Types.ObjectId(),
        sourceName: 'synthetic-roster-lane',
        sourceUrl: 'https://example.edu/synthetic-row/',
        confidence: 0.9,
        observedAt: new Date('2026-01-01T00:00:00Z'),
        superseded: false,
      });
    await observation('name', 'Synthetic Resolve Fallback Research');
    await observation('departments', ['Synthetic Alpha Studies', 'Synthetic Beta Studies']);
    await ResearchEntity.create({
      slug: entityKey,
      name: 'Synthetic Resolve Fallback Research',
      entityType: 'LAB',
      studentVisibilityTier: 'operator_review',
      fieldProvenance: { school: leadInheritanceProvenance },
      fieldValueRefusals: { school: refusalOf(REFUSED_SCHOOL) },
    });

    await materializeEntity('researchEntity', { entityKey });

    const stored = await ResearchEntity.findOne({ slug: entityKey }).lean();
    expect(stored?.school).toBe(OTHER_SCHOOL);
    expect(stored?.fieldProvenance?.school).toBeUndefined();
    const selected = await ResearchEntity.find({
      _id: stored?._id,
      ...LEAD_DEPARTMENT_INHERITANCE_CANDIDATE_FILTER,
    }).lean();
    expect(selected).toHaveLength(0);
  });
});
