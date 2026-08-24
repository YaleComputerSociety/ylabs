import { describe, expect, it } from 'vitest';
import { computeSavedHomeAvailabilityBadge } from '../savedHomeAvailabilityBadge';

describe('computeSavedHomeAvailabilityBadge', () => {
  it('badges an OPEN home as currently open', () => {
    const badge = computeSavedHomeAvailabilityBadge({ undergraduateCurrentAvailability: 'OPEN' });
    expect(badge).toEqual({ label: 'Open now', tone: 'open', isCurrentlyOpen: true });
  });

  it('badges a ROLLING home as currently open', () => {
    const badge = computeSavedHomeAvailabilityBadge({
      undergraduateCurrentAvailability: 'ROLLING',
    });
    expect(badge?.isCurrentlyOpen).toBe(true);
    expect(badge?.label).toBe('Rolling');
  });

  it('gives a muted, non-promising treatment to a not-currently-available home', () => {
    const badge = computeSavedHomeAvailabilityBadge({
      undergraduateCurrentAvailability: 'NOT_CURRENTLY_AVAILABLE',
    });
    expect(badge?.isCurrentlyOpen).toBe(false);
    expect(badge?.tone).toBe('muted-negative');
    expect(badge?.label).toMatch(/reach out to confirm/i);
  });

  it('falls back to hosting-evidence vocabulary when availability is unknown', () => {
    const badge = computeSavedHomeAvailabilityBadge({
      undergraduateCurrentAvailability: 'UNKNOWN',
      hasUndergradHostingEvidence: true,
    });
    expect(badge).toEqual({
      label: 'Has hosted undergrads before',
      tone: 'muted-positive',
      isCurrentlyOpen: false,
    });
  });

  it('falls back to a reach-out-plausible badge for verified/likely acceptance without hosting evidence', () => {
    const badge = computeSavedHomeAvailabilityBadge({ accessAcceptanceLevel: 'likely' });
    expect(badge?.tone).toBe('muted-positive');
    expect(badge?.label).toBe('Reach-out plausible');
  });

  it('fails closed to no badge when every access field is absent', () => {
    expect(computeSavedHomeAvailabilityBadge({})).toBeNull();
  });

  it('fails closed to no badge when acceptance level is none and there is no other evidence', () => {
    expect(
      computeSavedHomeAvailabilityBadge({
        undergraduateCurrentAvailability: 'UNKNOWN',
        accessAcceptanceLevel: 'none',
        hasUndergradHostingEvidence: false,
      }),
    ).toBeNull();
  });
});
