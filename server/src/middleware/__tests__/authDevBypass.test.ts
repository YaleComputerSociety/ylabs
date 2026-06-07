import type express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localAuthBypass } from '../auth';

const ORIGINAL_ENV = { ...process.env };

const makeReq = (overrides: Partial<express.Request> = {}) =>
  ({
    originalUrl: '/api/check',
    path: '/api/check',
    get: vi.fn(),
    ...overrides,
  }) as unknown as express.Request;

const runMiddleware = (req: express.Request) =>
  new Promise<void>((resolve) => {
    const next: express.NextFunction = () => resolve();
    localAuthBypass(req, {} as express.Response, next);
  });

describe('localAuthBypass', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    process.env.NODE_ENV = 'test';
    process.env.LOCAL_AUTH_BYPASS = 'true';
    delete process.env.LOCAL_AUTH_BYPASS_NETID;
    delete process.env.LOCAL_AUTH_BYPASS_USER_TYPE;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  it('injects the default dev admin only when explicitly enabled in test or development', async () => {
    const req = makeReq();

    await runMiddleware(req);

    expect(req.user).toEqual({
      netId: 'devadmin',
      userType: 'admin',
      userConfirmed: true,
      profileVerified: true,
    });
  });

  it('fails closed when the bypass flag is disabled or the environment is not local/test', async () => {
    process.env.LOCAL_AUTH_BYPASS = 'false';
    const disabledReq = makeReq();
    await runMiddleware(disabledReq);
    expect(disabledReq.user).toBeUndefined();

    process.env.LOCAL_AUTH_BYPASS = 'true';
    process.env.NODE_ENV = 'production';
    const productionReq = makeReq();
    await runMiddleware(productionReq);
    expect(productionReq.user).toBeUndefined();
  });

  it('does not replace a user already established by passport', async () => {
    const existingUser = {
      netId: 'realuser',
      userType: 'student',
      userConfirmed: false,
      profileVerified: false,
    };
    const req = makeReq({ user: existingUser });

    await runMiddleware(req);

    expect(req.user).toBe(existingUser);
  });

  it('skips CAS and logout routes', async () => {
    const casReq = makeReq({ originalUrl: '/api/cas', path: '/api/cas' });
    await runMiddleware(casReq);
    expect(casReq.user).toBeUndefined();

    const logoutReq = makeReq({ originalUrl: '/api/logout', path: '/api/logout' });
    await runMiddleware(logoutReq);
    expect(logoutReq.user).toBeUndefined();
  });

  it('honors env defaults and per-request dev headers', async () => {
    process.env.LOCAL_AUTH_BYPASS_NETID = 'envuser';
    process.env.LOCAL_AUTH_BYPASS_USER_TYPE = 'faculty';
    const req = makeReq({
      get: vi.fn((name: string) => {
        if (name.toLowerCase() === 'x-dev-netid') return 'headeruser';
        if (name.toLowerCase() === 'x-dev-user-type') return 'professor';
        return undefined;
      }) as express.Request['get'],
    });

    await runMiddleware(req);

    expect(req.user).toMatchObject({
      netId: 'headeruser',
      userType: 'professor',
      userConfirmed: true,
      profileVerified: true,
    });
  });

  it('is mounted after passport session and before API routes', async () => {
    process.env.SESSION_SECRET = '12345678901234567890123456789012';
    vi.resetModules();
    const { default: app } = await import('../../app');
    const stack = (app as any)._router.stack as Array<{ name: string }>;

    const passportSessionIndex = stack.findIndex((layer) => layer.name === 'authenticate');
    const bypassIndex = stack.findIndex((layer) => layer.name === 'localAuthBypass');
    const firstApiRouterIndex = stack.findIndex((layer, index) => {
      return index > bypassIndex && layer.name === 'router';
    });

    expect(passportSessionIndex).toBeGreaterThanOrEqual(0);
    expect(bypassIndex).toBeGreaterThan(passportSessionIndex);
    expect(firstApiRouterIndex).toBeGreaterThan(bypassIndex);
  });
});
