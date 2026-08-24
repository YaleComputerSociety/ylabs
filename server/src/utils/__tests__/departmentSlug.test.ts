import { describe, expect, it } from 'vitest';
import {
  departmentDisplayLabel,
  departmentSlugToLabelKey,
  isYaleSchoolLabelKey,
  normalizedDepartmentLabelKey,
  toDepartmentSlug,
} from '../departmentSlug';

describe('departmentSlug', () => {
  it('strips the org-code prefix for the display label', () => {
    expect(departmentDisplayLabel('MB&B - Molecular Biophysics & Biochemistry')).toBe(
      'Molecular Biophysics & Biochemistry',
    );
    expect(departmentDisplayLabel('Chemistry')).toBe('Chemistry');
  });

  it('buckets prefixed and plain variants under the same normalized key', () => {
    expect(normalizedDepartmentLabelKey('CHEM - Chemistry')).toBe('chemistry');
    expect(normalizedDepartmentLabelKey('Chemistry')).toBe('chemistry');
    expect(normalizedDepartmentLabelKey('MB&B - Molecular Biophysics & Biochemistry')).toBe(
      normalizedDepartmentLabelKey('Molecular Biophysics and Biochemistry'),
    );
  });

  it('produces a stable slug and reverses it to the same key', () => {
    const raw = 'MB&B - Molecular Biophysics & Biochemistry';
    const slug = toDepartmentSlug(raw);
    expect(slug).toBe('molecular-biophysics-and-biochemistry');
    expect(departmentSlugToLabelKey(slug)).toBe(normalizedDepartmentLabelKey(raw));
  });

  it('rejects malformed slugs', () => {
    expect(departmentSlugToLabelKey('')).toBe('');
    expect(departmentSlugToLabelKey('-leading-hyphen')).toBe('');
    expect(departmentSlugToLabelKey('has space')).toBe('');
    expect(departmentSlugToLabelKey('../etc/passwd')).toBe('');
    expect(departmentSlugToLabelKey(42)).toBe('');
    expect(departmentSlugToLabelKey('a'.repeat(200))).toBe('');
  });

  it('flags Yale school names so they never resolve as departments', () => {
    expect(isYaleSchoolLabelKey(normalizedDepartmentLabelKey('School of Medicine'))).toBe(true);
    expect(isYaleSchoolLabelKey(normalizedDepartmentLabelKey('School of Management'))).toBe(true);
    expect(isYaleSchoolLabelKey(normalizedDepartmentLabelKey('Yale College'))).toBe(true);
    expect(isYaleSchoolLabelKey(normalizedDepartmentLabelKey('Chemistry'))).toBe(false);
    expect(isYaleSchoolLabelKey(normalizedDepartmentLabelKey('History of Art'))).toBe(false);
  });
});
