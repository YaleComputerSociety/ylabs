import { describe, expect, it } from 'vitest';
import { grantAwardIdentity } from '../utils/grantAwardIdentity';
import { recentGrantPeriodsOf } from '../utils/recentGrantPeriods';
import { aggregateResearchEntityGrantEvidence } from '../entityMaterializer';

describe('grantAwardIdentity', () => {
  it('ignores case and punctuation within one funder', () => {
    expect(grantAwardIdentity({ id: 'RSG-23-0000001-01', agency: 'American Cancer Society' })).toBe(
      grantAwardIdentity({ id: 'rsg 23 0000001 01', agency: 'american cancer society' }),
    );
  });

  it('keeps the same number from two funders apart', () => {
    expect(grantAwardIdentity({ id: '2400001', agency: 'NSF' })).not.toBe(
      grantAwardIdentity({ id: '2400001', agency: 'James S. McDonnell Foundation' }),
    );
  });

  it('collapses NIH fiscal-year application numbers onto the core project whatever the institute label', () => {
    const core = grantAwardIdentity({ id: 'R01GM000001', agency: 'NIGMS' });
    expect(grantAwardIdentity({ id: '5R01GM000001-04', agency: 'NIGMS' })).toBe(core);
    expect(grantAwardIdentity({ id: '1R01GM000001-01A1', agency: 'NIH' })).toBe(core);
  });

  it('treats a DOE award number the same with or without its DE- prefix', () => {
    expect(grantAwardIdentity({ id: 'DE-SC0000001', agency: 'DOE' })).toBe(
      grantAwardIdentity({ id: 'SC0000001', agency: 'DOE' }),
    );
  });

  it('has no identity for a grant with no award number', () => {
    expect(grantAwardIdentity({ id: ' - ', agency: 'NSF' })).toBeNull();
  });
});

describe('cross-source grant evidence', () => {
  it('lists and counts one award once when two lanes spell its number differently', () => {
    const evidence = aggregateResearchEntityGrantEvidence([
      {
        field: 'recentGrants',
        sourceName: 'doe-osti',
        observedAt: new Date('2026-01-01'),
        value: [{ id: 'DE-SC0000001', agency: 'DOE', endDate: new Date('2027-01-01') }],
      },
      {
        field: 'recentGrants',
        sourceName: 'crossref-grants',
        observedAt: new Date('2026-01-01'),
        value: [{ id: 'SC0000001', agency: 'DOE', endDate: new Date('2027-01-01') }],
      },
      {
        field: 'recentGrantPeriods',
        sourceName: 'doe-osti',
        observedAt: new Date('2026-01-01'),
        value: recentGrantPeriodsOf([{ id: 'DE-SC0000001', agency: 'DOE' }]),
      },
      {
        field: 'recentGrantPeriods',
        sourceName: 'crossref-grants',
        observedAt: new Date('2026-01-01'),
        value: recentGrantPeriodsOf([{ id: 'SC0000001', agency: 'DOE' }]),
      },
      {
        field: 'recentGrantCount',
        sourceName: 'doe-osti',
        observedAt: new Date('2026-01-01'),
        value: 1,
      },
      {
        field: 'recentGrantCount',
        sourceName: 'crossref-grants',
        observedAt: new Date('2026-01-01'),
        value: 1,
      },
    ]);
    expect(evidence.recentGrants).toHaveLength(1);
    expect(evidence.recentGrantCount).toBe(1);
  });

  it('keeps the later-ending record when one NIH project arrives under several fiscal years', () => {
    const evidence = aggregateResearchEntityGrantEvidence([
      {
        field: 'recentGrants',
        sourceName: 'nih-reporter',
        observedAt: new Date('2026-01-01'),
        value: [
          { id: '5R01GM000001-05', agency: 'NIGMS', endDate: new Date('2027-06-30') },
          { id: '5R01GM000001-04', agency: 'NIGMS', endDate: new Date('2026-06-30') },
        ],
      },
    ]);
    expect(evidence.recentGrants).toEqual([
      { id: '5R01GM000001-05', agency: 'NIGMS', endDate: new Date('2027-06-30') },
    ]);
  });
});
