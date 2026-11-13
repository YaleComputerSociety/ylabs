import { describe, expect, it } from 'vitest';
import {
  storedDepartmentHasUnscreenedReading,
  storedDepartmentRestsOnlyOnScreenedReadings,
} from '../storedDepartmentScreenedBacking';
import type { UserDepartmentObservationScreen } from '../userDepartmentObservationScreens';

const catalog = {
  canonicalDepartment: (name: string) => (name === 'Fixture Studies' ? name : undefined),
};
const noCatalog = { canonicalDepartment: null };
const screenFixtureLane: UserDepartmentObservationScreen = (observations) =>
  observations.filter((observation) => observation.sourceName !== 'fixture-screened-lane');
const screens = [screenFixtureLane];
const reading = (value: unknown, sourceName = 'fixture-screened-lane') => ({
  field: 'primaryDepartment',
  value,
  sourceName,
});

describe('storedDepartmentRestsOnlyOnScreenedReadings', () => {
  it('reads a stored value every reading of which is screened as resting on screened readings', () => {
    expect(
      storedDepartmentRestsOnlyOnScreenedReadings(
        'Fixture Center',
        [reading('Fixture Center'), reading('fixture  center')],
        catalog,
        screens,
      ),
    ).toBe(true);
  });

  it('keeps a stored value one unscreened reading still states', () => {
    expect(
      storedDepartmentRestsOnlyOnScreenedReadings(
        'Fixture Center',
        [reading('Fixture Center'), reading('Fixture Center', 'fixture-open-lane')],
        catalog,
        screens,
      ),
    ).toBe(false);
  });

  it('leaves a never-backed stored value to the #6049 rule', () => {
    expect(
      storedDepartmentRestsOnlyOnScreenedReadings(
        'Fixture Center',
        [reading('Fixture Studies'), { field: 'departments', value: 'Fixture Center' }],
        catalog,
        screens,
      ),
    ).toBe(false);
    expect(
      storedDepartmentRestsOnlyOnScreenedReadings('Fixture Center', [], catalog, screens),
    ).toBe(false);
  });

  it('clears nothing while the catalog is unavailable', () => {
    expect(
      storedDepartmentRestsOnlyOnScreenedReadings(
        'Fixture Center',
        [reading('Fixture Center')],
        noCatalog,
        screens,
      ),
    ).toBe(false);
  });

  it('reads a stored heading the #5795 screen refuses as resting on screened readings', () => {
    expect(
      storedDepartmentRestsOnlyOnScreenedReadings(
        'Other Departments & Organizations',
        [reading('Other Departments & Organizations', 'official-profile-pi-backfill')],
        catalog,
      ),
    ).toBe(true);
  });

  it('reads an export reading decoded to the stored value own catalog department as still backing it', () => {
    expect(
      storedDepartmentRestsOnlyOnScreenedReadings(
        'FASFIX Fixture Studies',
        [reading('FASFIX Fixture Studies', 'yale-directory-csv')],
        catalog,
      ),
    ).toBe(false);
  });

  it('reads an export reading the decode refuses as screened', () => {
    expect(
      storedDepartmentRestsOnlyOnScreenedReadings(
        'FASFIX Fixture Center',
        [reading('FASFIX Fixture Center', 'yale-directory-csv')],
        catalog,
      ),
    ).toBe(true);
  });
});

describe('storedDepartmentHasUnscreenedReading', () => {
  it('finds an unscreened reading of the stored value and ignores screened ones', () => {
    expect(
      storedDepartmentHasUnscreenedReading(
        'Fixture Studies',
        [reading('Fixture Studies', 'fixture-open-lane')],
        catalog,
      ),
    ).toBe(true);
    expect(
      storedDepartmentHasUnscreenedReading('Fixture Studies', [reading('Fixture Center')], catalog),
    ).toBe(false);
  });
});
