import { describe, expect, it } from 'vitest';

import {
  isDecisiveStoredVerdict,
  resolveSourceLinkHealthEntry,
  sourceLinkVerdictSignature,
  storedSourceLinkHealthByUrl,
  tallySourceLinkVerdictTransition,
} from '../backfillSourceLinkHealthCore';

const URL_A = 'https://ysph.yale.edu/a/b/';
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

// #2556: the routing axis and the liveness axis move independently, so the entry
// resolver has to carry one without disturbing the other.
describe('resolveSourceLinkHealthEntry routing axis', () => {
  it('records a private-address host alongside the inconclusive verdict', () => {
    const resolved = resolveSourceLinkHealthEntry(
      URL_A,
      { healthStatus: 'UNKNOWN', privateAddressHost: true },
      undefined,
      NOW,
    );
    expect(resolved.entry).toEqual({
      url: URL_A,
      healthStatus: 'UNKNOWN',
      privateAddressHost: true,
      checkedAt: NOW,
    });
  });

  // A host that answered with a status was publicly routable at that moment, and
  // that is the only evidence that releases the flag.
  it('drops the flag once a probe comes back with a status', () => {
    const resolved = resolveSourceLinkHealthEntry(
      URL_A,
      { healthStatus: 'HEALTHY', httpStatusCode: 200 },
      { url: URL_A, healthStatus: 'UNKNOWN', privateAddressHost: true, checkedAt: EARLIER },
      NOW,
    );
    expect(resolved.entry.privateAddressHost).toBeUndefined();
  });

  // A timeout learned nothing about addressing, so releasing on it would hand a
  // student back a link they cannot open.
  it('keeps the flag when the probe learned nothing about addressing', () => {
    const resolved = resolveSourceLinkHealthEntry(
      URL_A,
      { healthStatus: 'UNKNOWN' },
      { url: URL_A, healthStatus: 'UNKNOWN', privateAddressHost: true, checkedAt: EARLIER },
      NOW,
    );
    expect(resolved.entry.privateAddressHost).toBe(true);
  });

  it('drops the flag when public DNS maps the host to public space (#3903)', () => {
    const resolved = resolveSourceLinkHealthEntry(
      URL_A,
      { healthStatus: 'UNKNOWN', publicAddressHost: true },
      { url: URL_A, healthStatus: 'UNKNOWN', privateAddressHost: true, checkedAt: EARLIER },
      NOW,
    );
    expect(resolved.entry).toEqual({
      url: URL_A,
      healthStatus: 'UNKNOWN',
      checkedAt: EARLIER,
      lastAttemptedAt: NOW,
    });
  });

  it('keeps a preserved decisive verdict and the fresh routing fact together', () => {
    const resolved = resolveSourceLinkHealthEntry(
      URL_A,
      { healthStatus: 'UNKNOWN', privateAddressHost: true },
      { url: URL_A, healthStatus: 'UNAVAILABLE', httpStatusCode: 404, checkedAt: EARLIER },
      NOW,
    );
    expect(resolved.preservedDecisiveVerdict).toBe(true);
    expect(resolved.entry).toEqual({
      url: URL_A,
      healthStatus: 'UNAVAILABLE',
      httpStatusCode: 404,
      privateAddressHost: true,
      checkedAt: EARLIER,
      lastAttemptedAt: NOW,
    });
  });
});

describe('resolveSourceLinkHealthEntry under a certificate failure (#4080)', () => {
  const HTTPS = 'https://a.yale.edu/~x/';

  it('replaces a stored HEALTHY for the same https url, because it contradicts it', () => {
    const resolved = resolveSourceLinkHealthEntry(
      HTTPS,
      { healthStatus: 'UNKNOWN', tlsVerificationFailed: true },
      { url: HTTPS, healthStatus: 'HEALTHY', httpStatusCode: 200, checkedAt: EARLIER },
      NOW,
    );
    expect(resolved.preservedDecisiveVerdict).toBe(false);
    expect(resolved.entry).toEqual({
      url: HTTPS,
      healthStatus: 'UNKNOWN',
      tlsVerificationFailed: true,
      checkedAt: NOW,
    });
  });

  it('keeps a stored UNAVAILABLE and records the certificate failure beside it', () => {
    const resolved = resolveSourceLinkHealthEntry(
      HTTPS,
      { healthStatus: 'UNKNOWN', tlsVerificationFailed: true },
      { url: HTTPS, healthStatus: 'UNAVAILABLE', httpStatusCode: 404, checkedAt: EARLIER },
      NOW,
    );
    expect(resolved.preservedDecisiveVerdict).toBe(true);
    expect(resolved.entry).toMatchObject({
      healthStatus: 'UNAVAILABLE',
      tlsVerificationFailed: true,
    });
  });
});

describe('resolveSourceLinkHealthEntry https landing (#4649)', () => {
  const HTTP = 'http://faculty.example.yale.edu/FixturePerson/';
  const LANDING = 'https://faculty.example.yale.edu/fixtureperson/';

  it('stores the landing a fresh HEALTHY probe recorded', () => {
    const resolved = resolveSourceLinkHealthEntry(
      HTTP,
      { healthStatus: 'HEALTHY', httpStatusCode: 200, httpsLandingUrl: LANDING },
      undefined,
      NOW,
    );
    expect(resolved.entry).toEqual({
      url: HTTP,
      healthStatus: 'HEALTHY',
      httpStatusCode: 200,
      httpsLandingUrl: LANDING,
      checkedAt: NOW,
    });
  });

  it('keeps the landing with a decisive verdict an inconclusive probe preserved', () => {
    const resolved = resolveSourceLinkHealthEntry(
      HTTP,
      { healthStatus: 'UNKNOWN', httpStatusCode: 503 },
      {
        url: HTTP,
        healthStatus: 'HEALTHY',
        httpStatusCode: 200,
        httpsLandingUrl: LANDING,
        checkedAt: EARLIER,
      },
      NOW,
    );
    expect(resolved.preservedDecisiveVerdict).toBe(true);
    expect(resolved.entry.httpsLandingUrl).toBe(LANDING);
  });

  it('drops the landing when a fresh decisive probe no longer records one', () => {
    const resolved = resolveSourceLinkHealthEntry(
      HTTP,
      { healthStatus: 'HEALTHY', httpStatusCode: 200 },
      { url: HTTP, healthStatus: 'HEALTHY', httpsLandingUrl: LANDING, checkedAt: EARLIER },
      NOW,
    );
    expect(resolved.entry.httpsLandingUrl).toBeUndefined();
  });
});

describe('resolveSourceLinkHealthEntry https spelling (#5639)', () => {
  const HTTP = 'http://both.fixture.example.org/lab/';
  const SPELLING = 'https://both.fixture.example.org/lab/';

  it('stores the https spelling a fresh probe recorded', () => {
    const resolved = resolveSourceLinkHealthEntry(
      HTTP,
      { healthStatus: 'HEALTHY', httpStatusCode: 200, httpsSpellingUrl: SPELLING },
      undefined,
      NOW,
    );
    expect(resolved.entry).toEqual({
      url: HTTP,
      healthStatus: 'HEALTHY',
      httpStatusCode: 200,
      httpsSpellingUrl: SPELLING,
      checkedAt: NOW,
    });
  });

  it('keeps the spelling with a decisive verdict an inconclusive probe preserved', () => {
    const resolved = resolveSourceLinkHealthEntry(
      HTTP,
      { healthStatus: 'UNKNOWN', httpStatusCode: 503 },
      { url: HTTP, healthStatus: 'HEALTHY', httpsSpellingUrl: SPELLING, checkedAt: EARLIER },
      NOW,
    );
    expect(resolved.preservedDecisiveVerdict).toBe(true);
    expect(resolved.entry.httpsSpellingUrl).toBe(SPELLING);
  });

  it('drops the spelling when a fresh decisive probe no longer records one', () => {
    const resolved = resolveSourceLinkHealthEntry(
      HTTP,
      { healthStatus: 'HEALTHY', httpStatusCode: 200 },
      { url: HTTP, healthStatus: 'HEALTHY', httpsSpellingUrl: SPELLING, checkedAt: EARLIER },
      NOW,
    );
    expect(resolved.entry.httpsSpellingUrl).toBeUndefined();
  });
});

describe('resolveSourceLinkHealthEntry on a probe that never reached the host', () => {
  it('keeps a stored certificate failure when the guard refused a split-horizon host', () => {
    const resolved = resolveSourceLinkHealthEntry(
      URL_A,
      { healthStatus: 'UNKNOWN', publicAddressHost: true },
      { url: URL_A, healthStatus: 'UNKNOWN', tlsVerificationFailed: true, checkedAt: EARLIER },
      NOW,
    );
    expect(resolved.preservedUnreachedVerdict).toBe(true);
    expect(resolved.entry).toEqual({
      url: URL_A,
      healthStatus: 'UNKNOWN',
      tlsVerificationFailed: true,
      checkedAt: EARLIER,
      lastAttemptedAt: NOW,
    });
  });

  it('keeps the certificate failure on a stored HEALTHY verdict through a timeout', () => {
    const resolved = resolveSourceLinkHealthEntry(
      URL_A,
      { healthStatus: 'UNKNOWN' },
      {
        url: URL_A,
        healthStatus: 'HEALTHY',
        httpStatusCode: 200,
        tlsVerificationFailed: true,
        checkedAt: EARLIER,
      },
      NOW,
    );
    expect(resolved.preservedDecisiveVerdict).toBe(true);
    expect(resolved.entry).toEqual({
      url: URL_A,
      healthStatus: 'HEALTHY',
      httpStatusCode: 200,
      tlsVerificationFailed: true,
      checkedAt: EARLIER,
      lastAttemptedAt: NOW,
    });
  });

  it('releases a stored private-address flag once public DNS answers a public address', () => {
    const resolved = resolveSourceLinkHealthEntry(
      URL_A,
      { healthStatus: 'UNKNOWN', publicAddressHost: true },
      { url: URL_A, healthStatus: 'UNKNOWN', privateAddressHost: true, checkedAt: EARLIER },
      NOW,
    );
    expect(resolved.entry.privateAddressHost).toBeUndefined();
  });

  it('keeps a stored private-address flag when public DNS also answers private', () => {
    const resolved = resolveSourceLinkHealthEntry(
      URL_A,
      { healthStatus: 'UNKNOWN', privateAddressHost: true },
      { url: URL_A, healthStatus: 'UNKNOWN', privateAddressHost: true, checkedAt: EARLIER },
      NOW,
    );
    expect(resolved.entry.privateAddressHost).toBe(true);
  });

  it('still lets a probe that reached the server replace a stored certificate failure', () => {
    const resolved = resolveSourceLinkHealthEntry(
      URL_A,
      { healthStatus: 'UNKNOWN', httpStatusCode: 403 },
      { url: URL_A, healthStatus: 'UNKNOWN', tlsVerificationFailed: true, checkedAt: EARLIER },
      NOW,
    );
    expect(resolved.preservedUnreachedVerdict).toBeUndefined();
    expect(resolved.entry).toEqual({
      url: URL_A,
      healthStatus: 'UNKNOWN',
      httpStatusCode: 403,
      checkedAt: NOW,
    });
  });

  it('still records a confirmed DNS or connection negative as gone', () => {
    const resolved = resolveSourceLinkHealthEntry(
      URL_A,
      { healthStatus: 'UNAVAILABLE' },
      { url: URL_A, healthStatus: 'HEALTHY', httpStatusCode: 200, checkedAt: EARLIER },
      NOW,
    );
    expect(resolved.entry).toEqual({ url: URL_A, healthStatus: 'UNAVAILABLE', checkedAt: NOW });
  });

  it('writes the unreached probe when nothing is stored', () => {
    const resolved = resolveSourceLinkHealthEntry(
      URL_A,
      { healthStatus: 'UNKNOWN' },
      undefined,
      NOW,
    );
    expect(resolved.preservedUnreachedVerdict).toBeUndefined();
    expect(resolved.entry).toEqual({ url: URL_A, healthStatus: 'UNKNOWN', checkedAt: NOW });
  });
});

describe('tallySourceLinkVerdictTransition', () => {
  const emptyTally = () => ({ verdictTransitions: {}, clearedTlsFlags: 0, servedWebsitesLost: 0 });

  it('ignores a renewed checkedAt on an unchanged verdict', () => {
    const tally = emptyTally();
    tallySourceLinkVerdictTransition(
      tally,
      { url: URL_A, healthStatus: 'HEALTHY', checkedAt: EARLIER },
      { url: URL_A, healthStatus: 'HEALTHY', checkedAt: NOW },
      true,
    );
    expect(tally).toEqual(emptyTally());
  });

  it('counts a cleared certificate failure', () => {
    const tally = emptyTally();
    tallySourceLinkVerdictTransition(
      tally,
      { url: URL_A, healthStatus: 'UNKNOWN', tlsVerificationFailed: true },
      { url: URL_A, healthStatus: 'UNKNOWN' },
      false,
    );
    expect(tally).toEqual({
      verdictTransitions: { 'UNKNOWN+TLS->UNKNOWN': 1 },
      clearedTlsFlags: 1,
      servedWebsitesLost: 0,
    });
  });

  it('counts a served website that stops being followable, and only a served website', () => {
    const tally = emptyTally();
    const before = { url: URL_A, healthStatus: 'HEALTHY' as const, httpStatusCode: 200 };
    const after = { url: URL_A, healthStatus: 'UNAVAILABLE' as const, httpStatusCode: 404 };
    tallySourceLinkVerdictTransition(tally, before, after, true);
    tallySourceLinkVerdictTransition(tally, before, after, false);
    expect(tally.servedWebsitesLost).toBe(1);
    expect(tally.verdictTransitions).toEqual({ 'HEALTHY->UNAVAILABLE': 2 });
  });

  it('labels a never-probed URL as NONE', () => {
    expect(sourceLinkVerdictSignature(undefined)).toBe('NONE');
    expect(
      sourceLinkVerdictSignature({ url: URL_A, healthStatus: 'UNKNOWN', privateAddressHost: true }),
    ).toBe('UNKNOWN+PRIVATE');
  });
});
