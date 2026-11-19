import { createHmac } from 'node:crypto';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };
const STRONG_SESSION_SECRET = 'Zq7#Lm2$Wx9!Rt4%Kp8@Hv3^Nc6&Jb1*';
const SESSION_COOKIE_NAME = 'session';
const OWNER_NETID = 'deltest1';
const OTHER_NETID = 'keeptest2';
const AUDIT_HMAC_KEY = 'synthetic-audit-key-0123456789abcdef0123';
const OWNER_ANALYTICS_ID = '0f8b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d';
const SYNTHETIC_SEARCH_TEXT = 'synthetic owner search phrase';
const FLAG_ENV = 'FEATURE_ACCOUNT_DATA_CONTROLS';
const BETA_MONGODBURL = 'mongodb://127.0.0.1:1/Beta';
const PRODUCTION_MONGODBURL = 'mongodb://127.0.0.1:1/Prod';
const SYNTHETIC_POSTHOG_KEY = `phx_${'s'.repeat(40)}`;
const SYNTHETIC_POSTHOG_PROJECT_ID = '24680';
const BETA_TARGET_SERVICE_ENV = {
  ACCOUNT_DELETION_AUDIT_HMAC_KEY: 'synthetic-beta-target-key-0123456789abcdef',
};
const COMPLETE_PRODUCTION_DELETION_ENV = {
  MONGODBURL: PRODUCTION_MONGODBURL,
  POSTHOG_PERSONAL_API_KEY: SYNTHETIC_POSTHOG_KEY,
  POSTHOG_PROJECT_ID: SYNTHETIC_POSTHOG_PROJECT_ID,
  ACCOUNT_DELETION_AUDIT_HMAC_KEY: AUDIT_HMAC_KEY,
};
const AUTHENTICATED_ROUTE = '/api/users/savedResearchEntityIds';

vi.mock('../services/yaliesService', () => ({
  lookupYalieByNetid: vi.fn(async () => ({ kind: 'not_found' })),
}));

vi.mock('../services/analyticsService', () => ({
  logEvent: vi.fn(async () => 'skipped'),
}));

vi.mock('../middleware/csrfOriginGuard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/csrfOriginGuard')>();
  return {
    ...actual,
    csrfOriginGuard: (...[allowed, options]: Parameters<typeof actual.csrfOriginGuard>) =>
      actual.csrfOriginGuard(allowed, { ...options, allowUnsafeOriginBypass: false }),
  };
});

const TRUSTED_ORIGIN = 'https://yalelabs.io';
const casLogins: Array<{ renew: boolean }> = [];
const casValidations: Array<{ renew: boolean }> = [];

type FakeCas = { baseUrl: string; close: () => Promise<void> };

const startFakeCas = async (): Promise<FakeCas> => {
  const issued = new Map<string, { service: string; renew: boolean }>();
  const server = http.createServer((req, res) => {
    const requested = new URL(req.url ?? '/', 'http://cas.invalid');
    const service = requested.searchParams.get('service') ?? '';
    const renew = requested.searchParams.get('renew') === 'true';
    if (requested.pathname === '/cas/login') {
      const ticket = `ST-account-data-${issued.size + 1}`;
      issued.set(ticket, { service, renew });
      casLogins.push({ renew });
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(ticket);
      return;
    }
    if (requested.pathname === '/cas/validate') {
      const ticket = issued.get(requested.searchParams.get('ticket') ?? '');
      casValidations.push({ renew });
      const accepted = ticket?.service === service && (!renew || ticket.renew);
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(accepted ? `yes\n${OWNER_NETID}\n` : 'no\n');
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

const cookieHeaderFrom = (response: Response): string =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .filter((pair) => pair.startsWith(SESSION_COOKIE_NAME))
    .join('; ');

type Hop = { status: number; location: string; cookie: string; body: string; headers: Headers };

const request = async (
  url: string,
  {
    cookie = '',
    method = 'GET',
    json,
    origin = TRUSTED_ORIGIN,
    referer,
    extraHeaders = {},
  }: {
    cookie?: string;
    method?: string;
    json?: unknown;
    origin?: string | null;
    referer?: string;
    extraHeaders?: Record<string, string>;
  } = {},
): Promise<Hop> => {
  const headers: Record<string, string> = { ...extraHeaders };
  if (cookie) headers.cookie = cookie;
  if (origin && method !== 'GET') headers.origin = origin;
  if (referer) headers.referer = referer;
  if (json !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(url, {
    method,
    headers,
    body: json === undefined ? undefined : JSON.stringify(json),
    redirect: 'manual',
  });
  return {
    status: response.status,
    location: response.headers.get('location') ?? '',
    cookie: cookieHeaderFrom(response),
    body: await response.text(),
    headers: response.headers,
  };
};

const signIn = async (
  baseUrl: string,
  { confirmCredentials = false }: { confirmCredentials?: boolean } = {},
): Promise<string> => {
  const started = await request(`${baseUrl}/api/cas${confirmCredentials ? '?reauth=1' : ''}`);
  const ticket = (await request(started.location)).body;
  const service = new URL(started.location).searchParams.get('service') ?? '';
  const separator = service.includes('?') ? '&' : '?';
  const completed = await request(`${service}${separator}ticket=${ticket}`, {
    cookie: started.cookie,
  });
  expect(completed.status).toBe(302);
  return completed.cookie;
};

const staleSignInCookie = (issuedAt: number, credentialsConfirmedAt?: number): string =>
  sessionCookieHeader({
    passport: {
      user: {
        netId: OWNER_NETID,
        userType: 'unknown',
        sessionId: 'c'.repeat(32),
        issuedAt,
        sessionVersion: 0,
        ...(credentialsConfirmedAt === undefined ? {} : { credentialsConfirmedAt }),
      },
    },
  });

const db = () => mongoose.connection.db!;

const seedAccountData = async (netid: string, label: string) => {
  const account = await db().collection('accounts').findOne({ netid });
  const accountId = account!._id;
  const entityId = new mongoose.Types.ObjectId();
  await db()
    .collection('research_plans')
    .insertMany([
      {
        accountId,
        target: { kind: 'RESEARCH_ENTITY', id: entityId },
        stage: 'EXPLORING',
        privateNotes: `${label} private note`,
        checklist: [{ label: `${label} checklist item`, completed: false }],
        deadlines: [{ label: `${label} deadline`, dueAt: new Date('2027-01-15T00:00:00Z') }],
        archived: false,
      },
      {
        accountId,
        target: { kind: 'PROGRAM', id: new mongoose.Types.ObjectId() },
        stage: 'SAVED',
        privateNotes: `${label} archived note`,
        archived: true,
        restorableUntil: new Date(Date.now() + 60 * 60 * 1000),
      },
    ]);
  await db()
    .collection('analytics_events')
    .insertMany([
      {
        eventType: 'search',
        netid,
        userType: 'undergraduate',
        searchQuery: `${label} ${SYNTHETIC_SEARCH_TEXT}`,
        timestamp: new Date('2026-10-03T12:00:00Z'),
      },
      {
        eventType: 'search',
        netid,
        userType: 'undergraduate',
        searchQuery: `${label} second search`,
        timestamp: new Date('2026-10-20T12:00:00Z'),
      },
      {
        eventType: 'research_profile_open',
        netid,
        userType: 'undergraduate',
        entityId: String(entityId),
        timestamp: new Date('2026-11-01T12:00:00Z'),
      },
    ]);
  await db()
    .collection('entitycorrectionreports')
    .insertOne({
      researchEntityId: entityId,
      entitySlug: `${label}-synthetic-row`,
      entitySnapshot: { name: `${label} synthetic row`, kind: 'lab', entityType: 'lab' },
      category: 'broken_link',
      note: `${label} report note`,
      reporter: {
        netId: netid,
        email: `${netid}@example.invalid`,
        name: `${label} Reporter`,
        userType: 'undergraduate',
        role: 'student',
      },
      status: 'unreviewed',
      reviewHistory: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  return { accountId, entityId };
};

describe('a signed-in student can export and delete their account data (#4156)', () => {
  let replSet: MongoMemoryReplSet;
  let fakeCas: FakeCas;
  let server: http.Server;
  let baseUrl: string;
  let nativeFetch: typeof fetch;
  let invalidateConfigCache: () => void;

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
    delete process.env.POSTHOG_PERSONAL_API_KEY;
    delete process.env.POSTHOG_PROJECT_ID;
    delete process.env.ACCOUNT_DELETION_AUDIT_HMAC_KEY;
    nativeFetch = globalThis.fetch;
    ({ invalidateConfigCache } = await import('../services/configService'));
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
    process.env[FLAG_ENV] = 'true';
    process.env.MONGODBURL = BETA_MONGODBURL;
    process.env.ACCOUNT_DELETION_AUDIT_HMAC_KEY = AUDIT_HMAC_KEY;
    invalidateConfigCache();
    for (const name of [
      'accounts',
      'research_plans',
      'analytics_events',
      'entitycorrectionreports',
      'admin_grants',
      'admin_audit_events',
      'deleted_account_event_tallies',
      'account_deletion_requests',
    ]) {
      await db().collection(name).deleteMany({});
    }
  });

  afterEach(() => {
    globalThis.fetch = nativeFetch;
    delete process.env.POSTHOG_PERSONAL_API_KEY;
    delete process.env.POSTHOG_PROJECT_ID;
    delete process.env.ACCOUNT_DELETION_AUDIT_HMAC_KEY;
    delete process.env.MONGODBURL;
  });

  const signInBothAccounts = async ({ confirmCredentials = true } = {}) => {
    const cookie = await signIn(baseUrl, { confirmCredentials });
    await db()
      .collection('accounts')
      .updateOne({ netid: OWNER_NETID }, { $set: { productAnalyticsId: OWNER_ANALYTICS_ID } });
    await db()
      .collection('accounts')
      .insertOne({
        netid: OTHER_NETID,
        email: `${OTHER_NETID}@example.invalid`,
        status: 'ACTIVE',
        archived: false,
        sessionVersion: 0,
      });
    const owner = await seedAccountData(OWNER_NETID, 'owner');
    const other = await seedAccountData(OTHER_NETID, 'other');
    return { cookie, owner, other };
  };

  const deletionCsrfToken = async (cookie: string) => {
    const issued = await request(`${baseUrl}/api/users/me/deletion-csrf-token`, { cookie });
    return {
      cookie: issued.cookie || cookie,
      token: issued.status === 200 ? String(JSON.parse(issued.body).csrfToken) : '',
    };
  };

  const deleteOwnData = async (
    cookie: string,
    json: unknown = { confirm: 'delete my data' },
    {
      origin,
      referer,
      withToken = true,
    }: { origin?: string | null; referer?: string; withToken?: boolean } = {},
  ) => {
    const issued = withToken ? await deletionCsrfToken(cookie) : { cookie, token: '' };
    return request(`${baseUrl}/api/users/me`, {
      cookie: issued.cookie,
      method: 'DELETE',
      json,
      origin,
      referer,
      extraHeaders: issued.token ? { 'x-csrf-token': issued.token } : {},
    });
  };

  it('answers 404 on both routes while the release flag is off', async () => {
    const { cookie } = await signInBothAccounts();
    process.env[FLAG_ENV] = 'false';

    expect((await request(`${baseUrl}/api/users/me/export`, { cookie })).status).toBe(404);
    const refused = await deleteOwnData(cookie, { confirm: 'delete my data' });
    expect(refused.status).toBe(404);
    expect(await db().collection('accounts').countDocuments({ netid: OWNER_NETID })).toBe(1);
  });

  it('exports exactly the signed-in account rows, private plan fields included', async () => {
    const { cookie } = await signInBothAccounts();

    const exported = await request(`${baseUrl}/api/users/me/export`, { cookie });

    expect(exported.status).toBe(200);
    expect(exported.headers.get('content-disposition')).toMatch(/^attachment; filename="/);
    expect(exported.headers.get('cache-control')).toContain('no-store');
    const data = JSON.parse(exported.body);
    expect(data.scopeVersion).toBe(1);
    expect(data.account.netid).toBe(OWNER_NETID);
    expect(data.account.productAnalyticsId).toBe(OWNER_ANALYTICS_ID);
    expect(data.researchPlans).toHaveLength(2);
    const active = data.researchPlans.find((plan: any) => !plan.archived);
    expect(active.privateNotes).toBe('owner private note');
    expect(active.checklist[0].label).toBe('owner checklist item');
    expect(active.deadlines[0].label).toBe('owner deadline');
    expect(data.researchPlans.some((plan: any) => plan.archived)).toBe(true);
    expect(data.analyticsEvents).toHaveLength(3);
    expect(data.correctionReports).toHaveLength(1);
    expect(data.correctionReports[0].note).toBe('owner report note');
    expect(exported.body).not.toContain('other private note');
    expect(exported.body).not.toContain(OTHER_NETID);
  });

  it('refuses a deletion without the typed phrase', async () => {
    const { cookie } = await signInBothAccounts();

    const refused = await deleteOwnData(cookie, { confirm: 'delete' });

    expect(refused.status).toBe(400);
    expect(JSON.parse(refused.body).code).toBe('CONFIRMATION_REQUIRED');
    expect(await db().collection('accounts').countDocuments({ netid: OWNER_NETID })).toBe(1);
  });

  it('refuses a deletion whose password confirmation is older than the window', async () => {
    await signInBothAccounts();
    await db()
      .collection('accounts')
      .updateOne(
        { netid: OWNER_NETID },
        { $set: { createdAt: new Date(Date.now() - 60 * 60 * 1000) } },
      );
    const elevenMinutesAgo = Date.now() - 11 * 60 * 1000;
    const stale = staleSignInCookie(elevenMinutesAgo, elevenMinutesAgo);
    expect((await request(`${baseUrl}${AUTHENTICATED_ROUTE}`, { cookie: stale })).status).toBe(200);

    const refused = await deleteOwnData(stale, { confirm: 'delete my data' });

    expect(refused.status).toBe(403);
    expect(JSON.parse(refused.body).code).toBe('RECENT_SIGN_IN_REQUIRED');
    expect(await db().collection('analytics_events').countDocuments({ netid: OWNER_NETID })).toBe(
      3,
    );
  });

  it('refuses a deletion from a single sign-on session that never re-entered a password', async () => {
    const { cookie } = await signInBothAccounts({ confirmCredentials: false });

    const refused = await deleteOwnData(cookie, { confirm: 'delete my data' });

    expect(refused.status).toBe(403);
    expect(JSON.parse(refused.body).code).toBe('RECENT_SIGN_IN_REQUIRED');
    expect(await db().collection('accounts').countDocuments({ netid: OWNER_NETID })).toBe(1);
  });

  it('asks CAS to renew credentials at login and at validation when deletion needs a password', async () => {
    casLogins.length = 0;
    casValidations.length = 0;
    await signIn(baseUrl);
    await signIn(baseUrl, { confirmCredentials: true });

    expect(casLogins).toEqual([{ renew: false }, { renew: true }]);
    expect(casValidations).toEqual([{ renew: false }, { renew: true }]);
  });

  it('refuses a cross-origin deletion without the token through the origin guard', async () => {
    const { cookie } = await signInBothAccounts();

    expect(
      (
        await deleteOwnData(cookie, undefined, {
          origin: 'https://attacker.example',
          withToken: false,
        })
      ).status,
    ).toBe(403);
    for (const refused of [
      await deleteOwnData(cookie, undefined, {
        origin: null,
        referer: 'https://attacker.example/page',
        withToken: false,
      }),
      await deleteOwnData(cookie, undefined, { origin: null, withToken: false }),
    ]) {
      expect(refused.status).toBe(403);
      expect(JSON.parse(refused.body).error).toBe('Cross-site request blocked');
    }
    expect(await db().collection('accounts').countDocuments({ netid: OWNER_NETID })).toBe(1);
    expect(await db().collection('analytics_events').countDocuments({ netid: OWNER_NETID })).toBe(
      3,
    );
  });

  it("refuses a same-origin deletion without this session's token, and accepts it with one", async () => {
    const { cookie } = await signInBothAccounts();
    const otherSession = await deletionCsrfToken(
      await signIn(baseUrl, { confirmCredentials: true }),
    );

    const withoutToken = await deleteOwnData(cookie, undefined, { withToken: false });
    expect(withoutToken.status).toBe(403);
    expect(JSON.parse(withoutToken.body).code).toBe('CSRF_TOKEN_REQUIRED');
    const ownSession = await deletionCsrfToken(cookie);
    const borrowedToken = await request(`${baseUrl}/api/users/me`, {
      cookie: ownSession.cookie,
      method: 'DELETE',
      json: { confirm: 'delete my data' },
      extraHeaders: { 'x-csrf-token': otherSession.token },
    });
    expect(borrowedToken.status).toBe(403);
    expect(JSON.parse(borrowedToken.body).code).toBe('CSRF_TOKEN_REQUIRED');
    expect(await db().collection('accounts').countDocuments({ netid: OWNER_NETID })).toBe(1);

    const accepted = await request(`${baseUrl}/api/users/me`, {
      cookie: ownSession.cookie,
      method: 'DELETE',
      json: { confirm: 'delete my data' },
      extraHeaders: { 'x-csrf-token': ownSession.token },
    });

    expect(accepted.status).toBe(200);
    expect(await db().collection('accounts').countDocuments({ netid: OWNER_NETID })).toBe(0);
  });

  it('records a pending deletion for every other environment, keyed by the hash alone', async () => {
    const { cookie } = await signInBothAccounts();
    process.env.MONGODBURL = BETA_MONGODBURL;

    const deleted = await deleteOwnData(cookie, { confirm: 'delete my data' });

    expect(deleted.status).toBe(200);
    expect(JSON.parse(deleted.body).otherEnvironments).toBe('requested');
    const requests = await db().collection('account_deletion_requests').find({}).toArray();
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      subjectHash: createHmac('sha256', AUDIT_HMAC_KEY).update(OWNER_NETID).digest('hex'),
      sourceEnvironment: 'beta',
      requester: 'account_holder',
      pendingEnvironments: ['development', 'production'],
      completedEnvironments: [],
    });
    expect(JSON.stringify(requests).toLowerCase()).not.toContain(OWNER_NETID);
  });

  it('lets the operator carry a pending request into another environment and mark it done', async () => {
    const { processPendingDeletionRequests } =
      await import('../services/accountDeletionRequestProcessor');
    await signInBothAccounts();
    const sourceDb = mongoose.connection.getClient().db('synthetic_deletion_source');
    await sourceDb.collection('account_deletion_requests').deleteMany({});
    const sourceKey = 'synthetic-source-key-0123456789abcdef0123';
    const subjectHash = createHmac('sha256', sourceKey).update(OWNER_NETID).digest('hex');
    await sourceDb.collection('account_deletion_requests').insertMany([
      {
        subjectHash,
        sourceEnvironment: 'production',
        requester: 'account_holder',
        requestedAt: new Date(),
        pendingEnvironments: ['development', 'beta'],
        completedEnvironments: [],
      },
      {
        subjectHash: 'f'.repeat(64),
        sourceEnvironment: 'production',
        requester: 'operator',
        requestedAt: new Date(),
        pendingEnvironments: ['beta'],
        completedEnvironments: [],
      },
    ]);

    const dryRun = await processPendingDeletionRequests({
      sourceDb,
      sourceKey,
      target: 'beta',
      targetServiceEnv: BETA_TARGET_SERVICE_ENV,
      apply: false,
    });
    expect(dryRun).toEqual({ pending: 2, matched: 1, deleted: 0, markedDone: 0, failed: 0 });
    expect(await db().collection('accounts').countDocuments({ netid: OWNER_NETID })).toBe(1);

    const applied = await processPendingDeletionRequests({
      sourceDb,
      sourceKey,
      target: 'beta',
      targetServiceEnv: BETA_TARGET_SERVICE_ENV,
      apply: true,
    });

    expect(applied).toEqual({ pending: 2, matched: 1, deleted: 1, markedDone: 2, failed: 0 });
    expect(await db().collection('accounts').countDocuments({ netid: OWNER_NETID })).toBe(0);
    expect(await db().collection('analytics_events').countDocuments({ netid: OWNER_NETID })).toBe(
      0,
    );
    expect(await db().collection('accounts').countDocuments({ netid: OTHER_NETID })).toBe(1);
    expect(await db().collection('account_deletion_requests').countDocuments()).toBe(0);
    const carried = await sourceDb
      .collection('account_deletion_requests')
      .find({}, { projection: { _id: 0, pendingEnvironments: 1, completedEnvironments: 1 } })
      .sort({ requester: 1 })
      .toArray();
    expect(carried).toEqual([
      {
        pendingEnvironments: ['development'],
        completedEnvironments: [
          { environment: 'beta', completedAt: expect.any(Date), matched: true },
        ],
      },
      {
        pendingEnvironments: [],
        completedEnvironments: [
          { environment: 'beta', completedAt: expect.any(Date), matched: false },
        ],
      },
    ]);
    expect(
      await processPendingDeletionRequests({
        sourceDb,
        sourceKey,
        target: 'beta',
        targetServiceEnv: BETA_TARGET_SERVICE_ENV,
        apply: true,
      }),
    ).toEqual({ pending: 0, matched: 0, deleted: 0, markedDone: 0, failed: 0 });
  });

  it('leaves a blocked request pending and still carries the requests behind it', async () => {
    const { processPendingDeletionRequests } =
      await import('../services/accountDeletionRequestProcessor');
    const { owner } = await signInBothAccounts();
    await db().collection('researchers').insertOne({ accountId: owner.accountId });
    const sourceDb = mongoose.connection.getClient().db('synthetic_deletion_source');
    await sourceDb.collection('account_deletion_requests').deleteMany({});
    const sourceKey = 'synthetic-source-key-0123456789abcdef0123';
    const hashOf = (netid: string) => createHmac('sha256', sourceKey).update(netid).digest('hex');
    await sourceDb.collection('account_deletion_requests').insertMany([
      {
        subjectHash: hashOf(OWNER_NETID),
        sourceEnvironment: 'production',
        requester: 'account_holder',
        requestedAt: new Date(1_000),
        pendingEnvironments: ['beta'],
        completedEnvironments: [],
      },
      {
        subjectHash: hashOf(OTHER_NETID),
        sourceEnvironment: 'production',
        requester: 'account_holder',
        requestedAt: new Date(2_000),
        pendingEnvironments: ['beta'],
        completedEnvironments: [],
      },
    ]);

    const applied = await processPendingDeletionRequests({
      sourceDb,
      sourceKey,
      target: 'beta',
      targetServiceEnv: BETA_TARGET_SERVICE_ENV,
      apply: true,
    });

    expect(applied).toEqual({ pending: 2, matched: 2, deleted: 1, markedDone: 1, failed: 1 });
    expect(await db().collection('accounts').countDocuments({ netid: OWNER_NETID })).toBe(1);
    expect(await db().collection('accounts').countDocuments({ netid: OTHER_NETID })).toBe(0);
    const remaining = await sourceDb
      .collection('account_deletion_requests')
      .find({ pendingEnvironments: 'beta' })
      .toArray();
    expect(remaining.map((request) => request.subjectHash)).toEqual([hashOf(OWNER_NETID)]);
    await db().collection('researchers').deleteMany({});
  });

  it('refuses to carry requests into an environment that lacks a deletion setting, marking none done', async () => {
    const { processPendingDeletionRequests } =
      await import('../services/accountDeletionRequestProcessor');
    await signInBothAccounts();
    const sourceDb = mongoose.connection.getClient().db('synthetic_deletion_source');
    await sourceDb.collection('account_deletion_requests').deleteMany({});
    const sourceKey = 'synthetic-source-key-0123456789abcdef0123';
    await sourceDb.collection('account_deletion_requests').insertOne({
      subjectHash: createHmac('sha256', sourceKey).update(OWNER_NETID).digest('hex'),
      sourceEnvironment: 'beta',
      requester: 'account_holder',
      requestedAt: new Date(),
      pendingEnvironments: ['production'],
      completedEnvironments: [],
    });

    await expect(
      processPendingDeletionRequests({
        sourceDb,
        sourceKey,
        target: 'production',
        targetServiceEnv: { ACCOUNT_DELETION_AUDIT_HMAC_KEY: AUDIT_HMAC_KEY },
        apply: true,
      }),
    ).rejects.toThrow('POSTHOG_PERSONAL_API_KEY, POSTHOG_PROJECT_ID');

    expect(await db().collection('accounts').countDocuments({ netid: OWNER_NETID })).toBe(1);
    expect(
      await sourceDb
        .collection('account_deletion_requests')
        .countDocuments({ pendingEnvironments: 'production' }),
    ).toBe(1);
  });

  it('puts an environment already carried back to pending when the person deletes again', async () => {
    const { recordCrossEnvironmentDeletionRequest } =
      await import('../services/accountDeletionRequestService');
    const subjectHash = 'a'.repeat(64);
    await recordCrossEnvironmentDeletionRequest({
      subjectHash,
      sourceEnvironment: 'production',
      requester: 'account_holder',
    });
    await db()
      .collection('account_deletion_requests')
      .updateOne({ subjectHash }, {
        $pull: { pendingEnvironments: 'beta' },
        $push: {
          completedEnvironments: { environment: 'beta', completedAt: new Date(), matched: true },
        },
      } as never);

    await recordCrossEnvironmentDeletionRequest({
      subjectHash,
      sourceEnvironment: 'production',
      requester: 'account_holder',
    });

    const requests = await db().collection('account_deletion_requests').find({}).toArray();
    expect(requests).toHaveLength(1);
    expect([...requests[0].pendingEnvironments].sort()).toEqual(['beta', 'development']);
  });

  it('deletes every in-scope row, keeps only counts and tombstoned reports, and ends the session', async () => {
    const { cookie, owner, other } = await signInBothAccounts();
    await db().collection('admin_grants').insertOne({
      netid: OWNER_NETID,
      status: 'active',
      source: 'manual',
      grantedBy: 'synthgrantor',
      grantedAt: new Date(),
      history: [],
    });
    process.env.ACCOUNT_DELETION_AUDIT_HMAC_KEY = AUDIT_HMAC_KEY;

    const deleted = await deleteOwnData(cookie, { confirm: 'delete my data' });

    expect(deleted.status).toBe(200);
    const body = JSON.parse(deleted.body);
    expect(body.counts).toEqual({
      account: 1,
      researchPlans: 2,
      analyticsEvents: 3,
      correctionReports: 1,
      adminGrants: 1,
    });
    expect(body.postHog).toBe('skipped_not_configured');
    expect(body.auditSubjectHash).toBe('recorded');

    expect(await db().collection('accounts').countDocuments({ netid: OWNER_NETID })).toBe(0);
    expect(
      await db().collection('research_plans').countDocuments({ accountId: owner.accountId }),
    ).toBe(0);
    expect(await db().collection('analytics_events').countDocuments({ netid: OWNER_NETID })).toBe(
      0,
    );
    const ownGrant = await db().collection('admin_grants').findOne({ netid: OWNER_NETID });
    expect(ownGrant).toMatchObject({ status: 'revoked', grantedBy: 'synthgrantor' });
    expect(ownGrant?.history).toEqual([
      expect.objectContaining({ action: 'revoked', actorNetid: 'accountholder' }),
    ]);

    const report = await db()
      .collection('entitycorrectionreports')
      .findOne({ researchEntityId: owner.entityId });
    expect(report?.note).toBe('owner report note');
    expect(report?.reporter).toEqual({
      netId: `deleted-${String(report?._id)}`,
      email: '',
      name: '',
      userType: 'unknown',
      role: 'other',
    });

    const tallies = await db()
      .collection('deleted_account_event_tallies')
      .find({}, { projection: { _id: 0 } })
      .sort({ month: 1, eventType: 1 })
      .toArray();
    expect(tallies).toEqual([
      { month: '2026-10', eventType: 'search', count: 2 },
      { month: '2026-11', eventType: 'research_profile_open', count: 1 },
    ]);

    const audit = await db()
      .collection('admin_audit_events')
      .findOne({ action: 'account.self_delete' });
    const expectedHash = createHmac('sha256', AUDIT_HMAC_KEY).update(OWNER_NETID).digest('hex');
    expect(audit?.targetId).toBe(expectedHash);
    const storedText = JSON.stringify(
      await Promise.all(
        ['admin_audit_events', 'deleted_account_event_tallies', 'entitycorrectionreports'].map(
          (name) => db().collection(name).find({}).toArray(),
        ),
      ),
    );
    expect(storedText).not.toContain(OWNER_NETID);
    expect(storedText).not.toContain(SYNTHETIC_SEARCH_TEXT);

    expect(await db().collection('accounts').countDocuments({ netid: OTHER_NETID })).toBe(1);
    expect(
      await db().collection('research_plans').countDocuments({ accountId: other.accountId }),
    ).toBe(2);
    expect(await db().collection('analytics_events').countDocuments({ netid: OTHER_NETID })).toBe(
      3,
    );
    expect(
      await db()
        .collection('entitycorrectionreports')
        .countDocuments({ 'reporter.netId': OTHER_NETID }),
    ).toBe(1);

    expect((await request(`${baseUrl}${AUTHENTICATED_ROUTE}`, { cookie })).status).toBe(401);
  });

  const recordPostHogCalls = () => {
    const postHogCalls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith('https://us.posthog.com/')) {
        postHogCalls.push({ url, init });
        return new Response('{}', { status: 202 });
      }
      return nativeFetch(input, init);
    }) as typeof fetch;
    return postHogCalls;
  };

  const useProductionDeletionEnv = (without?: string) => {
    Object.assign(process.env, COMPLETE_PRODUCTION_DELETION_ENV);
    if (without) delete process.env[without];
    invalidateConfigCache();
  };

  const servedDeletionState = async () => {
    const ready = JSON.parse((await request(`${baseUrl}/api/ready`)).body);
    const config = JSON.parse((await request(`${baseUrl}/api/config`)).body);
    return { readiness: ready.accountDeletion, config: config.selfServeAccountDeletion };
  };

  it('asks PostHog to delete the person by its random id when configured', async () => {
    const { cookie } = await signInBothAccounts();
    useProductionDeletionEnv();
    const postHogCalls = recordPostHogCalls();

    const deleted = await deleteOwnData(cookie, { confirm: 'delete my data' });

    expect(deleted.status).toBe(200);
    const body = JSON.parse(deleted.body);
    expect(body.postHog).toBe('requested');
    expect(body.auditSubjectHash).toBe('recorded');
    expect(body.otherEnvironments).toBe('requested');
    expect(postHogCalls).toHaveLength(1);
    expect(postHogCalls[0].url).toBe(
      `https://us.posthog.com/api/projects/${SYNTHETIC_POSTHOG_PROJECT_ID}/persons/bulk_delete/`,
    );
    expect(JSON.parse(String(postHogCalls[0].init?.body))).toEqual({
      distinct_ids: [OWNER_ANALYTICS_ID],
      delete_events: true,
      delete_recordings: true,
    });
    const audit = await db()
      .collection('admin_audit_events')
      .findOne({ action: 'account.self_delete' });
    expect(audit?.targetId).toBe(
      createHmac('sha256', AUDIT_HMAC_KEY).update(OWNER_NETID).digest('hex'),
    );
  });

  it('serves deletion as available once every production setting is present', async () => {
    useProductionDeletionEnv();

    expect(await servedDeletionState()).toEqual({
      readiness: { status: 'available', missingSettings: [] },
      config: true,
    });
  });

  it.each(['POSTHOG_PERSONAL_API_KEY', 'POSTHOG_PROJECT_ID', 'ACCOUNT_DELETION_AUDIT_HMAC_KEY'])(
    'refuses deletion without %s, deleting nothing and naming only the setting',
    async (missing) => {
      const { cookie } = await signInBothAccounts();
      useProductionDeletionEnv(missing);
      const postHogCalls = recordPostHogCalls();

      const refused = await deleteOwnData(cookie, { confirm: 'delete my data' });

      expect(refused.status).toBe(503);
      expect(JSON.parse(refused.body)).toEqual({
        code: 'DELETION_UNAVAILABLE',
        error: expect.stringContaining('Email the privacy address'),
      });
      expect(postHogCalls).toHaveLength(0);
      expect(await db().collection('accounts').countDocuments({ netid: OWNER_NETID })).toBe(1);
      expect(await db().collection('analytics_events').countDocuments({ netid: OWNER_NETID })).toBe(
        3,
      );
      expect(await db().collection('research_plans').countDocuments()).toBe(4);
      expect(await db().collection('account_deletion_requests').countDocuments()).toBe(0);
      expect(await db().collection('admin_audit_events').countDocuments()).toBe(0);

      const served = await servedDeletionState();
      expect(served).toEqual({
        readiness: { status: 'unavailable', missingSettings: [missing] },
        config: false,
      });
      const servedText = JSON.stringify(served);
      for (const value of Object.values(COMPLETE_PRODUCTION_DELETION_ENV)) {
        expect(servedText).not.toContain(value);
      }

      const exported = await request(`${baseUrl}/api/users/me/export`, { cookie });
      expect(exported.status).toBe(200);
      expect(JSON.parse(exported.body).account.netid).toBe(OWNER_NETID);
    },
  );

  it('refuses deletion where it cannot tell which environment it serves', async () => {
    const { cookie } = await signInBothAccounts();
    useProductionDeletionEnv('MONGODBURL');

    const refused = await deleteOwnData(cookie, { confirm: 'delete my data' });

    expect(refused.status).toBe(503);
    expect((await servedDeletionState()).readiness).toEqual({
      status: 'unavailable',
      missingSettings: ['MONGODBURL'],
    });
    expect(await db().collection('accounts').countDocuments({ netid: OWNER_NETID })).toBe(1);
  });

  it('exports with every deletion setting unset, since export reads only this database', async () => {
    const { cookie } = await signInBothAccounts();
    delete process.env.MONGODBURL;
    delete process.env.POSTHOG_PERSONAL_API_KEY;
    delete process.env.POSTHOG_PROJECT_ID;
    delete process.env.ACCOUNT_DELETION_AUDIT_HMAC_KEY;
    const postHogCalls = recordPostHogCalls();

    const exported = await request(`${baseUrl}/api/users/me/export`, { cookie });

    expect(exported.status).toBe(200);
    expect(JSON.parse(exported.body).researchPlans).toHaveLength(2);
    expect(postHogCalls).toHaveLength(0);
    expect((await servedDeletionState()).readiness.status).toBe('unavailable');
  });

  it('reports deletion as off, not unavailable, while the release flag is off', async () => {
    process.env[FLAG_ENV] = 'false';
    delete process.env.ACCOUNT_DELETION_AUDIT_HMAC_KEY;
    invalidateConfigCache();

    expect(await servedDeletionState()).toEqual({
      readiness: { status: 'off', missingSettings: [] },
      config: false,
    });
  });

  it('keeps the account when PostHog fails, so a retry after signing in again finishes the job', async () => {
    const { deleteAccountData, readAccountDataResidue } =
      await import('../services/accountDataService');
    await signInBothAccounts();
    process.env.POSTHOG_PERSONAL_API_KEY = `phx_${'b'.repeat(40)}`;
    process.env.POSTHOG_PROJECT_ID = '12345';
    let postHogStatus = 500;
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith('https://us.posthog.com/'))
        return new Response('{}', { status: postHogStatus });
      return nativeFetch(input, init);
    }) as typeof fetch;

    await expect(deleteAccountData(OWNER_NETID, { requester: 'account_holder' })).rejects.toThrow(
      /PostHog/,
    );
    expect(await readAccountDataResidue(OWNER_NETID)).toEqual({
      account: 1,
      researchPlans: 0,
      analyticsEvents: 0,
      correctionReports: 0,
      adminGrants: 0,
    });

    postHogStatus = 202;
    const retried = await deleteAccountData(OWNER_NETID, { requester: 'account_holder' });

    expect(retried.deleted.account).toBe(1);
    expect(await readAccountDataResidue(OWNER_NETID)).toEqual({
      account: 0,
      researchPlans: 0,
      analyticsEvents: 0,
      correctionReports: 0,
      adminGrants: 0,
    });
    const tallied = await db()
      .collection('deleted_account_event_tallies')
      .aggregate([{ $group: { _id: null, total: { $sum: '$count' } } }])
      .toArray();
    expect(tallied[0].total).toBe(3);
  });

  it('finds rows stored under a differently cased netid in export, residue and deletion', async () => {
    const { deleteAccountData, readAccountDataResidue } =
      await import('../services/accountDataService');
    const { cookie, owner } = await signInBothAccounts();
    const storedCase = OWNER_NETID.toUpperCase();
    await db()
      .collection('analytics_events')
      .updateMany({ netid: OWNER_NETID }, { $set: { netid: storedCase } });
    await db()
      .collection('entitycorrectionreports')
      .updateMany({ 'reporter.netId': OWNER_NETID }, { $set: { 'reporter.netId': storedCase } });

    const exported = JSON.parse((await request(`${baseUrl}/api/users/me/export`, { cookie })).body);
    expect(exported.analyticsEvents).toHaveLength(3);
    expect(exported.correctionReports).toHaveLength(1);
    expect(await readAccountDataResidue(OWNER_NETID)).toMatchObject({
      analyticsEvents: 3,
      correctionReports: 1,
    });

    await deleteAccountData(OWNER_NETID, { requester: 'account_holder' });

    expect(await db().collection('analytics_events').countDocuments({ netid: storedCase })).toBe(0);
    const report = await db()
      .collection('entitycorrectionreports')
      .findOne({ researchEntityId: owner.entityId });
    expect(report?.reporter.netId).toBe(`deleted-${String(report?._id)}`);
    expect(await db().collection('analytics_events').countDocuments({ netid: OTHER_NETID })).toBe(
      3,
    );
  });

  it('counts each event once when two deletions of one account run at the same time', async () => {
    const { deleteAccountData } = await import('../services/accountDataService');
    await signInBothAccounts();

    const results = await Promise.all([
      deleteAccountData(OWNER_NETID, { requester: 'account_holder' }),
      deleteAccountData(OWNER_NETID, { requester: 'operator' }),
    ]);

    expect(results.reduce((sum, result) => sum + result.deleted.analyticsEvents, 0)).toBe(3);
    const tallied = await db()
      .collection('deleted_account_event_tallies')
      .aggregate([{ $group: { _id: null, total: { $sum: '$count' } } }])
      .toArray();
    expect(tallied[0].total).toBe(3);
  });

  it('never revives a session minted before the account was deleted and created again', async () => {
    const { cookie } = await signInBothAccounts();
    const deleted = await deleteOwnData(cookie, { confirm: 'delete my data' });
    expect(deleted.status).toBe(200);
    const forgotten = staleSignInCookie(Date.now() - 60 * 1000);

    const freshCookie = await signIn(baseUrl);

    expect(
      (await request(`${baseUrl}${AUTHENTICATED_ROUTE}`, { cookie: freshCookie })).status,
    ).toBe(200);
    expect((await request(`${baseUrl}${AUTHENTICATED_ROUTE}`, { cookie: forgotten })).status).toBe(
      401,
    );
  });

  it('exports a maintainer audit trail and leaves the append-only audit log and grant history untouched', async () => {
    const { deleteAccountData } = await import('../services/accountDataService');
    const { cookie } = await signInBothAccounts();
    const grantedAt = new Date('2026-09-01T00:00:00Z');
    await db()
      .collection('admin_grants')
      .insertOne({
        netid: OTHER_NETID,
        status: 'active',
        source: 'manual',
        grantedBy: OWNER_NETID,
        grantedAt,
        history: [
          { action: 'granted', actorNetid: OWNER_NETID, at: grantedAt },
          { action: 'note', actorNetid: 'synthgrantor', at: grantedAt },
        ],
      });
    await db()
      .collection('admin_audit_events')
      .insertMany([
        {
          actorNetid: OWNER_NETID,
          action: 'admin_grant.grant',
          targetType: 'adminGrant',
          targetId: OTHER_NETID,
          timestamp: grantedAt,
        },
        {
          actorNetid: 'synthgrantor',
          action: 'account.sessions_revoke',
          targetType: 'account',
          targetId: OWNER_NETID.toUpperCase(),
          timestamp: grantedAt,
        },
      ]);

    const exported = JSON.parse((await request(`${baseUrl}/api/users/me/export`, { cookie })).body);
    expect(exported.adminAuditEvents).toEqual([
      {
        role: 'actor',
        action: 'admin_grant.grant',
        targetType: 'adminGrant',
        timestamp: grantedAt.toISOString(),
      },
      {
        role: 'subject',
        action: 'account.sessions_revoke',
        targetType: 'account',
        timestamp: grantedAt.toISOString(),
      },
    ]);
    expect(exported.adminGrantActions).toEqual([
      { action: 'granted', at: grantedAt.toISOString() },
    ]);

    const auditBefore = await db().collection('admin_audit_events').find({}).toArray();
    const result = await deleteAccountData(OWNER_NETID, { requester: 'account_holder' });

    expect(result.deleted).not.toHaveProperty('adminAuditEvents');
    const otherGrant = await db().collection('admin_grants').findOne({ netid: OTHER_NETID });
    expect(otherGrant?.status).toBe('active');
    expect(otherGrant?.grantedBy).toBe(OWNER_NETID);
    expect(otherGrant?.history.map((entry: any) => entry.actorNetid)).toEqual([
      OWNER_NETID,
      'synthgrantor',
    ]);
    const auditAfter = await db().collection('admin_audit_events').find({}).toArray();
    expect(auditAfter.slice(0, auditBefore.length)).toEqual(auditBefore);
    expect(auditAfter).toHaveLength(auditBefore.length + 1);
  });

  it('refuses to delete an account the directory still references', async () => {
    const { cookie, owner } = await signInBothAccounts();
    await db().collection('researchers').insertOne({ accountId: owner.accountId });

    const refused = await deleteOwnData(cookie, { confirm: 'delete my data' });

    expect(refused.status).toBe(409);
    expect(JSON.parse(refused.body).code).toBe('DELETION_BLOCKED');
    expect(await db().collection('analytics_events').countDocuments({ netid: OWNER_NETID })).toBe(
      3,
    );
    await db().collection('researchers').deleteMany({});
  });
});
