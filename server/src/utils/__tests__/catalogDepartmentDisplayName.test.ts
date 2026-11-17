import { describe, expect, it } from 'vitest';
import {
  buildOrgUnitResolverIndex,
  createOrgUnitCanonicalizer,
} from '../../scrapers/orgUnitCanonicalization';
import {
  catalogDepartmentDisplayName,
  withCatalogDepartmentName,
} from '../catalogDepartmentDisplayName';

const catalog = createOrgUnitCanonicalizer(
  buildOrgUnitResolverIndex([
    {
      slug: 'english',
      name: 'English Language & Literature',
      kind: 'DEPARTMENT',
      aliases: ['English'],
    },
    {
      slug: 'eeb',
      name: 'Ecology & Evolutionary Biology',
      kind: 'DEPARTMENT',
      aliases: ['Ecology and Evolutionary Biology'],
    },
    { slug: 'school-of-medicine', name: 'School of Medicine', kind: 'SCHOOL' },
  ]),
);

describe('the department a member card serves (#6380)', () => {
  it('serves the catalog name for a spelling the catalog resolves', () => {
    expect(catalogDepartmentDisplayName(catalog, 'English')).toBe('English Language & Literature');
    expect(catalogDepartmentDisplayName(catalog, 'Ecology and Evolutionary Biology')).toBe(
      'Ecology & Evolutionary Biology',
    );
  });

  it('passes a value the catalog does not resolve through unchanged', () => {
    expect(catalogDepartmentDisplayName(catalog, 'Synthetic Unlisted Program')).toBe(
      'Synthetic Unlisted Program',
    );
    expect(catalogDepartmentDisplayName(catalog, 'School of Medicine')).toBe('School of Medicine');
    expect(catalogDepartmentDisplayName(catalog, '')).toBe('');
    expect(catalogDepartmentDisplayName(catalog, undefined)).toBeUndefined();
  });

  it('passes every value through when the catalog is unavailable', () => {
    const empty = createOrgUnitCanonicalizer(new Map());
    expect(catalogDepartmentDisplayName(empty, 'English')).toBe('English');
  });

  it('rewrites both served department keys and leaves a card without one untouched', () => {
    expect(
      withCatalogDepartmentName(catalog, {
        displayName: 'Synthetic Member',
        primaryDepartment: 'English',
        primary_department: 'English',
      }),
    ).toEqual({
      displayName: 'Synthetic Member',
      primaryDepartment: 'English Language & Literature',
      primary_department: 'English Language & Literature',
    });
    const withoutDepartment = { displayName: 'Synthetic Member' };
    expect(withCatalogDepartmentName(catalog, withoutDepartment)).toBe(withoutDepartment);
  });
});
