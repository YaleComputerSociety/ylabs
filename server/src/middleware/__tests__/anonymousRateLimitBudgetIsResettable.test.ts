import cookieSession from 'cookie-session';
import express from 'express';
import rateLimit from 'express-rate-limit';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ensureAnonymousRateLimitId, getRateLimitKey } from '../rateLimiters';

// Pins the measurement behind the rate-limiter description (#2420): the general
// limiter constrains a browser and does not constrain a caller who declines to
// be constrained. The keying is deliberate, because an IP-keyed general limiter
// would put a NATed campus in one bucket, so this asserts the trade rather than
// arguing against it. If a future change makes the anonymous budget stick to a
// cookie-discarding caller, these expectations break and the prose in
// `skills/auth-security/SKILL.md` needs revisiting with them.
//
// `globalLimiter`'s own `skip` returns `bypassRuntimeSecurity`, which is true
// under test, so the property is asserted on a limiter built from the same key
// function and the same window and max, mounted behind the same cookie-session
// and `ensureAnonymousRateLimitId` wiring `app.ts` uses.
describe('the anonymous general-limiter budget is resettable by the caller (#2420)', () => {
  let server: Server;
  let baseUrl = '';

  beforeAll(async () => {
    const app = express()
      .set('trust proxy', () => true)
      .use(
        cookieSession({
          name: 'ylabs-rate-limit-key-test',
          keys: ['rate-limit-key-test-secret'],
          httpOnly: true,
          path: '/',
        }),
      )
      .use('/api', ensureAnonymousRateLimitId)
      .use(
        '/api',
        rateLimit({
          windowMs: 15 * 60 * 1000,
          max: 1000,
          keyGenerator: getRateLimitKey,
          standardHeaders: true,
          legacyHeaders: false,
        }),
      )
      .get('/api/config', (req, res) => {
        res.json({ key: getRateLimitKey(req) });
      });

    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const probe = async (cookie: string) => {
    const response = await fetch(`${baseUrl}/api/config`, {
      headers: {
        'X-Forwarded-For': '203.0.113.7',
        ...(cookie ? { cookie } : {}),
      },
    });
    const body = (await response.json()) as { key: string };
    // cookie-session only re-sends Set-Cookie when the session changed, so an
    // absent header on a later request means the caller's jar is still current.
    const issued = response.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
    return {
      remaining: Number(response.headers.get('ratelimit-remaining')),
      cookie: issued || cookie,
      key: body.key,
    };
  };

  it('decrements a cookie-holding caller monotonically', async () => {
    const remaining: number[] = [];
    let cookie = '';
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await probe(cookie);
      cookie = result.cookie;
      remaining.push(result.remaining);
    }

    expect(remaining).toEqual([999, 998, 997, 996, 995]);
  });

  it('gives a cookie-discarding caller a fresh budget on every request', async () => {
    const remaining: number[] = [];
    const keys = new Set<string>();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await probe('');
      remaining.push(result.remaining);
      keys.add(result.key);
    }

    expect(remaining).toEqual([999, 999, 999, 999, 999]);
    // Pinned at 999 because each request minted a new bucket, not because the
    // counter is broken.
    expect(keys.size).toBe(5);
  });

  it('never reaches the ip fallback once the session middleware is mounted', async () => {
    const result = await probe('');

    expect(result.key).toMatch(/^anonymous:/);
    expect(result.key).not.toMatch(/^ip:/);
  });
});
