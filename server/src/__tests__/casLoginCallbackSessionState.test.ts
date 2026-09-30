import { createHmac } from 'node:crypto';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';

const ORIGINAL_ENV = { ...process.env };
const STRONG_SESSION_SECRET = 'R8h!vK2p#Q7zLm4$T9nWx6%Yc3@F5sJ0';
const SESSION_COOKIE_NAME = 'session';
const CAS_NETID = 'teststudent';
const CAS_TICKET = 'ST-hermetic-ticket';
const SIGNED_IN_NETID = 'priorlogin';

const accountServiceMock = vi.hoisted(() => ({
  recordAccountLogin: vi.fn(async (data: { netid: string }) => ({
    _id: `acc-${data.netid}`,
    netid: data.netid,
    email: `${data.netid}@yale.edu`,
    status: 'ACTIVE',
    archived: false,
  })),
  validateAccount: vi.fn(async (netid: string) => ({ netid, archived: false })),
}));
vi.mock('../services/accountService', () => accountServiceMock);

vi.mock('../services/yaliesService', () => ({
  classifyYalieByNetid: vi.fn(async () => null),
}));

vi.mock('../services/directoryService', () => ({
  fetchFromDirectory: vi.fn(async () => null),
  isFacultyTitle: vi.fn(() => false),
}));

vi.mock('../services/adminGrantService', () => ({
  ensureBootstrapAdminGrant: vi.fn(async () => undefined),
  hasActiveAdminGrant: vi.fn(async () => false),
}));

vi.mock('../services/analyticsService', () => ({
  logEvent: vi.fn(async () => 'skipped'),
}));

type FakeCas = {
  baseUrl: string;
  loginServiceUrls: string[];
  validateServiceUrls: string[];
  close: () => Promise<void>;
};

const startFakeCas = async (): Promise<FakeCas> => {
  const loginServiceUrls: string[] = [];
  const validateServiceUrls: string[] = [];
  // CAS issues a ticket for one service URL and refuses to validate it against
  // any other, so the stand-in holds the caller to the same rule.
  const serviceUrlByTicket = new Map<string, string>();
  const server = http.createServer((req, res) => {
    const requested = new URL(req.url ?? '/', 'http://cas.invalid');
    const service = requested.searchParams.get('service') ?? '';

    if (requested.pathname === '/cas/login') {
      loginServiceUrls.push(service);
      const ticket = `${CAS_TICKET}-${loginServiceUrls.length}`;
      serviceUrlByTicket.set(ticket, service);
      const separator = service.includes('?') ? '&' : '?';
      res.writeHead(302, { location: `${service}${separator}ticket=${ticket}` });
      res.end();
      return;
    }

    if (requested.pathname === '/cas/validate') {
      validateServiceUrls.push(service);
      const ticket = requested.searchParams.get('ticket') ?? '';
      const accepted = serviceUrlByTicket.get(ticket) === service;
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(accepted ? `yes\n${CAS_NETID}\n` : 'no\n');
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}/cas`,
    loginServiceUrls,
    validateServiceUrls,
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

const signedInCookieHeader = (): string =>
  sessionCookieHeader({
    passport: { user: { netId: SIGNED_IN_NETID, userType: 'graduate' } },
  });

const cookieHeaderFrom = (response: Response): string =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .filter((pair) => pair.startsWith(SESSION_COOKIE_NAME))
    .join('; ');

const sessionPayloadOf = (cookieHeader: string): Record<string, unknown> => {
  const value = new RegExp(`(?:^|; )${SESSION_COOKIE_NAME}=([^;]+)`).exec(cookieHeader)?.[1] ?? '';
  if (!value) return {};
  return JSON.parse(Buffer.from(value, 'base64').toString('utf8'));
};

let fakeCas: FakeCas;

const prepareApp = () => {
  process.env = {
    ...ORIGINAL_ENV,
    NODE_ENV: 'test',
    SSOBASEURL: fakeCas.baseUrl,
    SESSION_SECRET: STRONG_SESSION_SECRET,
  };
  delete process.env.SERVER_BASE_URL;
};

async function withRunningApp(run: (baseUrl: string) => Promise<void>) {
  const { default: app } = await import('../app');
  const server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const address = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

type Hop = { status: number; location: string; cookie: string; body: string };

const get = async (url: string, cookie = ''): Promise<Hop> => {
  const response = await fetch(url, {
    headers: cookie ? { cookie } : {},
    redirect: 'manual',
  });
  const body = await response.text();
  return {
    status: response.status,
    location: response.headers.get('location') ?? '',
    cookie: cookieHeaderFrom(response),
    body,
  };
};

type StartedLogin = { cookie: string; callbackUrl: string };

const startLogin = async (baseUrl: string, query = '', cookie = ''): Promise<StartedLogin> => {
  const started = await get(`${baseUrl}/api/cas${query}`, cookie);
  expect(started.status).toBe(302);
  const atCas = await get(started.location);
  expect(atCas.status).toBe(302);
  return { cookie: started.cookie, callbackUrl: atCas.location };
};

const expectRefusedCallback = (refused: Hop, validationsBefore: number) => {
  expect(refused.status).toBe(401);
  expect(JSON.parse(refused.body)).toEqual({ error: 'CAS callback does not match this login' });
  expect(fakeCas.validateServiceUrls.length).toBe(validationsBefore);
};

describe('CAS login callback binding', () => {
  beforeAll(async () => {
    fakeCas = await startFakeCas();
  });

  afterAll(async () => {
    await fakeCas.close();
  });

  afterEach(() => {
    vi.resetModules();
    mongoose.deleteModel(/.+/);
    process.env = { ...ORIGINAL_ENV };
  });

  it('completes a login this browser started and carries the value CAS echoes back', async () => {
    prepareApp();

    await withRunningApp(async (baseUrl) => {
      const { cookie, callbackUrl } = await startLogin(baseUrl, '?redirect=%2Fsaved');

      expect(fakeCas.loginServiceUrls.at(-1)).toMatch(/[?&]state=[0-9a-f]{32}(&|$)/);
      expect(sessionPayloadOf(cookie).casLoginStates).toEqual([
        expect.stringMatching(/^[0-9a-f]{32}$/),
      ]);

      const completed = await get(callbackUrl, cookie);
      expect(completed.status).toBe(302);
      expect(completed.location).toBe('/saved');
    });
  });

  it('reports the session as authenticated once the callback has been accepted', async () => {
    prepareApp();

    await withRunningApp(async (baseUrl) => {
      const { cookie, callbackUrl } = await startLogin(baseUrl);
      const completed = await get(callbackUrl, cookie);

      const check = await get(`${baseUrl}/api/check`, completed.cookie);

      expect(JSON.parse(check.body)).toMatchObject({ auth: true, user: { netId: CAS_NETID } });
    });
  });

  it('sends CAS the same service URL at login and at ticket validation', async () => {
    prepareApp();

    await withRunningApp(async (baseUrl) => {
      const { cookie, callbackUrl } = await startLogin(baseUrl, '?redirect=%2Fresearch%2Fabc');
      const completed = await get(callbackUrl, cookie);

      expect(completed.status).toBe(302);
      expect(fakeCas.validateServiceUrls.at(-1)).toBe(fakeCas.loginServiceUrls.at(-1));
    });
  });

  it('rejects a callback whose value is not stored in the session', async () => {
    prepareApp();

    await withRunningApp(async (baseUrl) => {
      const { callbackUrl } = await startLogin(baseUrl);
      const validationsBefore = fakeCas.validateServiceUrls.length;

      const refused = await get(callbackUrl);

      expectRefusedCallback(refused, validationsBefore);
      expect(sessionPayloadOf(refused.cookie).passport).toBeUndefined();
    });
  });

  it('rejects a callback whose value does not match the session', async () => {
    prepareApp();

    await withRunningApp(async (baseUrl) => {
      const { cookie, callbackUrl } = await startLogin(baseUrl);
      const mismatched = callbackUrl.replace(/state=[0-9a-f]{32}/, `state=${'b'.repeat(32)}`);
      const validationsBefore = fakeCas.validateServiceUrls.length;

      const refused = await get(mismatched, cookie);

      expectRefusedCallback(refused, validationsBefore);
      expect(sessionPayloadOf(refused.cookie).passport).toBeUndefined();
    });
  });

  it('leaves an already authenticated session in place when it rejects a callback', async () => {
    prepareApp();

    await withRunningApp(async (baseUrl) => {
      const { callbackUrl } = await startLogin(baseUrl);
      const existing = signedInCookieHeader();
      const validationsBefore = fakeCas.validateServiceUrls.length;

      const refused = await get(callbackUrl, existing);
      expectRefusedCallback(refused, validationsBefore);
      expect(sessionPayloadOf(refused.cookie).passport).toEqual({
        user: { netId: SIGNED_IN_NETID, userType: 'graduate' },
      });

      const check = await get(`${baseUrl}/api/check`, existing);
      expect(JSON.parse(check.body)).toMatchObject({
        auth: true,
        user: { netId: SIGNED_IN_NETID },
      });
    });
  });

  it('clears the stored value on use so the same callback is rejected a second time', async () => {
    prepareApp();

    await withRunningApp(async (baseUrl) => {
      const { cookie, callbackUrl } = await startLogin(baseUrl);
      const completed = await get(callbackUrl, cookie);

      expect(completed.status).toBe(302);
      expect(sessionPayloadOf(completed.cookie).casLoginStates).toBeUndefined();

      const validationsBefore = fakeCas.validateServiceUrls.length;
      const repeated = await get(callbackUrl, completed.cookie);

      expectRefusedCallback(repeated, validationsBefore);
    });
  });

  it('completes each of two logins started in the same browser, in either order', async () => {
    prepareApp();

    await withRunningApp(async (baseUrl) => {
      const first = await startLogin(baseUrl, '?redirect=%2Ffirst');
      const second = await startLogin(baseUrl, '?redirect=%2Fsecond', first.cookie);

      const completedFirst = await get(first.callbackUrl, second.cookie);
      expect(completedFirst.status).toBe(302);
      expect(completedFirst.location).toBe('/first');

      const completedSecond = await get(second.callbackUrl, completedFirst.cookie);
      expect(completedSecond.status).toBe(302);
      expect(completedSecond.location).toBe('/second');
      expect(sessionPayloadOf(completedSecond.cookie).casLoginStates).toBeUndefined();
    });
  });

  it('keeps only the most recent pending logins and rejects the oldest once it is dropped', async () => {
    prepareApp();

    await withRunningApp(async (baseUrl) => {
      const oldest = await startLogin(baseUrl);
      let cookie = oldest.cookie;
      for (let started = 0; started < 5; started += 1) {
        cookie = (await startLogin(baseUrl, '', cookie)).cookie;
      }

      expect(sessionPayloadOf(cookie).casLoginStates).toHaveLength(5);

      const validationsBefore = fakeCas.validateServiceUrls.length;
      const refused = await get(oldest.callbackUrl, cookie);

      expectRefusedCallback(refused, validationsBefore);
    });
  });
});
