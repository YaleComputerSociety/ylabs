import { createHmac } from 'node:crypto';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };
const STRONG_SESSION_SECRET = 'Yr8#Pk3$Lm6!Wq1%Tz4@Bn9^Hc2&Vd7*';
const SESSION_COOKIE_NAME = 'session';
const TRUSTED_ORIGIN = 'https://yalelabs.io';
const LISTED_NETID = 'zz9lst';
const ADMIN_NETID = 'zz9adm';

vi.mock('../services/adminGrantService', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  hasActiveAdminGrant: vi.fn(async (netid: unknown) => netid === ADMIN_NETID),
}));

vi.mock('../middleware/csrfOriginGuard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/csrfOriginGuard')>();
  return {
    ...actual,
    csrfOriginGuard: (...[allowed, options]: Parameters<typeof actual.csrfOriginGuard>) =>
      actual.csrfOriginGuard(allowed, { ...options, allowUnsafeOriginBypass: false }),
  };
});

const signCookie = (name: string, value: string): string =>
  createHmac('sha1', STRONG_SESSION_SECRET)
    .update(`${name}=${value}`)
    .digest('base64')
    .replace(/\/|\+|=/g, (character) => ({ '/': '_', '+': '-', '=': '' })[character] ?? '');

const sessionCookieFor = (netid: string, sessionIdCharacter: string): string => {
  const value = Buffer.from(
    JSON.stringify({
      passport: {
        user: {
          netId: netid,
          userType: 'unknown',
          sessionId: sessionIdCharacter.repeat(32),
          issuedAt: Date.now(),
          sessionVersion: 0,
        },
      },
    }),
  ).toString('base64');
  return `${SESSION_COOKIE_NAME}=${value}; ${SESSION_COOKIE_NAME}.sig=${signCookie(
    SESSION_COOKIE_NAME,
    value,
  )}`;
};

const cookieHeaderFrom = (response: Response): string =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .filter((pair) => pair.startsWith(SESSION_COOKIE_NAME))
    .join('; ');

type Hop = { status: number; cookie: string; body: any };

const db = () => mongoose.connection.db!;

describe('directory removal request writes need the session CSRF token (#4160)', () => {
  let memoryServer: MongoMemoryServer;
  let server: http.Server;
  let baseUrl: string;

  const request = async (
    path: string,
    {
      cookie,
      method = 'GET',
      json,
      origin = TRUSTED_ORIGIN,
      referer,
      token,
    }: {
      cookie: string;
      method?: string;
      json?: unknown;
      origin?: string | null;
      referer?: string;
      token?: string;
    },
  ): Promise<Hop> => {
    const headers: Record<string, string> = { cookie };
    if (origin && method !== 'GET') headers.origin = origin;
    if (referer) headers.referer = referer;
    if (json !== undefined) headers['content-type'] = 'application/json';
    if (token !== undefined) headers['x-csrf-token'] = token;
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: json === undefined ? undefined : JSON.stringify(json),
      redirect: 'manual',
    });
    const text = await response.text();
    let body: any;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    return { status: response.status, cookie: cookieHeaderFrom(response), body };
  };

  const issuedToken = async (cookie: string) => {
    const issued = await request('/api/users/me/csrf-token', { cookie });
    expect(issued.status).toBe(200);
    return { cookie: issued.cookie || cookie, token: String(issued.body.csrfToken) };
  };

  beforeAll(async () => {
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri('directory_removal_request_csrf_test'));
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
      SSOBASEURL: 'http://127.0.0.1:9/cas',
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
    await mongoose.disconnect();
    await memoryServer?.stop();
    process.env = { ...ORIGINAL_ENV };
  });

  beforeEach(async () => {
    for (const name of [
      'accounts',
      'researchers',
      'directory_removal_requests',
      'directory_removals',
      'admin_audit_events',
    ]) {
      await db().collection(name).deleteMany({});
    }
    await db()
      .collection('accounts')
      .insertMany(
        [LISTED_NETID, ADMIN_NETID].map((netid) => ({
          netid,
          email: `${netid}@example.edu`,
          status: 'ACTIVE',
          archived: false,
          sessionVersion: 0,
        })),
      );
    await db()
      .collection('researchers')
      .insertOne({
        displayName: 'Synthetic Listed Person',
        identifiers: { netid: LISTED_NETID },
        archived: false,
      });
  });

  const pendingRequestId = async (): Promise<string> => {
    const inserted = await db().collection('directory_removal_requests').insertOne({
      requesterNetid: LISTED_NETID,
      researcherId: new mongoose.Types.ObjectId(),
      status: 'pending',
      createdAt: new Date(),
    });
    return String(inserted.insertedId);
  };

  const requestCount = () => db().collection('directory_removal_requests').countDocuments();
  const requestStatus = async (id: string) =>
    (
      await db()
        .collection('directory_removal_requests')
        .findOne({ _id: new mongoose.Types.ObjectId(id) })
    )?.status;

  it('issues one token per session on the general route', async () => {
    const cookie = sessionCookieFor(LISTED_NETID, 'a');
    const first = await issuedToken(cookie);
    expect(first.token).toMatch(/^[0-9a-f]{64}$/);
    const second = await issuedToken(first.cookie);
    expect(second.token).toBe(first.token);
  });

  describe('POST /api/users/directoryRemovalRequest', () => {
    const submit = (
      cookie: string,
      options: { origin?: string | null; referer?: string; token?: string } = {},
    ) => request('/api/users/directoryRemovalRequest', { cookie, method: 'POST', ...options });

    it('is refused cross-origin by the origin guard', async () => {
      const { cookie, token } = await issuedToken(sessionCookieFor(LISTED_NETID, 'a'));

      expect((await submit(cookie, { origin: 'https://attacker.example', token })).status).toBe(
        403,
      );
      const refused = await submit(cookie, {
        origin: null,
        referer: 'https://attacker.example/page',
        token,
      });
      expect(refused.status).toBe(403);
      expect(refused.body.error).toBe('Cross-site request blocked');
      expect(await requestCount()).toBe(0);
    });

    it('answers 403 CSRF_TOKEN_REQUIRED without a token', async () => {
      const { cookie } = await issuedToken(sessionCookieFor(LISTED_NETID, 'a'));

      const refused = await submit(cookie);
      expect(refused.status).toBe(403);
      expect(refused.body.code).toBe('CSRF_TOKEN_REQUIRED');
      expect(await requestCount()).toBe(0);
    });

    it("answers 403 with another session's token", async () => {
      const own = await issuedToken(sessionCookieFor(LISTED_NETID, 'a'));
      const other = await issuedToken(sessionCookieFor(LISTED_NETID, 'b'));
      expect(other.token).not.toBe(own.token);

      const refused = await submit(own.cookie, { token: other.token });
      expect(refused.status).toBe(403);
      expect(refused.body.code).toBe('CSRF_TOKEN_REQUIRED');
      expect(await requestCount()).toBe(0);
    });

    it("creates the request with this session's token", async () => {
      const { cookie, token } = await issuedToken(sessionCookieFor(LISTED_NETID, 'a'));

      const created = await submit(cookie, { token });
      expect(created.status).toBe(201);
      expect(created.body.request.status).toBe('pending');
      expect(await requestCount()).toBe(1);
    });
  });

  describe('PUT /api/admin/directory-removal-requests/:id', () => {
    const decide = (
      id: string,
      cookie: string,
      options: { origin?: string | null; referer?: string; token?: string } = {},
    ) =>
      request(`/api/admin/directory-removal-requests/${id}`, {
        cookie,
        method: 'PUT',
        json: { status: 'accepted' },
        ...options,
      });

    it('is refused cross-origin by the origin guard', async () => {
      const id = await pendingRequestId();
      const { cookie, token } = await issuedToken(sessionCookieFor(ADMIN_NETID, 'c'));

      expect((await decide(id, cookie, { origin: 'https://attacker.example', token })).status).toBe(
        403,
      );
      const refused = await decide(id, cookie, {
        origin: null,
        referer: 'https://attacker.example/page',
        token,
      });
      expect(refused.status).toBe(403);
      expect(refused.body.error).toBe('Cross-site request blocked');
      expect(await requestStatus(id)).toBe('pending');
    });

    it('answers 403 CSRF_TOKEN_REQUIRED without a token', async () => {
      const id = await pendingRequestId();
      const { cookie } = await issuedToken(sessionCookieFor(ADMIN_NETID, 'c'));

      const refused = await decide(id, cookie);
      expect(refused.status).toBe(403);
      expect(refused.body.code).toBe('CSRF_TOKEN_REQUIRED');
      expect(await requestStatus(id)).toBe('pending');
    });

    it("answers 403 with another session's token", async () => {
      const id = await pendingRequestId();
      const own = await issuedToken(sessionCookieFor(ADMIN_NETID, 'c'));
      const other = await issuedToken(sessionCookieFor(ADMIN_NETID, 'd'));

      const refused = await decide(id, own.cookie, { token: other.token });
      expect(refused.status).toBe(403);
      expect(refused.body.code).toBe('CSRF_TOKEN_REQUIRED');
      expect(await requestStatus(id)).toBe('pending');
    });

    it("decides the request with this session's token", async () => {
      const id = await pendingRequestId();
      const { cookie, token } = await issuedToken(sessionCookieFor(ADMIN_NETID, 'c'));

      const decided = await decide(id, cookie, { token });
      expect(decided.status).toBe(200);
      expect(await requestStatus(id)).toBe('accepted');
    });
  });
});
