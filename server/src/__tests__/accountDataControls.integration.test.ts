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
      const ticket = `ST-account-data-${serviceUrlByTicket.size + 1}`;
      serviceUrlByTicket.set(ticket, service);
      const separator = service.includes('?') ? '&' : '?';
      res.writeHead(302, { location: `${service}${separator}ticket=${ticket}` });
      res.end();
      return;
    }
    if (requested.pathname === '/cas/validate') {
      const ticket = requested.searchParams.get('ticket') ?? '';
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(serviceUrlByTicket.get(ticket) === service ? `yes\n${OWNER_NETID}\n` : 'no\n');
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
  { cookie = '', method = 'GET', json }: { cookie?: string; method?: string; json?: unknown } = {},
): Promise<Hop> => {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
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

const signIn = async (baseUrl: string): Promise<string> => {
  const started = await request(`${baseUrl}/api/cas`);
  const atCas = await request(started.location);
  const completed = await request(atCas.location, { cookie: started.cookie });
  expect(completed.status).toBe(302);
  return completed.cookie;
};

const staleSignInCookie = (issuedAt: number): string =>
  sessionCookieHeader({
    passport: {
      user: {
        netId: OWNER_NETID,
        userType: 'unknown',
        sessionId: 'c'.repeat(32),
        issuedAt,
        sessionVersion: 0,
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
    for (const name of [
      'accounts',
      'research_plans',
      'analytics_events',
      'entitycorrectionreports',
      'admin_grants',
      'admin_audit_events',
      'deleted_account_event_tallies',
    ]) {
      await db().collection(name).deleteMany({});
    }
  });

  afterEach(() => {
    globalThis.fetch = nativeFetch;
    delete process.env.POSTHOG_PERSONAL_API_KEY;
    delete process.env.POSTHOG_PROJECT_ID;
    delete process.env.ACCOUNT_DELETION_AUDIT_HMAC_KEY;
  });

  const signInBothAccounts = async () => {
    const cookie = await signIn(baseUrl);
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

  it('answers 404 on both routes while the release flag is off', async () => {
    const { cookie } = await signInBothAccounts();
    process.env[FLAG_ENV] = 'false';

    expect((await request(`${baseUrl}/api/users/me/export`, { cookie })).status).toBe(404);
    const refused = await request(`${baseUrl}/api/users/me`, {
      cookie,
      method: 'DELETE',
      json: { confirm: 'delete my data' },
    });
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

    const refused = await request(`${baseUrl}/api/users/me`, {
      cookie,
      method: 'DELETE',
      json: { confirm: 'delete' },
    });

    expect(refused.status).toBe(400);
    expect(JSON.parse(refused.body).code).toBe('CONFIRMATION_REQUIRED');
    expect(await db().collection('accounts').countDocuments({ netid: OWNER_NETID })).toBe(1);
  });

  it('refuses a deletion from a session whose sign-in was not recent', async () => {
    await signInBothAccounts();
    await db()
      .collection('accounts')
      .updateOne(
        { netid: OWNER_NETID },
        { $set: { createdAt: new Date(Date.now() - 60 * 60 * 1000) } },
      );
    const stale = staleSignInCookie(Date.now() - 11 * 60 * 1000);
    expect((await request(`${baseUrl}${AUTHENTICATED_ROUTE}`, { cookie: stale })).status).toBe(200);

    const refused = await request(`${baseUrl}/api/users/me`, {
      cookie: stale,
      method: 'DELETE',
      json: { confirm: 'delete my data' },
    });

    expect(refused.status).toBe(403);
    expect(JSON.parse(refused.body).code).toBe('RECENT_SIGN_IN_REQUIRED');
    expect(await db().collection('analytics_events').countDocuments({ netid: OWNER_NETID })).toBe(
      3,
    );
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

    const deleted = await request(`${baseUrl}/api/users/me`, {
      cookie,
      method: 'DELETE',
      json: { confirm: 'delete my data' },
    });

    expect(deleted.status).toBe(200);
    const body = JSON.parse(deleted.body);
    expect(body.counts).toEqual({
      account: 1,
      researchPlans: 2,
      analyticsEvents: 3,
      correctionReports: 1,
      adminGrants: 1,
      adminAuditEvents: 0,
      adminGrantActions: 0,
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
    expect(await db().collection('admin_grants').countDocuments({ netid: OWNER_NETID })).toBe(0);

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

  it('asks PostHog to delete the person by its random id when configured', async () => {
    const { cookie } = await signInBothAccounts();
    process.env.POSTHOG_PERSONAL_API_KEY = `phx_${'a'.repeat(40)}`;
    process.env.POSTHOG_PROJECT_ID = '12345';
    const postHogCalls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.startsWith('https://us.posthog.com/')) {
        postHogCalls.push({ url, init });
        return new Response('{}', { status: 202 });
      }
      return nativeFetch(input, init);
    }) as typeof fetch;

    const deleted = await request(`${baseUrl}/api/users/me`, {
      cookie,
      method: 'DELETE',
      json: { confirm: 'delete my data' },
    });

    expect(deleted.status).toBe(200);
    expect(JSON.parse(deleted.body).postHog).toBe('requested');
    expect(JSON.parse(deleted.body).auditSubjectHash).toBe('skipped_not_configured');
    expect(postHogCalls).toHaveLength(1);
    expect(postHogCalls[0].url).toBe(
      'https://us.posthog.com/api/projects/12345/persons/bulk_delete/',
    );
    expect(JSON.parse(String(postHogCalls[0].init?.body))).toEqual({
      distinct_ids: [OWNER_ANALYTICS_ID],
      delete_events: true,
      delete_recordings: true,
    });
    const audit = await db()
      .collection('admin_audit_events')
      .findOne({ action: 'account.self_delete' });
    expect(audit?.targetId).toBeUndefined();
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
      adminAuditEvents: 0,
      adminGrantActions: 0,
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
      adminAuditEvents: 0,
      adminGrantActions: 0,
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
    const deleted = await request(`${baseUrl}/api/users/me`, {
      cookie,
      method: 'DELETE',
      json: { confirm: 'delete my data' },
    });
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

  it('keeps a maintainer audit trail and grant history but replaces their netid in it', async () => {
    const { deleteAccountData, readAccountDataResidue } =
      await import('../services/accountDataService');
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

    const result = await deleteAccountData(OWNER_NETID, { requester: 'account_holder' });

    expect(result.deleted.adminAuditEvents).toBe(2);
    expect(result.deleted.adminGrantActions).toBe(1);
    expect(await readAccountDataResidue(OWNER_NETID)).toMatchObject({
      adminAuditEvents: 0,
      adminGrantActions: 0,
    });
    const otherGrant = await db().collection('admin_grants').findOne({ netid: OTHER_NETID });
    expect(otherGrant?.status).toBe('active');
    expect(otherGrant?.grantedBy).toBe('deleted-account');
    expect(otherGrant?.history.map((entry: any) => entry.actorNetid)).toEqual([
      'deleted-account',
      'synthgrantor',
    ]);
    const storedAudit = JSON.stringify(
      await db().collection('admin_audit_events').find({}).toArray(),
    ).toLowerCase();
    expect(storedAudit).not.toContain(OWNER_NETID);
    expect(await db().collection('admin_audit_events').countDocuments()).toBe(3);
  });

  it('refuses to delete an account the directory still references', async () => {
    const { cookie, owner } = await signInBothAccounts();
    await db().collection('researchers').insertOne({ accountId: owner.accountId });

    const refused = await request(`${baseUrl}/api/users/me`, {
      cookie,
      method: 'DELETE',
      json: { confirm: 'delete my data' },
    });

    expect(refused.status).toBe(409);
    expect(JSON.parse(refused.body).code).toBe('DELETION_BLOCKED');
    expect(await db().collection('analytics_events').countDocuments({ netid: OWNER_NETID })).toBe(
      3,
    );
    await db().collection('researchers').deleteMany({});
  });
});
