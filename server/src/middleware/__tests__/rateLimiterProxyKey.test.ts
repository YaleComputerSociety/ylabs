import express from 'express';
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
    const response = await fetch(`${baseUrl}/key`, { headers: { 'X-Forwarded-For': forwardedFor } });
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
