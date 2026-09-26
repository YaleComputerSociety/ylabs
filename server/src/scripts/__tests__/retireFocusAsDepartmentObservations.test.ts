import { describe, expect, it } from 'vitest';
import {
  buildFocusNamePredicate,
  NEVER_A_HOME_DEPARTMENT_VALUES,
  parseRetireFocusAsDepartmentArgs,
  CONFIRM_FLAG,
} from '../retireFocusAsDepartmentObservations';

const catalog = [
  { name: 'Biostatistics', kind: 'DEPARTMENT' },
  { name: 'Environmental Health Sciences', kind: 'DEPARTMENT' },
  { name: 'Digestive Diseases', kind: 'SECTION' },
];

describe('buildFocusNamePredicate', () => {
  it('matches every value on the closed list', () => {
    const isFocus = buildFocusNamePredicate(catalog);
    for (const value of NEVER_A_HOME_DEPARTMENT_VALUES) {
      expect(isFocus(value)).toBe(true);
    }
  });

  it('never matches a real department or section', () => {
    const isFocus = buildFocusNamePredicate(catalog);
    expect(isFocus('Biostatistics')).toBe(false);
    expect(isFocus('Digestive Diseases')).toBe(false);
  });

  it('stops matching a focus the catalog has promoted to a department', () => {
    const isFocus = buildFocusNamePredicate([
      ...catalog,
      { name: 'Global Health', kind: 'DEPARTMENT' },
    ]);
    expect(isFocus('Global Health')).toBe(false);
    expect(isFocus('Public Health Modeling')).toBe(true);
  });

  it('leaves an uncatalogued value that is not on the list alone, since it is usually a real division', () => {
    const isFocus = buildFocusNamePredicate(catalog);
    expect(isFocus('Rheumatology')).toBe(false);
    expect(isFocus('Otolaryngology Surgery')).toBe(false);
    expect(isFocus('')).toBe(false);
  });

  it('matches regardless of casing, as the org-unit key does', () => {
    const isFocus = buildFocusNamePredicate(catalog);
    expect(isFocus('global health')).toBe(true);
    expect(isFocus('GLOBAL HEALTH')).toBe(true);
  });

  it('covers the period-free spelling too, which does not share a key with the published one', () => {
    const isFocus = buildFocusNamePredicate(catalog);
    expect(isFocus('U.S. Health Justice')).toBe(true);
    expect(isFocus('US Health Justice')).toBe(true);
  });
});

describe('parseRetireFocusAsDepartmentArgs', () => {
  it('defaults to a dry run that is not confirmed', () => {
    expect(parseRetireFocusAsDepartmentArgs([])).toEqual({ dryRun: true, confirmed: false });
  });

  it('requires the explicit confirm flag alongside apply', () => {
    expect(parseRetireFocusAsDepartmentArgs(['--apply', CONFIRM_FLAG])).toMatchObject({
      dryRun: false,
      confirmed: true,
    });
  });

  it('refuses an unknown argument rather than ignoring it', () => {
    expect(() => parseRetireFocusAsDepartmentArgs(['--wipe'])).toThrow(/Unknown/);
  });
});
