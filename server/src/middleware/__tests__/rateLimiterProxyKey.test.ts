import express from 'express';
import rateLimit from 'express-rate-limit';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getPeerIpKey, getRateLimitKey, rateLimitClientIp } from '../rateLimiters';

// Exercises the real express trust-proxy chain rather than a stubbed field: the
// defect in #2318 was that the key functions read req.socket.remoteAddress, so a
// test that sets req.ip directly would pass against the broken code too.
describe('rate limit keys derive from the forwarded client address (#2318)', () => {
  let server: Server;
  let baseUrl = '';

  beforeAll(async () => {
    const app = express()
      // Trust any proxy, mirroring app.ts's validated predicate for a request
      // that arrives from an allow-listed load balancer.
      .set('trust proxy', () => true)
      .get('/key', (req, res) => {
        res.json({
          peer: req.socket.remoteAddress ?? '',
          reqIp: req.ip ?? '',
          authKey: getPeerIpKey(req),
          globalKey: getRateLimitKey(req),
        });
      });
    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const fetchKey = async (forwardedFor: string) => {
    const response = await fetch(`${baseUrl}/key`, {
      headers: { 'X-Forwarded-For': forwardedFor },
    });
    return (await response.json()) as {
      peer: string;
      reqIp: string;
      authKey: string;
      globalKey: string;
    };
  };

  it('keys the auth limiter on the forwarded client, not the connecting peer', async () => {
    const result = await fetchKey('203.0.113.7');
    // The peer here is loopback: that is the value the broken code used.
    expect(result.peer).toContain('127.0.0.1');
    expect(result.reqIp).toBe('203.0.113.7');
    expect(result.authKey).toContain('203.0.113.7');
    expect(result.authKey).not.toContain('127.0.0.1');
  });

  it('gives two different clients behind one proxy two different buckets', async () => {
    const first = await fetchKey('203.0.113.7');
    const second = await fetchKey('198.51.100.42');
    expect(first.authKey).not.toBe(second.authKey);
    // Both arrive on the same socket address, which is exactly why the peer key
    // produced one global bucket for the whole user base.
    expect(first.peer).toBe(second.peer);
  });

  it('falls back to the client ip for anonymous traffic with no session id', async () => {
    const result = await fetchKey('203.0.113.7');
    expect(result.globalKey).toBe('ip:203.0.113.7');
  });

  // The defect's real signature is a NON-DETERMINISTIC counter: a load balancer
  // fronts the app from more than one egress address, so a peer-keyed limiter
  // splits one caller across several counters and ratelimit-remaining comes back
  // non-monotonic. Keying on the forwarded client must make a burst monotonic.
  describe('authLimiter counts a single forwarded client on one counter', () => {
    let limited: Server;
    let limitedUrl = '';

    beforeAll(async () => {
      // authLimiter itself is a no-op here: its `skip` returns
      // bypassRuntimeSecurity, which is true under test by design. So the
      // property is asserted on a limiter built from the same key function and
      // the same window/max, which is the part this change touches.
      const burstLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 20,
        keyGenerator: getPeerIpKey,
        standardHeaders: true,
        legacyHeaders: false,
      });
      const app = express()
        .set('trust proxy', () => true)
        .get('/cas', burstLimiter, (_req, res) => res.json({ ok: true }));
      limited = await new Promise<Server>((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
      });
      limitedUrl = `http://127.0.0.1:${(limited.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
      await new Promise<void>((resolve) => limited.close(() => resolve()));
    });

    it('decrements ratelimit-remaining monotonically across a burst', async () => {
      const remaining: number[] = [];
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const response = await fetch(`${limitedUrl}/cas`, {
          headers: { 'X-Forwarded-For': '203.0.113.99' },
        });
        remaining.push(Number(response.headers.get('ratelimit-remaining')));
      }
      expect(remaining).toEqual([19, 18, 17, 16, 15]);
    });

    it('does not spend one client budget on another', async () => {
      const first = await fetch(`${limitedUrl}/cas`, {
        headers: { 'X-Forwarded-For': '198.51.100.1' },
      });
      const second = await fetch(`${limitedUrl}/cas`, {
        headers: { 'X-Forwarded-For': '198.51.100.2' },
      });
      expect(Number(first.headers.get('ratelimit-remaining'))).toBe(19);
      expect(Number(second.headers.get('ratelimit-remaining'))).toBe(19);
    });
  });

  describe('rateLimitClientIp port handling', () => {
    const asRequest = (ip: string) => ({ ip }) as never;

    it('strips a rotating source port from an ipv4 address', () => {
      expect(rateLimitClientIp(asRequest('203.0.113.7:54321'))).toBe('203.0.113.7');
    });

    it('strips a port from a bracketed ipv6 address', () => {
      expect(rateLimitClientIp(asRequest('[2001:db8::1]:54321'))).toBe('2001:db8::1');
    });

    it('never splits a bare ipv6 address on its own colons', () => {
      expect(rateLimitClientIp(asRequest('2001:db8::1'))).toBe('2001:db8::1');
      expect(rateLimitClientIp(asRequest('::1'))).toBe('::1');
    });

    it('tolerates a missing ip', () => {
      expect(rateLimitClientIp({} as never)).toBe('');
    });
  });
});
