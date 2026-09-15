import { describe, expect, it } from 'vitest';

import {
  deriveUndergraduateAccessStatus,
  undergraduateAccessSortRank,
} from '../undergraduateAccessStatus';

describe('deriveUndergraduateAccessStatus', () => {
  it('reports a past-tense hosting badge that never implies current availability', () => {
    const status = deriveUndergraduateAccessStatus({ hasUndergradHostingEvidence: true });
    expect(status).toEqual({ tone: 'evidence', label: 'Has hosted undergrads before' });
    expect(status?.label).not.toMatch(/open|now|currently/i);
  });

  it('fails closed to silence when no access fields are present', () => {
    expect(deriveUndergraduateAccessStatus({})).toBeNull();
    expect(deriveUndergraduateAccessStatus({ hasUndergradHostingEvidence: false })).toBeNull();
    expect(deriveUndergraduateAccessStatus({ hasUndergradHostingEvidence: null })).toBeNull();
  });

  // Availability, compensation and welcomed class years were removed because no
  // source publishes them, so hosting evidence is the only signal left and there
  // is no longer any "currently open" claim to make.
  it('never claims a home is currently open', () => {
    for (const fields of [{}, { hasUndergradHostingEvidence: true }]) {
      const status = deriveUndergraduateAccessStatus(fields);
      expect(status?.tone).not.toBe('open');
    }
  });
});

describe('undergraduateAccessSortRank', () => {
  it('orders homes with hosting evidence ahead of homes without', () => {
    const withEvidence = deriveUndergraduateAccessStatus({ hasUndergradHostingEvidence: true });
    expect(undergraduateAccessSortRank(withEvidence)).toBeLessThan(
      undergraduateAccessSortRank(null),
    );
  });
});
