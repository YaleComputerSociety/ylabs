import { describe, expect, it } from 'vitest';
import { schoolSlugToQuery, toSchoolSlug } from '../schoolSlug';

describe('toSchoolSlug', () => {
  it('slugifies a canonical school name', () => {
    expect(toSchoolSlug('School of Medicine')).toBe('school-of-medicine');
    expect(toSchoolSlug('School of the Environment')).toBe('school-of-the-environment');
    expect(toSchoolSlug('David Geffen School of Drama')).toBe('david-geffen-school-of-drama');
  });
});

describe('schoolSlugToQuery', () => {
  it('turns a plausible slug back into a query string', () => {
    expect(schoolSlugToQuery('school-of-medicine')).toBe('school of medicine');
    expect(schoolSlugToQuery('law-school')).toBe('law school');
  });

  it('returns an empty string for a malformed or non-string slug', () => {
    expect(schoolSlugToQuery('')).toBe('');
    expect(schoolSlugToQuery('..')).toBe('');
    expect(schoolSlugToQuery('has space')).toBe('');
    expect(schoolSlugToQuery(null)).toBe('');
    expect(schoolSlugToQuery(`${'a'.repeat(200)}`)).toBe('');
  });
});
