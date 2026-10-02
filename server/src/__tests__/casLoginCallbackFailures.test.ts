import http from 'node:http';
import { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';

const ORIGINAL_ENV = { ...process.env };
const STRONG_SESSION_SECRET = 'R8h!vK2p#Q7zLm4$T9nWx6%Yc3@F5sJ0';
const SESSION_COOKIE_NAME = 'session';
const CAS_NETID = 'zz9synth';
const CAS_TICKET_PREFIX = 'ST-failure-path-ticket';
const TROUBLE_MESSAGE = 'Sign-in is having trouble right now. Please try again in a moment.';

const mocks = vi.hoisted(() => ({
  captureServerError: vi.fn(),
  recordAccountLogin: vi.fn(),
}));

vi.mock('../utils/errorTracking', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/errorTracking')>()),
  captureServerError: mocks.captureServerError,
}));

vi.mock('../utils/casCallbackFailure', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/casCallbackFailure')>()),
  CAS_VALIDATION_TIMEOUT_MS: 250,
}));

vi.mock('../services/accountService', () => ({
  recordAccountLogin: mocks.recordAccountLogin,
  lastKnownAccountUserType: vi.fn(async () => undefined),
  validateAccount: vi.fn(async (netid: string) => ({ netid, archived: false })),
}));

vi.mock('../services/yaliesService', () => ({
  lookupYalieByNetid: vi.fn(async () => ({ kind: 'not_found' })),
}));

vi.mock('../services/adminGrantService', () => ({
  ensureBootstrapAdminGrant: vi.fn(async () => undefined),
  hasActiveAdminGrant: vi.fn(async () => false),
}));

vi.mock('../services/analyticsService', () => ({
  logEvent: vi.fn(async () => 'skipped'),
}));

type ValidationBehaviour = 'accept' | 'reject' | 'hang';

type StubCas = {
  baseUrl: string;
  behaviour: ValidationBehaviour;
  lastHeldTicket: string;
  releasedTickets: Set<string>;
  close: () => Promise<void>;
};

const startStubCas = async (): Promise<StubCas> => {
  const hanging = new Set<http.ServerResponse>();
  let issued = 0;
  const stub: StubCas = {
    baseUrl: '',
    behaviour: 'accept',
    lastHeldTicket: '',
    releasedTickets: new Set<string>(),
    close: async () => undefined,
  };
  const server = http.createServer((req, res) => {
    const requested = new URL(req.url ?? '/', 'http://cas.invalid');
    const service = requested.searchParams.get('service') ?? '';

    if (requested.pathname === '/cas/login') {
      issued += 1;
      const separator = service.includes('?') ? '&' : '?';
      res.writeHead(302, {
        location: `${service}${separator}ticket=${CAS_TICKET_PREFIX}-${issued}`,
      });
      res.end();
      return;
    }

    if (requested.pathname === '/cas/validate') {
      if (stub.behaviour === 'hang') {
        const ticket = requested.searchParams.get('ticket') ?? '';
        hanging.add(res);
        stub.lastHeldTicket = ticket;
        req.socket.once('close', () => {
          if (hanging.delete(res)) stub.releasedTickets.add(ticket);
        });
        return;
      }
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(stub.behaviour === 'accept' ? `yes\n${CAS_NETID}\n` : 'no\n');
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  stub.baseUrl = `http://127.0.0.1:${port}/cas`;
  stub.close = () =>
    new Promise<void>((resolve, reject) => {
      for (const res of hanging) res.destroy();
      server.closeAllConnections();
      server.close((error) => (error ? reject(error) : resolve()));
    });
  return stub;
};

let stubCas: StubCas;

const prepareApp = () => {
  process.env = {
    ...ORIGINAL_ENV,
    NODE_ENV: 'test',
    SSOBASEURL: stubCas.baseUrl,
    SESSION_SECRET: STRONG_SESSION_SECRET,
  };
  delete process.env.SERVER_BASE_URL;
};

async function withRunningApp(run: (baseUrl: string) => Promise<void>) {
  const { default: app } = await import('../app');
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

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

const completeLogin = async (baseUrl: string, query = ''): Promise<Hop> => {
  const started = await get(`${baseUrl}/api/cas${query}`);
  expect(started.status).toBe(302);
  const atCas = await get(started.location);
  expect(atCas.status).toBe(302);
  return get(atCas.location, started.cookie);
};

const reportedText = (): string =>
  JSON.stringify(
    mocks.captureServerError.mock.calls.map(([error]) => {
      const reported = error as Error;
      return { name: reported.name, message: reported.message, stack: reported.stack };
    }),
  );

const expectReportedWithoutIdentity = () => {
  expect(mocks.captureServerError).toHaveBeenCalledTimes(1);
  const text = reportedText();
  expect(text).toContain('CAS login callback failed');
  expect(text).not.toContain(CAS_NETID);
  expect(text).not.toContain(CAS_TICKET_PREFIX);
};

describe('CAS login callback failures', () => {
  beforeAll(async () => {
    stubCas = await startStubCas();
  });

  afterAll(async () => {
    await stubCas.close();
  });

  beforeEach(() => {
    mocks.captureServerError.mockReset();
    mocks.recordAccountLogin.mockReset();
    mocks.recordAccountLogin.mockImplementation(async (data: { netid: string }) => ({
      netid: data.netid,
      archived: false,
    }));
    stubCas.behaviour = 'accept';
  });

  afterEach(() => {
    vi.resetModules();
    mongoose.deleteModel(/.+/);
    process.env = { ...ORIGINAL_ENV };
  });

  it('completes a login whose ticket CAS accepts and reports nothing', async () => {
    prepareApp();

    await withRunningApp(async (baseUrl) => {
      const completed = await completeLogin(baseUrl, '?redirect=%2Fsaved');

      expect(completed.status).toBe(302);
      expect(completed.location).toBe('/saved');
      expect(mocks.captureServerError).not.toHaveBeenCalled();
    });
  });

  it('answers 401 for a ticket CAS rejects and reports nothing', async () => {
    prepareApp();
    stubCas.behaviour = 'reject';

    await withRunningApp(async (baseUrl) => {
      const rejected = await completeLogin(baseUrl);

      expect(rejected.status).toBe(401);
      expect(JSON.parse(rejected.body)).toEqual({ error: 'Error in authentication' });
      expect(mocks.captureServerError).not.toHaveBeenCalled();
    });
  });

  it('answers 503 with a retry message when CAS does not answer in time, and reports it', async () => {
    prepareApp();
    stubCas.behaviour = 'hang';

    await withRunningApp(async (baseUrl) => {
      const timedOut = await completeLogin(baseUrl);

      expect(timedOut.status).toBe(503);
      expect(JSON.parse(timedOut.body)).toEqual({ error: TROUBLE_MESSAGE });
      expectReportedWithoutIdentity();
      expect(reportedText()).toContain('CasValidationTimeoutError');
    });
  });

  it('releases the validation request to a CAS that never answers instead of holding it open', async () => {
    prepareApp();
    stubCas.behaviour = 'hang';

    await withRunningApp(async (baseUrl) => {
      const timedOut = await completeLogin(baseUrl);
      expect(timedOut.status).toBe(503);
      const heldTicket = stubCas.lastHeldTicket;

      const deadline = Date.now() + 2_000;
      while (!stubCas.releasedTickets.has(heldTicket) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }

      expect(heldTicket).not.toBe('');
      expect(stubCas.releasedTickets.has(heldTicket)).toBe(true);
      expect(mocks.recordAccountLogin).not.toHaveBeenCalled();
    });
  });

  it('answers 500 with a retry message when our own code throws, and reports it without the netid', async () => {
    prepareApp();
    mocks.recordAccountLogin.mockImplementation(async (data: { netid: string }) => {
      throw new Error(`write failed for account ${data.netid}`);
    });

    await withRunningApp(async (baseUrl) => {
      const failed = await completeLogin(baseUrl, '?error=%2Flogin-error');

      expect(failed.status).toBe(500);
      expect(JSON.parse(failed.body)).toEqual({ error: TROUBLE_MESSAGE });
      expect(failed.location).toBe('');
      expectReportedWithoutIdentity();
    });
  });

  it('answers 503 when the database cannot be reached during the login write', async () => {
    prepareApp();
    mocks.recordAccountLogin.mockImplementation(async () => {
      const unreachable = new Error('Server selection timed out after 1 ms');
      unreachable.name = 'MongooseServerSelectionError';
      throw unreachable;
    });

    await withRunningApp(async (baseUrl) => {
      const unavailable = await completeLogin(baseUrl);

      expect(unavailable.status).toBe(503);
      expect(JSON.parse(unavailable.body)).toEqual({ error: TROUBLE_MESSAGE });
      expectReportedWithoutIdentity();
      expect(reportedText()).toContain('MongooseServerSelectionError');
    });
  });
});
