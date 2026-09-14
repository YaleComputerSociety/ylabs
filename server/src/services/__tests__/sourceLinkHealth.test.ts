import { beforeEach, describe, expect, it, vi } from 'vitest';

const requestMock = vi.fn();

vi.mock('axios', () => ({
  default: { request: (...args: unknown[]) => requestMock(...args) },
}));

const { MockSsrfBlockedError, assertPublicHttpUrlMock } = vi.hoisted(() => {
  class HoistedSsrfBlockedError extends Error {
    readonly reason: string;

    constructor(message: string, reason: string) {
      super(message);
      this.name = 'SsrfBlockedError';
      this.reason = reason;
      Object.setPrototypeOf(this, HoistedSsrfBlockedError.prototype);
    }
  }
  return {
    MockSsrfBlockedError: HoistedSsrfBlockedError,
    assertPublicHttpUrlMock: vi.fn(async (url: string) => new URL(url)),
  };
});

vi.mock('../../utils/ssrfGuard', () => ({
  assertPublicHttpUrl: (url: string) => assertPublicHttpUrlMock(url),
  SsrfBlockedError: MockSsrfBlockedError,
  ssrfSafeAgents: () => ({ httpAgent: undefined, httpsAgent: undefined }),
}));

import {
  SOURCE_LINK_HEALTH_FRESHNESS_DAYS,
  classifySourceLinkHealth,
  isLikelyUnavailableSourceLink,
  isStaleSourceLinkHealth,
  findSourceLinkHealth,
  isKnownDeadSourceUrl,
  isVerifiedReachableSourceLink,
  landsAwayFromRequestedResource,
  sourceLinkHealthKey,
  probeSourceLink,
  hasLiveSourceCitation,
} from '../sourceLinkHealth';

const daysAgo = (days: number, now = new Date('2026-09-10T00:00:00.000Z')): Date =>
  new Date(now.getTime() - days * 86_400_000);

const NOW = new Date('2026-09-10T00:00:00.000Z');

describe('classifySourceLinkHealth', () => {
  it('treats 2xx responses as healthy', () => {
    expect(classifySourceLinkHealth({ status: 200 })).toEqual({
      healthStatus: 'HEALTHY',
      httpStatusCode: 200,
    });
  });

  it('treats 3xx responses as redirected but reachable', () => {
    expect(classifySourceLinkHealth({ status: 301 })).toEqual({
      healthStatus: 'REDIRECTED',
      httpStatusCode: 301,
    });
  });

  it('retires a link only on a status that asserts the resource is gone', () => {
    expect(classifySourceLinkHealth({ status: 404 })).toEqual({
      healthStatus: 'UNAVAILABLE',
      httpStatusCode: 404,
    });
    expect(classifySourceLinkHealth({ status: 410 })).toEqual({
      healthStatus: 'UNAVAILABLE',
      httpStatusCode: 410,
    });
  });

  it.each([401, 403, 429, 500, 503])(
    'leaves %i inconclusive so access control, throttling, and outages never retire a link',
    (status) => {
      expect(classifySourceLinkHealth({ status })).toEqual({
        healthStatus: 'UNKNOWN',
        httpStatusCode: status,
      });
    },
  );

  it('treats dead-domain network errors as unavailable without a status', () => {
    expect(classifySourceLinkHealth({ errorCode: 'ENOTFOUND' })).toEqual({
      healthStatus: 'UNAVAILABLE',
    });
    expect(classifySourceLinkHealth({ errorCode: 'ECONNREFUSED' })).toEqual({
      healthStatus: 'UNAVAILABLE',
    });
  });

  it('leaves ambiguous failures (timeout, blocked) as unknown so temporary blips are not marked', () => {
    expect(classifySourceLinkHealth({ errorCode: 'ECONNABORTED' })).toEqual({
      healthStatus: 'UNKNOWN',
    });
    expect(classifySourceLinkHealth({ errorCode: 'ERR_SSRF_BLOCKED' })).toEqual({
      healthStatus: 'UNKNOWN',
    });
    expect(classifySourceLinkHealth({})).toEqual({ healthStatus: 'UNKNOWN' });
  });
});

describe('probeSourceLink', () => {
  beforeEach(() => {
    requestMock.mockReset();
    assertPublicHttpUrlMock.mockReset();
    assertPublicHttpUrlMock.mockImplementation(async (url: string) => new URL(url));
  });

  const blockedWith = (reason: string) => {
    assertPublicHttpUrlMock.mockRejectedValueOnce(
      new MockSsrfBlockedError('URL resolves to a private or non-public address', reason),
    );
  };

  it('reports a name with no DNS record as ENOTFOUND so it can be classified dead (#2709)', async () => {
    blockedWith('unresolvable');
    const probe = await probeSourceLink('https://gone.example.edu/profile');
    expect(probe).toEqual({ errorCode: 'ENOTFOUND' });
    expect(classifySourceLinkHealth(probe)).toEqual({ healthStatus: 'UNAVAILABLE' });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('keeps a private-address refusal inconclusive, because that is a fact about us', async () => {
    blockedWith('private-address');
    const probe = await probeSourceLink('https://internal.example.edu/profile');
    expect(probe).toEqual({ errorCode: 'ERR_SSRF_BLOCKED' });
    expect(classifySourceLinkHealth(probe)).toEqual({ healthStatus: 'UNKNOWN' });
  });

  it('keeps a resolver failure inconclusive, so a DNS blip never retires a live citation', async () => {
    blockedWith('resolver-failure');
    const probe = await probeSourceLink('https://slow-dns.example.edu/profile');
    expect(probe).toEqual({ errorCode: 'ERR_SSRF_BLOCKED' });
    expect(classifySourceLinkHealth(probe)).toEqual({ healthStatus: 'UNKNOWN' });
  });

  it('keeps every other guard refusal inconclusive', async () => {
    for (const reason of ['invalid-url', 'unsupported-scheme', 'credentials', 'port']) {
      blockedWith(reason);
      const probe = await probeSourceLink('https://example.edu/profile');
      expect(probe, reason).toEqual({ errorCode: 'ERR_SSRF_BLOCKED' });
    }
  });

  it('does not read a non-SsrfBlockedError rejection as a dead host', async () => {
    assertPublicHttpUrlMock.mockRejectedValueOnce(new Error('boom'));
    await expect(probeSourceLink('https://example.edu/profile')).resolves.toEqual({
      errorCode: 'ERR_SSRF_BLOCKED',
    });
  });

  const headOnlyStatus = (status: number) => {
    requestMock.mockResolvedValueOnce({ status });
  };

  it('uses the HEAD status directly when HEAD succeeds', async () => {
    headOnlyStatus(200);
    await expect(probeSourceLink('https://example.com/paper')).resolves.toEqual({
      status: 200,
      requestedUrl: 'https://example.com/paper',
    });
    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(requestMock.mock.calls[0][0]).toMatchObject({ method: 'HEAD' });
  });

  it.each([400, 403, 405, 501, 500])(
    'falls back to GET when HEAD returns %i and reports the GET status',
    async (headStatus) => {
      const destroy = vi.fn();
      requestMock
        .mockResolvedValueOnce({ status: headStatus })
        .mockResolvedValueOnce({ status: 200, data: { destroy } });

      await expect(probeSourceLink('https://example.com/paper')).resolves.toEqual({
        status: 200,
        requestedUrl: 'https://example.com/paper',
      });
      expect(requestMock).toHaveBeenCalledTimes(2);
      expect(requestMock.mock.calls[1][0]).toMatchObject({ method: 'GET' });
      expect(destroy).toHaveBeenCalledTimes(1);
    },
  );

  it('reports the GET status when the GET fallback also fails', async () => {
    requestMock
      .mockResolvedValueOnce({ status: 501 })
      .mockResolvedValueOnce({ status: 404, data: { destroy: vi.fn() } });

    await expect(probeSourceLink('https://example.com/paper')).resolves.toEqual({
      status: 404,
      requestedUrl: 'https://example.com/paper',
    });
  });

  // The property name is the whole point of this test. `follow-redirects` sets
  // `responseUrl`; the upper-case `responseURL` is the browser XHR spelling and
  // is always undefined under the Node adapter. An earlier version of this test
  // asserted the upper-case spelling, so it passed while soft-404 detection was
  // inert against every real probe.
  it('reports the post-redirect landing url from the property follow-redirects actually sets', async () => {
    requestMock.mockResolvedValueOnce({
      status: 200,
      request: { res: { responseUrl: 'https://engineering.yale.edu/research-and-faculty' } },
    });

    await expect(
      probeSourceLink('https://seas.yale.edu/faculty-directory/a-person'),
    ).resolves.toEqual({
      status: 200,
      requestedUrl: 'https://seas.yale.edu/faculty-directory/a-person',
      finalUrl: 'https://engineering.yale.edu/research-and-faculty',
    });
  });

  it('falls back to the redirectable current url when the IncomingMessage carries none', async () => {
    requestMock.mockResolvedValueOnce({
      status: 200,
      request: {
        res: {},
        _redirectable: { _currentUrl: 'https://engineering.yale.edu/research-and-faculty' },
      },
    });

    await expect(
      probeSourceLink('https://seas.yale.edu/faculty-directory/a-person'),
    ).resolves.toEqual({
      status: 200,
      requestedUrl: 'https://seas.yale.edu/faculty-directory/a-person',
      finalUrl: 'https://engineering.yale.edu/research-and-faculty',
    });
  });

  it('ignores the browser-only responseURL spelling, which is never set under Node', async () => {
    requestMock.mockResolvedValueOnce({
      status: 200,
      request: { res: { responseURL: 'https://engineering.yale.edu/research-and-faculty' } },
    });

    const probe = await probeSourceLink('https://seas.yale.edu/faculty-directory/a-person');
    expect(probe.finalUrl).toBeUndefined();
  });

  it('retries once on a transport failure before recording an inconclusive verdict', async () => {
    requestMock
      .mockRejectedValueOnce(Object.assign(new Error('timeout'), { code: 'ECONNABORTED' }))
      .mockResolvedValueOnce({ status: 200 });

    await expect(probeSourceLink('https://www.cs.yale.edu/homes/someone/')).resolves.toEqual({
      status: 200,
      requestedUrl: 'https://www.cs.yale.edu/homes/someone/',
    });
    expect(requestMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a dead domain, whose verdict a second attempt cannot change', async () => {
    requestMock.mockRejectedValueOnce(Object.assign(new Error('dns'), { code: 'ENOTFOUND' }));

    await expect(probeSourceLink('https://gone.example.com/lab')).resolves.toEqual({
      errorCode: 'ENOTFOUND',
      requestedUrl: 'https://gone.example.com/lab',
    });
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it('raises the timeout past the 7s that turned slow legacy hosts into UNKNOWN', async () => {
    headOnlyStatus(200);
    await probeSourceLink('https://www.astro.yale.edu/someone/');
    expect(requestMock.mock.calls[0][0].timeout).toBeGreaterThan(7000);
  });
});

describe('isLikelyUnavailableSourceLink', () => {
  it('is true for UNAVAILABLE health or a status asserting the resource is gone', () => {
    expect(isLikelyUnavailableSourceLink({ healthStatus: 'UNAVAILABLE' })).toBe(true);
    expect(isLikelyUnavailableSourceLink({ healthStatus: 'UNKNOWN', httpStatusCode: 404 })).toBe(
      true,
    );
    expect(isLikelyUnavailableSourceLink({ healthStatus: 'HEALTHY', httpStatusCode: 410 })).toBe(
      true,
    );
  });

  it.each([401, 403, 429, 500, 503])('is false for an inconclusive %i status', (httpStatusCode) => {
    expect(isLikelyUnavailableSourceLink({ healthStatus: 'UNKNOWN', httpStatusCode })).toBe(false);
  });

  it('is false for healthy, redirected, unknown, or missing health', () => {
    expect(isLikelyUnavailableSourceLink({ healthStatus: 'HEALTHY', httpStatusCode: 200 })).toBe(
      false,
    );
    expect(isLikelyUnavailableSourceLink({ healthStatus: 'REDIRECTED', httpStatusCode: 301 })).toBe(
      false,
    );
    expect(isLikelyUnavailableSourceLink({ healthStatus: 'UNKNOWN' })).toBe(false);
    expect(isLikelyUnavailableSourceLink(undefined)).toBe(false);
  });
});

describe('landsAwayFromRequestedResource', () => {
  it('is false when the landing keeps the requested resource', () => {
    expect(
      landsAwayFromRequestedResource(
        'http://physics.yale.edu/people/a-person',
        'https://physics.yale.edu/people/a-person/',
      ),
    ).toBe(false);
    expect(
      landsAwayFromRequestedResource(
        'https://example.yale.edu/lab/thing',
        'https://www.example.yale.edu/lab/thing',
      ),
    ).toBe(false);
  });

  it('is false for a genuine per-person move that still names the person', () => {
    expect(
      landsAwayFromRequestedResource(
        'https://physics.yale.edu/people/a-person',
        'https://physics.yale.edu/profile/a-person',
      ),
    ).toBe(false);
  });

  it('is true when a requested page lands on the SAME host root', () => {
    expect(
      landsAwayFromRequestedResource('https://art.yale.edu/SomePerson', 'https://art.yale.edu/'),
    ).toBe(true);
  });

  // Measured on live data: 12 of the first 15 detections were this shape, and all
  // 12 were research homes that had moved rather than pages that stopped
  // existing. A cross-host landing on a root is a migration.
  it.each([
    ['http://www.yale.edu/lamoreauxgroup/', 'https://lamoreauxgroup.yale.edu/'],
    ['http://www.yale.edu/pollard_lab/', 'https://pollardlab.yale.edu/'],
    ['http://faculty.som.yale.edu/peterschott', 'https://sompks4.github.io/'],
    ['http://politicalscience.yale.edu/people/ian-shapiro', 'https://shapiro.macmillan.yale.edu/'],
    ['https://ysph.yale.edu/olaga/', 'https://www.olaga.org/'],
  ])('is false for a migration to another host root (%s)', (requested, final) => {
    expect(landsAwayFromRequestedResource(requested, final)).toBe(false);
  });

  it('keeps the shared-roster arm cross-host, since a roster landing is about the person', () => {
    expect(
      landsAwayFromRequestedResource(
        'http://publichealth.yale.edu/people/a_person.profile',
        'https://ysph.yale.edu/school-of-public-health-faculty/',
      ),
    ).toBe(true);
  });

  it('is true when a requested person page lands on a shared roster', () => {
    expect(
      landsAwayFromRequestedResource(
        'https://seas.yale.edu/faculty-research/faculty-directory/a-person',
        'https://engineering.yale.edu/research-and-faculty/faculty-directory',
      ),
    ).toBe(true);
  });

  it('is false when the requested url was itself a roster', () => {
    expect(
      landsAwayFromRequestedResource(
        'https://example.yale.edu/people/faculty',
        'https://example.yale.edu/people/core-faculty',
      ),
    ).toBe(false);
  });

  it('is false when either url is unparseable, so a bad record never retires a link', () => {
    expect(landsAwayFromRequestedResource(undefined, 'https://example.yale.edu/')).toBe(false);
    expect(landsAwayFromRequestedResource('not a url', 'https://example.yale.edu/')).toBe(false);
  });
});

describe('classifySourceLinkHealth soft 404 handling', () => {
  it('records a 200 that lands on a roster root as unavailable', () => {
    expect(
      classifySourceLinkHealth({
        status: 200,
        requestedUrl: 'https://seas.yale.edu/faculty-research/faculty-directory/a-person',
        finalUrl: 'https://engineering.yale.edu/research-and-faculty/faculty-directory',
      }),
    ).toEqual({ healthStatus: 'UNAVAILABLE', httpStatusCode: 200 });
  });

  it('keeps a 200 that lands on the requested resource healthy', () => {
    expect(
      classifySourceLinkHealth({
        status: 200,
        requestedUrl: 'https://example.yale.edu/lab/thing',
        finalUrl: 'https://example.yale.edu/lab/thing/',
      }),
    ).toEqual({ healthStatus: 'HEALTHY', httpStatusCode: 200 });
  });

  it('keeps a 200 healthy when no landing url was captured', () => {
    expect(
      classifySourceLinkHealth({ status: 200, requestedUrl: 'https://example.yale.edu/lab/thing' }),
    ).toEqual({ healthStatus: 'HEALTHY', httpStatusCode: 200 });
  });
});

describe('isStaleSourceLinkHealth', () => {
  it('is false inside the freshness horizon', () => {
    expect(
      isStaleSourceLinkHealth(
        { healthStatus: 'HEALTHY', checkedAt: daysAgo(SOURCE_LINK_HEALTH_FRESHNESS_DAYS - 1) },
        NOW,
      ),
    ).toBe(false);
  });

  it('is true past the horizon', () => {
    expect(
      isStaleSourceLinkHealth(
        { healthStatus: 'HEALTHY', checkedAt: daysAgo(SOURCE_LINK_HEALTH_FRESHNESS_DAYS + 1) },
        NOW,
      ),
    ).toBe(true);
  });

  it('treats an undated verdict as stale, since it cannot be shown to be current', () => {
    expect(isStaleSourceLinkHealth({ healthStatus: 'HEALTHY' }, NOW)).toBe(true);
  });

  it('accepts a serialized date string', () => {
    expect(
      isStaleSourceLinkHealth(
        { healthStatus: 'HEALTHY', checkedAt: daysAgo(400).toISOString() },
        NOW,
      ),
    ).toBe(true);
  });

  it('is false for a missing record, which asserts nothing at all', () => {
    expect(isStaleSourceLinkHealth(undefined, NOW)).toBe(false);
  });
});

describe('isVerifiedReachableSourceLink', () => {
  it('requires both a reachable verdict and a fresh one', () => {
    expect(
      isVerifiedReachableSourceLink({ healthStatus: 'HEALTHY', checkedAt: daysAgo(1) }, NOW),
    ).toBe(true);
    expect(
      isVerifiedReachableSourceLink({ healthStatus: 'REDIRECTED', checkedAt: daysAgo(1) }, NOW),
    ).toBe(true);
  });

  it('refuses a stale HEALTHY, the record that defeated serve-time suppression', () => {
    expect(
      isVerifiedReachableSourceLink({ healthStatus: 'HEALTHY', checkedAt: daysAgo(400) }, NOW),
    ).toBe(false);
  });

  it('refuses inconclusive and dead verdicts', () => {
    expect(
      isVerifiedReachableSourceLink({ healthStatus: 'UNKNOWN', checkedAt: daysAgo(1) }, NOW),
    ).toBe(false);
    expect(
      isVerifiedReachableSourceLink({ healthStatus: 'UNAVAILABLE', checkedAt: daysAgo(1) }, NOW),
    ).toBe(false);
    expect(isVerifiedReachableSourceLink(undefined, NOW)).toBe(false);
  });

  it('is not the negation of isLikelyUnavailableSourceLink', () => {
    const stale = { healthStatus: 'HEALTHY' as const, checkedAt: daysAgo(400) };
    expect(isVerifiedReachableSourceLink(stale, NOW)).toBe(false);
    expect(isLikelyUnavailableSourceLink(stale)).toBe(false);
  });
});

describe('sourceLinkHealthKey', () => {
  it('ignores scheme, www, host case, and a trailing slash', () => {
    const canonical = sourceLinkHealthKey('https://art.yale.edu/SomePerson');
    expect(sourceLinkHealthKey('http://www.ART.yale.edu/SomePerson/')).toBe(canonical);
  });

  it('keeps distinct paths and queries apart', () => {
    expect(sourceLinkHealthKey('https://a.yale.edu/x')).not.toBe(
      sourceLinkHealthKey('https://a.yale.edu/y'),
    );
    expect(sourceLinkHealthKey('https://a.yale.edu/x?id=1')).not.toBe(
      sourceLinkHealthKey('https://a.yale.edu/x?id=2'),
    );
  });

  it('is null for a non-url', () => {
    expect(sourceLinkHealthKey('not a url')).toBeNull();
    expect(sourceLinkHealthKey(undefined)).toBeNull();
    expect(sourceLinkHealthKey('')).toBeNull();
  });
});

describe('isKnownDeadSourceUrl', () => {
  const dead = [
    { url: 'https://art.yale.edu/SomePerson', healthStatus: 'UNAVAILABLE', httpStatusCode: 404 },
  ];

  it('is true for a url the corpus recorded as gone', () => {
    expect(isKnownDeadSourceUrl(dead, 'https://art.yale.edu/SomePerson')).toBe(true);
  });

  it('matches across cosmetic url differences', () => {
    expect(isKnownDeadSourceUrl(dead, 'http://www.art.yale.edu/SomePerson/')).toBe(true);
  });

  it('is false for an unprobed url, so silence never demotes an entity', () => {
    expect(isKnownDeadSourceUrl(dead, 'https://art.yale.edu/OtherPerson')).toBe(false);
    expect(isKnownDeadSourceUrl([], 'https://art.yale.edu/SomePerson')).toBe(false);
    expect(isKnownDeadSourceUrl(undefined, 'https://art.yale.edu/SomePerson')).toBe(false);
  });

  it('is false for an inconclusive verdict', () => {
    expect(
      isKnownDeadSourceUrl(
        [{ url: 'https://slow.yale.edu/lab', healthStatus: 'UNKNOWN', httpStatusCode: 403 }],
        'https://slow.yale.edu/lab',
      ),
    ).toBe(false);
  });

  it('is false for a stale HEALTHY, which is unverified rather than dead', () => {
    expect(
      isKnownDeadSourceUrl(
        [{ url: 'https://a.yale.edu/lab', healthStatus: 'HEALTHY', checkedAt: daysAgo(400) }],
        'https://a.yale.edu/lab',
      ),
    ).toBe(false);
  });
});

describe('findSourceLinkHealth', () => {
  it('returns the stored verdict with its status code and checkedAt', () => {
    const checkedAt = daysAgo(3);
    expect(
      findSourceLinkHealth(
        [
          {
            url: 'https://a.yale.edu/lab',
            healthStatus: 'HEALTHY',
            httpStatusCode: 200,
            checkedAt,
          },
        ],
        'https://a.yale.edu/lab/',
      ),
    ).toEqual({ healthStatus: 'HEALTHY', httpStatusCode: 200, checkedAt });
  });

  it('ignores a malformed entry rather than reading it as a verdict', () => {
    expect(
      findSourceLinkHealth([{ url: 'https://a.yale.edu/lab' }], 'https://a.yale.edu/lab'),
    ).toBeUndefined();
  });
});

describe('hasLiveSourceCitation', () => {
  const dead = (url: string) => ({
    url,
    healthStatus: 'UNAVAILABLE' as const,
    httpStatusCode: 404,
  });
  const live = (url: string) => ({ url, healthStatus: 'HEALTHY' as const, httpStatusCode: 200 });

  it('is true when a stored citation is healthy', () => {
    expect(
      hasLiveSourceCitation({
        sourceUrls: ['https://sph.yale.edu/profile/avery-marlowe'],
        sourceLinkHealth: [live('https://sph.yale.edu/profile/avery-marlowe')],
      }),
    ).toBe(true);
  });

  // Fails OPEN on silence, matching isKnownDeadSourceUrl: an unprobed corpus must
  // never be mass-demoted.
  it('is true when citations exist but none have been probed', () => {
    expect(
      hasLiveSourceCitation({ sourceUrls: ['https://sph.yale.edu/profile/avery-marlowe'] }),
    ).toBe(true);
    expect(
      hasLiveSourceCitation({
        sourceUrls: ['https://a.yale.edu/x'],
        sourceLinkHealth: [
          { url: 'https://a.yale.edu/x', healthStatus: 'UNKNOWN', httpStatusCode: 403 },
        ],
      }),
    ).toBe(true);
  });

  it('is true when one of several citations survives', () => {
    expect(
      hasLiveSourceCitation({
        sourceUrls: ['https://a.yale.edu/dead', 'https://a.yale.edu/live'],
        sourceLinkHealth: [dead('https://a.yale.edu/dead'), live('https://a.yale.edu/live')],
      }),
    ).toBe(true);
  });

  // The #2635 case: sourceUrls emptied by a dead-link repair, provenance holding
  // only 404s, and the entity published as student_ready on that basis.
  it('is false when sourceUrls is empty and every provenance source is dead', () => {
    expect(
      hasLiveSourceCitation({
        sourceUrls: [],
        fieldProvenance: {
          name: { sourceUrl: 'http://art.yale.edu/MartaKuzma' },
          fullDescription: { sourceUrl: 'https://www.art.yale.edu/marta-kuzma' },
        },
        sourceLinkHealth: [
          dead('http://art.yale.edu/MartaKuzma'),
          dead('https://www.art.yale.edu/marta-kuzma'),
        ],
      }),
    ).toBe(false);
  });

  it('is true when sourceUrls is empty but provenance holds a live source', () => {
    expect(
      hasLiveSourceCitation({
        sourceUrls: [],
        fieldProvenance: { name: { sourceUrl: 'https://a.yale.edu/live' } },
        sourceLinkHealth: [live('https://a.yale.edu/live')],
      }),
    ).toBe(true);
  });

  it('is false when every stored and provenance citation is dead', () => {
    expect(
      hasLiveSourceCitation({
        sourceUrls: ['https://medicine.yale.edu/profile/rosa-xicola/'],
        fieldProvenance: {
          name: { sourceUrl: 'https://medicine.yale.edu/cancer/profile/rosa-xicola/' },
        },
        sourceLinkHealth: [
          dead('https://medicine.yale.edu/profile/rosa-xicola/'),
          dead('https://medicine.yale.edu/cancer/profile/rosa-xicola/'),
        ],
      }),
    ).toBe(false);
  });

  // No citation at all is the #1802 projection gap, which must stay soft. Failing
  // closed here would demote every organizational home the materializer has not
  // projected yet, which is why the first version of this helper broke three
  // existing gate tests.
  it('is true for an entity with no citation at all', () => {
    expect(hasLiveSourceCitation({})).toBe(true);
    expect(hasLiveSourceCitation({ sourceUrls: [], fieldProvenance: {} })).toBe(true);
    expect(hasLiveSourceCitation({ sourceUrls: ['', '   '] })).toBe(true);
  });

  it('ignores non-string and malformed entries rather than reading them as citations', () => {
    expect(
      hasLiveSourceCitation({ sourceUrls: [null, 7], fieldProvenance: { a: null, b: 'x' } }),
    ).toBe(true);
  });
});
