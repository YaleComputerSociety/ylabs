import { describe, expect, it } from 'vitest';
import { buildEntityRepairPlan, parseArgs } from '../repairJulyLegacyMedicineImport';

describe('repairJulyLegacyMedicineImport', () => {
  it('restores erased descriptions and collapsed departments', () => {
    const plan = buildEntityRepairPlan(
      {
        slug: 'ysm-vaccarino',
        name: 'Vaccarino Lab',
        description: '',
        fullDescription: '',
        shortDescription: '',
        departments: ['Yale School of Medicine'],
        schools: ['Yale School of Medicine'],
        sourceUrls: ['https://medicine.yale.edu/lab/vaccarino/'],
        fieldProvenance: {
          description: { sourceName: 'root-yale-medicine-labs-json' },
        },
      },
      {
        slug: 'ysm-vaccarino',
        name: 'Vaccarino Lab',
        description: 'A source-backed description.',
        fullDescription: 'A source-backed description.',
        shortDescription: 'Source-backed summary.',
        departments: ['Child Study Center', 'Yale School of Medicine'],
        schools: [],
        sourceUrls: ['https://medicine.yale.edu/lab/vaccarino/'],
      },
    );

    expect(plan.repairs.map((repair) => repair.field)).toEqual([
      'shortDescription',
      'description',
      'fullDescription',
      'departments',
    ]);
  });

  it('preserves any non-empty Beta description when production merely differs', () => {
    const plan = buildEntityRepairPlan(
      {
        slug: 'ysm-example',
        name: 'Example Lab',
        description: 'A newer and detailed Beta description of the lab research.',
        departments: ['Genetics'],
        sourceUrls: [],
        fieldProvenance: { description: { sourceName: 'ysm-atoz-index' } },
      },
      {
        slug: 'ysm-example',
        name: 'Example Lab',
        description:
          'A much longer production biography that is not necessarily a better lab description and must not replace populated Beta evidence.',
        departments: ['Genetics'],
        sourceUrls: [],
      },
    );

    expect(plan.repairs).toEqual([]);
  });

  it('requires explicit confirmation for apply mode', () => {
    expect(() => parseArgs(['--apply'])).toThrow(
      /--confirm-july-legacy-medicine-repair is required/,
    );
  });
});
