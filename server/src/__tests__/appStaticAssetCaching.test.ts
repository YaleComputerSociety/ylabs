import { createHmac } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';

const ORIGINAL_ENV = { ...process.env };
const STRONG_SESSION_SECRET = 'R8h!vK2p#Q7zLm4$T9nWx6%Yc3@F5sJ0';
const SESSION_COOKIE_NAME = '__Host-session';
const HASHED_ENTRY_CHUNK = 'index-Ab3_x-9Z.js';
const UNHASHED_IMAGE = 'developers/placeholder.png';

const validateAccount = vi.fn(async () => null);

let clientDistPath = '';

const signCookie = (name: string, value: string): string =>
  createHmac('sha1', STRONG_SESSION_SECRET)
    .update(`${name}=${value}`)
    .digest('base64')
    .replace(/\/|\+|=/g, (character) => ({ '/': '_', '+': '-', '=': '' })[character] ?? '');

const signedInSessionCookieHeader = (): string => {
  const value = Buffer.from(JSON.stringify({ passport: { user: 'abc123' } })).toString('base64');
  const signature = signCookie(SESSION_COOKIE_NAME, value);
  return `${SESSION_COOKIE_NAME}=${value}; ${SESSION_COOKIE_NAME}.sig=${signature}`;
};

const sessionCookiesOf = (response: Response): string[] =>
  response.headers.getSetCookie().filter((cookie) => cookie.startsWith(SESSION_COOKIE_NAME));

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

describe('client static asset serving', () => {
  beforeAll(() => {
    clientDistPath = mkdtempSync(path.join(tmpdir(), 'ylabs-client-dist-'));
    mkdirSync(path.join(clientDistPath, 'assets', 'developers'), { recursive: true });
    writeFileSync(path.join(clientDistPath, 'assets', HASHED_ENTRY_CHUNK), 'export {};\n');
    writeFileSync(path.join(clientDistPath, 'assets', UNHASHED_IMAGE), 'not-a-real-image');
    writeFileSync(path.join(clientDistPath, 'assets', `${HASHED_ENTRY_CHUNK}.map`), '{}');
    writeFileSync(path.join(clientDistPath, 'index.html'), '<!doctype html><title>t</title>');
    writeFileSync(path.join(clientDistPath, 'oauth-callback.html'), '<!doctype html><title>t</title>');
  });

  afterAll(() => {
    rmSync(clientDistPath, { recursive: true, force: true });
  });

  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('../middleware/clientStaticAssets');
    vi.doUnmock('../services/accountService');
    validateAccount.mockClear();
    mongoose.deleteModel(/.+/);
    process.env = { ...ORIGINAL_ENV };
  });

  const prepareDeployedApp = () => {
    vi.doMock('../middleware/clientStaticAssets', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../middleware/clientStaticAssets')>();
      return {
        ...actual,
        createClientStaticAssets: () => actual.createClientStaticAssets(clientDistPath),
      };
    });
    vi.doMock('../services/accountService', async (importOriginal) => ({
      ...(await importOriginal<typeof import('../services/accountService')>()),
      validateAccount,
    }));
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'production',
      SERVER_BASE_URL: 'https://yalelabs.io',
      SSOBASEURL: 'https://secure.its.yale.edu/cas',
      SESSION_SECRET: STRONG_SESSION_SECRET,
      TRUSTED_PROXY_CIDRS: '127.0.0.1/32',
    };
  };

  it('serves a content-hashed asset immutable for a year with no session cookie', async () => {
    prepareDeployedApp();

    await withRunningApp(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/assets/${HASHED_ENTRY_CHUNK}`, {
        headers: { 'x-forwarded-proto': 'https' },
      });
      await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toContain('max-age=31536000');
      expect(response.headers.get('cache-control')).toContain('immutable');
      expect(sessionCookiesOf(response)).toEqual([]);
    });
  });

  it('serves a content-hashed asset to a signed-in visitor without restoring the session', async () => {
    prepareDeployedApp();

    await withRunningApp(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/assets/${HASHED_ENTRY_CHUNK}`, {
        headers: { 'x-forwarded-proto': 'https', cookie: signedInSessionCookieHeader() },
      });
      await response.text();

      expect(response.status).toBe(200);
      expect(validateAccount).not.toHaveBeenCalled();
    });
  });

  it('still restores a signed-in session on API requests', async () => {
    prepareDeployedApp();

    await withRunningApp(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/missing`, {
        headers: { 'x-forwarded-proto': 'https', cookie: signedInSessionCookieHeader() },
      });
      await response.text();

      expect(validateAccount).toHaveBeenCalled();
    });
  });

  it('keeps unhashed assets and the app shell revalidating', async () => {
    prepareDeployedApp();

    await withRunningApp(async (baseUrl) => {
      const headers = { 'x-forwarded-proto': 'https' };
      const image = await fetch(`${baseUrl}/assets/${UNHASHED_IMAGE}`, { headers });
      const shell = await fetch(`${baseUrl}/index.html`, { headers });
      await Promise.all([image.text(), shell.text()]);

      for (const response of [image, shell]) {
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).not.toContain('immutable');
        expect(response.headers.get('cache-control')).toMatch(/max-age=0\b/);
      }
    });
  });

  it('does not issue an empty session cookie to anonymous page and file requests', async () => {
    prepareDeployedApp();

    await withRunningApp(async (baseUrl) => {
      const headers = { 'x-forwarded-proto': 'https' };
      const page = await fetch(`${baseUrl}/research`, { headers });
      const missingFile = await fetch(`${baseUrl}/missing.js`, { headers });
      const api = await fetch(`${baseUrl}/api/missing`, { headers });
      await Promise.all([page.text(), missingFile.text(), api.text()]);

      expect(sessionCookiesOf(page)).toEqual([]);
      expect(sessionCookiesOf(missingFile)).toEqual([]);
      expect(sessionCookiesOf(api).length).toBeGreaterThan(0);
    });
  });

  it('never serves a client build file under the API prefix', async () => {
    mkdirSync(path.join(clientDistPath, 'api'), { recursive: true });
    writeFileSync(path.join(clientDistPath, 'api', 'leak.json'), '{"leaked":true}');
    prepareDeployedApp();

    try {
      await withRunningApp(async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/leak.json`, {
          headers: { 'x-forwarded-proto': 'https' },
        });
        const body = await response.text();

        expect(response.status).toBe(404);
        expect(body).not.toContain('leaked');
        expect(response.headers.get('cache-control')).toContain('no-store');
      });
    } finally {
      rmSync(path.join(clientDistPath, 'api'), { recursive: true, force: true });
    }
  });

  it('refuses to serve a source map even when the build emitted one', async () => {
    prepareDeployedApp();

    await withRunningApp(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/assets/${HASHED_ENTRY_CHUNK}.map`, {
        headers: { 'x-forwarded-proto': 'https' },
      });
      await response.text();

      expect(response.status).toBe(404);
      expect(response.headers.get('cache-control')).toContain('no-store');
    });
  });

  it('serves the OAuth callback page with no-store', async () => {
    prepareDeployedApp();

    await withRunningApp(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/oauth-callback.html`, {
        headers: { 'x-forwarded-proto': 'https' },
      });
      await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toContain('no-store');
      expect(sessionCookiesOf(response)).toEqual([]);
    });
  });
});
