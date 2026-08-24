import { afterEach, describe, expect, it } from 'vitest';
import {
  buildSchoolResearchPage,
  resolveSchoolSlug,
} from '../schoolResearchPageService';
import {
  setOrgUnitCanonicalizerForTesting,
  type OrgUnitCanonicalizer,
} from '../../scrapers/orgUnitCanonicalization';

const SCHOOL_NAMES = new Map<string, string>([
  ['school of medicine', 'School of Medicine'],
  ['school-of-medicine', 'School of Medicine'],
  ['school of the environment', 'School of the Environment'],
  ['school-of-the-environment', 'School of the Environment'],
]);

const fakeCanonicalizer: OrgUnitCanonicalizer = {
  schoolForDepartment: () => null,
  canonicalizeSchool: (raw) => {
    const key = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    const value = SCHOOL_NAMES.get(key);
    return value ? { value, matched: true } : { value: typeof raw === 'string' ? raw : '', matched: false };
  },
  canonicalizeDepartments: () => ({ values: [], unmatched: [], dropped: [] }),
};

const entity = (overrides: Record<string, unknown>) => ({
  slug: 'x',
  name: 'X',
  entityType: 'LAB',
  departments: ['Genetics'],
  schools: ['School of Medicine'],
  school: 'School of Medicine',
  sourceUrls: ['https://medicine.example.edu/lab'],
  studentVisibilityTier: 'student_ready',
  shortDescription: 'Studies gene regulation.',
  ...overrides,
});

afterEach(() => {
  setOrgUnitCanonicalizerForTesting(null);
});

describe('resolveSchoolSlug', () => {
  it('resolves a school slug through the shared canonicalizer', async () => {
    setOrgUnitCanonicalizerForTesting(fakeCanonicalizer);
    expect(await resolveSchoolSlug('school-of-medicine')).toEqual({
      slug: 'school-of-medicine',
      name: 'School of Medicine',
    });
    expect(await resolveSchoolSlug('school-of-the-environment')).toEqual({
      slug: 'school-of-the-environment',
      name: 'School of the Environment',
    });
  });

  it('fails closed on a slug that does not resolve to a known school', async () => {
    setOrgUnitCanonicalizerForTesting(fakeCanonicalizer);
    expect(await resolveSchoolSlug('not-a-real-school')).toBeNull();
  });

  it('rejects a malformed slug before consulting the canonicalizer', async () => {
    setOrgUnitCanonicalizerForTesting(fakeCanonicalizer);
    expect(await resolveSchoolSlug('')).toBeNull();
    expect(await resolveSchoolSlug('..')).toBeNull();
    expect(await resolveSchoolSlug('has space')).toBeNull();
    expect(await resolveSchoolSlug(null)).toBeNull();
  });
});

describe('buildSchoolResearchPage', () => {
  const resolved = { slug: 'school-of-medicine', name: 'School of Medicine' };

  it('renders an honest empty page for a resolved school with no entities', () => {
    const page = buildSchoolResearchPage(resolved, []);
    expect(page.school).toEqual({ slug: 'school-of-medicine', label: 'School of Medicine' });
    expect(page.departments).toEqual([]);
    expect(page.crossCuttingGroups).toEqual([]);
    expect(page.homeGroups).toEqual([]);
    expect(page.waysIn).toEqual([]);
    expect(page.totalHomeCount).toBe(0);
    expect(page.totalWayInCount).toBe(0);
  });

  it('splits homes, cross-cutting centers, and ways in, and rolls up departments', () => {
    const page = buildSchoolResearchPage(resolved, [
      entity({ slug: 'lab-a', name: 'Gene Regulation Lab', entityType: 'LAB', departments: ['Genetics'] }),
      entity({ slug: 'lab-b', name: 'Immunity Lab', entityType: 'LAB', departments: ['Immunobiology'] }),
      entity({
        slug: 'center-c',
        name: 'Cancer Center',
        entityType: 'CENTER',
        departments: ['Genetics', 'Immunobiology'],
      }),
      entity({
        slug: 'institute-d',
        name: 'Stem Cell Institute',
        entityType: 'INSTITUTE',
        departments: [],
      }),
      entity({
        slug: 'ra-e',
        name: 'Summer Medical RA Program',
        entityType: 'RA_PROGRAM',
        departments: ['Genetics'],
      }),
    ]);

    expect(page.homeGroups.map((group) => group.entityType)).toEqual(['LAB']);
    expect(page.crossCuttingGroups.map((group) => group.entityType)).toEqual([
      'CENTER',
      'INSTITUTE',
    ]);
    expect(page.waysIn.map((group) => group.entityType)).toEqual(['RA_PROGRAM']);
    expect(page.totalHomeCount).toBe(4);
    expect(page.totalWayInCount).toBe(1);

    const genetics = page.departments.find((department) => department.slug === 'genetics');
    const immuno = page.departments.find((department) => department.slug === 'immunobiology');
    expect(genetics?.homeCount).toBe(2);
    expect(immuno?.homeCount).toBe(2);
    expect(page.departments[0].homeCount).toBeGreaterThanOrEqual(page.departments[1].homeCount);
  });

  it('excludes a department value that names the school itself', () => {
    const page = buildSchoolResearchPage(resolved, [
      entity({ slug: 'lab-x', departments: ['School of Medicine', 'Genetics'] }),
    ]);
    expect(page.departments.map((department) => department.slug)).toEqual(['genetics']);
  });

  it('caps entities per group while reporting the true total', () => {
    const many = Array.from({ length: 75 }, (_, index) =>
      entity({ slug: `lab-${index}`, name: `Lab ${String(index).padStart(3, '0')}` }),
    );
    const page = buildSchoolResearchPage(resolved, many);
    expect(page.totalHomeCount).toBe(75);
    expect(page.homeGroups[0].totalCount).toBe(75);
    expect(page.homeGroups[0].researchEntities.length).toBe(60);
  });
});
