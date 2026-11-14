import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SourceLinkProbeResult } from '../../services/sourceLinkHealth';

const probeMock = vi.hoisted(() => vi.fn<(url: string) => Promise<SourceLinkProbeResult>>());

vi.mock('../../services/sourceLinkHealth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/sourceLinkHealth')>()),
  probeSourceLink: probeMock,
}));

const { probeRetractionValueLiveness, withholdSoleHolderRetractionsThatStillAnswer } =
  await import('../fieldRetraction');

const URL = 'https://lapsed.example.edu/lab/';
const NOW = new Date('2026-11-14T12:00:00Z');
const hoursBefore = (hours: number) => new Date(NOW.getTime() - hours * 60 * 60 * 1000);

const storedNameAbsent = (hoursAgo: number) => [
  { url: URL, healthStatus: 'UNAVAILABLE', checkedAt: hoursBefore(hoursAgo) },
];

const storedRefusedConfirmedByMarker = (hoursAgo: number) => [
  {
    url: URL,
    healthStatus: 'UNAVAILABLE',
    checkedAt: hoursBefore(hoursAgo),
    pendingConnectionFailureAt: hoursBefore(hoursAgo + 7),
    pendingConnectionFailureProbedAt: hoursBefore(hoursAgo + 7),
    confirmingConnectionFailureAt: hoursBefore(hoursAgo),
  },
];

const storedRefusedWithoutLiveVerdict = (hoursAgo: number) => [
  {
    url: URL,
    healthStatus: 'UNAVAILABLE',
    checkedAt: hoursBefore(hoursAgo),
    connectionLevelFailure: true,
  },
];

beforeEach(() => probeMock.mockReset());

describe('the retraction probe confirms a lane absence only with a second observation (#6264)', () => {
  it('retracts on a 404, which the lane absence plus this probe make two observations', async () => {
    probeMock.mockResolvedValue({ status: 404, requestedUrl: URL, finalUrl: URL });
    expect(await probeRetractionValueLiveness(URL, { now: NOW })).toEqual({
      positivelyDead: true,
      basis: 'gone-status',
    });
  });

  it('keeps the #3135 rule that a redirect loop means the address no longer serves it', async () => {
    probeMock.mockResolvedValue({ errorCode: 'ERR_FR_TOO_MANY_REDIRECTS', requestedUrl: URL });
    expect(await probeRetractionValueLiveness(URL, { now: NOW })).toEqual({
      positivelyDead: true,
      basis: 'address-no-longer-serves',
    });
  });

  it('no longer retracts on a single DNS negative with no stored host-level verdict', async () => {
    probeMock.mockResolvedValue({ errorCode: 'ENOTFOUND', requestedUrl: URL });
    expect(await probeRetractionValueLiveness(URL, { now: NOW })).toEqual({
      positivelyDead: false,
    });
  });

  it('retracts on a DNS negative that a stored one from at least 6 hours earlier agrees with', async () => {
    probeMock.mockResolvedValue({ errorCode: 'ENOTFOUND', requestedUrl: URL });
    expect(
      await probeRetractionValueLiveness(URL, { storedHealth: storedNameAbsent(7), now: NOW }),
    ).toEqual({ positivelyDead: true, basis: 'name-absent' });
  });

  it.each([
    [
      'a refused connection the backfill confirmed over a live verdict',
      storedRefusedConfirmedByMarker,
    ],
    ['a refused connection stored with no live verdict before it', storedRefusedWithoutLiveVerdict],
  ])('never pairs a fresh DNS negative with %s', async (_label, stored) => {
    probeMock.mockResolvedValue({ errorCode: 'ENOTFOUND', requestedUrl: URL });
    expect(await probeRetractionValueLiveness(URL, { storedHealth: stored(7), now: NOW })).toEqual({
      positivelyDead: false,
    });
  });

  it.each([
    [
      'a refused connection the backfill confirmed over a live verdict',
      storedRefusedConfirmedByMarker,
    ],
    ['a refused connection stored with no live verdict before it', storedRefusedWithoutLiveVerdict],
  ])('retracts on a refused connection that agrees with %s', async (_label, stored) => {
    probeMock.mockResolvedValue({ errorCode: 'ECONNREFUSED', requestedUrl: URL });
    expect(await probeRetractionValueLiveness(URL, { storedHealth: stored(7), now: NOW })).toEqual({
      positivelyDead: true,
      basis: 'connection-refused',
    });
  });

  it('never pairs a fresh refused connection with a stored DNS negative', async () => {
    probeMock.mockResolvedValue({ errorCode: 'ECONNREFUSED', requestedUrl: URL });
    expect(
      await probeRetractionValueLiveness(URL, { storedHealth: storedNameAbsent(7), now: NOW }),
    ).toEqual({ positivelyDead: false });
  });

  it('holds a DNS negative seen again under 6 hours later', async () => {
    probeMock.mockResolvedValue({ errorCode: 'ENOTFOUND', requestedUrl: URL });
    expect(
      await probeRetractionValueLiveness(URL, { storedHealth: storedNameAbsent(2), now: NOW }),
    ).toEqual({ positivelyDead: false });
  });

  it('never counts a split-horizon Yale host that resolves only privately on campus (#6123)', async () => {
    probeMock.mockResolvedValue({
      errorCode: 'ERR_SSRF_BLOCKED',
      requestedUrl: URL,
      privateAddressHost: true,
    });
    expect(
      await probeRetractionValueLiveness(URL, { storedHealth: storedNameAbsent(7), now: NOW }),
    ).toEqual({ positivelyDead: false });
  });

  it.each([
    ['our own pause of the host', { errorCode: 'ERR_EXCLUDED_HOST', excludedHost: true as const }],
    ['a timeout', { errorCode: 'ECONNABORTED' }],
    ['a throttle', { status: 429 }],
  ])('never counts %s', async (_label, result) => {
    probeMock.mockResolvedValue({ requestedUrl: URL, ...result });
    expect(
      await probeRetractionValueLiveness(URL, { storedHealth: storedNameAbsent(7), now: NOW }),
    ).toEqual({ positivelyDead: false });
  });
});

describe('sole-holder retractions report their removals per host (#6264)', () => {
  it('lists each host once with the count it retired', async () => {
    const retraction = (entityId: string, value: string) => ({
      entityId,
      entityKey: `synthetic-${entityId}`,
      field: 'websiteUrl',
      observationIds: [`obs-${entityId}`],
      clearsStoredValue: true,
      retractedValues: [value],
      maxEntitiesSharingAValue: 1,
    });
    const result = await withholdSoleHolderRetractionsThatStillAnswer(
      [
        retraction('a', 'https://lapsed.example.edu/one/'),
        retraction('b', 'https://lapsed.example.edu/two/'),
        retraction('c', 'https://alive.example.edu/'),
        retraction('d', 'https://moved.example.edu/'),
      ],
      async (value) => {
        if (value.includes('lapsed')) return { positivelyDead: true, basis: 'name-absent' };
        if (value.includes('moved')) {
          return { positivelyDead: true, basis: 'address-no-longer-serves' };
        }
        return { positivelyDead: false };
      },
    );
    expect(result.retained).toHaveLength(3);
    expect(result.withheld).toHaveLength(1);
    expect(result.removalsByHost).toEqual([
      { host: 'lapsed.example.edu', count: 2, byBasis: { 'name-absent': 2 } },
      { host: 'moved.example.edu', count: 1, byBasis: { 'address-no-longer-serves': 1 } },
    ]);
  });
});
