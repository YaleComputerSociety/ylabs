import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ResearchEntity } from '../../models/researchEntity';
import { getDepartmentResearchPage } from '../departmentResearchPageService';

const baseEntity = (overrides: Record<string, unknown>) => ({
  slug: 'entity',
  name: 'Entity',
  kind: 'lab',
  entityType: 'LAB',
  departments: ['CHEM - Chemistry'],
  sourceUrls: ['https://chem.example.edu/lab'],
  shortDescription: 'Studies reaction dynamics.',
  studentVisibilityTier: 'student_ready',
  archived: false,
  ...overrides,
});

describe('getDepartmentResearchPage (issue #1649)', () => {
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
  });

  afterEach(async () => {
    await ResearchEntity.deleteMany({});
  });

  it('aggregates servable homes and ways in for a department slug', async () => {
    await ResearchEntity.create([
      baseEntity({ slug: 'chem-lab', name: 'Reaction Dynamics Lab', entityType: 'LAB' }),
      baseEntity({
        slug: 'chem-center',
        name: 'Energy Sciences Center',
        kind: 'center',
        entityType: 'CENTER',
        departments: ['Chemistry'],
      }),
      baseEntity({
        slug: 'chem-course',
        name: 'Senior Essay in Chemistry',
        kind: 'program',
        entityType: 'COURSE_SEQUENCE',
        departments: ['CHEM - Chemistry'],
      }),
      baseEntity({
        slug: 'chem-ra',
        name: 'Chemistry Summer RA Program',
        kind: 'program',
        entityType: 'RA_PROGRAM',
        departments: ['Chemistry'],
      }),
      baseEntity({
        slug: 'archived-lab',
        name: 'Archived Chem Lab',
        archived: true,
      }),
      baseEntity({
        slug: 'hidden-lab',
        name: 'Under Review Chem Lab',
        studentVisibilityTier: 'operator_review',
      }),
      baseEntity({
        slug: 'other-dept-lab',
        name: 'Physics Lab',
        departments: ['PHYS - Physics'],
      }),
    ]);

    const page = await getDepartmentResearchPage('chemistry');
    expect(page).not.toBeNull();
    expect(page?.department.label).toBe('Chemistry');
    expect(page?.homeGroups.map((group) => group.entityType)).toEqual(['LAB', 'CENTER']);
    expect(page?.totalHomeCount).toBe(2);
    const slugs = page?.homeGroups.flatMap((group) =>
      group.researchEntities.map((entity) => entity.slug),
    );
    expect(slugs).toContain('chem-lab');
    expect(slugs).toContain('chem-center');
    expect(slugs).not.toContain('archived-lab');
    expect(slugs).not.toContain('hidden-lab');
    expect(slugs).not.toContain('other-dept-lab');

    expect(page?.waysIn.map((group) => group.entityType).sort()).toEqual([
      'COURSE_SEQUENCE',
      'RA_PROGRAM',
    ]);
    expect(page?.totalWayInCount).toBe(2);
  });

  it('returns an honest empty page for a well-formed slug with no coverage', async () => {
    const page = await getDepartmentResearchPage('anthropology');
    expect(page).not.toBeNull();
    expect(page?.homeGroups).toEqual([]);
    expect(page?.waysIn).toEqual([]);
    expect(page?.totalHomeCount).toBe(0);
  });

  it('returns null for a slug that names a Yale school', async () => {
    await ResearchEntity.create([
      baseEntity({ slug: 'som-lab', departments: ['School of Medicine'] }),
    ]);
    expect(await getDepartmentResearchPage('school-of-medicine')).toBeNull();
  });

  it('returns null for a malformed slug', async () => {
    expect(await getDepartmentResearchPage('..')).toBeNull();
    expect(await getDepartmentResearchPage('has space')).toBeNull();
  });
});
