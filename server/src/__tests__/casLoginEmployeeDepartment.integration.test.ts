import http from 'node:http';
import { AddressInfo } from 'node:net';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };
const SESSION_SECRET = 'R8h!vK2p#Q7zLm4$T9nWx6%Yc3@F5sJ0';
const SESSION_COOKIE_NAME = 'session';
const YALIES_URL = 'https://api.yalies.io/v2/people';

const employee = (netid: string, unit?: string) => ({
  netid,
  first_name: 'Synthetic',
  last_name: 'Employee',
  email: `${netid}@example.invalid`,
  title: 'Professor of Fixture Studies',
  organization: 'Synthetic Fixture School',
  ...(unit === undefined ? {} : { unit }),
});

const yalies = vi.hoisted(() => ({
  calls: [] as string[],
  records: {} as Record<string, Record<string, unknown> | 'throw'>,
}));

vi.mock('axios', async (importOriginal) => {
  const actual = await importOriginal<typeof import('axios')>();
  const post = vi.fn(async (url: string, body: { filters?: { netid?: string[] } }) => {
    yalies.calls.push(url);
    if (url !== YALIES_URL) throw new Error('unexpected outbound request in test');
    const record = yalies.records[body.filters?.netid?.[0] ?? ''];
    if (record === 'throw') throw new Error('synthetic Yalies outage');
    return { data: record ? [record] : [] };
  });
  const axios = Object.assign(Object.create(actual.default), actual.default, { post });
  return { ...actual, default: axios };
});

vi.mock('../services/analyticsService', () => ({
  logEvent: vi.fn(async () => 'skipped'),
}));

type FakeCas = { baseUrl: string; close: () => Promise<void> };
const casState = vi.hoisted(() => ({ netid: '' }));

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

let memoryServer: MongoMemoryServer;
let fakeCas: FakeCas;
let server: http.Server;
let baseUrl: string;

const casLogin = async (netid: string) => {
  casState.netid = netid;
  yalies.calls.length = 0;
  const started = await get(`${baseUrl}/api/cas`);
  const atCas = await get(started.location);
  const completed = await get(atCas.location, started.cookie);
  const check = await get(`${baseUrl}/api/check`, completed.cookie);
  const account = await mongoose.connection.db!.collection('accounts').findOne({ netid });
  return {
    status: completed.status,
    authenticated: JSON.parse(check.body).auth === true,
    department: account?.profile?.department,
    yaliesRequests: yalies.calls.length,
  };
};

describe('a CAS login reads an employee department from the directory unit (#5741)', () => {
  beforeAll(async () => {
    memoryServer = await MongoMemoryServer.create();
    await mongoose.connect(memoryServer.getUri('cas_login_employee_department_test'));
    fakeCas = await startFakeCas();
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
      SSOBASEURL: fakeCas.baseUrl,
      SESSION_SECRET,
      YALIES_API_KEY: 'synthetic-test-key',
    };
    delete process.env.SERVER_BASE_URL;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { default: app } = await import('../app');
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    process.env = { ...ORIGINAL_ENV };
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fakeCas.close();
    await mongoose.disconnect();
    await memoryServer.stop();
  });

  it('stores the screened department for an employee whose unit names one', async () => {
    yalies.records.fixturedept = employee('fixturedept', 'Genetics-All');
    expect(await casLogin('fixturedept')).toEqual({
      status: 302,
      authenticated: true,
      department: 'Genetics',
      yaliesRequests: 1,
    });
  });

  it.each([
    ['a Yalies error', 'fixturethrow', 'throw' as const],
    ['an empty unit', 'fixtureempty', employee('fixtureempty', '')],
    ['no unit at all', 'fixturebare', employee('fixturebare')],
    ['an administrative unit', 'fixtureadmin', employee('fixtureadmin', 'Business Office')],
  ])('still logs in, with no department, on %s', async (_label, netid, record) => {
    yalies.records[netid] = record;
    expect(await casLogin(netid)).toEqual({
      status: 302,
      authenticated: true,
      department: undefined,
      yaliesRequests: 1,
    });
  });

  it('writes no researcher from a login', async () => {
    expect(await mongoose.connection.db!.collection('researchers').countDocuments({})).toBe(0);
  });
});
