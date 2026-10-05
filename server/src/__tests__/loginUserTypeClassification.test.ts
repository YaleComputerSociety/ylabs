import http from 'node:http';
import { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';

const ORIGINAL_ENV = { ...process.env };
const STRONG_SESSION_SECRET = 'R8h!vK2p#Q7zLm4$T9nWx6%Yc3@F5sJ0';
const SESSION_COOKIE_NAME = 'session';
const CAS_NETID = 'fixturelogin';
const CAS_TICKET = 'ST-hermetic-ticket';

const accountServiceMock = vi.hoisted(() => ({
  recordAccountLogin: vi.fn(async (data: { netid: string }) => ({
    _id: `acc-${data.netid}`,
    netid: data.netid,
    email: `${data.netid}@yale.edu`,
    status: 'ACTIVE',
    archived: false,
  })),
  validateAccount: vi.fn(async (netid: string) => ({ netid, archived: false })),
  lastKnownAccountUserType: vi.fn(async (): Promise<string | undefined> => undefined),
}));
vi.mock('../services/accountService', () => accountServiceMock);

const yaliesMock = vi.hoisted(() => ({ lookupYalieByNetid: vi.fn() }));
vi.mock('../services/yaliesService', () => yaliesMock);

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

const cookieHeaderFrom = (response: Response): string =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .filter((pair) => pair.startsWith(SESSION_COOKIE_NAME))
    .join('; ');

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

const signInAndCheck = async (baseUrl: string) => {
  const started = await get(`${baseUrl}/api/cas`);
  const atCas = await get(started.location);
  const completed = await get(atCas.location, started.cookie);
  expect(completed.status).toBe(302);
  const check = await get(`${baseUrl}/api/check`, completed.cookie);
  return JSON.parse(check.body) as { auth: boolean; user: { userType: string } };
};

const employee = (title: string) => ({
  kind: 'employee',
  employee: {
    netid: CAS_NETID,
    fname: 'Fixture',
    lname: 'Employee',
    email: 'fixture.employee@example.invalid',
    title,
    department: 'Fixture Department',
  },
});

const student = () => ({
  kind: 'student',
  identity: {
    netid: CAS_NETID,
    fname: 'Fixture',
    lname: 'Student',
    email: 'fixture.student@example.invalid',
    userType: 'undergraduate',
    userConfirmed: true,
  },
});

describe('login types a person from what Yalies knows about them', () => {
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
    accountServiceMock.lastKnownAccountUserType.mockReset();
    accountServiceMock.recordAccountLogin.mockClear();
  });

  it('types an employee with a faculty title as professor', async () => {
    prepareApp();
    yaliesMock.lookupYalieByNetid.mockResolvedValue(employee('Associate Professor of Fixtures'));

    await withRunningApp(async (baseUrl) => {
      expect((await signInAndCheck(baseUrl)).user.userType).toBe('professor');
    });
  });

  it('types an employee without a faculty title as staff', async () => {
    prepareApp();
    yaliesMock.lookupYalieByNetid.mockResolvedValue(employee('Program Coordinator'));

    await withRunningApp(async (baseUrl) => {
      expect((await signInAndCheck(baseUrl)).user.userType).toBe('staff');
    });
  });

  it('keeps the stored type when Yalies cannot answer, and leaves the stored profile alone', async () => {
    prepareApp();
    yaliesMock.lookupYalieByNetid.mockResolvedValue({ kind: 'unavailable' });
    accountServiceMock.lastKnownAccountUserType.mockResolvedValue('undergraduate');

    await withRunningApp(async (baseUrl) => {
      expect((await signInAndCheck(baseUrl)).user.userType).toBe('undergraduate');
    });
    expect(accountServiceMock.recordAccountLogin).toHaveBeenCalledWith(
      expect.objectContaining({ profile: undefined }),
    );
  });

  it('persists no residential college, class year or major for a student who signs in', async () => {
    prepareApp();
    yaliesMock.lookupYalieByNetid.mockResolvedValue(student());

    await withRunningApp(async (baseUrl) => {
      expect((await signInAndCheck(baseUrl)).user.userType).toBe('undergraduate');
    });

    const [loginInput] = accountServiceMock.recordAccountLogin.mock.calls[0];
    const persistedProfile =
      (loginInput as { profile?: Record<string, unknown> }).profile ??
      ({} as Record<string, unknown>);
    expect(Object.keys(persistedProfile).sort()).toEqual(['firstName', 'lastName', 'userType']);
  });

  it('types a person Yalies has never heard of as unknown', async () => {
    prepareApp();
    yaliesMock.lookupYalieByNetid.mockResolvedValue({ kind: 'not_found' });
    accountServiceMock.lastKnownAccountUserType.mockResolvedValue('undergraduate');

    await withRunningApp(async (baseUrl) => {
      expect((await signInAndCheck(baseUrl)).user.userType).toBe('unknown');
    });
  });
});
