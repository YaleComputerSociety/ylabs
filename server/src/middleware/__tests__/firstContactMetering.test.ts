import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import cookieSession from 'cookie-session';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
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
    expect(
      describeFirstContactCeiling({ FIRST_CONTACT_RATE_LIMIT_MAX: '900' } as NodeJS.ProcessEnv),
    ).toBe('first-contact ceiling 900/15m (from FIRST_CONTACT_RATE_LIMIT_MAX)');
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

// The real `firstContactLimiter`, not a rebuild of it: `skills/auth-security/SKILL.md`
// and `scripts/security-preflight.test.mjs` both claim first contact counts every
// response, and only driving the exported limiter proves the counter behaves that
// way rather than that the options text reads that way (#2990). Its own `skip`
// returns `bypassRuntimeSecurity`, which is true under test, so the module is
// re-imported with a deployed NODE_ENV to make the limiter live.
describe('first-contact metering counts every response, a 5xx included (#2990)', () => {
  let server: Server;
  let baseUrl = '';

  beforeAll(async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.resetModules();
    const limiters = await import('../rateLimiters');

    const app = express()
      .set('trust proxy', () => true)
      .use(
        cookieSession({
          name: 'ylabs-first-contact-test',
          keys: ['first-contact-test-secret'],
          httpOnly: true,
          path: '/',
        }),
      )
      .use('/api', limiters.ensureAnonymousRateLimitId)
      .use('/api', limiters.firstContactLimiter)
      .get('/api/probe', (req, res) => {
        const status = Number(req.query.status) || 200;
        res.status(status).json({ used: (req as any).rateLimit?.used });
      });

    server = await new Promise<Server>((resolve) => {
      const started = app.listen(0, '127.0.0.1', () => resolve(started));
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  const cookielessProbe = async (status: number) => {
    const response = await fetch(`${baseUrl}/api/probe?status=${status}`, {
      headers: { 'X-Forwarded-For': '203.0.113.9' },
    });
    const body = (await response.json()) as { used?: number };
    return { status: response.status, used: body.used };
  };

  it('does not refund a failed response, so an outage is not a session-minting window', async () => {
    const failed = await cookielessProbe(500);
    const followUp = await cookielessProbe(200);

    expect(failed.status).toBe(500);
    expect(failed.used).toBe(1);
    // 2 rather than 1: a limiter that refunded the 5xx would hand the second
    // cookie-less caller the first caller's slot back.
    expect(followUp.used).toBe(2);
  });

  it('counts a 4xx as well, so no status class escapes the first-contact budget', async () => {
    const rejected = await cookielessProbe(404);

    expect(rejected.status).toBe(404);
    expect(rejected.used).toBe(3);
  });
});
