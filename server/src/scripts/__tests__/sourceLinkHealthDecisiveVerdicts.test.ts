import { describe, expect, it } from 'vitest';

import {
  isDecisiveStoredVerdict,
  resolveSourceLinkHealthEntry,
  storedSourceLinkHealthByUrl,
} from '../backfillSourceLinkHealthCore';

const URL_A = 'https://medicine.yale.edu/a/b/';
const NOW = new Date('2026-09-15T12:00:00.000Z');
const EARLIER = new Date('2026-08-01T00:00:00.000Z');

describe('isDecisiveStoredVerdict', () => {
  it('treats every status except UNKNOWN as an assertion about the resource', () => {
    expect(isDecisiveStoredVerdict({ healthStatus: 'UNAVAILABLE' })).toBe(true);
    expect(isDecisiveStoredVerdict({ healthStatus: 'HEALTHY' })).toBe(true);
    expect(isDecisiveStoredVerdict({ healthStatus: 'REDIRECTED' })).toBe(true);
    expect(isDecisiveStoredVerdict({ healthStatus: 'UNKNOWN' })).toBe(false);
    expect(isDecisiveStoredVerdict(undefined)).toBe(false);
    expect(isDecisiveStoredVerdict({})).toBe(false);
  });
});

describe('resolveSourceLinkHealthEntry', () => {
  it('writes a decisive fresh verdict over anything stored', () => {
    const resolved = resolveSourceLinkHealthEntry(
      URL_A,
      { healthStatus: 'UNAVAILABLE', httpStatusCode: 404 },
      { url: URL_A, healthStatus: 'HEALTHY', httpStatusCode: 200, checkedAt: EARLIER },
      NOW,
    );
    expect(resolved.preservedDecisiveVerdict).toBe(false);
    expect(resolved.entry).toEqual({
      url: URL_A,
      healthStatus: 'UNAVAILABLE',
      httpStatusCode: 404,
      checkedAt: NOW,
    });
  });

  // #2762: a 403 wave downgraded 9 correct 404 verdicts, 2 on served rows, and
  // suppression fires on UNAVAILABLE, so the pass un-suppressed pages that are gone.
  it('refuses to erase a decisive 404 with an inconclusive 403', () => {
    const resolved = resolveSourceLinkHealthEntry(
      URL_A,
      { healthStatus: 'UNKNOWN', httpStatusCode: 403 },
      { url: URL_A, healthStatus: 'UNAVAILABLE', httpStatusCode: 404, checkedAt: EARLIER },
      NOW,
    );
    expect(resolved.preservedDecisiveVerdict).toBe(true);
    expect(resolved.entry).toEqual({
      url: URL_A,
      healthStatus: 'UNAVAILABLE',
      httpStatusCode: 404,
      checkedAt: EARLIER,
      lastAttemptedAt: NOW,
    });
  });

  it('preserves a HEALTHY assertion without renewing its warranty', () => {
    const resolved = resolveSourceLinkHealthEntry(
      URL_A,
      { healthStatus: 'UNKNOWN', httpStatusCode: 429 },
      { url: URL_A, healthStatus: 'HEALTHY', httpStatusCode: 200, checkedAt: EARLIER },
      NOW,
    );
    expect(resolved.preservedDecisiveVerdict).toBe(true);
    // The original checkedAt survives so the freshness horizon can still age this
    // out; renewing it would let a permanently throttling host keep a HEALTHY
    // verdict alive for ever.
    expect(resolved.entry.checkedAt).toBe(EARLIER);
    expect(resolved.entry.lastAttemptedAt).toBe(NOW);
  });

  it('writes an inconclusive verdict when nothing decisive is stored', () => {
    for (const stored of [
      undefined,
      { url: URL_A, healthStatus: 'UNKNOWN' as const, checkedAt: EARLIER },
    ]) {
      const resolved = resolveSourceLinkHealthEntry(
        URL_A,
        { healthStatus: 'UNKNOWN', httpStatusCode: 403 },
        stored,
        NOW,
      );
      expect(resolved.preservedDecisiveVerdict).toBe(false);
      expect(resolved.entry).toEqual({
        url: URL_A,
        healthStatus: 'UNKNOWN',
        httpStatusCode: 403,
        checkedAt: NOW,
      });
    }
  });

  it('drops a preserved status code when the stored verdict had none', () => {
    const resolved = resolveSourceLinkHealthEntry(
      URL_A,
      { healthStatus: 'UNKNOWN' },
      { url: URL_A, healthStatus: 'UNAVAILABLE', checkedAt: EARLIER },
      NOW,
    );
    expect(resolved.entry).toEqual({
      url: URL_A,
      healthStatus: 'UNAVAILABLE',
      checkedAt: EARLIER,
      lastAttemptedAt: NOW,
    });
  });

  it('a fresh HEALTHY still replaces a stored UNAVAILABLE, so a revived page recovers', () => {
    const resolved = resolveSourceLinkHealthEntry(
      URL_A,
      { healthStatus: 'HEALTHY', httpStatusCode: 200 },
      { url: URL_A, healthStatus: 'UNAVAILABLE', httpStatusCode: 404, checkedAt: EARLIER },
      NOW,
    );
    expect(resolved.preservedDecisiveVerdict).toBe(false);
    expect(resolved.entry).toMatchObject({ healthStatus: 'HEALTHY', checkedAt: NOW });
  });
});

describe('storedSourceLinkHealthByUrl', () => {
  it('indexes stored rows by url and ignores unusable entries', () => {
    const index = storedSourceLinkHealthByUrl([
      { url: URL_A, healthStatus: 'HEALTHY' },
      { url: '', healthStatus: 'HEALTHY' },
      { healthStatus: 'HEALTHY' },
      null,
    ]);
    expect([...index.keys()]).toEqual([URL_A]);
  });

  it('is empty for a row that has never been probed', () => {
    expect(storedSourceLinkHealthByUrl(undefined).size).toBe(0);
    expect(storedSourceLinkHealthByUrl('not an array').size).toBe(0);
  });
});
