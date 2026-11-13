import { describe, expect, it, vi } from 'vitest';
import {
  schoolDerivedByOrgUnitCanonicalization,
  storedSchoolBackingClass,
  storedSchoolIsBacked,
  type SchoolCanonicalizer,
} from '../storedSchoolBacking';

const SCHOOLS: Record<string, string> = {
  'fixture school of science': 'Fixture School of Science',
  'yale fixture school of science': 'Fixture School of Science',
  'fixture school of letters': 'Fixture School of Letters',
};

const canonicalizer: SchoolCanonicalizer = {
  canonicalizeSchool: (raw: unknown) => {
    const value = SCHOOLS[String(raw).trim().toLowerCase()];
    return value ? { value, matched: true } : { value: String(raw), matched: false };
  },
};

const none = { own: [], mergedIn: [] };

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

  it('prefers the row own reading over any derivation', () => {
    expect(
      storedSchoolBackingClass(
        row,
        { own: [{ value: 'Fixture School of Science' }], mergedIn: [] },
        canonicalizer,
        'Fixture School of Science',
      ),
    ).toBe('school-observation');
  });

  it('credits the school org-unit canonicalization derives when no own reading states it', () => {
    expect(storedSchoolBackingClass(row, none, canonicalizer, 'Fixture School of Science')).toBe(
      'org-unit-derivation',
    );
  });

  it('never counts a merged-in row reading as backing a survivor-owned school', () => {
    expect(
      storedSchoolBackingClass(
        row,
        { own: [], mergedIn: [{ value: 'Fixture School of Science' }] },
        canonicalizer,
        '',
      ),
    ).toBe('merged-in-reading-only');
  });

  it('reads a stored school no reading and no derivation states as never backed', () => {
    expect(
      storedSchoolBackingClass(
        row,
        { own: [{ value: 'Fixture School of Letters' }], mergedIn: [] },
        canonicalizer,
        'Fixture School of Letters',
      ),
    ).toBe('never-backed');
  });

  it('reports a row with no stored school apart from every backing class', () => {
    expect(storedSchoolBackingClass({ _id: 'row', school: '' }, none, canonicalizer, '')).toBe(
      'no-stored-school',
    );
  });
});

describe('schoolDerivedByOrgUnitCanonicalization (#6096)', () => {
  it('asks the engine canonicalization for a school with an empty one, passing the row and its pages', async () => {
    const schoolsAskedWith: unknown[] = [];
    const canonicalize = vi.fn(async (set: Record<string, unknown>) => {
      schoolsAskedWith.push(set.school);
      set.school = 'Fixture School of Science';
      return {
        unmatchedDepartments: [],
        droppedDepartments: [],
        orgAffiliationLabels: [],
        departmentAffiliationLabels: [],
      };
    });
    const row = {
      _id: 'row',
      school: 'Fixture School of Letters',
      departments: ['Fixture Chemistry'],
      websiteUrl: 'https://fixture-lab.example.edu/',
      sourceUrls: ['https://fixture-school.example.edu/people/fixture'],
    };

    expect(await schoolDerivedByOrgUnitCanonicalization(row, canonicalize)).toBe(
      'Fixture School of Science',
    );
    expect(schoolsAskedWith).toEqual(['']);
    expect(canonicalize).toHaveBeenCalledWith(expect.any(Object), row, [
      'https://fixture-lab.example.edu/',
      'https://fixture-school.example.edu/people/fixture',
    ]);
  });

  it('reads a canonicalization that leaves the school empty as deriving none', async () => {
    const canonicalize = vi.fn(async () => ({
      unmatchedDepartments: [],
      droppedDepartments: [],
      orgAffiliationLabels: [],
      departmentAffiliationLabels: [],
    }));
    expect(await schoolDerivedByOrgUnitCanonicalization({ _id: 'row' }, canonicalize)).toBe('');
  });
});
