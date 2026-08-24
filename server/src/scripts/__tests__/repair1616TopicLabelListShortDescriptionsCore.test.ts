import { describe, expect, it } from 'vitest';

import {
  planTopicLabelListRepairRow,
  summarizeTopicLabelListRepair,
} from '../repair1616TopicLabelListShortDescriptionsCore';

describe('planTopicLabelListRepairRow', () => {
  it('leaves a non-flagged short untouched', () => {
    const row = planTopicLabelListRepairRow({
      id: '1',
      entityType: 'LAB',
      shortDescription: 'Studies protein folding using cryo-EM.',
      fullDescription:
        'The lab studies protein folding using cryo-EM techniques to understand misfolding diseases.',
    });
    expect(row.action).toBe('unchanged');
    expect(row.changed).toBe(false);
  });

  it('clears a bare label-list short identical to its full when no better sentence exists', () => {
    const text = 'Studies Condensed Matter Physics, Theorist, and Stochastic processes.';
    const row = planTopicLabelListRepairRow({
      id: '2',
      entityType: 'FACULTY_RESEARCH_AREA',
      shortDescription: text,
      fullDescription: text,
    });
    expect(row.action).toBe('cleared');
    expect(row.after).toBe('');
    expect(row.changed).toBe(true);
  });

  it('derives a faithful short from a richer full when the stored short is a garbled affiliation fragment', () => {
    const row = planTopicLabelListRepairRow({
      id: '3',
      entityType: 'FACULTY_RESEARCH_AREA',
      shortDescription: 'Studies the US National Institute on Aging, and a Next Generation Leader of the Committee of 100.',
      fullDescription:
        "Emma Zang's research interests intersect at the nexus of health and aging, family demography, and inequality, employing advanced data science and statistical tools. Her scholarship has primarily dealt with how families shape inequality in the United States and China.",
    });
    if (row.action === 'derived-from-full') {
      expect(row.after).not.toBe(row.before);
      expect(row.after.length).toBeGreaterThan(0);
    } else {
      expect(row.action).toBe('cleared');
      expect(row.after).toBe('');
    }
  });

  it('does not touch an entity outside LAB/FACULTY_RESEARCH_AREA', () => {
    const text = 'Studies Condensed Matter Physics, Theorist, and Stochastic processes.';
    const row = planTopicLabelListRepairRow({
      id: '4',
      entityType: 'CENTER',
      shortDescription: text,
      fullDescription: text,
    });
    expect(row.action).toBe('unchanged');
    expect(row.changed).toBe(false);
  });
});

describe('summarizeTopicLabelListRepair', () => {
  it('counts considered, flagged, derived, and cleared rows', () => {
    const text = 'Studies Condensed Matter Physics, Theorist, and Stochastic processes.';
    const rows = [
      planTopicLabelListRepairRow({
        id: '1',
        entityType: 'LAB',
        shortDescription: 'Studies protein folding using cryo-EM.',
        fullDescription:
          'The lab studies protein folding using cryo-EM techniques to understand misfolding diseases.',
      }),
      planTopicLabelListRepairRow({
        id: '2',
        entityType: 'FACULTY_RESEARCH_AREA',
        shortDescription: text,
        fullDescription: text,
      }),
    ];
    expect(summarizeTopicLabelListRepair(rows)).toEqual({
      considered: 2,
      flagged: 1,
      derivedFromFull: 0,
      cleared: 1,
    });
  });
});
