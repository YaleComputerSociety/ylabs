import { describe, expect, it, vi } from 'vitest';
import passport from 'passport';
import {
  isDevLoginAllowed,
  isLocalAuthBypassAllowed,
  isLocalDevelopmentRuntime,
  localAuthBypassUser,
  placeholderYaleEmail,
  passportRoutes,
  shouldSkipLocalAuthBypass,
  validateProductionAuthConfig,
} from '../passport';

describe('auth environment guards', () => {
  it('allows dev login for local development even when the database name is beta-like', () => {
    expect(
      isDevLoginAllowed({
        NODE_ENV: 'development',
        SERVER_BASE_URL: 'http://localhost:4000',
        MONGODBURL: 'mongodb+srv://example.invalid/ylabs-beta',
      }),
    ).toBe(true);
  });

  it('disables dev login outside local development runtime', () => {
    expect(
      isDevLoginAllowed({ NODE_ENV: 'production', SERVER_BASE_URL: 'http://localhost:4000' }),
    ).toBe(false);
    expect(
      isDevLoginAllowed({ NODE_ENV: 'development', SERVER_BASE_URL: 'https://yalelabs.io' }),
    ).toBe(false);
    expect(isDevLoginAllowed({ NODE_ENV: 'development' })).toBe(false);
    expect(
      isLocalDevelopmentRuntime({
        NODE_ENV: 'development',
        SERVER_BASE_URL: 'http://127.0.0.1:4000',
      }),
    ).toBe(true);
  });

  it('uses syntactically valid Yale placeholder emails for fallback accounts', () => {
    expect(placeholderYaleEmail('ABC123')).toBe('abc123@yale.edu');
  });

  it('allows local auth bypass only in local development with the explicit flag', () => {
    expect(
      isLocalAuthBypassAllowed({
        NODE_ENV: 'development',
        SERVER_BASE_URL: 'http://localhost:4000',
        LOCAL_AUTH_BYPASS: 'true',
        MONGODBURL: 'mongodb+srv://example.invalid/ylabs-beta',
      }),
    ).toBe(true);
    expect(
      isLocalAuthBypassAllowed({
        NODE_ENV: 'development',
        SERVER_BASE_URL: 'http://localhost:4000',
      }),
    ).toBe(false);
    expect(
      isLocalAuthBypassAllowed({
        NODE_ENV: 'production',
        SERVER_BASE_URL: 'http://localhost:4000',
        LOCAL_AUTH_BYPASS: 'true',
      }),
    ).toBe(false);
    expect(
      isLocalAuthBypassAllowed({
        NODE_ENV: 'development',
        SERVER_BASE_URL: 'https://yalelabs.io',
        LOCAL_AUTH_BYPASS: 'true',
      }),
    ).toBe(false);
  });

  it('builds a local auth bypass user from env defaults and request headers', () => {
    expect(
      localAuthBypassUser({
        LOCAL_AUTH_BYPASS_NETID: 'devadmin',
        LOCAL_AUTH_BYPASS_USER_TYPE: 'admin',
      }),
    ).toMatchObject({
      netId: 'devadmin',
      userType: 'admin',
      userConfirmed: true,
      profileVerified: true,
    });

    expect(
      localAuthBypassUser(
        {
          LOCAL_AUTH_BYPASS_NETID: 'devadmin',
          LOCAL_AUTH_BYPASS_USER_TYPE: 'admin',
        },
        {
          'x-dev-netid': 'test123',
          'x-dev-user-type': 'student',
        },
      ),
    ).toMatchObject({
      netId: 'test123',
      userType: 'student',
    });
  });

  it('does not bypass explicit auth routes', () => {
    expect(shouldSkipLocalAuthBypass('/cas')).toBe(true);
    expect(shouldSkipLocalAuthBypass('/logout')).toBe(true);
    expect(shouldSkipLocalAuthBypass('/dev-login')).toBe(true);
    expect(shouldSkipLocalAuthBypass('/check')).toBe(false);
    expect(shouldSkipLocalAuthBypass('/users/favListingsIds')).toBe(false);
  });

  it('requires explicit HTTPS CAS base URLs in production', () => {
    const validProductionEnv = {
      NODE_ENV: 'production',
      SSOBASEURL: 'https://secure.its.yale.edu/cas',
      SERVER_BASE_URL: 'https://yalelabs.io',
    };

    expect(() => validateProductionAuthConfig(validProductionEnv)).not.toThrow();
    expect(() =>
      validateProductionAuthConfig({ ...validProductionEnv, NODE_ENV: 'prod' }),
    ).not.toThrow();
    expect(() => validateProductionAuthConfig({ ...validProductionEnv, SSOBASEURL: '' })).toThrow(
      /SSOBASEURL/,
    );
    expect(() =>
      validateProductionAuthConfig({ ...validProductionEnv, SERVER_BASE_URL: 'http://yalelabs.io' }),
    ).toThrow(/SERVER_BASE_URL must use HTTPS/);
    expect(() =>
      validateProductionAuthConfig({ ...validProductionEnv, SERVER_BASE_URL: 'https://localhost:4000' }),
    ).toThrow(/localhost/);
    expect(() =>
      validateProductionAuthConfig({ ...validProductionEnv, SSOBASEURL: 'not-a-url' }),
    ).toThrow(/SSOBASEURL must be a valid HTTPS URL/);
  });

  it('requires explicit HTTPS CAS base URLs for remote development-labelled runtimes', () => {
    const remoteDevelopmentEnv = {
      NODE_ENV: 'development',
      SSOBASEURL: 'https://secure.its.yale.edu/cas',
      SERVER_BASE_URL: 'https://yalelabs.io',
    };

    expect(() => validateProductionAuthConfig(remoteDevelopmentEnv)).not.toThrow();
    expect(() =>
      validateProductionAuthConfig({
        ...remoteDevelopmentEnv,
        SSOBASEURL: 'http://secure.its.yale.edu/cas',
      }),
    ).toThrow(/SSOBASEURL must use HTTPS/);
    expect(() =>
      validateProductionAuthConfig({
        ...remoteDevelopmentEnv,
        SERVER_BASE_URL: 'http://yalelabs.io',
      }),
    ).toThrow(/SERVER_BASE_URL must use HTTPS/);
  });

  it('marks auth check responses as private no-store payloads', () => {
    const checkRoute = (passportRoutes as any).stack
      .map((layer: any) => layer.route)
      .find((route: any) => route?.path === '/check');
    expect(checkRoute).toBeTruthy();
    const handler = checkRoute.stack.at(-1).handle;
    const req = {
      user: {
        netId: 'abc123',
        userType: 'student',
        userConfirmed: true,
        profileVerified: false,
      },
    };
    const res = {
      setHeader: vi.fn(),
      json: vi.fn(),
    };

    handler(req, res);

    expect(res.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'no-store, private, max-age=0',
    );
    expect(res.setHeader).toHaveBeenCalledWith('Pragma', 'no-cache');
    expect(res.json).toHaveBeenCalledWith({
      auth: true,
      user: req.user,
    });
  });

  it('does not redirect CAS auth failures to same-host HTTP downgrade URLs', async () => {
    const originalServerBaseUrl = process.env.SERVER_BASE_URL;
    process.env.SERVER_BASE_URL = 'https://yalelabs.io';
    const authenticateSpy = vi.spyOn(passport, 'authenticate').mockImplementation(
      ((_strategy: unknown, callback: any) =>
        ((req: any, res: any, next: any) => callback(new Error('CAS failed'), false, {}, req, res, next))) as any,
    );

    const casRoute = (passportRoutes as any).stack
      .map((layer: any) => layer.route)
      .find((route: any) => route?.path === '/cas');
    expect(casRoute).toBeTruthy();
    const handler = casRoute.stack.at(-1).handle;
    const res = {
      redirect: vi.fn(),
      status: vi.fn(function (this: any) {
        return this;
      }),
      json: vi.fn(),
    };

    try {
      await handler(
        {
          query: { error: 'http://yalelabs.io/login' },
        },
        res,
        vi.fn(),
      );

      expect(res.redirect).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Error in authentication' });
    } finally {
      authenticateSpy.mockRestore();
      if (originalServerBaseUrl === undefined) {
        delete process.env.SERVER_BASE_URL;
      } else {
        process.env.SERVER_BASE_URL = originalServerBaseUrl;
      }
    }
  });
});
