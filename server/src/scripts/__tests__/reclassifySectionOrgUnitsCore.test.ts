import { describe, expect, it } from 'vitest';
import { planSectionReclassification } from '../reclassifySectionOrgUnitsCore';

const school = {
  id: 'school',
  slug: 'yale-school-of-medicine',
  name: 'Yale School of Medicine',
  kind: 'SCHOOL' as const,
};

const internalMedicine = {
  id: 'internal-medicine',
  slug: 'internal-medicine',
  name: 'Internal Medicine',
  kind: 'DEPARTMENT' as const,
  parentOrgUnitId: 'school',
};

describe('planSectionReclassification', () => {
  it('reclassifies a department parented to another department', () => {
    const plan = planSectionReclassification([
      school,
      internalMedicine,
      {
        id: 'digestive-diseases',
        slug: 'digestive-diseases',
        name: 'Digestive Diseases',
        kind: 'DEPARTMENT',
        parentOrgUnitId: 'internal-medicine',
      },
    ]);
    expect(plan.reclassified).toEqual([
      {
        id: 'digestive-diseases',
        slug: 'digestive-diseases',
        name: 'Digestive Diseases',
        fromKind: 'DEPARTMENT',
        parentName: 'Internal Medicine',
        schoolName: 'Yale School of Medicine',
      },
    ]);
    expect(plan.scanned).toBe(3);
  });

  it('leaves a department parented directly to its school alone', () => {
    const plan = planSectionReclassification([school, internalMedicine]);
    expect(plan.reclassified).toEqual([]);
  });

  it('leaves a division-parented department alone', () => {
    const plan = planSectionReclassification([
      { id: 'fas', slug: 'fas', name: 'Faculty of Arts and Sciences', kind: 'DIVISION' },
      {
        id: 'history',
        slug: 'history',
        name: 'History',
        kind: 'DEPARTMENT',
        parentOrgUnitId: 'fas',
      },
    ]);
    expect(plan.reclassified).toEqual([]);
  });

  it('counts an already-reclassified section instead of re-planning it', () => {
    const plan = planSectionReclassification([
      school,
      internalMedicine,
      {
        id: 'digestive-diseases',
        slug: 'digestive-diseases',
        name: 'Digestive Diseases',
        kind: 'SECTION',
        parentOrgUnitId: 'internal-medicine',
      },
    ]);
    expect(plan.reclassified).toEqual([]);
    expect(plan.alreadySection).toBe(1);
  });

  it('names the nearest department when the chain nests two deep', () => {
    const plan = planSectionReclassification([
      school,
      internalMedicine,
      {
        id: 'digestive-diseases',
        slug: 'digestive-diseases',
        name: 'Digestive Diseases',
        kind: 'SECTION',
        parentOrgUnitId: 'internal-medicine',
      },
      {
        id: 'advanced-endoscopy',
        slug: 'advanced-endoscopy',
        name: 'Advanced Endoscopy',
        kind: 'DEPARTMENT',
        parentOrgUnitId: 'digestive-diseases',
      },
    ]);
    expect(plan.reclassified.map((row) => [row.slug, row.parentName])).toEqual([
      ['advanced-endoscopy', 'Digestive Diseases'],
    ]);
  });

  it('reports a parent cycle instead of following it', () => {
    const plan = planSectionReclassification([
      { id: 'a', slug: 'a', name: 'A', kind: 'DEPARTMENT', parentOrgUnitId: 'b' },
      { id: 'b', slug: 'b', name: 'B', kind: 'DEPARTMENT', parentOrgUnitId: 'a' },
    ]);
    expect(plan.reclassified).toEqual([]);
    expect(plan.cycles.sort()).toEqual(['a', 'b']);
  });

  it('skips a department whose parent is missing from the catalog', () => {
    const plan = planSectionReclassification([
      {
        id: 'stranded',
        slug: 'stranded',
        name: 'Stranded',
        kind: 'DEPARTMENT',
        parentOrgUnitId: 'gone',
      },
    ]);
    expect(plan.reclassified).toEqual([]);
  });
});
