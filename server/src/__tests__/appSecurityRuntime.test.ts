import http from 'node:http';
import { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';

const ORIGINAL_ENV = { ...process.env };
const STRONG_SESSION_SECRET = 'R8h!vK2p#Q7zLm4$T9nWx6%Yc3@F5sJ0';

const resetEnv = () => {
  process.env = { ...ORIGINAL_ENV };
};

describe('app security runtime classification', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('express-rate-limit');
    vi.doUnmock('cookie-session');
    mongoose.deleteModel(/.+/);
    resetEnv();
  });

  it('does not allow remote development-labelled runtimes to bypass session secret hardening', async () => {
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'development',
      SERVER_BASE_URL: 'https://yalelabs.io',
      SSOBASEURL: 'https://secure.its.yale.edu/cas',
    };
    process.env.SESSION_SECRET = '';

    await expect(import('../app')).rejects.toThrow(/SESSION_SECRET/);
  });

  it('does not allow low-entropy session secrets in deployed runtimes', async () => {
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'production',
      SERVER_BASE_URL: 'https://yalelabs.io',
      SSOBASEURL: 'https://secure.its.yale.edu/cas',
      SESSION_SECRET: 'x'.repeat(40),
    };

    await expect(import('../app')).rejects.toThrow(/high-entropy/);
  });

  it('keeps local development imports usable without a production session secret', async () => {
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'development',
      SERVER_BASE_URL: 'http://localhost:4000',
      SSOBASEURL: 'https://secure.its.yale.edu/cas',
    };
    process.env.SESSION_SECRET = '';

    await expect(import('../app')).resolves.toBeTruthy();
  });

  it('uses a host-prefixed secure session cookie in deployed runtimes', async () => {
    const cookieSession = vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next());
    vi.doMock('cookie-session', () => ({ default: cookieSession }));
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'production',
      SERVER_BASE_URL: 'https://yalelabs.io',
      SSOBASEURL: 'https://secure.its.yale.edu/cas',
      SESSION_SECRET: STRONG_SESSION_SECRET,
      TRUSTED_PROXY_CIDRS: '10.0.0.0/8',
    };

    await import('../app');

    expect(cookieSession).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '__Host-session',
        httpOnly: true,
        secure: true,
        path: '/',
        sameSite: 'lax',
      }),
    );
  });

  it('uses validated session identifiers for rate-limit buckets', async () => {
    const limiters: Array<{
      keyGenerator: (req: {
        user?: unknown;
        ip?: string;
        headers?: Record<string, string>;
        socket: { remoteAddress?: string };
        session?: { rateLimitId?: unknown } | null;
      }) => string;
    }> = [];
    const ipKeyGenerator = vi.fn((ip: string) => `ip-key:${ip}`);
    vi.doMock('express-rate-limit', () => ({
      default: vi.fn(
        (options: { keyGenerator: (req: { user?: unknown; ip?: string }) => string }) => {
          limiters.push(options);
          return (_req: unknown, _res: unknown, next: () => void) => next();
        },
      ),
      ipKeyGenerator,
    }));
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'production',
      SERVER_BASE_URL: 'https://yalelabs.io',
      SSOBASEURL: 'https://secure.its.yale.edu/cas',
      SESSION_SECRET: STRONG_SESSION_SECRET,
      TRUSTED_PROXY_CIDRS: '10.0.0.0/8,2001:db8:abcd::/48',
    };

    await import('../app');

    const keyGenerator = limiters[0].keyGenerator;
    let coerced = false;
    const objectNetId = {
      toString: () => {
        coerced = true;
        return 'admin1';
      },
    };

    expect(
      keyGenerator({
        user: { netId: 'AbC123' },
        session: { rateLimitId: '0123456789abcdef0123456789abcdef' },
        socket: { remoteAddress: '127.0.0.1' },
      }),
    ).toBe('user:abc123');
    expect(
      keyGenerator({
        user: { netId: objectNetId },
        socket: { remoteAddress: '203.0.113.7' },
      }),
    ).toBe('ip:ip-key:203.0.113.7');
    expect(coerced).toBe(false);

    const anonymousRequest = {
      ip: '198.51.100.20',
      socket: { remoteAddress: '192.0.2.20' },
      session: { rateLimitId: '0123456789abcdef0123456789abcdef' },
    };
    expect(keyGenerator(anonymousRequest)).toBe('anonymous:0123456789abcdef0123456789abcdef');

    const malformedSessionRequest = {
      ip: '198.51.100.8',
      headers: {
        'x-forwarded-for': '203.0.113.8',
        'cf-connecting-ip': '203.0.113.9',
      },
      socket: { remoteAddress: '192.0.2.8' },
      session: { rateLimitId: 'attacker-controlled' },
    };
    expect(keyGenerator(malformedSessionRequest)).toBe('ip:ip-key:192.0.2.8');

    expect(
      keyGenerator({
        ip: '198.51.100.9',
        headers: {
          'x-forwarded-for': '203.0.113.10',
          'cf-connecting-ip': '203.0.113.11',
        },
        socket: { remoteAddress: '192.0.2.9' },
        session: { rateLimitId: 'ABCDEF0123456789ABCDEF0123456789' },
      }),
    ).toBe('ip:ip-key:192.0.2.9');
  });

  it.each(['10.0.0.0/99', '10.0.0.0/8/garbage', '10.0.0.0/', '10.0.0.0/1e1'])(
    'rejects malformed trusted proxy boundary %s',
    async (trustedProxyCidrs) => {
      process.env = {
        ...ORIGINAL_ENV,
        NODE_ENV: 'production',
        SERVER_BASE_URL: 'https://yalelabs.io',
        SSOBASEURL: 'https://secure.its.yale.edu/cas',
        SESSION_SECRET: STRONG_SESSION_SECRET,
        TRUSTED_PROXY_CIDRS: trustedProxyCidrs,
      };

      await expect(import('../app')).rejects.toThrow(/TRUSTED_PROXY_CIDRS/);
    },
  );

  it('requires a trusted proxy boundary in deployed runtimes', async () => {
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'production',
      SERVER_BASE_URL: 'https://yalelabs.io',
      SSOBASEURL: 'https://secure.its.yale.edu/cas',
      SESSION_SECRET: STRONG_SESSION_SECRET,
      TRUSTED_PROXY_CIDRS: '  , ',
    };

    await expect(import('../app')).rejects.toThrow(
      /TRUSTED_PROXY_CIDRS must define at least one trusted proxy/,
    );
  });

  it('keeps Express query parsing flat before request-shape sanitization', async () => {
    vi.doUnmock('cookie-session');
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'production',
      SERVER_BASE_URL: 'https://yalelabs.io',
      SSOBASEURL: 'https://secure.its.yale.edu/cas',
      SESSION_SECRET: STRONG_SESSION_SECRET,
      TRUSTED_PROXY_CIDRS: '10.0.0.0/8',
    };

    const { default: app } = await import('../app');

    expect(app.get('query parser')).toBe('simple');
  });

  it('initializes anonymous rate-limit sessions only for API requests', async () => {
    vi.doUnmock('cookie-session');
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'production',
      SERVER_BASE_URL: 'https://yalelabs.io',
      SSOBASEURL: 'https://secure.its.yale.edu/cas',
      SESSION_SECRET: STRONG_SESSION_SECRET,
      TRUSTED_PROXY_CIDRS: '127.0.0.1/32',
    };

    const { default: app } = await import('../app');
    const server = http.createServer(app);

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });

    try {
      const address = server.address() as AddressInfo;
      const requestHeaders = { 'x-forwarded-proto': 'https' };
      const staticResponse = await fetch(`http://127.0.0.1:${address.port}/missing.js`, {
        headers: requestHeaders,
      });
      const apiResponse = await fetch(`http://127.0.0.1:${address.port}/api/missing`, {
        headers: requestHeaders,
      });
      const readSession = (response: Response) => {
        const sessionCookie = response.headers
          .getSetCookie()
          .find((cookie) => cookie.startsWith('__Host-session='));
        const encodedSession = sessionCookie?.split(';', 1)[0].split('=', 2)[1];
        return encodedSession
          ? (JSON.parse(Buffer.from(encodedSession, 'base64').toString('utf8')) as Record<
              string,
              unknown
            >)
          : {};
      };

      expect(readSession(staticResponse)).not.toHaveProperty('rateLimitId');
      expect(readSession(apiResponse).rateLimitId).toMatch(/^[a-f0-9]{32}$/);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('serves public config with mounted browser hardening headers and no source revision fingerprint', async () => {
    vi.doUnmock('cookie-session');
    vi.doMock('../services/configService', () => ({
      getConfig: vi.fn(async () => ({
        researchAreas: { areas: [], fields: [], fieldOrder: [] },
        departments: { list: [], categories: [] },
        deployment: {
          provider: 'render',
        },
        timestamp: '2026-06-06T00:00:00.000Z',
      })),
      invalidateConfigCache: vi.fn(),
    }));

    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'production',
      SERVER_BASE_URL: 'https://yalelabs.io',
      SSOBASEURL: 'https://secure.its.yale.edu/cas',
      SESSION_SECRET: STRONG_SESSION_SECRET,
      TRUSTED_PROXY_CIDRS: '10.0.0.0/8',
    };

    const { default: app } = await import('../app');
    const server = http.createServer(app);

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });

    try {
      const address = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/api/config`, {
        headers: { 'x-forwarded-proto': 'https' },
      });
      const body = (await response.json()) as {
        deployment?: {
          provider?: string;
          gitCommit?: string;
          gitBranch?: string;
        };
      };

      expect(response.status).toBe(200);
      expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
      expect(response.headers.get('content-security-policy')).toContain("object-src 'none'");
      expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
      expect(response.headers.get('content-security-policy')).toContain(
        'upgrade-insecure-requests',
      );
      expect(response.headers.get('permissions-policy')).toContain('camera=()');
      expect(response.headers.get('permissions-policy')).toContain('microphone=()');
      expect(response.headers.get('permissions-policy')).toContain('geolocation=()');
      expect(response.headers.get('strict-transport-security')).toBe(
        'max-age=31536000; includeSubDomains',
      );
      expect(body.deployment).toEqual({
        provider: 'render',
      });
      expect(body.deployment).not.toHaveProperty('gitCommit');
      expect(body.deployment).not.toHaveProperty('gitBranch');
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('does not trust localhost browser origins in deployed runtimes', async () => {
    vi.doUnmock('cookie-session');
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'production',
      SERVER_BASE_URL: 'https://yalelabs.io',
      SSOBASEURL: 'https://secure.its.yale.edu/cas',
      SESSION_SECRET: STRONG_SESSION_SECRET,
      TRUSTED_PROXY_CIDRS: '10.0.0.0/8',
    };

    const { default: app } = await import('../app');
    const server = http.createServer(app);

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });

    try {
      const address = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/api/config`, {
        method: 'POST',
        headers: {
          origin: 'http://localhost:3000',
          'x-forwarded-proto': 'https',
        },
      });
      const body = (await response.json()) as { error?: string };

      expect(response.status).toBe(403);
      expect(body).toEqual({ error: 'Forbidden' });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('rejects oversized API JSON request bodies before route work', async () => {
    vi.doUnmock('cookie-session');
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'production',
      SERVER_BASE_URL: 'https://yalelabs.io',
      SSOBASEURL: 'https://secure.its.yale.edu/cas',
      SESSION_SECRET: STRONG_SESSION_SECRET,
      TRUSTED_PROXY_CIDRS: '10.0.0.0/8',
    };

    const { default: app } = await import('../app');
    const server = http.createServer(app);

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });

    try {
      const address = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/api/config`, {
        method: 'POST',
        headers: {
          origin: 'https://yalelabs.io',
          'content-type': 'application/json',
          'x-forwarded-proto': 'https',
        },
        body: JSON.stringify({ data: 'x'.repeat(70 * 1024) }),
      });
      const body = (await response.json()) as { error?: string };

      expect(response.status).toBe(413);
      expect(body).toEqual({ error: 'Request failed' });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('rate-limits account mutation routes with the deployed write limiter', async () => {
    vi.doUnmock('cookie-session');
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'production',
      SERVER_BASE_URL: 'https://yalelabs.io',
      SSOBASEURL: 'https://secure.its.yale.edu/cas',
      SESSION_SECRET: STRONG_SESSION_SECRET,
      TRUSTED_PROXY_CIDRS: '127.0.0.1/32',
    };

    const { default: app } = await import('../app');
    const server = http.createServer(app);

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });

    try {
      const address = server.address() as AddressInfo;
      let lastStatus = 0;
      let sessionCookie: string | undefined;

      for (let attempt = 0; attempt < 51; attempt += 1) {
        const response = await fetch(`http://127.0.0.1:${address.port}/api/users/watchedPrograms`, {
          method: 'PUT',
          headers: {
            origin: 'https://yalelabs.io',
            'content-type': 'application/json',
            'x-forwarded-proto': 'https',
            ...(sessionCookie ? { cookie: sessionCookie } : {}),
          },
          body: JSON.stringify({ data: { watchedPrograms: ['64a000000000000000000030'] } }),
        });
        if (!sessionCookie) {
          sessionCookie = response.headers
            .getSetCookie()
            .map((cookie) => cookie.split(';', 1)[0])
            .join('; ');
        }
        lastStatus = response.status;
        await response.text();
      }

      expect(lastStatus).toBe(429);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('does not bill entity view telemetry against the write limiter', async () => {
    vi.doUnmock('cookie-session');
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'production',
      SERVER_BASE_URL: 'https://yalelabs.io',
      SSOBASEURL: 'https://secure.its.yale.edu/cas',
      SESSION_SECRET: STRONG_SESSION_SECRET,
      TRUSTED_PROXY_CIDRS: '127.0.0.1/32',
    };

    const { default: app } = await import('../app');
    const server = http.createServer(app);

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });

    try {
      const address = server.address() as AddressInfo;
      let lastStatus = 0;
      let sessionCookie: string | undefined;

      for (let attempt = 0; attempt < 51; attempt += 1) {
        const response = await fetch(
          `http://127.0.0.1:${address.port}/api/fellowships/64a000000000000000000030/addView`,
          {
            method: 'PUT',
            headers: {
              origin: 'https://yalelabs.io',
              'content-type': 'application/json',
              'x-forwarded-proto': 'https',
              ...(sessionCookie ? { cookie: sessionCookie } : {}),
            },
          },
        );
        if (!sessionCookie) {
          sessionCookie = response.headers
            .getSetCookie()
            .map((cookie) => cookie.split(';', 1)[0])
            .join('; ');
        }
        lastStatus = response.status;
        await response.text();
      }

      expect(lastStatus).not.toBe(429);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('does not bill the research analytics beacon against the write limiter', async () => {
    vi.doUnmock('cookie-session');
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'production',
      SERVER_BASE_URL: 'https://yalelabs.io',
      SSOBASEURL: 'https://secure.its.yale.edu/cas',
      SESSION_SECRET: STRONG_SESSION_SECRET,
      TRUSTED_PROXY_CIDRS: '127.0.0.1/32',
    };

    const { default: app } = await import('../app');
    const server = http.createServer(app);

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });

    try {
      const address = server.address() as AddressInfo;
      let lastStatus = 0;
      let sessionCookie: string | undefined;

      for (let attempt = 0; attempt < 51; attempt += 1) {
        const response = await fetch(
          `http://127.0.0.1:${address.port}/api/analytics/research/batch`,
          {
            method: 'POST',
            headers: {
              origin: 'https://yalelabs.io',
              'content-type': 'application/json',
              'x-forwarded-proto': 'https',
              ...(sessionCookie ? { cookie: sessionCookie } : {}),
            },
            body: JSON.stringify({
              events: [
                {
                  eventType: 'research_entity_impression',
                  entityType: 'research_entity',
                  entityId: '64a000000000000000000030',
                },
              ],
            }),
          },
        );
        if (!sessionCookie) {
          sessionCookie = response.headers
            .getSetCookie()
            .map((cookie) => cookie.split(';', 1)[0])
            .join('; ');
        }
        lastStatus = response.status;
        await response.text();
      }

      expect(lastStatus).not.toBe(429);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it('applies a per-IP auth limiter to the CAS login callback', async () => {
    vi.doUnmock('cookie-session');
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'production',
      SERVER_BASE_URL: 'https://yalelabs.io',
      SSOBASEURL: 'https://secure.its.yale.edu/cas',
      SESSION_SECRET: STRONG_SESSION_SECRET,
      TRUSTED_PROXY_CIDRS: '127.0.0.1/32',
    };

    const { default: app } = await import('../app');
    const server = http.createServer(app);

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });

    try {
      const address = server.address() as AddressInfo;
      let lastStatus = 0;

      for (let attempt = 0; attempt < 21; attempt += 1) {
        const response = await fetch(`http://127.0.0.1:${address.port}/api/cas`, {
          method: 'GET',
          headers: { 'x-forwarded-proto': 'https' },
          redirect: 'manual',
        });
        lastStatus = response.status;
        await response.text();
      }

      expect(lastStatus).toBe(429);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
