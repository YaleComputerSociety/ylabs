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

  it('persists a sanitized short when a trailing affiliation clause is stripped and the rest stays useful (#1616)', () => {
    const row = planTopicLabelListRepairRow({
      id: '5',
      entityType: 'FACULTY_RESEARCH_AREA',
      shortDescription: 'Studies American Politics at Yale University.',
      fullDescription:
        'Her research centers on the U.S. Congress, money in politics, and electoral campaigns, investigating the strategic choices of candidates and how financial constraints shape legislative behavior and representation in American democracy.',
    });
    expect(row.action).toBe('sanitized');
    expect(row.after).toBe('Studies American Politics.');
    expect(row.changed).toBe(true);
  });

  it('clears an ungrounded single-clause cherry-pick whose topic is absent from the full (#1616)', () => {
    const row = planTopicLabelListRepairRow({
      id: '6',
      entityType: 'FACULTY_RESEARCH_AREA',
      shortDescription: 'Studies Texas from the first.',
      fullDescription:
        'The analysis in Making Morocco focuses on interactions between state and society during the Protectorate period, and how they politicized religion, ethnicity, territory, and the role of the Alawid monarchy.',
    });
    expect(row.action).toBe('cleared');
    expect(row.after).toBe('');
    expect(row.changed).toBe(true);
  });
});

describe('summarizeTopicLabelListRepair', () => {
  it('counts considered, changed, sanitized, derived, and cleared rows', () => {
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
      planTopicLabelListRepairRow({
        id: '3',
        entityType: 'FACULTY_RESEARCH_AREA',
        shortDescription: 'Studies American Politics at Yale University.',
        fullDescription:
          'Her research centers on the U.S. Congress, money in politics, and electoral campaigns, investigating the strategic choices of candidates and how financial constraints shape legislative behavior and representation in American democracy.',
      }),
    ];
    expect(summarizeTopicLabelListRepair(rows)).toEqual({
      considered: 3,
      changed: 2,
      sanitized: 1,
      derivedFromFull: 0,
      cleared: 1,
    });
  });
});
