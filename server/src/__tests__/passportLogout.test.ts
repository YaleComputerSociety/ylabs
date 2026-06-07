import type { NextFunction, Request, Response } from 'express';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

let logoutHandlerImport: Promise<
  typeof import('../passport').logoutRouteHandler
> | null = null;

const importLogoutHandler = async () => {
  if (!logoutHandlerImport) {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SSOBASEURL', 'https://secure.its.yale.edu/cas');
    vi.stubEnv('SERVER_BASE_URL', 'https://yalelabs.io');

    logoutHandlerImport = import('../passport').then(
      (passportModule) => passportModule.logoutRouteHandler,
    );
  }

  return logoutHandlerImport;
};

const mockResponse = () => {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    redirect: vi.fn(),
  } as unknown as Response;
};

describe('logoutRouteHandler', () => {
  afterAll(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the Passport 0.6+ callback form before redirecting to CAS logout', async () => {
    const logoutRouteHandler = await importLogoutHandler();
    const logOut = vi.fn((callback: (error?: Error) => void) => callback());
    const req = {
      user: undefined,
      logOut,
      get: vi.fn((header: string) =>
        header.toLowerCase() === 'referer' ? 'https://yalelabs.io/account' : undefined,
      ),
    } as unknown as Request;
    const res = mockResponse();
    const next = vi.fn() as unknown as NextFunction;

    await logoutRouteHandler(req, res, next);

    expect(logOut).toHaveBeenCalledWith(expect.any(Function));
    expect(next).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith(
      'https://secure.its.yale.edu/cas/logout?service=https%3A%2F%2Fyalelabs.io%2Flogin',
    );
  });

  it('forwards Passport logout callback failures without redirecting', async () => {
    const logoutRouteHandler = await importLogoutHandler();
    const logoutError = new Error('logout failed');
    const logOut = vi.fn((callback: (error?: Error) => void) => callback(logoutError));
    const req = {
      user: undefined,
      logOut,
      get: vi.fn((header: string) =>
        header.toLowerCase() === 'referer' ? 'https://yalelabs.io/account' : undefined,
      ),
    } as unknown as Request;
    const res = mockResponse();
    const next = vi.fn() as unknown as NextFunction;

    await logoutRouteHandler(req, res, next);

    expect(logOut).toHaveBeenCalledWith(expect.any(Function));
    expect(next).toHaveBeenCalledWith(logoutError);
    expect(res.redirect).not.toHaveBeenCalled();
  });

  it('blocks deployed logout requests without a trusted origin or referer', async () => {
    const logoutRouteHandler = await importLogoutHandler();
    const logOut = vi.fn((callback: (error?: Error) => void) => callback());
    const req = {
      user: undefined,
      logOut,
      get: vi.fn(() => undefined),
    } as unknown as Request;
    const res = mockResponse();
    const next = vi.fn() as unknown as NextFunction;

    await logoutRouteHandler(req, res, next);

    expect(logOut).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Cross-site logout blocked' });
    expect(res.redirect).not.toHaveBeenCalled();
  });
});
