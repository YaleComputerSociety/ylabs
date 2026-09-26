import { describe, expect, it } from 'vitest';

import {
  MAX_VANITY_REDIRECT_HOPS,
  VANITY_REPAIR_REFUSED_BY,
  VANITY_REPAIR_REFUSAL_NOTE,
  decideVanityRepair,
  planVanityRepairRow,
} from '../repairVanityHostCitationsCore';
import { fieldValueRefusalKey } from '../../utils/researchEntityFieldValueRefusals';

const VANITY = 'https://www.mood.yale.edu/';
const CANONICAL = 'https://medicine.yale.edu/psychiatry/research/mood/';
const CERT = 'ERR_TLS_CERT_ALTNAME_INVALID';

const probe = (over: Record<string, unknown> = {}) => ({
  citationErrorCode: CERT,
  destinationUrl: CANONICAL,
  hops: 2,
  destinationHealth: 'HEALTHY',
  ...over,
});

describe('decideVanityRepair', () => {
  it('repoints a cert-mismatch citation at a healthy destination on another host', () => {
    expect(decideVanityRepair(VANITY, probe())).toEqual({
      repoint: true,
      destinationUrl: CANONICAL,
    });
  });

  // http -> https on the same host, then a redirect, is the normal shape. A hop
  // count is not the guard; the destination checks are.
  it('accepts the two-hop scheme-upgrade-then-redirect shape', () => {
    expect(decideVanityRepair(VANITY, probe({ hops: 2 })).repoint).toBe(true);
    expect(decideVanityRepair(VANITY, probe({ hops: MAX_VANITY_REDIRECT_HOPS })).repoint).toBe(
      true,
    );
  });

  it.each([
    [
      'a citation that fails for another reason',
      { citationErrorCode: 'ENOTFOUND' },
      'not-cert-mismatch',
    ],
    ['no redirect at all', { destinationUrl: undefined }, 'no-redirect-destination'],
    [
      'a plaintext destination',
      { destinationUrl: 'http://medicine.yale.edu/x' },
      'destination-not-https',
    ],
    [
      'a destination on the same host',
      { destinationUrl: 'https://www.mood.yale.edu/other' },
      'destination-same-host',
    ],
    [
      'a destination that is itself dead',
      { destinationHealth: 'UNAVAILABLE' },
      'destination-not-healthy',
    ],
    [
      'a destination that is merely inconclusive',
      { destinationHealth: 'UNKNOWN' },
      'destination-not-healthy',
    ],
    ['a chain longer than the cap', { hops: MAX_VANITY_REDIRECT_HOPS + 1 }, 'too-many-hops'],
  ])('refuses %s', (_label, over, refusal) => {
    const decision = decideVanityRepair(VANITY, probe(over));
    expect(decision.repoint).toBe(false);
    expect(decision.refusal).toBe(refusal);
  });

  it('refuses an unparseable destination rather than guessing', () => {
    expect(decideVanityRepair(VANITY, probe({ destinationUrl: 'https://' })).repoint).toBe(false);
  });
});

describe('planVanityRepairRow', () => {
  it('rewrites only the fields holding the vanity url', () => {
    const change = planVanityRepairRow(
      {
        sourceUrls: ['https://other.yale.edu/a', VANITY],
        websiteUrl: 'https://unrelated.yale.edu/',
      },
      VANITY,
      CANONICAL,
    );
    expect(change?.sourceUrls).toEqual(['https://other.yale.edu/a', CANONICAL]);
    expect(change?.websiteUrl).toBeUndefined();
    expect(change?.changedFields).toEqual(['sourceUrls']);
  });

  // resolveBackfillWebsiteUrl re-derives the vanity url precisely because the row cites
  // it, so a bare websiteUrl rewrite is undone by the next materialize.
  it('refuses the vanity value when it rewrites websiteUrl, so the next materialize cannot undo the repair', () => {
    const change = planVanityRepairRow({ websiteUrl: VANITY }, VANITY, CANONICAL);
    expect(change?.websiteUrl).toBe(CANONICAL);
    const refusals = change?.fieldValueRefusalUpdate?.['fieldValueRefusals.websiteUrl'] as Array<{
      valueKey?: string;
      rule?: string;
      refusedBy?: string;
      note?: string;
      refusedAt?: Date;
      evidenceUrl?: string;
    }>;
    expect(refusals).toHaveLength(1);
    expect(refusals[0]?.valueKey).toBe(fieldValueRefusalKey('websiteUrl', VANITY));
    expect(refusals[0]?.rule).toBe('superseded_by_better_source');
    expect(refusals[0]?.refusedBy).toBe(VANITY_REPAIR_REFUSED_BY);
    expect(refusals[0]?.note).toBe(VANITY_REPAIR_REFUSAL_NOTE);
    expect(refusals[0]?.evidenceUrl).toBe(CANONICAL);
    expect(refusals[0]?.refusedAt).toBeInstanceOf(Date);
    expect(change?.changedFields).toEqual(['websiteUrl', 'fieldValueRefusals']);
  });

  // The whole reason for refusing rather than locking: a lock removes the field from
  // derivation forever, so the row could never take a better research home again.
  it('names one value rather than the field, so the field stays under derivation', () => {
    const change = planVanityRepairRow({ websiteUrl: VANITY }, VANITY, CANONICAL);
    expect(change?.fieldValueRefusalUpdate?.manuallyLockedFields).toBeUndefined();
    expect(Object.keys(change?.fieldValueRefusalUpdate ?? {})).toEqual([
      'fieldValueRefusals.websiteUrl',
    ]);
  });

  it('does not write over an operator lock, which is a standing instruction', () => {
    const change = planVanityRepairRow(
      { websiteUrl: VANITY, manuallyLockedFields: ['websiteUrl', 'shortDescription'] },
      VANITY,
      CANONICAL,
    );
    expect(change?.fieldValueRefusalUpdate).toBeUndefined();
    expect(change?.changedFields).toEqual(['websiteUrl']);
  });

  it('does not duplicate a refusal it already recorded, so a second run is a no-op', () => {
    const change = planVanityRepairRow(
      {
        websiteUrl: VANITY,
        fieldValueRefusals: {
          websiteUrl: [
            {
              valueKey: fieldValueRefusalKey('websiteUrl', VANITY),
              rule: 'superseded_by_better_source',
              refusedBy: VANITY_REPAIR_REFUSED_BY,
              refusedAt: new Date('2020-01-01T00:00:00.000Z'),
              note: 'already refused',
            },
          ],
        },
      },
      VANITY,
      CANONICAL,
    );
    expect(change?.fieldValueRefusalUpdate).toBeUndefined();
    expect(change?.changedFields).toEqual(['websiteUrl']);
  });

  it('does not refuse anything when only sourceUrls changed', () => {
    const change = planVanityRepairRow({ sourceUrls: [VANITY] }, VANITY, CANONICAL);
    expect(change?.fieldValueRefusalUpdate).toBeUndefined();
  });

  it('rewrites the website field, which is the third fallback the DTO renders', () => {
    const change = planVanityRepairRow({ website: VANITY }, VANITY, CANONICAL);
    expect(change?.website).toBe(CANONICAL);
    expect(change?.changedFields).toEqual(['website']);
  });

  it('returns null when the row does not hold the vanity url anywhere', () => {
    expect(
      planVanityRepairRow({ sourceUrls: ['https://other.yale.edu/'] }, VANITY, CANONICAL),
    ).toBeNull();
  });

  it('does not introduce a duplicate when the destination is already cited', () => {
    const change = planVanityRepairRow({ sourceUrls: [VANITY, CANONICAL] }, VANITY, CANONICAL);
    expect(change?.sourceUrls).toEqual([CANONICAL]);
  });
});
