import { describe, expect, it } from 'vitest';
import { researcherPersonPagePath } from '../researcherPersonPage';

describe('researcherPersonPagePath', () => {
  it('builds a person page path for a personId-backed public key', () => {
    expect(researcherPersonPagePath('a1b2c3d4e5f6a1b2c3d4e5f6-pi')).toBe(
      '/research/person/a1b2c3d4e5f6a1b2c3d4e5f6-pi',
    );
  });

  it('accepts a bare personId hex key with no role suffix', () => {
    expect(researcherPersonPagePath('a1b2c3d4e5f6a1b2c3d4e5f6')).toBe(
      '/research/person/a1b2c3d4e5f6a1b2c3d4e5f6',
    );
  });

  it('returns undefined for a display-name-only key', () => {
    expect(researcherPersonPagePath('jane-doe-pi')).toBeUndefined();
  });

  it('returns undefined for missing or empty keys', () => {
    expect(researcherPersonPagePath(undefined)).toBeUndefined();
    expect(researcherPersonPagePath('')).toBeUndefined();
  });
});
