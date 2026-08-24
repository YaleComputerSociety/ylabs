import { describe, expect, it } from 'vitest';

import {
  deriveUndergraduateAccessStatus,
  isCurrentlyOpenToUndergraduates,
  undergraduateAccessSortRank,
} from '../undergraduateAccessStatus';

describe('deriveUndergraduateAccessStatus', () => {
  it('reports an open badge for a currently open home', () => {
    const status = deriveUndergraduateAccessStatus({ undergraduateCurrentAvailability: 'OPEN' });
    expect(status).toEqual({
      tone: 'open',
      label: 'Open now',
      detail: 'Open to undergraduates right now',
      isCurrentlyOpen: true,
    });
  });

  it('treats rolling availability as currently open', () => {
    const status = deriveUndergraduateAccessStatus({ undergraduateCurrentAvailability: 'ROLLING' });
    expect(status?.tone).toBe('open');
    expect(status?.label).toBe('Rolling');
    expect(status?.isCurrentlyOpen).toBe(true);
  });

  it('renders a muted check-back treatment for a not-currently-available home', () => {
    const status = deriveUndergraduateAccessStatus({
      undergraduateCurrentAvailability: 'NOT_CURRENTLY_AVAILABLE',
    });
    expect(status).toEqual({
      tone: 'muted',
      label: 'Not currently available',
      detail: 'Check back later',
      isCurrentlyOpen: false,
    });
  });

  it('falls back to a past-tense hosting badge that never implies current availability', () => {
    const status = deriveUndergraduateAccessStatus({ hasUndergradHostingEvidence: true });
    expect(status).toEqual({
      tone: 'evidence',
      label: 'Has hosted undergrads before',
      isCurrentlyOpen: false,
    });
  });

  it('fails closed to silence when no access fields are present', () => {
    expect(deriveUndergraduateAccessStatus({})).toBeNull();
    expect(
      deriveUndergraduateAccessStatus({ undergraduateCurrentAvailability: 'UNKNOWN' }),
    ).toBeNull();
    expect(deriveUndergraduateAccessStatus({ accessAcceptanceLevel: 'verified' })).toBeNull();
  });

  it('prefers current availability over hosting evidence', () => {
    const status = deriveUndergraduateAccessStatus({
      undergraduateCurrentAvailability: 'NOT_CURRENTLY_AVAILABLE',
      hasUndergradHostingEvidence: true,
    });
    expect(status?.tone).toBe('muted');
  });
});

describe('isCurrentlyOpenToUndergraduates', () => {
  it('is true only for open or rolling availability', () => {
    expect(isCurrentlyOpenToUndergraduates({ undergraduateCurrentAvailability: 'OPEN' })).toBe(true);
    expect(isCurrentlyOpenToUndergraduates({ undergraduateCurrentAvailability: 'ROLLING' })).toBe(
      true,
    );
    expect(
      isCurrentlyOpenToUndergraduates({
        undergraduateCurrentAvailability: 'NOT_CURRENTLY_AVAILABLE',
      }),
    ).toBe(false);
    expect(isCurrentlyOpenToUndergraduates({ hasUndergradHostingEvidence: true })).toBe(false);
    expect(isCurrentlyOpenToUndergraduates({})).toBe(false);
  });
});

describe('undergraduateAccessSortRank', () => {
  it('orders open homes first and not-currently-available homes last', () => {
    const open = deriveUndergraduateAccessStatus({ undergraduateCurrentAvailability: 'OPEN' });
    const muted = deriveUndergraduateAccessStatus({
      undergraduateCurrentAvailability: 'NOT_CURRENTLY_AVAILABLE',
    });
    const evidence = deriveUndergraduateAccessStatus({ hasUndergradHostingEvidence: true });

    expect(undergraduateAccessSortRank(open)).toBeLessThan(undergraduateAccessSortRank(evidence));
    expect(undergraduateAccessSortRank(evidence)).toBeLessThan(
      undergraduateAccessSortRank(muted),
    );
    expect(undergraduateAccessSortRank(null)).toBe(1);
  });
});
