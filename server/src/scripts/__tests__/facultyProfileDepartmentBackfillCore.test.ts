import { describe, expect, it } from 'vitest';
import { planFacultyProfileDepartmentBackfill } from '../facultyProfileDepartmentBackfillCore';

const departments = [
  {
    _id: 'cpsc',
    abbreviation: 'CPSC',
    name: 'Computer Science',
    displayName: 'CPSC - Computer Science',
    aliases: [],
  },
  {
    _id: 'econ',
    abbreviation: 'ECON',
    name: 'Economics',
    displayName: 'ECON - Economics',
    aliases: [],
  },
  {
    _id: 'psyt',
    abbreviation: 'PSYT',
    name: 'Psychiatry',
    displayName: 'PSYT - Psychiatry',
    aliases: [],
  },
  {
    _id: 'nurs',
    abbreviation: 'NURS',
    name: 'Nursing',
    displayName: 'NURS - Nursing',
    aliases: [],
  },
];

describe('facultyProfileDepartmentBackfillCore', () => {
  it('plans current faculty profile department canonicalization', () => {
    const result = planFacultyProfileDepartmentBackfill(
      [
        {
          _id: 'user-1',
          netid: 'fp101',
          fname: 'Fixture',
          lname: 'Profile',
          userType: 'faculty',
          primaryDepartment: 'EASCPS Computer Science',
          secondaryDepartments: ['EAS School of Engineering and Applied Science'],
          departments: ['Computer Science'],
        },
      ],
      departments,
    );

    expect(result.summary).toMatchObject({
      scanned: 1,
      plannedUpdates: 1,
      skippedUnresolved: 0,
      unresolvedLabels: 0,
      ignoredLabels: 1,
    });
    expect(result.planned[0]).toMatchObject({
      id: 'user-1',
      netid: 'fp101',
      before: {
        primaryDepartment: 'EASCPS Computer Science',
        secondaryDepartments: ['EAS School of Engineering and Applied Science'],
        departments: ['Computer Science'],
      },
      after: {
        primaryDepartment: 'CPSC - Computer Science',
        secondaryDepartments: [],
        departments: ['CPSC - Computer Science'],
      },
    });
  });

  it('does not plan a change for already-canonical profile departments', () => {
    const result = planFacultyProfileDepartmentBackfill(
      [
        {
          _id: 'user-2',
          netid: 'cs1',
          fname: 'Canonical',
          lname: 'Person',
          userType: 'professor',
          primaryDepartment: 'CPSC - Computer Science',
          secondaryDepartments: [],
          departments: ['CPSC - Computer Science'],
        },
      ],
      departments,
    );

    expect(result.summary.plannedUpdates).toBe(0);
    expect(result.planned).toEqual([]);
  });

  it('skips unresolved source labels instead of guessing from stale fallback departments', () => {
    const result = planFacultyProfileDepartmentBackfill(
      [
        {
          _id: 'user-3',
          netid: 'mixed1',
          fname: 'Mixed',
          lname: 'Signal',
          userType: 'faculty',
          primaryDepartment: 'Unknown Political Science Unit',
          secondaryDepartments: ['FAS Other FAS and Academic Departments'],
          departments: ['Economics'],
        },
      ],
      departments,
    );

    expect(result.summary).toMatchObject({
      scanned: 1,
      plannedUpdates: 0,
      skippedUnresolved: 1,
      unresolvedLabels: 1,
      ignoredLabels: 1,
    });
    expect(result.planned).toEqual([]);
  });

  it('plans safe updates for newly resolvable source-unit families', () => {
    const result = planFacultyProfileDepartmentBackfill(
      [
        {
          _id: 'user-4',
          netid: 'psych1',
          fname: 'Psych',
          lname: 'Profile',
          userType: 'faculty',
          primaryDepartment: 'MEDPSY Psych Divisions-CNRU',
          secondaryDepartments: ['MED School of Medicine'],
          departments: [],
        },
        {
          _id: 'user-5',
          netid: 'nurse1',
          fname: 'Nursing',
          lname: 'Profile',
          userType: 'faculty',
          primaryDepartment: 'NURPRO MSN Program',
          secondaryDepartments: ['NUR School of Nursing'],
          departments: [],
        },
      ],
      departments,
    );

    expect(result.summary).toMatchObject({
      scanned: 2,
      plannedUpdates: 2,
      skippedUnresolved: 0,
      unresolvedLabels: 0,
      ignoredLabels: 1,
    });
    expect(result.planned.map((row) => row.after)).toEqual([
      {
        primaryDepartment: 'PSYT - Psychiatry',
        secondaryDepartments: [],
        departments: ['PSYT - Psychiatry'],
      },
      {
        primaryDepartment: 'NURS - Nursing',
        secondaryDepartments: [],
        departments: ['NURS - Nursing'],
      },
    ]);
  });
});
