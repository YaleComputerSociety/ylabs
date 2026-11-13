import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return { ...actual, syncEntity: vi.fn().mockResolvedValue(undefined) };
});

import { Observation } from '../../models/observation';
import { OrgUnit } from '../../models/orgUnit';
import { ResearchEntity } from '../../models/researchEntity';
import { planFieldValueRefusal } from '../../utils/researchEntityFieldValueRefusals';
import { materializeEntity } from '../entityMaterializer';
import { resetOrgUnitCanonicalizerCache } from '../orgUnitCanonicalization';
import { OWN_PROFILE_HOST_SCHOOL_SOURCE_NAME } from '../ownProfileSchoolPrecedence';

const KEY = 'fixture-precedence-lab';
const OWN_PROFILE = 'https://ysph.yale.edu/profile/hollis-quintrell/';
const ROSTER = 'https://medicine.yale.edu/fixture-department/people/';
const NAMESAKE_PROFILE = 'https://ysph.yale.edu/profile/marta-quintrell/';
const OWNER_PROFILE = 'https://medicine.yale.edu/profile/hollis-quintrell/';

describe('the own profile school outranks a cross-school roster at resolve (#6157)', () => {
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
    await Observation.collection.deleteMany({});
    await ResearchEntity.collection.deleteMany({});
    await OrgUnit.collection.deleteMany({});
    const schoolIds: Record<string, unknown> = {};
    for (const [slug, name] of [
      ['school-of-medicine', 'School of Medicine'],
      ['school-of-public-health', 'School of Public Health'],
    ] as const) {
      schoolIds[name] = (
        await OrgUnit.create({ slug, name, kind: 'SCHOOL', status: 'ACTIVE' })
      )._id;
    }
    await OrgUnit.create({
      slug: 'fixture-medicine-department',
      name: 'Fixture Medicine Department',
      kind: 'DEPARTMENT',
      status: 'ACTIVE',
      parentOrgUnitId: schoolIds['School of Medicine'],
    });
    resetOrgUnitCanonicalizerCache();
    await ResearchEntity.create({
      slug: KEY,
      name: 'Fixture Precedence Lab',
      kind: 'lab',
      entityType: 'LAB',
      school: 'School of Medicine',
      schools: ['School of Medicine'],
      archived: false,
    });
  });

  const observe = (field: string, value: unknown, sourceUrl: string, sourceName: string) =>
    Observation.create({
      entityType: 'researchEntity',
      entityKey: KEY,
      field,
      value,
      sourceId: new mongoose.Types.ObjectId(),
      sourceName,
      sourceUrl,
      confidence: 0.9,
      observedAt: new Date('2026-10-01T00:00:00Z'),
      superseded: false,
    });

  const seedRosterAndOwnProfile = async () => {
    await observe(
      'name',
      'Fixture Precedence Lab',
      'https://fixture-lab.example.edu/',
      'fixture-lab-site',
    );
    await observe('school', 'School of Medicine', ROSTER, 'dept-faculty-roster');
    await observe('inferredPiUserKey', 'netid:fixture-001', OWN_PROFILE, 'ysph-faculty-directory');
  };

  const plan = async () => {
    const result = await materializeEntity('researchEntity', { entityKey: KEY }, { dryRun: true });
    return (result.plannedSet ?? {}) as Record<string, any>;
  };

  it('resolves the own profile school, credits the derivation, and carries schools with it', async () => {
    await seedRosterAndOwnProfile();
    const planned = await plan();

    expect(planned.school).toBe('School of Public Health');
    expect(planned.schools).toEqual(['School of Public Health', 'School of Medicine']);
    expect(planned['fieldProvenance.school']).toMatchObject({
      sourceName: OWN_PROFILE_HOST_SCHOOL_SOURCE_NAME,
      sourceUrl: OWN_PROFILE,
    });
  });

  it('steps aside, keeping the roster school, when the row refuses the own profile school', async () => {
    await seedRosterAndOwnProfile();
    await ResearchEntity.updateOne(
      { slug: KEY },
      {
        $unset: { school: '', schools: '' },
        $set: planFieldValueRefusal(undefined, {
          field: 'school',
          value: 'School of Public Health',
          rule: 'operator_judgement',
          refusedBy: 'fixture',
          note: 'fixture refusal',
        }),
      },
    );
    const planned = await plan();

    expect(planned.school).toBe('School of Medicine');
    expect(planned.schools ?? []).not.toContain('School of Public Health');
    expect(planned['fieldProvenance.school']?.sourceName).not.toBe(
      OWN_PROFILE_HOST_SCHOOL_SOURCE_NAME,
    );
  });

  it('keeps the own profile school primary but never retains a refused roster school', async () => {
    await seedRosterAndOwnProfile();
    await ResearchEntity.updateOne(
      { slug: KEY },
      {
        $set: planFieldValueRefusal(undefined, {
          field: 'school',
          value: 'School of Medicine',
          rule: 'operator_judgement',
          refusedBy: 'fixture',
          note: 'fixture refusal',
        }),
      },
    );
    const planned = await plan();

    expect(planned.school).toBe('School of Public Health');
    expect(planned.schools).toEqual(['School of Public Health']);
  });

  it('keeps a refused school out of schools when both the roster and a department name it', async () => {
    await seedRosterAndOwnProfile();
    await ResearchEntity.updateOne(
      { slug: KEY },
      {
        $set: {
          departments: ['Fixture Medicine Department'],
          ...planFieldValueRefusal(undefined, {
            field: 'school',
            value: 'School of Medicine',
            rule: 'operator_judgement',
            refusedBy: 'fixture',
            note: 'fixture refusal',
          }),
        },
      },
    );
    const planned = await plan();

    expect(planned.school).toBe('School of Public Health');
    expect(planned.schools ?? []).not.toContain('School of Medicine');
  });

  it('keeps the roster school when the own profile names it too', async () => {
    await seedRosterAndOwnProfile();
    await observe('school', 'School of Medicine', OWN_PROFILE, 'ysph-faculty-directory');
    const planned = await plan();

    expect(planned.school ?? 'School of Medicine').toBe('School of Medicine');
    expect(planned['fieldProvenance.school']?.sourceName).not.toBe(
      OWN_PROFILE_HOST_SCHOOL_SOURCE_NAME,
    );
  });

  it('takes no school from a namesake whose profile the row does not cite as its own', async () => {
    await ResearchEntity.updateOne(
      { slug: KEY },
      { $set: { name: 'Hollis Quintrell Lab', sourceUrls: [OWNER_PROFILE] } },
    );
    await observe('school', 'School of Medicine', ROSTER, 'dept-faculty-roster');
    await observe(
      'inferredPiUserKey',
      'netid:fixture-002',
      NAMESAKE_PROFILE,
      'ysph-faculty-directory',
    );
    const planned = await plan();

    expect(planned.school ?? 'School of Medicine').toBe('School of Medicine');
    expect(planned['fieldProvenance.school']?.sourceName).not.toBe(
      OWN_PROFILE_HOST_SCHOOL_SOURCE_NAME,
    );
  });

  it('adds no school from a host-derived backfill reading on a row whose roster agrees with its profile', async () => {
    await ResearchEntity.updateOne(
      { slug: KEY },
      { $set: { school: 'School of Public Health', schools: ['School of Public Health'] } },
    );
    await observe('school', 'School of Public Health', OWN_PROFILE, 'dept-faculty-roster');
    await observe(
      'school',
      'School of Medicine',
      'https://medicine.yale.edu/fixture-center/',
      'school-profile-host-backfill',
    );
    await observe('inferredPiUserKey', 'netid:fixture-001', OWN_PROFILE, 'ysph-faculty-directory');
    const planned = await plan();

    expect(planned.schools ?? ['School of Public Health']).toEqual(['School of Public Health']);
    expect(planned['fieldProvenance.school']?.sourceName).not.toBe(
      OWN_PROFILE_HOST_SCHOOL_SOURCE_NAME,
    );
  });
});
