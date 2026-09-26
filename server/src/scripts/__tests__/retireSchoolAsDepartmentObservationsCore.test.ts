import { describe, expect, it } from 'vitest';
import { planSchoolAsDepartmentRetirement } from '../retireSchoolAsDepartmentObservationsCore';
import { buildSchoolNamePredicate } from '../retireSchoolAsDepartmentObservations';

const catalog = [
  { name: 'School of Public Health', kind: 'SCHOOL' },
  { name: 'Divinity School', kind: 'SCHOOL' },
  { name: 'Faculty of Arts and Sciences', kind: 'DIVISION' },
  { name: 'Biostatistics', kind: 'DEPARTMENT' },
  { name: 'Digestive Diseases', kind: 'SECTION' },
];

describe('buildSchoolNamePredicate', () => {
  const isSchoolName = buildSchoolNamePredicate(catalog);

  it('accepts a school name written with or without the Yale prefix', () => {
    expect(isSchoolName('School of Public Health')).toBe(true);
    expect(isSchoolName('Yale School of Public Health')).toBe(true);
  });

  it('accepts the conversational short form of a school', () => {
    expect(isSchoolName('Divinity')).toBe(true);
  });

  it('rejects a real department or section', () => {
    expect(isSchoolName('Biostatistics')).toBe(false);
    expect(isSchoolName('Digestive Diseases')).toBe(false);
  });

  it('rejects a division that is legitimately both a school and a department facet value', () => {
    expect(isSchoolName('Faculty of Arts and Sciences')).toBe(false);
  });
});

describe('planSchoolAsDepartmentRetirement', () => {
  const isSchoolName = buildSchoolNamePredicate(catalog);

  it('groups a person’s department-claiming observations into one row', () => {
    const plan = planSchoolAsDepartmentRetirement(
      [
        {
          id: 'a',
          entityKey: 'netid:aa11',
          field: 'primaryDepartment',
          value: 'Yale School of Public Health',
        },
        {
          id: 'b',
          entityKey: 'netid:aa11',
          field: 'departments',
          value: ['Yale School of Public Health'],
        },
      ],
      isSchoolName,
    );
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0].observationIds).toEqual(['a', 'b']);
    expect(plan.rows[0].fields).toEqual(['primaryDepartment', 'departments']);
    expect(plan.observationsToRetire).toBe(2);
  });

  it('leaves a real department observation alone', () => {
    const plan = planSchoolAsDepartmentRetirement(
      [{ id: 'a', entityKey: 'netid:aa11', field: 'primaryDepartment', value: 'Biostatistics' }],
      isSchoolName,
    );
    expect(plan.rows).toEqual([]);
    expect(plan.skippedNotASchool).toBe(1);
  });

  it('counts an unusable value as skipped rather than retiring it', () => {
    const plan = planSchoolAsDepartmentRetirement(
      [
        { id: 'a', entityKey: 'netid:aa11', field: 'departments', value: [] },
        { id: 'b', entityKey: 'netid:bb22', field: 'primaryDepartment', value: null },
      ],
      isSchoolName,
    );
    expect(plan.rows).toEqual([]);
    expect(plan.skippedNotASchool).toBe(2);
  });
});
