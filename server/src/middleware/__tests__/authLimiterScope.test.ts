import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

vi.mock('../../services/accountService', () => ({
  recordAccountLogin: vi.fn(),
  validateAccount: vi.fn(),
}));
vi.mock('../../services/adminGrantService', () => ({
  ensureBootstrapAdminGrant: vi.fn(async () => undefined),
  hasActiveAdminGrant: vi.fn(async () => false),
}));
vi.mock('../../services/analyticsService', () => ({
  logEvent: vi.fn(async () => 'recorded'),
}));

// express-rate-limit refunds on the response `finish` event, which can land after
// the client already holds the body, so a probe that reads the next request's
// counter yields to the event loop first.
const afterRefund = () => new Promise((resolve) => setTimeout(resolve, 5));

// The real exported limiters rather than rebuilds of them: the claim is about what
// the counter does, not about how an options block reads. Their own `skip` returns
// `bypassRuntimeSecurity`, which is true under test, so the module is re-imported
// with a deployed NODE_ENV to make them live.
const loadLiveLimiters = async () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.resetModules();
  return import('../rateLimiters');
};

const listen = async (app: express.Express) => {
  const server = await new Promise<Server>((resolve) => {
    const started = app.listen(0, '127.0.0.1', () => resolve(started));
  });
  return { server, baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
};

const close = async (server: Server) => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
};

describe('the login limiter meters ticket validation failures only', () => {
  let server: Server;
  let baseUrl = '';
  let max = 0;

  beforeAll(async () => {
    const limiters = await loadLiveLimiters();
    max = limiters.AUTH_VALIDATION_FAILURE_MAX;

    // Stands in for `casLogin`: a ticketless request redirects to CAS, a ticket
    // that validates is recorded as accepted and redirects onward, a ticket CAS
    // rejects answers 401 or, when the caller named an error page, a redirect, and
    // a lost database topology answers 503.
    const app = express()
      .set('trust proxy', () => true)
      .get('/api/cas', limiters.authLimiter, (req, res) => {
        const ticket = req.query.ticket;
        if (!ticket) return res.redirect('/sso/login');
        if (ticket === 'accepted') {
          limiters.markCasValidationAccepted(req);
          return res.redirect('/');
        }
        if (ticket === 'rejected-to-error-page') return res.redirect('/login-error');
        if (ticket === 'backend-down') return res.status(503).json({ error: 'unavailable' });
        return res.status(401).json({ error: 'Error in authentication' });
      });

    ({ server, baseUrl } = await listen(app));
  });

  afterAll(async () => {
    await close(server);
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  const probe = async (address: string, query = '') => {
    const response = await fetch(`${baseUrl}/api/cas${query}`, {
      headers: { 'X-Forwarded-For': address },
      redirect: 'manual',
    });
    await response.text();
    await afterRefund();
    return {
      status: response.status,
      remaining: response.headers.get('ratelimit-remaining'),
    };
  };

  it('lets a whole window of login starts through from one shared address', async () => {
    const statuses = new Set<number>();
    const metered: string[] = [];

    for (let attempt = 0; attempt < max + 5; attempt += 1) {
      const start = await probe('203.0.113.11');
      statuses.add(start.status);
      if (start.remaining !== null) metered.push(start.remaining);
    }

    expect([...statuses]).toEqual([302]);
    // A skipped request is never counted, so it carries no counter header at all.
    expect(metered).toEqual([]);

    const rejected = await probe('203.0.113.11', '?ticket=stale');
    expect(rejected.status).toBe(401);
    expect(rejected.remaining).toBe(String(max - 1));
  });

  it('still bounds repeated rejected validations from one address', async () => {
    for (let attempt = 0; attempt < max; attempt += 1) {
      const rejected = await probe('203.0.113.12', '?ticket=stale');
      expect(rejected.status).toBe(401);
      expect(rejected.remaining).toBe(String(max - attempt - 1));
    }

    const exhausted = await fetch(`${baseUrl}/api/cas?ticket=stale`, {
      headers: { 'X-Forwarded-For': '203.0.113.12' },
      redirect: 'manual',
    });
    const body = (await exhausted.json()) as { code?: string };
    expect(exhausted.status).toBe(429);
    expect(body.code).toBe('RATE_LIMITED');
  });

  it('does not spend the failure budget on a validation that succeeds', async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const accepted = await probe('203.0.113.13', '?ticket=accepted');
      expect(accepted.status).toBe(302);
      expect(accepted.remaining).toBe(String(max - 1));
    }

    const rejected = await probe('203.0.113.13', '?ticket=stale');
    expect(rejected.status).toBe(401);
    // max - 1 rather than max - 11: ten completed logins left the budget whole.
    expect(rejected.remaining).toBe(String(max - 1));
  });

  it('charges a rejected validation that answers with a redirect to an error page', async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const rejected = await probe('203.0.113.16', '?ticket=rejected-to-error-page');
      expect(rejected.status).toBe(302);
      expect(rejected.remaining).toBe(String(max - attempt - 1));
    }
  });

  it('keeps the outage exemption, so our own failure costs the caller nothing', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const unavailable = await probe('203.0.113.14', '?ticket=backend-down');
      expect(unavailable.status).toBe(503);
      expect(unavailable.remaining).toBe(String(max - 1));
    }

    const rejected = await probe('203.0.113.14', '?ticket=stale');
    expect(rejected.remaining).toBe(String(max - 1));
  });

  it('gives an empty ticket parameter the login-start treatment the strategy gives it', async () => {
    const start = await probe('203.0.113.15', '?ticket=');
    expect(start.status).toBe(302);
    expect(start.remaining).toBeNull();
  });
});

describe('the mounted CAS route tells the limiter which validations it accepted', () => {
  let server: Server;
  let baseUrl = '';
  let max = 0;

  beforeAll(async () => {
    vi.stubEnv('SSOBASEURL', 'https://sso.example.test/cas');
    vi.stubEnv('SERVER_BASE_URL', 'https://labs.example.test');
    const limiters = await loadLiveLimiters();
    max = limiters.AUTH_VALIDATION_FAILURE_MAX;
    const { default: passport } = await import('passport');
    const { passportRoutes } = await import('../../passport');

    const stubbedVerdict =
      (_strategy: unknown, callback: (err: Error | null, user: unknown) => void) =>
      (req: express.Request) =>
        req.query.ticket === 'accepted'
          ? callback(null, { netId: 'synthetic1', userType: 'undergraduate' })
          : callback(new Error('CAS rejected the ticket'), false);
    vi.spyOn(passport, 'authenticate').mockImplementation(stubbedVerdict as never);

    const app = express()
      .set('trust proxy', () => true)
      .use((req, _res, next) => {
        req.isAuthenticated = (() => false) as never;
        req.logIn = ((_user: unknown, done: (err?: unknown) => void) => done()) as never;
        next();
      })
      .use('/api', passportRoutes);

    ({ server, baseUrl } = await listen(app));
  });

  afterAll(async () => {
    await close(server);
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  const probe = async (address: string, query: string) => {
    const response = await fetch(`${baseUrl}/api/cas${query}`, {
      headers: { 'X-Forwarded-For': address },
      redirect: 'manual',
    });
    await response.text();
    await afterRefund();
    return {
      status: response.status,
      location: response.headers.get('location'),
      remaining: response.headers.get('ratelimit-remaining'),
    };
  };

  it('refunds a validation the route accepted', async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const accepted = await probe('203.0.113.31', '?ticket=accepted&redirect=/account');
      expect(accepted.status).toBe(302);
      expect(accepted.location).toBe('/account');
      expect(accepted.remaining).toBe(String(max - 1));
    }
  });

  it('charges a rejected validation even when the caller asked for an error-page redirect', async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const rejected = await probe('203.0.113.32', '?ticket=stale&error=/login-error');
      expect(rejected.status).toBe(302);
      expect(rejected.location).toBe('/login-error');
      expect(rejected.remaining).toBe(String(max - attempt - 1));
    }
  });
});

describe('the request-scoped limiters keep counting every non-5xx response', () => {
  let server: Server;
  let baseUrl = '';

  beforeAll(async () => {
    const limiters = await loadLiveLimiters();

    const app = express()
      .set('trust proxy', () => true)
      .get('/api/read', limiters.globalLimiter, (req, res) =>
        res.status(Number(req.query.status) || 200).json({ ok: true }),
      )
      .post('/api/write', limiters.writeLimit, (req, res) =>
        res.status(Number(req.query.status) || 200).json({ ok: true }),
      );

    ({ server, baseUrl } = await listen(app));
  });

  afterAll(async () => {
    await close(server);
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  const probe = async (path: string, method: 'GET' | 'POST', query = '') => {
    const response = await fetch(`${baseUrl}${path}${query}`, {
      method,
      headers: { 'X-Forwarded-For': '203.0.113.21' },
    });
    await response.text();
    await afterRefund();
    return Number(response.headers.get('ratelimit-remaining'));
  };

  it('charges a successful read and refunds only a 5xx', async () => {
    const first = await probe('/api/read', 'GET');
    const second = await probe('/api/read', 'GET');
    expect(second).toBe(first - 1);

    await probe('/api/read', 'GET', '?status=503');
    const afterOutage = await probe('/api/read', 'GET');
    expect(afterOutage).toBe(second - 1);
  });

  it('charges a successful write and refunds only a 5xx', async () => {
    const first = await probe('/api/write', 'POST');
    const second = await probe('/api/write', 'POST');
    expect(second).toBe(first - 1);

    await probe('/api/write', 'POST', '?status=503');
    const afterOutage = await probe('/api/write', 'POST');
    expect(afterOutage).toBe(second - 1);
  });
});
