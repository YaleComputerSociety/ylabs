import { describe, expect, it } from 'vitest';
import { withDirectoryDepartmentsCatalogGated } from '../directoryDepartmentCatalogGate';
import { directoryHomeDepartment } from '../sources/yaleDirectoryScraper';
import { withUserDepartmentObservationsScreened } from '../userDepartmentObservationScreens';

const CATALOG = new Map(
  [
    ['Fixture Studies', 'Fixture Studies'],
    ['Biostatistics', 'Biostatistics'],
    ['Health Policy and Management', 'Health Policy & Management'],
    ['MEDINT Cardiology', 'Cardiovascular Medicine'],
  ].map(([alias, name]) => [alias.toLowerCase(), name]),
);
const canonicalDepartment = (name: string) => CATALOG.get(name.toLowerCase());
const context = { canonicalDepartment };
const reading = (value: unknown, sourceName = 'yale-directory') => ({
  field: 'primaryDepartment',
  value,
  sourceName,
});

describe('directoryHomeDepartment (#6129)', () => {
  it('keeps a unit the catalog names as the directory spells it', () => {
    expect(directoryHomeDepartment({ unit: 'Fixture Studies' }, canonicalDepartment)).toBe(
      'Fixture Studies',
    );
  });

  it('reads an acronym-suffixed unit as its catalog name', () => {
    expect(directoryHomeDepartment({ unit: 'Biostatistics (BIS)' }, canonicalDepartment)).toBe(
      'Biostatistics',
    );
    expect(
      directoryHomeDepartment({ unit: 'Health Policy and Management (HPM)' }, canonicalDepartment),
    ).toBe('Health Policy & Management');
  });

  it('reads a section the catalog knows only by its coded form through the unit class', () => {
    expect(
      directoryHomeDepartment({ unit: 'Cardiology', unit_class: 'MEDINT' }, canonicalDepartment),
    ).toBe('Cardiovascular Medicine');
  });

  it('states no department for a center, a council or a bare section name', () => {
    expect(
      directoryHomeDepartment({ unit: 'Council on Fixture Studies' }, canonicalDepartment),
    ).toBeUndefined();
    expect(
      directoryHomeDepartment({ unit: 'Fixture Center' }, canonicalDepartment),
    ).toBeUndefined();
    expect(directoryHomeDepartment({ unit: 'Cardiology' }, canonicalDepartment)).toBeUndefined();
  });

  it('keeps the unit as before when no catalog is available', () => {
    expect(directoryHomeDepartment({ unit: 'Fixture Center' }, null)).toBe('Fixture Center');
  });
});

describe('withDirectoryDepartmentsCatalogGated (#6129)', () => {
  it('keeps a catalog department, decodes an acronym spelling and drops a center', () => {
    expect(
      withDirectoryDepartmentsCatalogGated(
        [
          reading('Fixture Studies'),
          reading('Biostatistics (BIS)'),
          reading('Council on Fixture Studies'),
          reading('Council on Fixture Studies', 'dept-faculty-roster'),
          {
            field: 'departments',
            value: ['Council on Fixture Studies'],
            sourceName: 'yale-directory',
          },
        ],
        context,
      ),
    ).toEqual([
      reading('Fixture Studies'),
      reading('Biostatistics'),
      reading('Council on Fixture Studies', 'dept-faculty-roster'),
      { field: 'departments', value: ['Council on Fixture Studies'], sourceName: 'yale-directory' },
    ]);
  });

  it('gates nothing while the catalog is unavailable', () => {
    const kept = [reading('Council on Fixture Studies')];
    expect(withDirectoryDepartmentsCatalogGated(kept, { canonicalDepartment: null })).toEqual(kept);
  });

  it('is one of the resolver department screens', () => {
    expect(
      withUserDepartmentObservationsScreened([reading('Council on Fixture Studies')], context),
    ).toEqual([]);
  });
});
