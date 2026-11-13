import { describe, expect, it } from 'vitest';
import { storedDepartmentIsBacked } from '../storedDepartmentBacking';

describe('storedDepartmentIsBacked (#6049)', () => {
  const catalog = (name: string) =>
    ({ 'fixture studies': 'Fixture Studies', fxs: 'Fixture Studies' })[name.toLowerCase()];

  it('reads a reading of the same value, in any spelling the materializer writes, as backing', () => {
    expect(
      storedDepartmentIsBacked('Fixture & Studies', [{ value: 'fixture and studies' }], null),
    ).toBe(true);
    expect(storedDepartmentIsBacked('Fixture Studies', [{ value: 'FXS' }], catalog)).toBe(true);
  });

  it('reads a stored value no reading states as unbacked', () => {
    expect(storedDepartmentIsBacked('Fixture Studies', [{ value: 'Other Studies' }], catalog)).toBe(
      false,
    );
    expect(storedDepartmentIsBacked('Fixture Studies', [], catalog)).toBe(false);
  });

  it('never reads an empty stored value as unbacked', () => {
    expect(storedDepartmentIsBacked('', [], catalog)).toBe(true);
    expect(storedDepartmentIsBacked(undefined, [], null)).toBe(true);
  });
});
