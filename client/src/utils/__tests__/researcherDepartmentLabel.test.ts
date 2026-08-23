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
];

describe('canonicalizeResearcherDepartmentLabel', () => {
  it('strips a leading HR org code and admin suffix, then maps to a configured department', () => {
    expect(
      canonicalizeResearcherDepartmentLabel('FASPHY Physics Business Operations', departmentTable),
    ).toBe('Physics');
  });

  it('strips the "-All" administrative qualifier before mapping', () => {
    expect(canonicalizeResearcherDepartmentLabel('MEDGEN Genetics-All', departmentTable)).toBe(
      'Genetics',
    );
    expect(
      canonicalizeResearcherDepartmentLabel('MEDNSG Neurosurgery - All', departmentTable),
    ).toBeNull();
  });

  it('resolves the "CODE - Name" shape through the config table', () => {
    expect(canonicalizeResearcherDepartmentLabel('INMD - Internal Medicine', departmentTable)).toBe(
      'Internal Medicine',
    );
  });

  it('drops HR org-unit chrome that does not resolve to a real department', () => {
    expect(
      canonicalizeResearcherDepartmentLabel('EASAPP Research Unit', departmentTable),
    ).toBeNull();
    expect(
      canonicalizeResearcherDepartmentLabel('MEDPSY Psych Divisions-CNRU', departmentTable),
    ).toBeNull();
    expect(
      canonicalizeResearcherDepartmentLabel('MEDPED Critical Care', departmentTable),
    ).toBeNull();
  });

  it('passes through an already-clean department unchanged', () => {
    expect(canonicalizeResearcherDepartmentLabel('Physics', departmentTable)).toBe('Physics');
    expect(canonicalizeResearcherDepartmentLabel('Cellular Biology', departmentTable)).toBe(
      'Cell Biology',
    );
  });

  it('trusts a coded value that matches one of the entity clean departments', () => {
    expect(
      canonicalizeResearcherDepartmentLabel('MEDNSC Neurosurgery', departmentTable, [
        'Neurosurgery',
      ]),
    ).toBe('Neurosurgery');
  });

  it('strips a leading org code whose remainder is an all-caps acronym, then resolves it', () => {
    expect(
      canonicalizeResearcherDepartmentLabel('FASMCD MCDB', [
        {
          abbreviation: 'MCDB',
          name: 'Molecular, Cellular, and Developmental Biology',
          displayName: 'MCDB - Molecular, Cellular, and Developmental Biology',
        },
      ]),
    ).toBe('Molecular, Cellular, and Developmental Biology');
  });

  it('trusts an all-caps remainder that matches one of the entity clean departments', () => {
    expect(canonicalizeResearcherDepartmentLabel('MEDNSC MRI', departmentTable, ['MRI'])).toBe(
      'MRI',
    );
  });

  it('drops an org code whose all-caps remainder resolves to no real department', () => {
    expect(canonicalizeResearcherDepartmentLabel('MEDCSC TS/OCD/ADHD', departmentTable)).toBeNull();
    expect(canonicalizeResearcherDepartmentLabel('FASMCD MCDB', departmentTable)).toBeNull();
  });

  it('drops bare administrative units and empty input', () => {
    expect(canonicalizeResearcherDepartmentLabel('Administration', departmentTable)).toBeNull();
    expect(canonicalizeResearcherDepartmentLabel('  ', departmentTable)).toBeNull();
    expect(canonicalizeResearcherDepartmentLabel(undefined, departmentTable)).toBeNull();
  });
});
