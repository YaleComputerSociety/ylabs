import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ResearchEntity } from '../../models/researchEntity';
import { OrgUnit } from '../../models/orgUnit';
import { resetOrgUnitCanonicalizerCache } from '../../scrapers/orgUnitCanonicalization';
import { getSchoolResearchPage } from '../schoolResearchPageService';

const baseEntity = (overrides: Record<string, unknown>) => ({
  slug: 'entity',
  name: 'Entity',
  kind: 'lab',
  entityType: 'LAB',
  departments: ['Genetics'],
  school: 'School of Medicine',
  schools: ['School of Medicine'],
  sourceUrls: ['https://medicine.example.edu/lab'],
  shortDescription: 'Studies gene regulation.',
  studentVisibilityTier: 'student_ready',
  archived: false,
  ...overrides,
});

describe('getSchoolResearchPage (issue #1707)', () => {
  let mongo: MongoMemoryServer;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    await mongoose.connect(mongo.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongo) await mongo.stop();
  });

  beforeEach(async () => {
    await ResearchEntity.deleteMany({});
    await OrgUnit.deleteMany({});
    resetOrgUnitCanonicalizerCache();
    await OrgUnit.create([
      { slug: 'school-of-medicine', name: 'School of Medicine', kind: 'SCHOOL', status: 'ACTIVE' },
      { slug: 'genetics', name: 'Genetics', kind: 'DEPARTMENT', status: 'ACTIVE' },
      { slug: 'immunobiology', name: 'Immunobiology', kind: 'DEPARTMENT', status: 'ACTIVE' },
    ]);
  });

  afterEach(async () => {
    await ResearchEntity.deleteMany({});
    await OrgUnit.deleteMany({});
    resetOrgUnitCanonicalizerCache();
  });

  it('aggregates servable homes, centers, departments, and ways in for a school slug', async () => {
    await ResearchEntity.create([
      baseEntity({ slug: 'med-lab', name: 'Gene Regulation Lab', entityType: 'LAB' }),
      baseEntity({
        slug: 'med-center',
        name: 'Cancer Center',
        kind: 'center',
        entityType: 'CENTER',
        departments: ['Immunobiology'],
      }),
      baseEntity({
        slug: 'med-ra',
        name: 'Summer Medical RA Program',
        kind: 'program',
        entityType: 'RA_PROGRAM',
      }),
      baseEntity({ slug: 'archived-lab', name: 'Archived Med Lab', archived: true }),
      baseEntity({
        slug: 'hidden-lab',
        name: 'Under Review Med Lab',
        studentVisibilityTier: 'operator_review',
      }),
      baseEntity({
        slug: 'other-school-lab',
        name: 'Law Lab',
        school: 'Law School',
        schools: ['Law School'],
        departments: ['Law'],
      }),
    ]);

    const page = await getSchoolResearchPage('school-of-medicine');
    expect(page).not.toBeNull();
    expect(page?.school.label).toBe('School of Medicine');

    const homeSlugs = page?.homeGroups.flatMap((group) =>
      group.researchEntities.map((entity) => entity.slug),
    );
    expect(homeSlugs).toContain('med-lab');
    expect(homeSlugs).not.toContain('archived-lab');
    expect(homeSlugs).not.toContain('hidden-lab');
    expect(homeSlugs).not.toContain('other-school-lab');

    expect(page?.crossCuttingGroups.map((group) => group.entityType)).toEqual(['CENTER']);
    expect(page?.waysIn.map((group) => group.entityType)).toEqual(['RA_PROGRAM']);
    expect(page?.departments.map((department) => department.slug).sort()).toEqual([
      'genetics',
      'immunobiology',
    ]);
  });

  it('returns an honest empty page for a resolvable school with no coverage', async () => {
    const page = await getSchoolResearchPage('school-of-medicine');
    expect(page).not.toBeNull();
    expect(page?.homeGroups).toEqual([]);
    expect(page?.crossCuttingGroups).toEqual([]);
    expect(page?.waysIn).toEqual([]);
    expect(page?.departments).toEqual([]);
    expect(page?.totalHomeCount).toBe(0);
  });

  it('returns null for a slug that does not resolve to a known school', async () => {
    expect(await getSchoolResearchPage('not-a-real-school')).toBeNull();
  });

  it('returns null for a malformed slug', async () => {
    expect(await getSchoolResearchPage('..')).toBeNull();
    expect(await getSchoolResearchPage('has space')).toBeNull();
  });
});
