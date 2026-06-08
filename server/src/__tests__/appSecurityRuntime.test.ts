import http from 'node:http';
import { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';

const ORIGINAL_ENV = { ...process.env };

const resetEnv = () => {
  process.env = { ...ORIGINAL_ENV };
};

describe('app security runtime classification', () => {
  afterEach(() => {
    vi.resetModules();
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
    delete process.env.SESSION_SECRET;

    await expect(import('../app')).rejects.toThrow(/SESSION_SECRET/);
  });

  it('keeps local development imports usable without a production session secret', async () => {
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'development',
      SERVER_BASE_URL: 'http://localhost:4000',
      SSOBASEURL: 'https://secure.its.yale.edu/cas',
    };
    delete process.env.SESSION_SECRET;

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
      SESSION_SECRET: 'x'.repeat(40),
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

  it('serves public config with mounted browser hardening headers and a narrow deployment fingerprint', async () => {
    vi.doUnmock('cookie-session');
    vi.doMock('../services/configService', () => ({
      getConfig: vi.fn(async () => ({
        researchAreas: { areas: [], fields: [], fieldOrder: [] },
        departments: { list: [], categories: [] },
        deployment: {
          provider: 'render',
          gitCommit: '852f4a05355bb17dbfce9d1197f4693ddf2ccb2a',
          gitBranch: 'new-foundation',
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
      SESSION_SECRET: 'x'.repeat(40),
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
      expect(response.headers.get('permissions-policy')).toContain('camera=()');
      expect(response.headers.get('permissions-policy')).toContain('microphone=()');
      expect(response.headers.get('permissions-policy')).toContain('geolocation=()');
      expect(response.headers.get('strict-transport-security')).toBe(
        'max-age=31536000; includeSubDomains',
      );
      expect(body.deployment).toEqual({
        provider: 'render',
        gitCommit: '852f4a05355bb17dbfce9d1197f4693ddf2ccb2a',
        gitBranch: 'new-foundation',
      });
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
      SESSION_SECRET: 'x'.repeat(40),
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

  it('rate-limits account mutation routes with the deployed write limiter', async () => {
    vi.doUnmock('cookie-session');
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'production',
      SERVER_BASE_URL: 'https://yalelabs.io',
      SSOBASEURL: 'https://secure.its.yale.edu/cas',
      SESSION_SECRET: 'x'.repeat(40),
    };

    const { default: app } = await import('../app');
    const server = http.createServer(app);

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });

    try {
      const address = server.address() as AddressInfo;
      let lastStatus = 0;

      for (let attempt = 0; attempt < 51; attempt += 1) {
        const response = await fetch(`http://127.0.0.1:${address.port}/api/users/favPathways`, {
          method: 'PUT',
          headers: {
            origin: 'https://yalelabs.io',
            'content-type': 'application/json',
            'x-forwarded-proto': 'https',
          },
          body: JSON.stringify({ data: { favPathways: ['64a000000000000000000030'] } }),
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
