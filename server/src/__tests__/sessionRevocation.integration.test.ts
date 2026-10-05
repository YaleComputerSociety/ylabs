import { createHmac } from 'node:crypto';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_LIFETIME_MS } from '../utils/sessionClaim';

const ORIGINAL_ENV = { ...process.env };
const STRONG_SESSION_SECRET = 'Zq7#Lm2$Wx9!Rt4%Kp8@Hv3^Nc6&Jb1*';
const SESSION_COOKIE_NAME = 'session';
const CAS_NETID = 'revoketest';
const AUTHENTICATED_ROUTE = '/api/users/savedResearchEntityIds';

vi.mock('../services/yaliesService', () => ({
  lookupYalieByNetid: vi.fn(async () => ({ kind: 'not_found' })),
}));

vi.mock('../services/analyticsService', () => ({
  logEvent: vi.fn(async () => 'skipped'),
}));

type FakeCas = { baseUrl: string; close: () => Promise<void> };

const startFakeCas = async (): Promise<FakeCas> => {
  const serviceUrlByTicket = new Map<string, string>();
  const server = http.createServer((req, res) => {
    const requested = new URL(req.url ?? '/', 'http://cas.invalid');
    const service = requested.searchParams.get('service') ?? '';
    if (requested.pathname === '/cas/login') {
      const ticket = `ST-revocation-${serviceUrlByTicket.size + 1}`;
      serviceUrlByTicket.set(ticket, service);
      const separator = service.includes('?') ? '&' : '?';
      res.writeHead(302, { location: `${service}${separator}ticket=${ticket}` });
      res.end();
      return;
    }
    if (requested.pathname === '/cas/validate') {
      const ticket = requested.searchParams.get('ticket') ?? '';
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(serviceUrlByTicket.get(ticket) === service ? `yes\n${CAS_NETID}\n` : 'no\n');
      return;
    }
    if (requested.pathname === '/cas/logout') {
      res.writeHead(200);
      res.end();
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}/cas`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
};

const signCookie = (name: string, value: string): string =>
  createHmac('sha1', STRONG_SESSION_SECRET)
    .update(`${name}=${value}`)
    .digest('base64')
    .replace(/\/|\+|=/g, (character) => ({ '/': '_', '+': '-', '=': '' })[character] ?? '');

const sessionCookieHeader = (payload: Record<string, unknown>): string => {
  const value = Buffer.from(JSON.stringify(payload)).toString('base64');
  return `${SESSION_COOKIE_NAME}=${value}; ${SESSION_COOKIE_NAME}.sig=${signCookie(
    SESSION_COOKIE_NAME,
    value,
  )}`;
};

const sessionPayloadOf = (cookieHeader: string): Record<string, any> => {
  const value = new RegExp(`(?:^|; )${SESSION_COOKIE_NAME}=([^;]+)`).exec(cookieHeader)?.[1] ?? '';
  return value ? JSON.parse(Buffer.from(value, 'base64').toString('utf8')) : {};
};

type Hop = { status: number; location: string; cookie: string };

const cookieHeaderFrom = (response: Response): string =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .filter((pair) => pair.startsWith(SESSION_COOKIE_NAME))
    .join('; ');

const get = async (url: string, cookie = ''): Promise<Hop> => {
  const response = await fetch(url, { headers: cookie ? { cookie } : {}, redirect: 'manual' });
  await response.text();
  return {
    status: response.status,
    location: response.headers.get('location') ?? '',
    cookie: cookieHeaderFrom(response),
  };
};

const signIn = async (baseUrl: string, cookie = ''): Promise<string> => {
  const started = await get(`${baseUrl}/api/cas`, cookie);
  const atCas = await get(started.location);
  const completed = await get(atCas.location, started.cookie || cookie);
  expect(completed.status).toBe(302);
  expect(completed.cookie).not.toBe('');
  return completed.cookie;
};

const signedInPrincipalCookie = (issuedAt: number, sessionVersion = 0): string =>
  sessionCookieHeader({
    passport: {
      user: {
        netId: CAS_NETID,
        userType: 'unknown',
        sessionId: 'b'.repeat(32),
        issuedAt,
        sessionVersion,
      },
    },
  });

describe('server-side session revocation and expiry', () => {
  let replSet: MongoMemoryReplSet;
  let fakeCas: FakeCas;
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
    fakeCas = await startFakeCas();
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
      SSOBASEURL: fakeCas.baseUrl,
      SESSION_SECRET: STRONG_SESSION_SECRET,
    };
    delete process.env.SERVER_BASE_URL;
    const { default: app } = await import('../app');
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await fakeCas?.close();
    await mongoose.disconnect();
    await replSet?.stop();
    process.env = { ...ORIGINAL_ENV };
  });

  beforeEach(async () => {
    await mongoose.connection.db?.collection('accounts').deleteMany({});
  });

  it('refuses a session cookie replayed after its holder signed out', async () => {
    const captured = await signIn(baseUrl);
    expect((await get(`${baseUrl}${AUTHENTICATED_ROUTE}`, captured)).status).toBe(200);

    const signedOut = await get(`${baseUrl}/api/logout`, captured);
    expect(signedOut.status).toBe(302);

    expect((await get(`${baseUrl}${AUTHENTICATED_ROUTE}`, captured)).status).toBe(401);
  });

  it('ends every copy of the account session at sign-out, and a fresh sign-in works again', async () => {
    const firstDevice = await signIn(baseUrl);
    const secondDevice = await signIn(baseUrl);

    await get(`${baseUrl}/api/logout`, firstDevice);

    expect((await get(`${baseUrl}${AUTHENTICATED_ROUTE}`, secondDevice)).status).toBe(401);
    const renewed = await signIn(baseUrl);
    expect((await get(`${baseUrl}${AUTHENTICATED_ROUTE}`, renewed)).status).toBe(200);
  });

  it('refuses a session older than the lifetime even though the cookie is still presented', async () => {
    await signIn(baseUrl);
    const now = Date.now();

    const live = signedInPrincipalCookie(now - 60_000);
    expect((await get(`${baseUrl}${AUTHENTICATED_ROUTE}`, live)).status).toBe(200);

    const expired = signedInPrincipalCookie(now - SESSION_LIFETIME_MS - 60_000);
    expect((await get(`${baseUrl}${AUTHENTICATED_ROUTE}`, expired)).status).toBe(401);
  });

  it('refuses a signed session that carries no issue time or version', async () => {
    await signIn(baseUrl);
    const legacy = sessionCookieHeader({
      passport: { user: { netId: CAS_NETID, userType: 'unknown' } },
    });

    expect((await get(`${baseUrl}${AUTHENTICATED_ROUTE}`, legacy)).status).toBe(401);
  });

  it('mints a new session id at every sign-in', async () => {
    const anonymous = (await get(`${baseUrl}/api/check`)).cookie;
    expect(sessionPayloadOf(anonymous).passport).toBeUndefined();

    const first = await signIn(baseUrl, anonymous);
    const second = await signIn(baseUrl, first);

    const firstId = sessionPayloadOf(first).passport.user.sessionId;
    const secondId = sessionPayloadOf(second).passport.user.sessionId;
    expect(firstId).toMatch(/^[0-9a-f]{32}$/);
    expect(secondId).toMatch(/^[0-9a-f]{32}$/);
    expect(secondId).not.toBe(firstId);
  });
});
