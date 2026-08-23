import { describe, expect, it } from 'vitest';

import {
  planVacuousFocusRepairRow,
  summarizeVacuousFocusRepair,
} from '../repairVacuousFocusShortDescriptionsCore';

describe('planVacuousFocusRepairRow', () => {
  it('rebuilds a vacuous "Studies the field." card from research areas', () => {
    const row = planVacuousFocusRepairRow({
      id: '1',
      slug: 'makuch-lab',
      shortDescription: 'Studies the field.',
      researchAreas: ['Biostatistics', 'Public Health', 'Cancer Research', 'Clinical Trials'],
    });
    expect(row.changed).toBe(true);
    expect(row.after).toBe(
      'Studies Biostatistics, Public Health, Cancer Research, and Clinical Trials.',
    );
  });

  it('leaves a genuinely specific short description untouched', () => {
    const row = planVacuousFocusRepairRow({
      id: '2',
      slug: 'good-lab',
      shortDescription: 'Studies liver diseases.',
      researchAreas: ['Hepatology'],
    });
    expect(row.changed).toBe(false);
    expect(row.after).toBe('Studies liver diseases.');
  });

  it('fails closed when the vacuous card has no usable research areas', () => {
    const row = planVacuousFocusRepairRow({
      id: '3',
      slug: 'empty-lab',
      shortDescription: 'Studies the organism.',
      researchAreas: [],
    });
    expect(row.changed).toBe(false);
    expect(row.after).toBe('Studies the organism.');
  });
});

describe('summarizeVacuousFocusRepair', () => {
  it('counts considered, vacuous, changed, and unresolved rows', () => {
    const rows = [
      planVacuousFocusRepairRow({
        id: '1',
        shortDescription: 'Studies the field.',
        researchAreas: ['Biostatistics', 'Public Health'],
      }),
      planVacuousFocusRepairRow({
        id: '2',
        shortDescription: 'Studies the organism.',
        researchAreas: [],
      }),
      planVacuousFocusRepairRow({
        id: '3',
        shortDescription: 'Studies liver diseases.',
        researchAreas: ['Hepatology'],
      }),
    ];
    expect(summarizeVacuousFocusRepair(rows)).toEqual({
      considered: 3,
      vacuous: 2,
      changed: 1,
      unresolved: 1,
    });
  });
});
