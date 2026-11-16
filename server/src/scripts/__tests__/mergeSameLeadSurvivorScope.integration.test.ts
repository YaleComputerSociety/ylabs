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
import {
  LEAD_PI_SCHOOL_INHERITANCE_SOURCE,
  materializeEntity,
} from '../../scrapers/entityMaterializer';
import { resetOrgUnitCanonicalizerCache } from '../../scrapers/orgUnitCanonicalization';
import {
  planScopedSurvivorRematerialize,
  rematerializeMergeSurvivors,
} from '../mergeSameLeadSurvivorScope';

const SURVIVOR_KEY = 'merge-scope-survivor';
const ORIGINAL_NAME = 'Merge Scope Survivor Lab';
const RENAMED = 'Merge Scope Survivor Research Lab';

describe('a scoped merge-survivor rematerialize writes nothing outside its list (#6296)', () => {
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

  const seedSurvivorWithPendingChanges = async () => {
    const entity = await ResearchEntity.create({
      slug: SURVIVOR_KEY,
      name: ORIGINAL_NAME,
      kind: 'lab',
      archived: false,
    });
    await Observation.create({
      entityType: 'researchEntity',
      entityKey: SURVIVOR_KEY,
      field: 'name',
      value: RENAMED,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName: 'department-directory',
      sourceUrl: 'https://example.edu/lab/merge-scope',
      confidence: 0.95,
      observedAt: new Date('2026-01-01T00:00:00Z'),
      superseded: false,
    });
    const lead = await Researcher.create({
      displayName: 'Fixture Lead',
      profile: { primaryDepartment: 'Genetics' },
    });
    await RoleAssignment.create({
      personId: lead._id,
      target: { kind: 'RESEARCH_ENTITY', id: entity._id },
      role: 'PI',
      state: 'CURRENT',
      confidence: 0.9,
    });
    return entity._id as mongoose.Types.ObjectId;
  };

  const persisted = async (id: unknown) =>
    (await ResearchEntity.findById(id).lean()) as Record<string, any>;

  it('control: an unscoped pass moves both the name and the departments', async () => {
    const id = await seedSurvivorWithPendingChanges();

    await materializeEntity('researchEntity', { entityKey: SURVIVOR_KEY });

    const after = await persisted(id);
    expect(after.name).toBe(RENAMED);
    expect(after.departments).toEqual(['Genetics']);
  });

  it('writes the scoped field and leaves every field outside the list untouched', async () => {
    const id = await seedSurvivorWithPendingChanges();

    const passes = await rematerializeMergeSurvivors({
      survivorSlugs: [SURVIVOR_KEY],
      onlyFields: ['name'],
      materialize: materializeEntity,
    });

    const after = await persisted(id);
    expect(passes).toBe(2);
    expect(after.name).toBe(RENAMED);
    expect(after.departments ?? []).toEqual([]);
    expect(after.school ?? '').toBe('');
    expect(after.fieldProvenance?.departments).toBeUndefined();
  });

  it('writes nothing at all when the list names no field with pending evidence', async () => {
    const id = await seedSurvivorWithPendingChanges();

    await rematerializeMergeSurvivors({
      survivorSlugs: [SURVIVOR_KEY],
      onlyFields: ['websiteUrl'],
      materialize: materializeEntity,
    });

    const after = await persisted(id);
    expect(after.name).toBe(ORIGINAL_NAME);
    expect(after.departments ?? []).toEqual([]);
  });

  it('plans only scoped paths in a dry run and writes nothing', async () => {
    const id = await seedSurvivorWithPendingChanges();

    const [plan] = await planScopedSurvivorRematerialize({
      survivorSlugs: [SURVIVOR_KEY],
      onlyFields: ['name'],
      materialize: materializeEntity,
      loadCurrent: async (slug) =>
        (await ResearchEntity.findOne({ slug }).lean()) as Record<string, unknown> | null,
    });

    expect(plan.changedFields).toEqual(['lastObservedAt', 'name']);
    const planned = [...plan.plannedSetPaths, ...plan.plannedUnsetPaths];
    expect(planned).toContain('name');
    expect(planned.some((path) => path.split('.').includes('departments'))).toBe(false);
    expect(planned.some((path) => path.split('.').includes('school'))).toBe(false);
    const after = await persisted(id);
    expect(after.name).toBe(ORIGINAL_NAME);
    expect(after.departments ?? []).toEqual([]);
  });
});
