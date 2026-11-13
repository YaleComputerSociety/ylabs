import { describe, expect, it } from 'vitest';
import {
  storedSchoolBackingClass,
  storedSchoolIsBacked,
  type SchoolCanonicalizer,
} from '../storedSchoolBacking';

const SCHOOLS: Record<string, string> = {
  'fixture school of science': 'Fixture School of Science',
  'yale fixture school of science': 'Fixture School of Science',
  'fixture school of letters': 'Fixture School of Letters',
};
const DEPARTMENT_SCHOOL: Record<string, string> = {
  'Fixture Chemistry': 'Fixture School of Science',
};

const canonicalizer: SchoolCanonicalizer = {
  canonicalizeSchool: (raw) => {
    const value = SCHOOLS[String(raw).trim().toLowerCase()];
    return value ? { value, matched: true } : { value: String(raw), matched: false };
  },
  canonicalizeDepartments: (raw) => ({
    values: (Array.isArray(raw) ? raw : []).filter((value) => value in DEPARTMENT_SCHOOL),
    affiliationLabels: [],
    unmatched: [],
    dropped: [],
  }),
  schoolForDepartment: (department) => DEPARTMENT_SCHOOL[department] ?? null,
};

describe('storedSchoolIsBacked (#6096)', () => {
  it('counts a reading in another spelling of the same school as backing', () => {
    expect(
      storedSchoolIsBacked(
        'Fixture School of Science',
        [{ value: 'Yale Fixture School of Science' }],
        canonicalizer,
      ),
    ).toBe(true);
    expect(
      storedSchoolIsBacked(
        'fixture school of science',
        [{ value: 'FIXTURE SCHOOL OF SCIENCE' }],
        canonicalizer,
      ),
    ).toBe(true);
  });

  it('does not count a reading of a different school', () => {
    expect(
      storedSchoolIsBacked(
        'Fixture School of Science',
        [{ value: 'Fixture School of Letters' }],
        canonicalizer,
      ),
    ).toBe(false);
  });

  it('treats an empty stored school as nothing to back', () => {
    expect(storedSchoolIsBacked('', [], canonicalizer)).toBe(true);
    expect(storedSchoolIsBacked(undefined, [], canonicalizer)).toBe(true);
  });
});

describe('storedSchoolBackingClass (#6096)', () => {
  const row = { _id: 'row', school: 'Fixture School of Science' };

  it('prefers a resolved school reading over any derivation', () => {
    expect(
      storedSchoolBackingClass(
        { ...row, departments: ['Fixture Chemistry'] },
        [{ value: 'Fixture School of Science' }],
        canonicalizer,
      ),
    ).toBe('school-observation');
  });

  it('credits the parent school of a stored department when no reading states it', () => {
    expect(
      storedSchoolBackingClass({ ...row, departments: ['Fixture Chemistry'] }, [], canonicalizer),
    ).toBe('department-derivation');
  });

  it('reads a stored school no reading and no derivation states as never backed', () => {
    expect(
      storedSchoolBackingClass(
        { ...row, departments: ['Unknown Department'] },
        [{ value: 'Fixture School of Letters' }],
        canonicalizer,
      ),
    ).toBe('never-backed');
  });

  it('reports a row with no stored school apart from every backing class', () => {
    expect(storedSchoolBackingClass({ _id: 'row', school: '' }, [], canonicalizer)).toBe(
      'no-stored-school',
    );
  });
});
