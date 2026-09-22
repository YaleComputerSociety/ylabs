import { describe, expect, it } from 'vitest';

import {
  MAX_VANITY_REDIRECT_HOPS,
  VANITY_REPAIR_LOCKED_BY,
  VANITY_REPAIR_LOCK_NOTE,
  decideVanityRepair,
  planVanityRepairRow,
} from '../repairVanityHostCitationsCore';
import { isRevisitableFieldLock } from '../../utils/researchEntityFieldLocks';

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

  // resolveBackfillWebsiteUrl clears a profile page precisely because the row cites
  // it, so an unlocked websiteUrl rewrite is undone by the next materialize.
  it('locks websiteUrl when it rewrites it, so the next materialize cannot undo the repair', () => {
    const change = planVanityRepairRow({ websiteUrl: VANITY }, VANITY, CANONICAL);
    expect(change?.websiteUrl).toBe(CANONICAL);
    expect(change?.fieldLockUpdate?.manuallyLockedFields).toEqual(['websiteUrl']);
  });

  // A lock with no recorded reason reads as `unknown`, which `isRevisitableFieldLock`
  // never re-opens, so it would freeze this row's websiteUrl for good (#2612).
  it('records the lock as an engine_gap_workaround so it can be re-opened', () => {
    const change = planVanityRepairRow({ websiteUrl: VANITY }, VANITY, CANONICAL);
    const provenance = change?.fieldLockUpdate?.['fieldLockProvenance.websiteUrl'] as {
      reason?: string;
      lockedBy?: string;
      note?: string;
      lockedAt?: Date;
    };
    expect(provenance?.reason).toBe('engine_gap_workaround');
    expect(provenance?.lockedBy).toBe(VANITY_REPAIR_LOCKED_BY);
    expect(provenance?.note).toBe(VANITY_REPAIR_LOCK_NOTE);
    expect(provenance?.lockedAt).toBeInstanceOf(Date);
    expect(isRevisitableFieldLock({ websiteUrl: provenance }, 'websiteUrl')).toBe(true);
  });

  it('does not duplicate an existing lock', () => {
    const change = planVanityRepairRow(
      { websiteUrl: VANITY, manuallyLockedFields: ['websiteUrl', 'shortDescription'] },
      VANITY,
      CANONICAL,
    );
    expect(change?.fieldLockUpdate).toBeUndefined();
    expect(change?.changedFields).toEqual(['websiteUrl']);
  });

  it('does not lock when only sourceUrls changed', () => {
    const change = planVanityRepairRow({ sourceUrls: [VANITY] }, VANITY, CANONICAL);
    expect(change?.fieldLockUpdate).toBeUndefined();
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
