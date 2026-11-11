import { describe, expect, it } from 'vitest';
import { aggregateResearchEntityGrantEvidence } from '../entityMaterializer';

const LEAD = 'researcher-lead';
const OTHER = 'researcher-other';
const at = new Date('2026-02-01T00:00:00Z');
const award = (id: string, researcherId: string, start = '2025-01-01') => ({
  id,
  agency: 'NIGMS',
  title: `Synthetic award ${id}`,
  startDate: new Date(`${start}T00:00:00Z`),
  endDate: new Date('2999-01-01T00:00:00Z'),
  investigators: [{ contact: true, researcherId }],
});
const obs = (sourceName: string, field: string, value: unknown) => ({
  sourceName,
  field,
  value,
  observedAt: at,
});
const everyoneElse = (investigator: Record<string, unknown>) => investigator.researcherId !== LEAD;

describe('the grant count and funders derive from the eligible award set (#5785)', () => {
  it('drops a withheld award from both the count and the funders', () => {
    const evidence = aggregateResearchEntityGrantEvidence(
      [
        obs('nih-reporter', 'recentGrants', [
          award('R01GM000001', LEAD),
          award('R01GM000002', OTHER),
        ]),
        obs('nih-reporter', 'recentGrantCount', 2),
        obs('nih-reporter', 'fundingAgencies', ['NIH']),
        obs('nsf-award-search', 'recentGrants', [{ ...award('2400001', OTHER), agency: 'NSF' }]),
        obs('nsf-award-search', 'recentGrantCount', 1),
        obs('nsf-award-search', 'fundingAgencies', ['NSF']),
      ] as any,
      new Set([LEAD]),
      everyoneElse,
    );
    expect(evidence.recentGrantCount).toBe(1);
    expect(evidence.fundingAgencies).toEqual(['NIH']);
  });

  it('serves no count and no funder when every award is withheld', () => {
    const evidence = aggregateResearchEntityGrantEvidence(
      [
        obs('nih-reporter', 'recentGrants', [award('R01GM000002', OTHER)]),
        obs('nih-reporter', 'recentGrantCount', 4),
        obs('nih-reporter', 'fundingAgencies', ['NIH']),
      ] as any,
      new Set([LEAD]),
      everyoneElse,
    );
    expect(evidence.recentGrantCount).toBe(0);
    expect(evidence.fundingAgencies).toEqual([]);
    expect(evidence.recentGrantPeriods).toEqual([]);
  });

  it('counts every eligible award when the served list is cut to ten', () => {
    const awards = Array.from({ length: 12 }, (_, index) =>
      award(`R01GM0001${String(index).padStart(2, '0')}`, LEAD, `20${10 + index}-01-01`),
    );
    const evidence = aggregateResearchEntityGrantEvidence(
      [
        obs('nih-reporter', 'recentGrants', awards),
        obs('nih-reporter', 'recentGrantCount', 15),
        obs('nih-reporter', 'fundingAgencies', ['NIH']),
      ] as any,
      new Set([LEAD]),
      everyoneElse,
    );
    expect(evidence.recentGrants).toHaveLength(10);
    expect(evidence.recentGrantCount).toBe(12);
    expect(evidence.recentGrantPeriods).toHaveLength(12);
  });

  it('counts awards a lane dates beyond its served list', () => {
    const listed = [award('R01GM000001', LEAD)];
    const dated = [
      award('R01GM000001', LEAD),
      award('R01GM000003', LEAD),
      award('R01GM000004', OTHER),
    ];
    const evidence = aggregateResearchEntityGrantEvidence(
      [
        obs('nih-reporter', 'recentGrants', listed),
        obs('nih-reporter', 'recentGrantPeriods', dated),
        obs('nih-reporter', 'recentGrantCount', 3),
        obs('nih-reporter', 'fundingAgencies', ['NIH']),
      ] as any,
      new Set([LEAD]),
      everyoneElse,
    );
    expect(evidence.recentGrants).toHaveLength(1);
    expect(evidence.recentGrantCount).toBe(2);
  });

  it('derives the same fields on a second resolve', () => {
    const input = [
      obs('nih-reporter', 'recentGrants', [
        award('R01GM000001', LEAD),
        award('R01GM000002', OTHER),
      ]),
      obs('nih-reporter', 'recentGrantCount', 2),
      obs('nih-reporter', 'fundingAgencies', ['NIH']),
    ] as any;
    const first = aggregateResearchEntityGrantEvidence(input, new Set([LEAD]), everyoneElse);
    expect(aggregateResearchEntityGrantEvidence(input, new Set([LEAD]), everyoneElse)).toEqual(
      first,
    );
  });
});
