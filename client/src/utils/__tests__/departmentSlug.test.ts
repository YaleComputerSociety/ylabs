import { describe, expect, it } from 'vitest';
import { slugifyDepartmentName } from '../departmentSlug';

describe('slugifyDepartmentName', () => {
  it('lowercases, strips accents, and dashes non-alphanumeric runs', () => {
    expect(slugifyDepartmentName('Ecology & Evolutionary Biology')).toBe(
      'ecology-evolutionary-biology',
    );
    expect(slugifyDepartmentName('Molecular Biophysics & Biochemistry')).toBe(
      'molecular-biophysics-biochemistry',
    );
  });

  it('returns an empty string for blank input', () => {
    expect(slugifyDepartmentName('')).toBe('');
  });
});
