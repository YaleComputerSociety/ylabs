import { describe, expect, it } from 'vitest';
import {
  buildOrgUnitSeedRows,
  validateOrgUnitRows,
  type OrgUnitSeedRow,
} from '../../../../data-migration/orgUnitGroundTruth';
import {
  assertOrgUnitSeedApplyAllowed,
  parseOrgUnitSeedArgs,
} from '../../../../data-migration/seedOrgUnits';
import {
  buildOrgUnitResolverIndex,
  resolveOrgUnitCanonical,
} from '../../scrapers/orgUnitCanonicalization';

const rows = buildOrgUnitSeedRows();
const index = buildOrgUnitResolverIndex(rows);

describe('buildOrgUnitSeedRows', () => {
  it('produces a valid, collision-free ground truth', () => {
    expect(validateOrgUnitRows(rows)).toEqual([]);
    expect(rows.length).toBeGreaterThan(50);
  });

  it('seeds canonical Yale schools and departments', () => {
    const bySlug = new Map(rows.map((row) => [row.slug, row]));
    expect(bySlug.get('yale-school-of-medicine')?.kind).toBe('SCHOOL');
    expect(bySlug.get('neuroscience')?.kind).toBe('DEPARTMENT');
    expect(bySlug.get('computer-science')?.kind).toBe('DEPARTMENT');
  });

  it('never emits a department row that actually names a school', () => {
    const schoolNames = new Set(
      rows.filter((row) => row.kind === 'SCHOOL').map((row) => row.name.toLowerCase()),
    );
    for (const row of rows.filter((entry) => entry.kind === 'DEPARTMENT')) {
      expect(schoolNames.has(row.name.toLowerCase())).toBe(false);
    }
  });

  it('parents School of Medicine departments under the school', () => {
    const neuroscience = rows.find((row) => row.slug === 'neuroscience');
    expect(neuroscience?.parentSlug).toBe('yale-school-of-medicine');
  });

  it('seeds School of Management research disciplines under the school (#1377)', () => {
    const bySlug = new Map(rows.map((row) => [row.slug, row]));
    for (const slug of [
      'finance',
      'marketing',
      'accounting',
      'operations',
      'organizational-behavior',
    ]) {
      expect(bySlug.get(slug)?.kind).toBe('DEPARTMENT');
      expect(bySlug.get(slug)?.parentSlug).toBe('yale-school-of-management');
    }
  });

  it('reuses the shared Economics department for the SOM economics discipline', () => {
    const economics = rows.filter((row) => row.slug === 'economics');
    expect(economics).toHaveLength(1);
  });

  it('parents School of Public Health departments under the school (#1377)', () => {
    const biostatistics = rows.find((row) => row.slug === 'biostatistics');
    expect(biostatistics?.kind).toBe('DEPARTMENT');
    expect(biostatistics?.parentSlug).toBe('yale-school-of-public-health');
  });
});

describe('resolveOrgUnitCanonical over the full ground truth', () => {
  it('canonicalizes fragmented department and school strings', () => {
    expect(resolveOrgUnitCanonical(index, 'Dept. of Physics', ['DEPARTMENT'])?.name).toBe(
      'Physics',
    );
    expect(resolveOrgUnitCanonical(index, 'Computer Science', ['DEPARTMENT'])?.slug).toBe(
      'computer-science',
    );
    expect(resolveOrgUnitCanonical(index, 'School of Medicine', ['SCHOOL', 'DIVISION'])?.name).toBe(
      'Yale School of Medicine',
    );
    expect(resolveOrgUnitCanonical(index, 'YSM', ['SCHOOL', 'DIVISION'])?.slug).toBe(
      'yale-school-of-medicine',
    );
    expect(
      resolveOrgUnitCanonical(index, 'Yale Jackson School of Global Affairs', [
        'SCHOOL',
        'DIVISION',
      ])?.name,
    ).toBe('Jackson School of Global Affairs');
  });

  it('fails closed on an unknown unit', () => {
    expect(resolveOrgUnitCanonical(index, 'Department of Wizardry')).toBeNull();
  });

  it('resolves School of Management disciplines as navigable departments (#1377)', () => {
    expect(resolveOrgUnitCanonical(index, 'Finance', ['DEPARTMENT'])?.slug).toBe('finance');
    expect(resolveOrgUnitCanonical(index, 'Organizational Behavior', ['DEPARTMENT'])?.slug).toBe(
      'organizational-behavior',
    );
  });

  it('resolves HR-coded and all-caps facet variants through overlay aliases', () => {
    expect(resolveOrgUnitCanonical(index, 'PHYSIOLOGY', ['DEPARTMENT'])?.name).toBe(
      'Cellular & Molecular Physiology',
    );
    expect(
      resolveOrgUnitCanonical(index, 'RADIATION-DIAGNOSTIC/ONCOLOGY', ['DEPARTMENT'])?.name,
    ).toBe('Therapeutic Radiology');
    expect(resolveOrgUnitCanonical(index, 'EASBME BME Faculty', ['DEPARTMENT'])?.name).toBe(
      'Biomedical Engineering',
    );
    expect(
      resolveOrgUnitCanonical(index, 'FASGSS Womens,Gender and Sexuality Studies', ['DEPARTMENT'])
        ?.name,
    ).toBe("Women's, Gender, and Sexuality Studies");
    expect(
      resolveOrgUnitCanonical(index, 'ISM Institute of Sacred Music', ['SCHOOL', 'DIVISION'])?.name,
    ).toBe('Yale Institute of Sacred Music');
  });
});

describe('validateOrgUnitRows', () => {
  it('flags a resolver-key collision between two units', () => {
    const colliding: OrgUnitSeedRow[] = [
      {
        slug: 'a',
        name: 'Neuroscience',
        kind: 'DEPARTMENT',
        aliases: [],
        status: 'ACTIVE',
        archived: false,
      },
      {
        slug: 'b',
        name: 'Neuroscience',
        kind: 'DEPARTMENT',
        aliases: [],
        status: 'ACTIVE',
        archived: false,
      },
    ];
    expect(validateOrgUnitRows(colliding).some((error) => error.includes('collision'))).toBe(true);
  });

  it('flags an unseeded parent slug', () => {
    const orphan: OrgUnitSeedRow[] = [
      {
        slug: 'a',
        name: 'A',
        kind: 'DEPARTMENT',
        aliases: [],
        parentSlug: 'missing',
        status: 'ACTIVE',
        archived: false,
      },
    ];
    expect(validateOrgUnitRows(orphan).some((error) => error.includes('parentSlug'))).toBe(true);
  });
});

describe('org-unit seed CLI safety', () => {
  it('parses flags', () => {
    expect(parseOrgUnitSeedArgs([])).toEqual({ apply: false });
    expect(parseOrgUnitSeedArgs(['--apply', '--confirm-seed-apply'])).toEqual({
      apply: true,
      confirmSeedApply: true,
    });
    expect(() => parseOrgUnitSeedArgs(['--nope'])).toThrow(/Unknown org-unit seed argument/);
  });

  it('requires --confirm-seed-apply before applying', () => {
    expect(() =>
      assertOrgUnitSeedApplyAllowed({
        apply: true,
        mongoUrl: 'mongodb://localhost:27017/ylabs-dev',
        env: { SCRAPER_ENV: 'development' } as NodeJS.ProcessEnv,
      }),
    ).toThrow(/--confirm-seed-apply is required/);
  });

  it('allows a confirmed non-production apply and a dry run', () => {
    expect(() =>
      assertOrgUnitSeedApplyAllowed({
        apply: true,
        confirmSeedApply: true,
        mongoUrl: 'mongodb://localhost:27017/ylabs-dev',
        env: { SCRAPER_ENV: 'development' } as NodeJS.ProcessEnv,
      }),
    ).not.toThrow();
    expect(() =>
      assertOrgUnitSeedApplyAllowed({
        apply: false,
        mongoUrl: 'mongodb://localhost:27017/ylabs-dev',
        env: { SCRAPER_ENV: 'development' } as NodeJS.ProcessEnv,
      }),
    ).not.toThrow();
  });
});
