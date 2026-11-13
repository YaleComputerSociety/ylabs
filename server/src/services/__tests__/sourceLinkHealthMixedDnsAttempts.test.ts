import { beforeEach, describe, expect, it, vi } from 'vitest';

const requestMock = vi.fn();

vi.mock('axios', () => ({
  default: { request: (...args: unknown[]) => requestMock(...args) },
}));

const { classifyOffCampusAddressingMock } = vi.hoisted(() => ({
  classifyOffCampusAddressingMock: vi.fn(async (_hostname: string) => 'private-address'),
}));

vi.mock('../../utils/publicDnsResolution', () => ({
  classifyOffCampusAddressing: (hostname: string) => classifyOffCampusAddressingMock(hostname),
}));

const { assertPublicHttpUrlMock } = vi.hoisted(() => ({
  assertPublicHttpUrlMock: vi.fn(async (url: string) => new URL(url)),
}));

vi.mock('../../utils/ssrfGuard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/ssrfGuard')>()),
  assertPublicHttpUrl: (url: string) => assertPublicHttpUrlMock(url),
  ssrfSafeAgents: () => ({ httpAgent: undefined, httpsAgent: undefined }),
}));

import { SsrfBlockedError, ssrfSafeLookup } from '../../utils/ssrfGuard';

const guardRefusalAtConnect = (): Promise<Error> =>
  new Promise((resolve) => {
    ssrfSafeLookup('127.0.0.1', {}, (error) => resolve(error as Error));
  });

import {
  resolveSourceLinkHealthEntry,
  type StoredSourceLinkHealthEntry,
} from '../../scripts/backfillSourceLinkHealthCore';
import { classifySourceLinkHealth, probeSourceLink } from '../sourceLinkHealth';

const URL_A = 'https://lab.example.edu/research/';
const CHECKED = new Date('2026-11-01T00:00:00.000Z');
const RUN = new Date('2026-11-10T00:00:00.000Z');
const PROBE = new Date('2026-11-10T00:05:00.000Z');

const failure = (code: string) => {
  const error = new Error(code) as NodeJS.ErrnoException;
  error.code = code;
  return error;
};

const storedVerdicts: StoredSourceLinkHealthEntry[] = [
  { url: URL_A, healthStatus: 'HEALTHY', httpStatusCode: 200, checkedAt: CHECKED },
  { url: URL_A, healthStatus: 'REDIRECTED', httpStatusCode: 302, checkedAt: CHECKED },
];

const probeWithFakeTimers = async () => {
  vi.useFakeTimers();
  try {
    const pending = probeSourceLink(URL_A);
    await vi.advanceTimersByTimeAsync(60_000);
    return await pending;
  } finally {
    vi.useRealTimers();
  }
};

const expectRetiredAtOnce = async () => {
  const fresh = classifySourceLinkHealth(await probeWithFakeTimers());
  expect(fresh).toEqual({ healthStatus: 'UNAVAILABLE' });
  for (const stored of storedVerdicts) {
    const resolved = resolveSourceLinkHealthEntry(URL_A, fresh, stored, PROBE, RUN);
    expect(resolved.heldConnectionFailure).toBeUndefined();
    expect(resolved.preservedUnreachedVerdict).toBeUndefined();
    expect(resolved.entry).toEqual({ url: URL_A, healthStatus: 'UNAVAILABLE', checkedAt: PROBE });
  }
};

describe('a probe whose attempts end in ENOTFOUND retires a live link at once (#6116)', () => {
  beforeEach(() => {
    requestMock.mockReset();
    assertPublicHttpUrlMock.mockReset();
    assertPublicHttpUrlMock.mockImplementation(async (url: string) => new URL(url));
  });

  it('retires on a pre-flight lookup the guard confirmed absent', async () => {
    assertPublicHttpUrlMock.mockRejectedValueOnce(
      new SsrfBlockedError('no record', 'unresolvable'),
    );
    await expectRetiredAtOnce();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('retires on a connect-time ENOTFOUND without asking again', async () => {
    requestMock.mockRejectedValueOnce(failure('ENOTFOUND'));
    requestMock.mockRejectedValueOnce(failure('ETIMEDOUT'));
    await expectRetiredAtOnce();
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it.each(['ETIMEDOUT', 'ECONNABORTED', 'ECONNRESET', 'ECONNREFUSED', 'EHOSTUNREACH'])(
    'retires when %s is followed by ENOTFOUND',
    async (firstCode) => {
      requestMock.mockRejectedValueOnce(failure(firstCode));
      requestMock.mockRejectedValueOnce(failure('ENOTFOUND'));
      await expectRetiredAtOnce();
      expect(requestMock).toHaveBeenCalledTimes(2);
    },
  );

  it('retires when a throttled status is followed by ENOTFOUND', async () => {
    requestMock.mockResolvedValueOnce({ status: 503 });
    requestMock.mockResolvedValueOnce({ status: 503 });
    requestMock.mockRejectedValueOnce(failure('ENOTFOUND'));
    await expectRetiredAtOnce();
    expect(requestMock).toHaveBeenCalledTimes(3);
  });
});

describe('a connect-time guard refusal is a non-observation, a genuine one is held (#6116, #6150)', () => {
  const HOUR_MS = 60 * 60 * 1000;
  const storedHealthy: StoredSourceLinkHealthEntry = {
    url: URL_A,
    healthStatus: 'HEALTHY',
    httpStatusCode: 200,
    checkedAt: CHECKED,
  };

  const connectError = (message: string) =>
    Object.assign(new Error(message), { code: 'EHOSTUNREACH' });
  const genuineUnreachable = () => connectError('connect EHOSTUNREACH 192.0.2.1:443');

  const probeFailingWith = async (failure: () => Error | Promise<Error>) => {
    requestMock.mockRejectedValue(await failure());
    return classifySourceLinkHealth(await probeWithFakeTimers());
  };

  beforeEach(() => {
    requestMock.mockReset();
    assertPublicHttpUrlMock.mockReset();
    assertPublicHttpUrlMock.mockImplementation(async (url: string) => new URL(url));
  });

  it('leaves a stored HEALTHY verdict untouched on a connect-time guard refusal', async () => {
    const fresh = await probeFailingWith(guardRefusalAtConnect);
    const resolved = resolveSourceLinkHealthEntry(URL_A, fresh, storedHealthy, PROBE, RUN);
    expect(fresh).toEqual({ healthStatus: 'UNKNOWN' });
    expect(resolved.preservedUnreachedVerdict).toBe(true);
    expect(resolved.heldConnectionFailure).toBeUndefined();
    expect(resolved.entry).toEqual({ ...storedHealthy, lastAttemptedAt: PROBE });
  });

  it('holds a genuine EHOSTUNREACH and confirms it six hours later', async () => {
    const first = resolveSourceLinkHealthEntry(
      URL_A,
      await probeFailingWith(genuineUnreachable),
      storedHealthy,
      PROBE,
      RUN,
    );
    expect(first.heldConnectionFailure).toBe(true);
    expect(first.entry.healthStatus).toBe('HEALTHY');
    expect(first.entry.pendingConnectionFailureAt).toEqual(RUN);

    const laterRun = new Date(RUN.getTime() + 6 * HOUR_MS);
    const laterProbe = new Date(PROBE.getTime() + 6 * HOUR_MS);
    const second = resolveSourceLinkHealthEntry(
      URL_A,
      await probeFailingWith(genuineUnreachable),
      first.entry,
      laterProbe,
      laterRun,
    );
    expect(second.heldConnectionFailure).toBeUndefined();
    expect(second.entry).toMatchObject({
      url: URL_A,
      healthStatus: 'UNAVAILABLE',
      checkedAt: laterProbe,
      pendingConnectionFailureAt: RUN,
      confirmingConnectionFailureAt: laterRun,
    });
  });
});
