import { describe, expect, it } from 'vitest';
import {
  buildDepartmentResearchPage,
  resolveDepartmentSlug,
} from '../departmentResearchPageService';

const entity = (overrides: Record<string, unknown>) => ({
  slug: 'x',
  name: 'X',
  entityType: 'LAB',
  departments: ['Chemistry'],
  sourceUrls: ['https://chem.example.edu/lab'],
  studentVisibilityTier: 'student_ready',
  shortDescription: 'Studies reaction dynamics.',
  ...overrides,
});

describe('resolveDepartmentSlug', () => {
  it('resolves a plain department slug to its comparison key', () => {
    expect(resolveDepartmentSlug('chemistry')).toEqual({
      slug: 'chemistry',
      labelKey: 'chemistry',
    });
  });

  it('rejects a slug that names a Yale school', () => {
    expect(resolveDepartmentSlug('school-of-medicine')).toBeNull();
    expect(resolveDepartmentSlug('yale-college')).toBeNull();
  });

  it('rejects a malformed slug', () => {
    expect(resolveDepartmentSlug('')).toBeNull();
    expect(resolveDepartmentSlug('..')).toBeNull();
    expect(resolveDepartmentSlug(null)).toBeNull();
  });
});

describe('buildDepartmentResearchPage', () => {
  const resolved = { slug: 'chemistry', labelKey: 'chemistry' };

  it('renders an honest empty page for a covered slug with no entities', () => {
    const page = buildDepartmentResearchPage(resolved, []);
    expect(page.department.slug).toBe('chemistry');
    expect(page.department.label).toBe('Chemistry');
    expect(page.homeGroups).toEqual([]);
    expect(page.waysIn).toEqual([]);
    expect(page.totalHomeCount).toBe(0);
    expect(page.totalWayInCount).toBe(0);
  });

  it('groups research homes by entity type and separates the ways in', () => {
    const page = buildDepartmentResearchPage(resolved, [
      entity({ slug: 'lab-a', name: 'Reaction Dynamics Lab', entityType: 'LAB' }),
      entity({ slug: 'center-b', name: 'Energy Sciences Center', entityType: 'CENTER' }),
      entity({
        slug: 'course-c',
        name: 'Senior Essay in Chemistry',
        entityType: 'COURSE_SEQUENCE',
      }),
      entity({
        slug: 'ra-d',
        name: 'Chemistry Summer RA Program',
        entityType: 'RA_PROGRAM',
      }),
    ]);

    expect(page.homeGroups.map((group) => group.entityType)).toEqual(['LAB', 'CENTER']);
    expect(page.totalHomeCount).toBe(2);
    expect(page.waysIn.map((group) => group.entityType)).toEqual([
      'COURSE_SEQUENCE',
      'RA_PROGRAM',
    ]);
    expect(page.totalWayInCount).toBe(2);
    expect(page.homeGroups[0].researchEntities[0].slug).toBe('lab-a');
    expect(page.homeGroups[0].label).toBe('Labs');
  });

  it('prefers the most common display label variant for the department title', () => {
    const page = buildDepartmentResearchPage(
      { slug: 'molecular-biophysics-and-biochemistry', labelKey: 'molecular biophysics and biochemistry' },
      [
        entity({
          slug: 'lab-1',
          departments: ['MB&B - Molecular Biophysics & Biochemistry'],
        }),
        entity({
          slug: 'lab-2',
          departments: ['MB&B - Molecular Biophysics & Biochemistry'],
        }),
        entity({ slug: 'lab-3', departments: ['Molecular Biophysics and Biochemistry'] }),
      ],
    );
    expect(page.department.label).toBe('Molecular Biophysics & Biochemistry');
  });

  it('caps entities per group while reporting the true total', () => {
    const many = Array.from({ length: 75 }, (_, index) =>
      entity({ slug: `lab-${index}`, name: `Lab ${String(index).padStart(3, '0')}` }),
    );
    const page = buildDepartmentResearchPage(resolved, many);
    expect(page.totalHomeCount).toBe(75);
    expect(page.homeGroups[0].totalCount).toBe(75);
    expect(page.homeGroups[0].researchEntities.length).toBe(60);
  });
});
