import { describe, expect, it } from 'vitest';

import { formatGrantSummary, grantAgencyDisplayName } from '../grantAgencyNames';

describe('grantAgencyDisplayName', () => {
  it('spells out a funder acronym and keeps the acronym a student will see elsewhere', () => {
    expect(grantAgencyDisplayName('NHLBI')).toBe(
      'National Heart, Lung, and Blood Institute (NHLBI)',
    );
    expect(grantAgencyDisplayName('NSF')).toBe('National Science Foundation (NSF)');
  });

  it('leaves a funder that is already named in full untouched', () => {
    expect(grantAgencyDisplayName('American Cancer Society')).toBe('American Cancer Society');
  });
});

describe('formatGrantSummary', () => {
  it('reads as a sentence rather than an acronym tally', () => {
    expect(formatGrantSummary([{ agency: 'NHLBI' }])).toBe(
      'Recent research grant: 1 from National Heart, Lung, and Blood Institute (NHLBI)',
    );
    expect(formatGrantSummary([{ agency: 'NIA' }, { agency: 'NIMH' }, { agency: 'NIMH' }])).toBe(
      'Recent research grants: 2 from National Institute of Mental Health (NIMH); 1 from National Institute on Aging (NIA)',
    );
  });

  it('returns nothing when no grant names a funder', () => {
    expect(formatGrantSummary([])).toBeNull();
    expect(formatGrantSummary([{ agency: '  ' }])).toBeNull();
    expect(formatGrantSummary(undefined)).toBeNull();
  });
});
