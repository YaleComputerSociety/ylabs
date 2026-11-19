import { describe, expect, it } from 'vitest';

import {
  deriveUndergraduateAccessStatuses,
  undergraduateAccessSortRank,
} from '../undergraduateAccessStatus';

const labels = (fields: Parameters<typeof deriveUndergraduateAccessStatuses>[0]) =>
  deriveUndergraduateAccessStatuses(fields).map((status) => status.label);

describe('deriveUndergraduateAccessStatuses', () => {
  it('leads with the invitation the detail page shows, ahead of past hosting (#6088)', () => {
    expect(
      labels({ undergradInvitationLevel: 'actively_hiring', hasUndergradHostingEvidence: true }),
    ).toEqual(['Taking undergrads now, recruiting', 'Has had undergrads']);
    expect(labels({ undergradInvitation: { level: 'welcomes_undergrads' } })).toEqual([
      'Taking undergrads now',
    ]);
  });

  it('reads the served welcome flag when no invitation level is served', () => {
    expect(labels({ welcomesUndergrads: true })).toEqual(['Taking undergrads now']);
  });

  it('uses the browse card badge words for hosting and advising', () => {
    expect(labels({ hasUndergradHostingEvidence: true, mentorsUndergrads: true })).toEqual([
      'Has had undergrads',
      'Advises undergrad research',
    ]);
  });

  it('claims no way in when the way in is withheld', () => {
    expect(
      labels({
        wayInWithheld: true,
        undergradInvitationLevel: 'actively_hiring',
        welcomesUndergrads: true,
        mentorsUndergrads: true,
        hasUndergradHostingEvidence: true,
      }),
    ).toEqual(['Has had undergrads']);
  });

  it('fails closed to silence when no access fields are present', () => {
    expect(deriveUndergraduateAccessStatuses({})).toEqual([]);
    expect(
      deriveUndergraduateAccessStatuses({
        hasUndergradHostingEvidence: false,
        welcomesUndergrads: null,
        undergradInvitationLevel: null,
      }),
    ).toEqual([]);
  });
});

describe('undergraduateAccessSortRank', () => {
  it('orders an invitation ahead of hosting evidence, and evidence ahead of nothing', () => {
    const invited = deriveUndergraduateAccessStatuses({ welcomesUndergrads: true });
    const hosted = deriveUndergraduateAccessStatuses({ hasUndergradHostingEvidence: true });
    expect(undergraduateAccessSortRank(invited)).toBeLessThan(undergraduateAccessSortRank(hosted));
    expect(undergraduateAccessSortRank(hosted)).toBeLessThan(undergraduateAccessSortRank([]));
  });
});
