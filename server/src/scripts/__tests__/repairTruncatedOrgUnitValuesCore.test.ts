import { describe, expect, it } from 'vitest';

import {
  planTruncatedValueRepair,
  preFixDenoiseOrgUnitValue,
  summarizeTruncatedValueRepair,
  type TruncatedValueRepairEntity,
} from '../repairTruncatedOrgUnitValuesCore';

/** Canonical departments for these fixtures; everything else is an affiliation. */
const CANONICAL = new Set([
  'Operations',
  'Neurosurgery',
  'Internal Medicine',
  'Cardiovascular Medicine',
]);
const canonicalizeDepartment = (value: string): string | null =>
  CANONICAL.has(value.trim()) ? value.trim() : null;

const entity = (
  overrides: Partial<TruncatedValueRepairEntity> = {},
): TruncatedValueRepairEntity => ({
  slug: 'ysm-faculty-fixture',
  departments: ['Cardiovascular Medicine', 'Internal Medicine', 'Operations'],
  orgAffiliationLabels: [],
  studentVisibilityTier: 'student_ready',
  ...overrides,
});

const LANSKY_RAW = [
  'Cardiovascular Medicine',
  'Internal Medicine',
  'Yale Cardiovascular Research Group',
  'YCRG Operations',
];

describe('preFixDenoiseOrgUnitValue', () => {
  it('reproduces the strip that produced the stored values', () => {
    expect(preFixDenoiseOrgUnitValue('YCRG Operations')).toBe('Operations');
    expect(preFixDenoiseOrgUnitValue('MR Core')).toBe('Core');
    expect(preFixDenoiseOrgUnitValue('Internal Medicine')).toBe('Internal Medicine');
  });
});

describe('planTruncatedValueRepair', () => {
  it('removes the truncation from the facet and keeps the real departments', () => {
    const plan = planTruncatedValueRepair(entity(), LANSKY_RAW, canonicalizeDepartment);

    expect(plan.afterDepartments).toEqual(['Cardiovascular Medicine', 'Internal Medicine']);
    expect(plan.afterOrgAffiliationLabels).toEqual(['YCRG Operations']);
    expect(plan.repairs).toEqual([
      {
        raw: 'YCRG Operations',
        truncated: 'Operations',
        placement: 'affiliation',
        field: 'departments',
      },
    ]);
  });

  it('is a no-op on a second run over its own output', () => {
    const first = planTruncatedValueRepair(entity(), LANSKY_RAW, canonicalizeDepartment);
    expect(first.changed).toBe(true);

    const second = planTruncatedValueRepair(
      entity({
        departments: first.afterDepartments,
        orgAffiliationLabels: first.afterOrgAffiliationLabels,
      }),
      LANSKY_RAW,
      canonicalizeDepartment,
    );

    expect(second.changed).toBe(false);
    expect(second.update).toEqual({});
  });

  it('never removes a truncation another raw value independently asserts', () => {
    // ysm-faculty-joseph-king: the observation carries both "Neurosurgery" and
    // "VA Neurosurgery", so the stored "Neurosurgery" is real and removing it
    // would delete a department the row genuinely belongs to.
    const plan = planTruncatedValueRepair(
      entity({ departments: ['Neurosurgery'], studentVisibilityTier: 'operator_review' }),
      ['Neurosurgery', 'Spine Surgery', 'VA Neurosurgery', 'Yale Ventures'],
      canonicalizeDepartment,
    );

    expect(plan.changed).toBe(false);
    expect(plan.afterDepartments).toEqual(['Neurosurgery']);
    expect(plan.skippedIndependent).toEqual([
      { raw: 'VA Neurosurgery', truncated: 'Neurosurgery' },
    ]);
  });

  it('restores a truncated affiliation label without touching the facet', () => {
    const plan = planTruncatedValueRepair(
      entity({ departments: ['Internal Medicine'], orgAffiliationLabels: ['Core'] }),
      ['Internal Medicine', 'MR Core'],
      canonicalizeDepartment,
    );

    expect(plan.afterDepartments).toEqual(['Internal Medicine']);
    expect(plan.afterOrgAffiliationLabels).toEqual(['MR Core']);
    expect(plan.update).not.toHaveProperty('departments');
  });

  it('puts a restored value back in the facet when it is itself a real department', () => {
    const plan = planTruncatedValueRepair(
      entity({ departments: ['Operations'], orgAffiliationLabels: [] }),
      ['XYZABC Operations'],
      // The restored form resolves to a department in this fixture.
      (value) => (value === 'XYZABC Operations' ? 'Operations' : canonicalizeDepartment(value)),
    );

    expect(plan.afterDepartments).toEqual(['Operations']);
    expect(plan.changed).toBe(false);
  });

  it('leaves a genuine HR code truncation alone, because the short form is correct', () => {
    const plan = planTruncatedValueRepair(
      entity({ departments: ['Medical Oncology'], orgAffiliationLabels: [] }),
      ['MEDCCC Medical Oncology'],
      canonicalizeDepartment,
    );

    expect(plan.changed).toBe(false);
    expect(plan.repairs).toEqual([]);
  });
});

describe('summarizeTruncatedValueRepair', () => {
  it('counts facet repairs separately from affiliation repairs', () => {
    const facet = planTruncatedValueRepair(entity(), LANSKY_RAW, canonicalizeDepartment);
    const label = planTruncatedValueRepair(
      entity({ slug: 'other', departments: ['Internal Medicine'], orgAffiliationLabels: ['Core'] }),
      ['Internal Medicine', 'MR Core'],
      canonicalizeDepartment,
    );

    expect(summarizeTruncatedValueRepair([facet, label])).toEqual({
      scanned: 2,
      changed: 2,
      departmentRepairs: 1,
      affiliationRepairs: 1,
      skippedIndependent: 0,
      servedChanged: 2,
    });
  });
});
