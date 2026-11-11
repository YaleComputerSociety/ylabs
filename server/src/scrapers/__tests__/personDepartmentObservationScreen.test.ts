import { describe, expect, it } from 'vitest';
import { screenedPersonDepartmentObservations } from '../personDepartmentObservationScreen';

const department = (sourceName: string, value: unknown, field = 'primaryDepartment') => ({
  field,
  value,
  sourceName,
});

describe('screenedPersonDepartmentObservations (#5741)', () => {
  it('drops a page heading read as a department, from any lane', () => {
    expect(
      screenedPersonDepartmentObservations([
        department('official-profile-pi-backfill', 'Other Departments & Organizations'),
        department(
          'official-profile-pi-backfill',
          ['Other Departments & Organizations', 'Fixture Studies'],
          'departments',
        ),
      ]),
    ).toEqual([department('official-profile-pi-backfill', ['Fixture Studies'], 'departments')]);
  });

  it('reads a directory unit through the directory screen and decode', () => {
    expect(
      screenedPersonDepartmentObservations([
        department('yale-directory-csv', 'MEDNEU Multiple Sclerosis'),
        department('yale-directory-csv', 'ENVOTH Other Units'),
        department('yale-directory', 'Business Office'),
      ]),
    ).toEqual([department('yale-directory-csv', 'Neurology')]);
  });

  it('leaves an official department and every other field alone', () => {
    const kept = [
      department('dept-faculty-roster', 'Fixture Studies'),
      { field: 'title', value: 'Professor of Fixture Studies', sourceName: 'yale-directory' },
    ];
    expect(screenedPersonDepartmentObservations(kept)).toEqual(kept);
  });
});
