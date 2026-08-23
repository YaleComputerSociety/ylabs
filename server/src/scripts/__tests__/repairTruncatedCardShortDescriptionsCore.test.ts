import { describe, expect, it } from 'vitest';

import {
  planTruncatedCardRepairRow,
  summarizeTruncatedCardRepair,
} from '../repairTruncatedCardShortDescriptionsCore';

describe('planTruncatedCardRepairRow', () => {
  it('rebuilds a card that was truncated mid-word from the full description', async () => {
    const fullDescription =
      'Studies distributed systems and protocol design, analyzing efficiency, privacy, and computational power using theoretical and algorithmic methods.';
    const row = await planTruncatedCardRepairRow({
      id: '1',
      slug: 'dept-cs-example',
      shortDescription:
        'Studies distributed systems and protocol design, analyzing efficiency, privacy, and computational power using theoretical and algorithmi',
      fullDescription,
    });

    expect(row.truncated).toBe(true);
    expect(row.changed).toBe(true);
    expect(row.after.endsWith('.')).toBe(true);
    expect(row.after).not.toBe(row.before);
  });

  it('rebuilds a card that dangles mid-sentence after a period', async () => {
    const fullDescription =
      'Studies chronic respiratory disease, including COPD, Sarcoidosis, and Asthma. His clinical work spans pulmonary and critical care medicine.';
    const row = await planTruncatedCardRepairRow({
      id: '2',
      slug: 'ysm-example',
      shortDescription:
        'Studies chronic respiratory disease, including COPD, Sarcoidosis, and Asthma. His',
      fullDescription,
    });

    expect(row.truncated).toBe(true);
    expect(row.changed).toBe(true);
    expect(row.after.endsWith('.')).toBe(true);
  });

  it('leaves a complete, gate-passing card untouched', async () => {
    const fullDescription = 'Studies liver diseases and their molecular drivers.';
    const row = await planTruncatedCardRepairRow({
      id: '3',
      slug: 'good-lab',
      shortDescription: 'Studies liver diseases.',
      fullDescription,
    });

    expect(row.truncated).toBe(false);
    expect(row.changed).toBe(false);
    expect(row.after).toBe('Studies liver diseases.');
  });

  it('fails closed and leaves the truncated card when no clean replacement can be derived', async () => {
    const row = await planTruncatedCardRepairRow({
      id: '4',
      slug: 'thin-lab',
      shortDescription: 'Contact the department chair at the address listed on our site',
      fullDescription: '',
      researchAreas: [],
    });

    expect(row.truncated).toBe(true);
    expect(row.changed).toBe(false);
    expect(row.after).toBe(row.before);
  });
});

describe('summarizeTruncatedCardRepair', () => {
  it('counts considered, truncated, changed, and unresolved rows', async () => {
    const rows = [
      await planTruncatedCardRepairRow({
        id: '1',
        shortDescription:
          'Studies distributed systems and protocol design, analyzing efficiency, privacy, and computational power using theoretical and algorithmi',
        fullDescription:
          'Studies distributed systems and protocol design, analyzing efficiency, privacy, and computational power using theoretical and algorithmic methods.',
      }),
      await planTruncatedCardRepairRow({
        id: '2',
        shortDescription: 'Contact us at the address on our site',
        fullDescription: '',
        researchAreas: [],
      }),
      await planTruncatedCardRepairRow({
        id: '3',
        shortDescription: 'Studies liver diseases.',
        fullDescription: 'Studies liver diseases and their molecular drivers.',
      }),
    ];

    const summary = summarizeTruncatedCardRepair(rows);
    expect(summary.considered).toBe(3);
    expect(summary.truncated).toBe(2);
    expect(summary.changed).toBe(1);
    expect(summary.unresolved).toBe(1);
  });
});
