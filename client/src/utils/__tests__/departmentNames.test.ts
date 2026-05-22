import {
  getDepartmentAbbreviation,
  getDepartmentDisplayLabel,
  getUniqueDepartmentLabels,
} from '../departmentNames';
import { describe, expect, it } from 'vitest';

const departmentTable = [
  {
    abbreviation: 'CPSC',
    name: 'Computer Science',
    displayName: 'CPSC - Computer Science',
    aliases: ['CS'],
  },
  {
    abbreviation: 'EEB',
    name: 'Ecology and Evolutionary Biology',
    displayName: 'EEB - Ecology and Evolutionary Biology',
    aliases: ['Ecology & Evolutionary Biology', 'E&EB'],
  },
  {
    abbreviation: 'S&DS',
    name: 'Statistics & Data Science',
    displayName: 'S&DS - Statistics & Data Science',
    aliases: ['Statistics and Data Science'],
  },
];

describe('departmentNames', () => {
  it('recognizes mixed-case abbreviation prefixes', () => {
    expect(getDepartmentAbbreviation('Phys - Physics')).toBe('PHYS');
    expect(getDepartmentAbbreviation('EEB - Ecology & Evolutionary Biology')).toBe('EEB');
  });

  it('collapses equivalent prefixed and plain department labels', () => {
    expect(
      getUniqueDepartmentLabels([
        'Ecology & Evolutionary Biology',
        'EEB - Ecology & Evolutionary Biology',
        'Physics',
        'Phys - Physics',
        'Computer Science',
        'CPSC - Computer Science',
      ]),
    ).toEqual(['Ecology & Evolutionary Biology', 'Physics', 'Computer Science']);
  });

  it('uses the department name as the display label for prefixed values', () => {
    expect(getDepartmentDisplayLabel('PHYS - Physics')).toBe('Physics');
    expect(getDepartmentDisplayLabel('EEB - Ecology & Evolutionary Biology')).toBe(
      'Ecology & Evolutionary Biology',
    );
  });

  it('resolves all known department variants through the Mongo department table', () => {
    expect(
      getUniqueDepartmentLabels(
        [
          'Computer Science',
          'CPSC - Computer Science',
          'CS',
          'Ecology & Evolutionary Biology',
          'EEB - Ecology & Evolutionary Biology',
          'S&DS - Statistics & Data Science',
          'Statistics and Data Science',
        ],
        departmentTable,
      ),
    ).toEqual([
      'Computer Science',
      'Ecology and Evolutionary Biology',
      'Statistics & Data Science',
    ]);
  });
});
