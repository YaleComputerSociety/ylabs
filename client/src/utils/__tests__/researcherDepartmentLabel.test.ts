import { describe, expect, it } from 'vitest';

import { canonicalizeResearcherDepartmentLabel } from '../researcherDepartmentLabel';
import type { DepartmentNameRecord } from '../departmentNames';

const departmentTable: DepartmentNameRecord[] = [
  { abbreviation: 'PHYS', name: 'Physics', displayName: 'PHYS - Physics' },
  { abbreviation: 'GENE', name: 'Genetics', displayName: 'GENE - Genetics' },
  { abbreviation: 'INMD', name: 'Internal Medicine', displayName: 'INMD - Internal Medicine' },
  {
    abbreviation: 'CBIO',
    name: 'Cell Biology',
    displayName: 'CBIO - Cell Biology',
    aliases: ['Cellular Biology'],
  },
  {
    abbreviation: 'MCDB',
    name: 'Molecular, Cellular, and Developmental Biology',
    displayName: 'MCDB - Molecular, Cellular, and Developmental Biology',
  },
  { abbreviation: 'LAW', name: 'Law', displayName: 'LAW - Law' },
];

const pillEligibleLabels = [
  'Physics',
  'Genetics',
  'Internal Medicine',
  'Cell Biology',
  'Cellular Biology',
  'Molecular, Cellular, and Developmental Biology',
  'MCDB',
  'Digestive Diseases',
  'Germanic Languages and Literatures',
];

const canonicalize = (
  raw: string | undefined | null,
  table: DepartmentNameRecord[] | undefined = departmentTable,
  entityDepartments: Array<string | undefined | null> = [],
) => canonicalizeResearcherDepartmentLabel(raw, table, { pillEligibleLabels, entityDepartments });

describe('canonicalizeResearcherDepartmentLabel', () => {
  it('strips a leading HR org code and admin suffix, then maps to a configured department', () => {
    expect(canonicalize('FASPHY Physics Business Operations')).toBe('Physics');
  });

  it('strips the "-All" administrative qualifier before mapping', () => {
    expect(canonicalize('MEDGEN Genetics-All')).toBe('Genetics');
    expect(canonicalize('MEDNSG Neurosurgery - All')).toBeNull();
  });

  it('resolves the "CODE - Name" shape through the config table', () => {
    expect(canonicalize('INMD - Internal Medicine')).toBe('Internal Medicine');
  });

  it('drops HR org-unit chrome that does not resolve to a real department', () => {
    expect(canonicalize('EASAPP Research Unit')).toBeNull();
    expect(canonicalize('MEDPSY Psych Divisions-CNRU')).toBeNull();
    expect(canonicalize('MEDPED Critical Care')).toBeNull();
  });

  it('strips a leading org code with an all-caps remainder that resolves to a real department', () => {
    expect(canonicalize('FASMCD MCDB')).toBe('Molecular, Cellular, and Developmental Biology');
    expect(
      canonicalizeResearcherDepartmentLabel('FASMCD MCDB', undefined, { pillEligibleLabels }),
    ).toBe('MCDB');
  });

  it('drops a leading org code whose all-caps remainder does not resolve to a real department', () => {
    expect(canonicalize('MEDCSC TS/OCD/ADHD')).toBeNull();
  });

  it('passes through an already-clean department that the org-unit catalog knows', () => {
    expect(canonicalize('Physics')).toBe('Physics');
    expect(canonicalize('Cellular Biology')).toBe('Cell Biology');
  });

  it('trusts a coded value that matches one of the entity clean departments', () => {
    expect(canonicalize('MEDNSC Neurosurgery', departmentTable, ['Neurosurgery'])).toBe(
      'Neurosurgery',
    );
  });

  it('drops bare administrative units and empty input', () => {
    expect(canonicalize('Administration')).toBeNull();
    expect(canonicalize('  ')).toBeNull();
    expect(canonicalize(undefined)).toBeNull();
  });

  it('hides a school even though the local name table carries it, since a school is not a department', () => {
    expect(canonicalize('Law')).toBeNull();
    expect(canonicalize('LAW - Law')).toBeNull();
  });

  it('shows a department the org-unit catalog knows but the local name table omits', () => {
    expect(canonicalize('Germanic Languages & Literatures')).toBe(
      'Germanic Languages & Literatures',
    );
  });

  it('shows a clinical section, which is a real appointment a student narrows to', () => {
    expect(canonicalize('Digestive Diseases')).toBe('Digestive Diseases');
  });

  it('hides a clean-looking value that names no org unit, which the old chrome shortcut passed', () => {
    expect(canonicalize('West Campus Institutes')).toBeNull();
    expect(canonicalize('Janeway Society')).toBeNull();
    expect(canonicalize('Rheumatology')).toBeNull();
  });

  it('strips a leading unit noun, so the same department is not hidden over a prefix', () => {
    expect(canonicalize('Department of Physics')).toBe('Physics');
    expect(canonicalize('The Department of Physics')).toBe('Physics');
    expect(canonicalize('Division of Digestive Diseases')).toBe('Digestive Diseases');
  });

  it('hides everything when the eligible-label authority failed to load, rather than guessing', () => {
    expect(
      canonicalizeResearcherDepartmentLabel('Physics', departmentTable, {
        pillEligibleLabels: [],
      }),
    ).toBeNull();
  });
});
