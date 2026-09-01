import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import {
  MIN_FIRST_CONTACT_MAX,
  FIRST_CONTACT_VOLUME_NOTICE_FRACTION,
  describeFirstContactCeiling,
  ensureAnonymousRateLimitId,
  firstContactMax,
  firstContactSaturationTotal,
  isFirstContactRequest,
  observeFirstContactVolume,
  recordFirstContactSaturation,
  resetFirstContactSaturationTotal,
  resetFirstContactVolumeNotices,
} from '../rateLimiters';

const VALID_ID = 'a'.repeat(32);

const requestWith = (session: Record<string, unknown> | null): Request =>
  ({ session, ip: '10.0.0.1' }) as unknown as Request;

const noopResponse = {} as Response;

const run = (req: Request) => {
  const next = vi.fn() as unknown as NextFunction;
  ensureAnonymousRateLimitId(req, noopResponse, next);
  return next;
};

beforeEach(() => {
  resetFirstContactSaturationTotal();
  resetFirstContactVolumeNotices();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('first-contact detection', () => {
  it('marks a request that arrives without a valid rateLimitId', () => {
    const req = requestWith({});
    run(req);
    expect(isFirstContactRequest(req)).toBe(true);
    expect(req.session?.rateLimitId).toMatch(/^[a-f0-9]{32}$/);
  });

  it('does not mark a request that already carries a valid id', () => {
    const req = requestWith({ rateLimitId: VALID_ID });
    run(req);
    expect(isFirstContactRequest(req)).toBe(false);
    expect(req.session?.rateLimitId).toBe(VALID_ID);
  });

  it('marks a request whose supplied id is malformed, so a junk cookie cannot dodge metering', () => {
    const req = requestWith({ rateLimitId: 'not-a-valid-id' });
    run(req);
    expect(isFirstContactRequest(req)).toBe(true);
  });

  it('does not mark a request with no session object at all', () => {
    const req = requestWith(null);
    run(req);
    expect(isFirstContactRequest(req)).toBe(false);
  });
});

describe('ceiling configuration', () => {
  it('defaults when the env var is unset', () => {
    expect(firstContactMax({} as NodeJS.ProcessEnv)).toBe(300);
    expect(describeFirstContactCeiling({} as NodeJS.ProcessEnv)).toContain('default');
  });

  it.each(['0', '-5', 'abc', ''])('defaults on the invalid value %s', (raw) => {
    expect(firstContactMax({ FIRST_CONTACT_RATE_LIMIT_MAX: raw } as NodeJS.ProcessEnv)).toBe(300);
  });

  it('floors a dangerously low ceiling instead of locking out a NATed cohort', () => {
    expect(firstContactMax({ FIRST_CONTACT_RATE_LIMIT_MAX: '3' } as NodeJS.ProcessEnv)).toBe(
      MIN_FIRST_CONTACT_MAX,
    );
    expect(
      describeFirstContactCeiling({ FIRST_CONTACT_RATE_LIMIT_MAX: '3' } as NodeJS.ProcessEnv),
    ).toContain('floored');
  });

  it('honours a valid override', () => {
    expect(firstContactMax({ FIRST_CONTACT_RATE_LIMIT_MAX: '900' } as NodeJS.ProcessEnv)).toBe(900);
  });

  it('describes the effective value so a fat-fingered env var is visible at boot', () => {
    expect(describeFirstContactCeiling({ FIRST_CONTACT_RATE_LIMIT_MAX: '900' } as NodeJS.ProcessEnv))
      .toBe('first-contact ceiling 900/15m (from FIRST_CONTACT_RATE_LIMIT_MAX)');
  });
});

describe('saturation telemetry', () => {
  it('counts exhaustion and names the env var to raise', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    recordFirstContactSaturation('ip:10.0.0.1');
    expect(firstContactSaturationTotal()).toBe(1);
    expect(warn.mock.calls[0][0]).toContain('FIRST_CONTACT_RATE_LIMIT_MAX');
  });
});

describe('volume telemetry', () => {
  const volumeRequest = (used: number, limit: number): Request => {
    const req = requestWith({});
    run(req);
    (req as any).rateLimit = { used, limit, resetTime: new Date(1_000_000) };
    return req;
  };

  it('stays silent below the notice fraction, so ordinary traffic is not noisy', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    observeFirstContactVolume(volumeRequest(10, 300), noopResponse, vi.fn() as any);
    expect(warn).not.toHaveBeenCalled();
  });

  it('reports issuance volume once a bucket crosses the notice fraction', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const used = Math.ceil(300 * FIRST_CONTACT_VOLUME_NOTICE_FRACTION);
    observeFirstContactVolume(volumeRequest(used, 300), noopResponse, vi.fn() as any);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain(`${used}/300`);
  });

  it('reports only once per bucket per window rather than on every request', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    observeFirstContactVolume(volumeRequest(200, 300), noopResponse, vi.fn() as any);
    observeFirstContactVolume(volumeRequest(201, 300), noopResponse, vi.fn() as any);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('ignores a request that is not first contact', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const req = requestWith({ rateLimitId: VALID_ID });
    run(req);
    (req as any).rateLimit = { used: 299, limit: 300, resetTime: new Date(1_000_000) };
    observeFirstContactVolume(req, noopResponse, vi.fn() as any);
    expect(warn).not.toHaveBeenCalled();
  });

  it('always calls next, so telemetry can never block a request', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const req of [volumeRequest(299, 300), requestWith(null)]) {
      const next = vi.fn();
      observeFirstContactVolume(req, noopResponse, next as any);
      expect(next).toHaveBeenCalledTimes(1);
    }
  });
});
