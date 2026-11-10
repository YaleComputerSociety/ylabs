import { createHmac } from 'node:crypto';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };
const OLD_SESSION_SECRET = 'Zq7#Lm2$Wx9!Rt4%Kp8@Hv3^Nc6&Jb1*';
const NEW_SESSION_SECRET = 'Pv5&Gh8!Td2#Yw6$Mk9@Rc4^Ls7*Qn3%';
const UNRELATED_SESSION_SECRET = 'Hb4%Xe7!Nu2#Fz8$Wq5@Jt9^Cm6&Sd3*';
const SESSION_COOKIE_NAME = 'session';
const CAS_NETID = 'rotationtest';
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

const signCookie = (secret: string, name: string, value: string): string =>
  createHmac('sha1', secret)
    .update(`${name}=${value}`)
    .digest('base64')
    .replace(/\/|\+|=/g, (character) => ({ '/': '_', '+': '-', '=': '' })[character] ?? '');

const sessionValueOf = (cookieHeader: string): string =>
  new RegExp(`(?:^|; )${SESSION_COOKIE_NAME}=([^;]+)`).exec(cookieHeader)?.[1] ?? '';

const signatureOf = (cookieHeader: string): string =>
  new RegExp(`(?:^|; )${SESSION_COOKIE_NAME}\\.sig=([^;]+)`).exec(cookieHeader)?.[1] ?? '';

const resignedWith = (secret: string, cookieHeader: string): string => {
  const value = sessionValueOf(cookieHeader);
  return `${SESSION_COOKIE_NAME}=${value}; ${SESSION_COOKIE_NAME}.sig=${signCookie(
    secret,
    SESSION_COOKIE_NAME,
    value,
  )}`;
};

type Hop = { status: number; location: string; cookie: string; setCookies: string[] };

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
    setCookies: response.headers.getSetCookie(),
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

const signInAndSettle = async (baseUrl: string): Promise<string> => {
  const signedIn = await signIn(baseUrl);
  const firstAuthenticated = await get(`${baseUrl}${AUTHENTICATED_ROUTE}`, signedIn);
  expect(firstAuthenticated.status).toBe(200);
  return firstAuthenticated.cookie || signedIn;
};

describe('session signing secret rotation (#4484)', () => {
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
      SESSION_SECRET: NEW_SESSION_SECRET,
      SESSION_SECRET_PREVIOUS: OLD_SESSION_SECRET,
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

  it('signs a new session with the current secret', async () => {
    const signedIn = await signIn(baseUrl);

    expect(signatureOf(signedIn)).toBe(signatureOf(resignedWith(NEW_SESSION_SECRET, signedIn)));
    expect((await get(`${baseUrl}${AUTHENTICATED_ROUTE}`, signedIn)).status).toBe(200);
  });

  it('keeps a session signed with the previous secret and re-signs it with the current one', async () => {
    const signedIn = await signInAndSettle(baseUrl);
    const signedWithPrevious = resignedWith(OLD_SESSION_SECRET, signedIn);

    const overlap = await get(`${baseUrl}${AUTHENTICATED_ROUTE}`, signedWithPrevious);

    expect(overlap.status).toBe(200);
    const reissuedValueSource = sessionValueOf(overlap.cookie) ? overlap.cookie : signedIn;
    expect(signatureOf(overlap.cookie)).not.toBe('');
    expect(signatureOf(overlap.cookie)).toBe(
      signatureOf(resignedWith(NEW_SESSION_SECRET, reissuedValueSource)),
    );
    const reissuedSignatureCookies = overlap.setCookies.filter((cookie) =>
      cookie.startsWith(`${SESSION_COOKIE_NAME}.sig=`),
    );
    expect(reissuedSignatureCookies).toHaveLength(1);
    expect(reissuedSignatureCookies[0]).toMatch(/; expires=/i);
    expect(reissuedSignatureCookies[0]).toMatch(/; samesite=lax/i);
    expect(reissuedSignatureCookies[0]).toMatch(/; httponly/i);
  });

  it('does not re-issue a session already signed with the current secret', async () => {
    const signedIn = await signInAndSettle(baseUrl);

    const current = await get(`${baseUrl}${AUTHENTICATED_ROUTE}`, signedIn);

    expect(current.status).toBe(200);
    expect(current.cookie).toBe('');
  });

  it('refuses a session signed with neither the current nor the previous secret', async () => {
    const signedIn = await signIn(baseUrl);
    const forged = resignedWith(UNRELATED_SESSION_SECRET, signedIn);

    expect((await get(`${baseUrl}${AUTHENTICATED_ROUTE}`, forged)).status).toBe(401);
  });
});
