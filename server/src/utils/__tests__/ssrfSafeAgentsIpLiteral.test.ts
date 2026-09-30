import http from 'node:http';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isSsrfGuardRefusal, SsrfBlockedError, ssrfSafeAgents } from '../ssrfGuard';

describe('ssrfSafeAgents on IP-literal hosts', () => {
  let server: http.Server;
  let hits: string[];
  let port: number;

  beforeEach(async () => {
    hits = [];
    server = http.createServer((req, res) => {
      hits.push(req.url ?? '');
      res.end('internal');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const requestThrough = (agent: http.Agent, host: string) =>
    new Promise<{ status?: number; code?: string }>((resolve) => {
      const req = http.get({ host, port, path: '/internal', agent }, (res) => {
        res.resume();
        resolve({ status: res.statusCode });
      });
      req.on('error', (error: NodeJS.ErrnoException) => resolve({ code: error.code }));
    });

  it('refuses a loopback IP literal before opening a socket', async () => {
    const result = await requestThrough(ssrfSafeAgents().httpAgent, '127.0.0.1');
    expect(result).toEqual({ code: 'EHOSTUNREACH' });
    expect(hits).toEqual([]);
  });

  it('refuses a bracketed IPv6 loopback literal', async () => {
    const result = await requestThrough(ssrfSafeAgents().httpAgent, '[::1]');
    expect(result.code).toBe('EHOSTUNREACH');
    expect(hits).toEqual([]);
  });

  it('refuses the literal through axios with the https agent too', async () => {
    const agents = ssrfSafeAgents();
    expect(agents.httpsAgent).toBeInstanceOf(https.Agent);
    await expect(
      axios.get(`http://127.0.0.1:${port}/internal`, {
        httpAgent: agents.httpAgent,
        httpsAgent: agents.httpsAgent,
        maxRedirects: 0,
        validateStatus: () => true,
      }),
    ).rejects.toMatchObject({ code: 'EHOSTUNREACH' });
    await expect(
      axios.get(`https://127.0.0.1:${port}/internal`, {
        httpAgent: agents.httpAgent,
        httpsAgent: agents.httpsAgent,
        maxRedirects: 0,
        validateStatus: () => true,
      }),
    ).rejects.toMatchObject({ code: 'EHOSTUNREACH' });
    expect(hits).toEqual([]);
  });

  it('reaches the same server through a plain agent, so the refusal comes from the guard', async () => {
    const plainAgent = new http.Agent();
    const result = await requestThrough(plainAgent, '127.0.0.1');
    expect(result.status).toBe(200);
    expect(hits).toEqual(['/internal']);
  });

  it('recognises the connect-time refusal as a guard refusal', async () => {
    const agents = ssrfSafeAgents();
    const refusal = await axios
      .get(`http://127.0.0.1:${port}/internal`, {
        httpAgent: agents.httpAgent,
        httpsAgent: agents.httpsAgent,
        maxRedirects: 0,
      })
      .catch((error: unknown) => error);

    expect(isSsrfGuardRefusal(refusal)).toBe(true);
    expect(hits).toEqual([]);
  });

  it('recognises a preflight refusal and rejects ordinary network failures', () => {
    const unreachable = Object.assign(new Error('connect EHOSTUNREACH 203.0.113.9:80'), {
      code: 'EHOSTUNREACH',
    });

    expect(isSsrfGuardRefusal(new SsrfBlockedError('blocked', 'private-address'))).toBe(true);
    expect(isSsrfGuardRefusal(unreachable)).toBe(false);
    expect(isSsrfGuardRefusal(new Error('socket hang up'))).toBe(false);
    expect(isSsrfGuardRefusal(undefined)).toBe(false);
  });
});
