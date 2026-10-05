import http from 'node:http';
import { AddressInfo } from 'node:net';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { loginSignalBuckets } from '../models/storedVocabularies';

const ORIGINAL_ENV = { ...process.env };
const SESSION_SECRET = 'R8h!vK2p#Q7zLm4$T9nWx6%Yc3@F5sJ0';
const SESSION_COOKIE_NAME = 'session';
const YALIES_URL = 'https://api.yalies.io/v2/people';

const SYNTHETIC_MAJOR = 'Synthetic Fixture Studies';
const SYNTHETIC_COLLEGE = 'Synthetic Fixture College';
const SYNTHETIC_CURRICULUM = 'Synthetic Fixture Curriculum';
const SYNTHETIC_YEAR = 'synthetic-fixture-year';
const RETIRED_KEYS = new Set(['major', 'college', 'year', 'curriculum', 'leave', 'visitor']);
const SENSITIVE_VALUES = [SYNTHETIC_MAJOR, SYNTHETIC_COLLEGE, SYNTHETIC_CURRICULUM, SYNTHETIC_YEAR];

const syntheticRecords: Record<string, Record<string, unknown>> = {
  fixtureugrad: {
    netid: 'fixtureugrad',
    first_name: 'Synthetic',
    last_name: 'Undergraduate',
    email: 'fixtureugrad@example.invalid',
    school_code: 'YC',
    year: SYNTHETIC_YEAR,
    college: SYNTHETIC_COLLEGE,
    major: [SYNTHETIC_MAJOR],
  },
  fixturegrad: {
    netid: 'fixturegrad',
    first_name: 'Synthetic',
    last_name: 'Graduate',
    email: 'fixturegrad@example.invalid',
    school_code: 'GS',
    year: SYNTHETIC_YEAR,
    curriculum: SYNTHETIC_CURRICULUM,
  },
};

const casState = vi.hoisted(() => ({ netid: '' }));

vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  const post = vi.fn(async (url: string, body: { filters?: { netid?: string[] } }) => {
    if (url !== YALIES_URL) throw new Error('unexpected outbound request in test');
    const netid = body.filters?.netid?.[0] ?? '';
    return { data: syntheticRecords[netid] ? [syntheticRecords[netid]] : [] };
  });
  const axios = Object.assign(Object.create(actual.default), actual.default, { post });
  return { ...actual, default: axios };
});

vi.mock('../services/analyticsService', () => ({
  logEvent: vi.fn(async () => 'skipped'),
}));

type FakeCas = { baseUrl: string; close: () => Promise<void> };

const startFakeCas = async (): Promise<FakeCas> => {
  const ticketService = new Map<string, string>();
  let issued = 0;
  const server = http.createServer((req, res) => {
    const requested = new URL(req.url ?? '/', 'http://cas.invalid');
    const service = requested.searchParams.get('service') ?? '';
    if (requested.pathname === '/cas/login') {
      issued += 1;
      const ticket = `ST-synthetic-${issued}`;
      ticketService.set(ticket, service);
      const separator = service.includes('?') ? '&' : '?';
      res.writeHead(302, { location: `${service}${separator}ticket=${ticket}` });
      res.end();
      return;
    }
    if (requested.pathname === '/cas/validate') {
      const ticket = requested.searchParams.get('ticket') ?? '';
      const accepted = ticketService.get(ticket) === service;
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(accepted ? `yes\n${casState.netid}\n` : 'no\n');
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}/cas`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
};

type Hop = { status: number; location: string; cookie: string; body: string };

const get = async (url: string, cookie = ''): Promise<Hop> => {
  const response = await fetch(url, { headers: cookie ? { cookie } : {}, redirect: 'manual' });
  return {
    status: response.status,
    location: response.headers.get('location') ?? '',
    cookie: response.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .filter((pair) => pair.startsWith(SESSION_COOKIE_NAME))
      .join('; '),
    body: await response.text(),
  };
};

const sessionPayloadOf = (cookieHeader: string): Record<string, unknown> => {
  const value = new RegExp(`(?:^|; )${SESSION_COOKIE_NAME}=([^;]+)`).exec(cookieHeader)?.[1] ?? '';
  return value ? JSON.parse(Buffer.from(value, 'base64').toString('utf8')) : {};
};

const keysDeep = (value: unknown, found: string[] = []): string[] => {
  if (Array.isArray(value)) value.forEach((item) => keysDeep(item, found));
  else if (value && typeof value === 'object' && !(value instanceof mongoose.Types.ObjectId)) {
    for (const [key, nested] of Object.entries(value)) {
      found.push(key);
      keysDeep(nested, found);
    }
  }
  return found;
};

const casLogin = async (baseUrl: string, netid: string): Promise<Hop> => {
  casState.netid = netid;
  const started = await get(`${baseUrl}/api/cas`);
  const atCas = await get(started.location);
  const completed = await get(atCas.location, started.cookie);
  expect(completed.status).toBe(302);
  return completed;
};

let memoryServer: MongoMemoryServer;
let fakeCas: FakeCas;

describe('a CAS login measures signal coverage without storing any student value', () => {
  beforeAll(async () => {
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri('cas_login_stores_no_student_signal_test'));
    fakeCas = await startFakeCas();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    process.env = { ...ORIGINAL_ENV };
    await fakeCas.close();
    await mongoose.disconnect();
    await memoryServer.stop();
  });

  it('keeps the major, college, year and curriculum out of the session, the database and the logs', async () => {
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
      SSOBASEURL: fakeCas.baseUrl,
      SESSION_SECRET,
      YALIES_API_KEY: 'synthetic-test-key',
    };
    delete process.env.SERVER_BASE_URL;

    const logged: string[] = [];
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logged.push(
          args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '),
        );
      });
    }

    const { default: app } = await import('../app');
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    try {
      const sessions: Record<string, unknown>[] = [];
      for (const netid of ['fixtureugrad', 'fixturegrad', 'fixtureugrad']) {
        const completed = await casLogin(baseUrl, netid);
        const check = await get(`${baseUrl}/api/check`, completed.cookie);
        expect(JSON.parse(check.body).auth).toBe(true);
        sessions.push(sessionPayloadOf(completed.cookie));
      }

      for (const session of sessions) {
        const serialized = JSON.stringify(session);
        for (const value of SENSITIVE_VALUES) expect(serialized).not.toContain(value);
        for (const key of keysDeep(session)) expect(RETIRED_KEYS.has(key)).toBe(false);
      }

      const db = mongoose.connection.db!;
      const sumBuckets = (rows: Record<string, unknown>[]) =>
        Object.fromEntries(
          loginSignalBuckets.map((bucket) => [
            bucket,
            rows.reduce((total, row) => total + Number(row[bucket] ?? 0), 0),
          ]),
        );
      await vi.waitFor(async () => {
        const rows = await db.collection('login_signal_tallies').find({}).toArray();
        expect(sumBuckets(rows)).toMatchObject({
          undergrad_usable_major: 2,
          grad_with_curriculum: 1,
        });
      });
      const collections = await db.listCollections().toArray();
      for (const { name } of collections) {
        const documents = await db.collection(name).find({}).toArray();
        const serialized = JSON.stringify(documents);
        for (const value of SENSITIVE_VALUES) expect(serialized).not.toContain(value);
        for (const key of keysDeep(documents)) expect(RETIRED_KEYS.has(key)).toBe(false);
      }

      const tallies = await db.collection('login_signal_tallies').find({}).toArray();
      const allowedTallyKeys = new Set(['_id', 'date', ...loginSignalBuckets]);
      for (const tally of tallies) {
        for (const key of Object.keys(tally)) expect(allowedTallyKeys.has(key)).toBe(true);
      }
      const totalLogins = Object.values(sumBuckets(tallies)).reduce((sum, count) => sum + count, 0);
      expect(totalLogins).toBe(3);
      expect(JSON.stringify(tallies)).not.toMatch(/fixture|example\.invalid/);

      const output = logged.join('\n');
      for (const value of [...SENSITIVE_VALUES, 'fixtureugrad', 'fixturegrad', 'example.invalid']) {
        expect(output).not.toContain(value);
      }
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
