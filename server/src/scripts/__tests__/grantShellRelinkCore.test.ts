import { describe, expect, it } from 'vitest';
import {
  classifyGrantShell,
  tallyGrantShellDispositions,
  type GrantShellDisposition,
} from '../grantShellRelinkCore';

describe('classifyGrantShell', () => {
  it('classifies an ambiguous match as still-ambiguous regardless of leads', () => {
    expect(
      classifyGrantShell({
        matchStatus: 'ambiguous',
        canonicalPersonId: null,
        activeLeadPersonIds: ['p1'],
      }),
    ).toBe('still-ambiguous');
  });

  it('classifies an unmatched shell as still-unmatched', () => {
    expect(
      classifyGrantShell({
        matchStatus: 'unmatched',
        canonicalPersonId: null,
        activeLeadPersonIds: [],
      }),
    ).toBe('still-unmatched');
  });

  it('classifies a shell with no active lead as newly-linked', () => {
    expect(
      classifyGrantShell({
        matchStatus: 'matched',
        canonicalPersonId: 'canonical',
        activeLeadPersonIds: [],
      }),
    ).toBe('newly-linked');
  });

  it('classifies a shell whose active lead is the matched canonical person as already-linked', () => {
    expect(
      classifyGrantShell({
        matchStatus: 'matched',
        canonicalPersonId: 'canonical',
        activeLeadPersonIds: ['other', 'canonical'],
      }),
    ).toBe('already-linked');
  });

  it('classifies a shell whose only active lead is a divergent personId as personid-divergent', () => {
    expect(
      classifyGrantShell({
        matchStatus: 'matched',
        canonicalPersonId: 'canonical',
        activeLeadPersonIds: ['divergent'],
      }),
    ).toBe('personid-divergent');
  });

  it('treats a matched shell with an unresolvable canonical personId but an existing active lead as personid-divergent, not newly-linked', () => {
    expect(
      classifyGrantShell({
        matchStatus: 'matched',
        canonicalPersonId: null,
        activeLeadPersonIds: ['someone'],
      }),
    ).toBe('personid-divergent');
  });

  it('allows a first link when the canonical personId is unresolved and no active lead exists', () => {
    expect(
      classifyGrantShell({
        matchStatus: 'matched',
        canonicalPersonId: null,
        activeLeadPersonIds: [],
      }),
    ).toBe('newly-linked');
  });
});

describe('tallyGrantShellDispositions', () => {
  it('counts every disposition and reports zero for unseen ones', () => {
    const dispositions: GrantShellDisposition[] = [
      'newly-linked',
      'newly-linked',
      'already-linked',
      'personid-divergent',
      'still-ambiguous',
    ];
    expect(tallyGrantShellDispositions(dispositions)).toEqual({
      'newly-linked': 2,
      'already-linked': 1,
      'personid-divergent': 1,
      'still-ambiguous': 1,
      'still-unmatched': 0,
    });
  });

  it('returns an all-zero tally for an empty input', () => {
    expect(tallyGrantShellDispositions([])).toEqual({
      'newly-linked': 0,
      'already-linked': 0,
      'personid-divergent': 0,
      'still-ambiguous': 0,
      'still-unmatched': 0,
    });
  });
});
