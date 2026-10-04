import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CasMalformedResponseError,
  CasTicketRejectedError,
  CasUnreachableError,
} from '../casCallbackFailure';
import {
  CasStrategy,
  casLoginUrl,
  casServiceUrl,
  casValidateUrl,
  parseCas1ValidationResponse,
  presentedCasTicket,
  type CasVerify,
} from '../casStrategy';

const SERVER_BASE = 'https://labs.example.test';
const CAS_NETID = 'synthetic1';
const INJECTING_TICKET = 'ST-1&service=https://attacker.example.test/&renew=true=x';

type ValidateBehaviour = 'yes' | 'no' | 'malformed' | 'http-error' | 'hang';

type StubCas = {
  baseUrl: string;
  behaviour: ValidateBehaviour;
  validations: URL[];
  released: number;
  close: () => Promise<void>;
};

const startStubCas = async (): Promise<StubCas> => {
  const held = new Set<http.ServerResponse>();
  const stub: StubCas = {
    baseUrl: '',
    behaviour: 'yes',
    validations: [],
    released: 0,
    close: async () => undefined,
  };
  const server = http.createServer((req, res) => {
    const requested = new URL(req.url ?? '/', 'http://cas.invalid');
    if (requested.pathname !== '/cas/validate') {
      res.writeHead(404);
      res.end();
      return;
    }
    stub.validations.push(requested);
    if (stub.behaviour === 'hang') {
      held.add(res);
      req.socket.once('close', () => {
        if (held.delete(res)) stub.released += 1;
      });
      return;
    }
    if (stub.behaviour === 'http-error') {
      res.writeHead(500);
      res.end('yes\nnot-a-verdict\n');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain' });
    const bodies: Record<'yes' | 'no' | 'malformed', string> = {
      yes: `yes\n${CAS_NETID}\n`,
      no: 'no\n\n',
      malformed: '<html>maintenance</html>',
    };
    res.end(bodies[stub.behaviour]);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  stub.baseUrl = `http://127.0.0.1:${port}/cas`;
  stub.close = () =>
    new Promise<void>((resolve, reject) => {
      for (const res of held) res.destroy();
      server.closeAllConnections();
      server.close((error) => (error ? reject(error) : resolve()));
    });
  return stub;
};

const requestFor = (originalUrl: string, host = 'localhost:4000'): express.Request => {
  const query: Record<string, string | string[]> = {};
  for (const [key, value] of new URL(originalUrl, 'http://parse.invalid').searchParams) {
    const existing = query[key];
    query[key] =
      existing === undefined
        ? value
        : [...(Array.isArray(existing) ? existing : [existing]), value];
  }
  return { originalUrl, query, protocol: 'http', host } as unknown as express.Request;
};

type Outcome =
  | { kind: 'redirect'; url: string }
  | { kind: 'success'; user: unknown }
  | { kind: 'fail' }
  | { kind: 'error'; error: unknown };

const authenticate = (strategy: CasStrategy, req: express.Request): Promise<Outcome> =>
  new Promise((resolve) => {
    const bound = Object.create(strategy) as CasStrategy;
    Object.assign(bound, {
      redirect: (url: string) => resolve({ kind: 'redirect', url }),
      success: (user: unknown) => resolve({ kind: 'success', user }),
      fail: () => resolve({ kind: 'fail' }),
      error: (error: unknown) => resolve({ kind: 'error', error }),
    });
    bound.authenticate(req);
  });

const acceptingVerify: CasVerify = (login, done) => done(null, { netId: login.user });

const callbackFor = (service: string, ticket: string): string => {
  const callback = new URL(service);
  callback.searchParams.append('ticket', ticket);
  return `${callback.pathname}${callback.search}`;
};

describe('CAS 1.0 URL construction', () => {
  it('encodes a ticket carrying & and = so it cannot add or override a validate parameter', () => {
    const service = `${SERVER_BASE}/api/cas?redirect=%2Fsaved&state=${'a'.repeat(32)}`;
    const validate = new URL(
      casValidateUrl('https://cas.example.test/cas/', INJECTING_TICKET, service),
    );

    expect(validate.pathname).toBe('/cas/validate');
    expect([...validate.searchParams.keys()]).toEqual(['ticket', 'service']);
    expect(validate.searchParams.get('ticket')).toBe(INJECTING_TICKET);
    expect(validate.searchParams.get('service')).toBe(service);
  });

  it('carries only the service URL to the CAS login page', () => {
    const login = new URL(
      casLoginUrl('https://cas.example.test/cas', `${SERVER_BASE}/api/cas?a=1&b=2`),
    );

    expect(login.pathname).toBe('/cas/login');
    expect([...login.searchParams.keys()]).toEqual(['service']);
    expect(login.searchParams.get('service')).toBe(`${SERVER_BASE}/api/cas?a=1&b=2`);
  });

  it('builds the service URL from the configured base and drops only the ticket', () => {
    const service = casServiceUrl(
      requestFor('/api/cas?redirect=%2Fresearch%2Fx&state=abc&ticket=ST-9'),
      SERVER_BASE,
    );

    expect(service).toBe(`${SERVER_BASE}/api/cas?redirect=%2Fresearch%2Fx&state=abc`);
  });

  it('never lets the request path choose the service host', () => {
    expect(casServiceUrl(requestFor('//attacker.example.test/api/cas'), SERVER_BASE)).toBe(
      `${SERVER_BASE}/api/cas`,
    );
  });

  it('falls back to the request origin only when no server base is configured', () => {
    expect(casServiceUrl(requestFor('/api/cas?ticket=ST-1', 'localhost:4015'))).toBe(
      'http://localhost:4015/api/cas',
    );
  });

  it('spells the service URL the same way on the callback as on the start', () => {
    const start = casServiceUrl(
      requestFor('/api/cas?redirect=%2Fa%20b%2Bc&note=x+y&empty='),
      SERVER_BASE,
    );
    const callback = casServiceUrl(requestFor(callbackFor(start, INJECTING_TICKET)), SERVER_BASE);

    expect(callback).toBe(start);
  });
});

describe('presentedCasTicket', () => {
  it('reads only a single non-empty ticket string', () => {
    expect(presentedCasTicket(requestFor('/api/cas?ticket=ST-1'))).toBe('ST-1');
    expect(presentedCasTicket(requestFor('/api/cas'))).toBeUndefined();
    expect(presentedCasTicket(requestFor('/api/cas?ticket='))).toBeUndefined();
    expect(presentedCasTicket(requestFor('/api/cas?ticket=a&ticket=b'))).toBeUndefined();
  });
});

describe('parseCas1ValidationResponse', () => {
  it('reads yes with a user, no, and anything else as malformed', () => {
    expect(parseCas1ValidationResponse(`yes\n${CAS_NETID}\n`)).toEqual({ user: CAS_NETID });
    expect(parseCas1ValidationResponse(`yes\r\n${CAS_NETID}\r\n`)).toEqual({ user: CAS_NETID });
    expect(() => parseCas1ValidationResponse('no\n')).toThrow(CasTicketRejectedError);
    expect(() => parseCas1ValidationResponse('yes')).toThrow(CasMalformedResponseError);
    expect(() => parseCas1ValidationResponse('YES\nx\n')).toThrow(CasMalformedResponseError);
    expect(() => parseCas1ValidationResponse('')).toThrow(CasMalformedResponseError);
  });
});

describe('CasStrategy against a stub CAS', () => {
  let stub: StubCas;

  beforeAll(async () => {
    stub = await startStubCas();
  });

  afterAll(async () => {
    await stub.close();
  });

  beforeEach(() => {
    stub.behaviour = 'yes';
    stub.validations.length = 0;
  });

  const strategyWith = (verify: CasVerify = acceptingVerify, validationTimeoutMs = 2_000) =>
    new CasStrategy(
      { ssoBaseURL: stub.baseUrl, serverBaseURL: SERVER_BASE, validationTimeoutMs },
      verify,
    );

  it('sends CAS the same service URL at login and at validation, with the ticket intact', async () => {
    const strategy = strategyWith();
    const started = await authenticate(
      strategy,
      requestFor(`/api/cas?redirect=%2Fsaved&state=${'c'.repeat(32)}`),
    );
    expect(started.kind).toBe('redirect');
    const loginService =
      new URL((started as { url: string }).url).searchParams.get('service') ?? '';

    const completed = await authenticate(
      strategy,
      requestFor(callbackFor(loginService, INJECTING_TICKET)),
    );

    expect(completed).toEqual({ kind: 'success', user: { netId: CAS_NETID } });
    expect(stub.validations).toHaveLength(1);
    expect(stub.validations[0].searchParams.get('service')).toBe(loginService);
    expect(stub.validations[0].searchParams.get('ticket')).toBe(INJECTING_TICKET);
    expect(stub.validations[0].searchParams.getAll('service')).toHaveLength(1);
    expect(stub.validations[0].searchParams.has('renew')).toBe(false);
  });

  it('reports a CAS refusal as a typed rejection without calling verify', async () => {
    stub.behaviour = 'no';
    let verified = false;
    const outcome = await authenticate(
      strategyWith((login, done) => {
        verified = true;
        done(null, { netId: login.user });
      }),
      requestFor('/api/cas?ticket=ST-2'),
    );

    expect(outcome.kind).toBe('error');
    expect((outcome as { error: unknown }).error).toBeInstanceOf(CasTicketRejectedError);
    expect(verified).toBe(false);
  });

  it('reports an unrecognised answer as malformed', async () => {
    stub.behaviour = 'malformed';
    const outcome = await authenticate(strategyWith(), requestFor('/api/cas?ticket=ST-3'));

    expect((outcome as { error: unknown }).error).toBeInstanceOf(CasMalformedResponseError);
  });

  it('reports a non-success HTTP status as unreachable rather than reading its body', async () => {
    stub.behaviour = 'http-error';
    const outcome = await authenticate(strategyWith(), requestFor('/api/cas?ticket=ST-4'));

    expect((outcome as { error: unknown }).error).toBeInstanceOf(CasUnreachableError);
  });

  it('gives up on a CAS that never answers and releases the request', async () => {
    stub.behaviour = 'hang';
    const releasedBefore = stub.released;
    const startedAt = Date.now();
    const outcome = await authenticate(
      strategyWith(acceptingVerify, 150),
      requestFor('/api/cas?ticket=ST-5'),
    );
    const error = (outcome as { error: Error }).error;

    expect(error).toBeInstanceOf(CasUnreachableError);
    expect(error.message).toContain('timed out');
    expect(error.message).not.toContain('ST-5');
    expect(Date.now() - startedAt).toBeLessThan(1_500);

    const deadline = Date.now() + 1_500;
    while (stub.released === releasedBefore && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(stub.released).toBeGreaterThan(releasedBefore);
  });

  it('reports an unreachable CAS as unreachable', async () => {
    const strategy = new CasStrategy(
      {
        ssoBaseURL: 'http://127.0.0.1:1/cas',
        serverBaseURL: SERVER_BASE,
        validationTimeoutMs: 2_000,
      },
      acceptingVerify,
    );
    const outcome = await authenticate(strategy, requestFor('/api/cas?ticket=ST-6'));

    expect((outcome as { error: unknown }).error).toBeInstanceOf(CasUnreachableError);
  });

  it('passes a verify error through and fails a login verify declines', async () => {
    const declined = await authenticate(
      strategyWith((_login, done) => done(null, false)),
      requestFor('/api/cas?ticket=ST-7'),
    );
    expect(declined.kind).toBe('fail');

    const failure = new Error('verify failed');
    const errored = await authenticate(
      strategyWith((_login, done) => done(failure)),
      requestFor('/api/cas?ticket=ST-8'),
    );
    expect(errored).toEqual({ kind: 'error', error: failure });
  });
});
