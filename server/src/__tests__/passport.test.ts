import { describe, expect, it, vi } from 'vitest';
import passport from 'passport';
import {
  isDevLoginAllowed,
  isLocalAuthBypassAllowed,
  isLocalDevelopmentRuntime,
  localAuthBypassUser,
  logoutRouteHandler,
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

  it('does not promote malformed local auth bypass user types to admin', () => {
    expect(
      localAuthBypassUser({
        LOCAL_AUTH_BYPASS_NETID: 'devadmin',
        LOCAL_AUTH_BYPASS_USER_TYPE: 'typo-admin',
      }),
    ).toMatchObject({
      netId: 'devadmin',
      userType: 'student',
    });

    expect(
      localAuthBypassUser(
        {
          LOCAL_AUTH_BYPASS_NETID: 'devadmin',
          LOCAL_AUTH_BYPASS_USER_TYPE: 'student',
        },
        {
          'x-dev-user-type': '__proto__',
        },
      ),
    ).toMatchObject({
      userType: 'student',
    });
  });

  it('bounds local auth bypass netids before creating a session identity', () => {
    expect(
      localAuthBypassUser(
        {
          LOCAL_AUTH_BYPASS_NETID: 'safe123',
          LOCAL_AUTH_BYPASS_USER_TYPE: 'student',
        },
        {
          'x-dev-netid': 'attacker@example.invalid',
        },
      ),
    ).toMatchObject({
      netId: 'safe123',
      userType: 'student',
    });

    expect(
      localAuthBypassUser({
        LOCAL_AUTH_BYPASS_NETID: 'x'.repeat(4096),
        LOCAL_AUTH_BYPASS_USER_TYPE: 'student',
      }),
    ).toMatchObject({
      netId: 'devadmin',
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
        email: 'abc123@yale.edu',
        savedPathwayPlans: { private: { note: 'sensitive' } },
        accessToken: 'secret-token',
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
    expect(res.setHeader).toHaveBeenCalledWith('Surrogate-Control', 'no-store');
    expect(res.json).toHaveBeenCalledWith({
      auth: true,
      user: {
        netId: 'abc123',
        userType: 'student',
        userConfirmed: true,
        profileVerified: false,
      },
    });
  });

  it('fails auth check closed for malformed session principals', () => {
    const checkRoute = (passportRoutes as any).stack
      .map((layer: any) => layer.route)
      .find((route: any) => route?.path === '/check');
    expect(checkRoute).toBeTruthy();
    const handler = checkRoute.stack.at(-1).handle;
    const req = {
      user: {
        netId: { toString: () => 'abc123' },
        userType: 'admin',
        userConfirmed: true,
        profileVerified: true,
      },
    };
    const res = {
      setHeader: vi.fn(),
      json: vi.fn(),
    };

    handler(req, res);

    expect(res.json).toHaveBeenCalledWith({ auth: false });
  });

  it('normalizes session principals before serializing them into signed cookies', async () => {
    const serializer = (passport as any)._serializers[0];

    await expect(
      new Promise<{ error: unknown; principal: unknown }>((resolve) => {
        serializer({ netId: ' AbC123 ' }, (error: unknown, principal: unknown) =>
          resolve({ error, principal }),
        );
      }),
    ).resolves.toEqual({ error: null, principal: 'AbC123' });

    const malformed = await new Promise<{ error: unknown; principal: unknown }>((resolve) => {
      serializer({ netId: { toString: () => 'abc123' } }, (error: unknown, principal: unknown) =>
        resolve({ error, principal }),
      );
    });

    expect(malformed.error).toBeInstanceOf(Error);
    expect((malformed.error as Error).message).toMatch(/Invalid authentication principal/);
    expect(malformed.principal).toBeUndefined();
  });

  it('marks CAS callback responses as private no-store auth payloads', async () => {
    const authenticateSpy = vi.spyOn(passport, 'authenticate').mockImplementation(
      ((_strategy: unknown, callback: any) =>
        ((req: any, res: any, next: any) => callback(null, false, {}, req, res, next))) as any,
    );

    const casRoute = (passportRoutes as any).stack
      .map((layer: any) => layer.route)
      .find((route: any) => route?.path === '/cas');
    expect(casRoute).toBeTruthy();
    const handler = casRoute.stack.at(-1).handle;
    const res = {
      setHeader: vi.fn(),
      status: vi.fn(function (this: any) {
        return this;
      }),
      json: vi.fn(),
    };

    try {
      await handler({ query: {} }, res, vi.fn());

      expect(res.setHeader).toHaveBeenCalledWith(
        'Cache-Control',
        'no-store, private, max-age=0',
      );
      expect(res.setHeader).toHaveBeenCalledWith('Pragma', 'no-cache');
      expect(res.setHeader).toHaveBeenCalledWith('Surrogate-Control', 'no-store');
      expect(res.status).toHaveBeenCalledWith(401);
    } finally {
      authenticateSpy.mockRestore();
    }
  });

  it('rejects implicit HEAD logout handling before clearing the session', async () => {
    const req = {
      method: 'HEAD',
      get: vi.fn(),
      user: { netId: 'abc123', userType: 'student' },
      logOut: vi.fn(),
    };
    const res = {
      setHeader: vi.fn(),
      status: vi.fn(function (this: any) {
        return this;
      }),
      json: vi.fn(),
      redirect: vi.fn(),
    };
    const next = vi.fn();

    await logoutRouteHandler(req as any, res as any, next);

    expect(res.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'no-store, private, max-age=0',
    );
    expect(res.setHeader).toHaveBeenCalledWith('Surrogate-Control', 'no-store');
    expect(res.setHeader).toHaveBeenCalledWith('Allow', 'GET');
    expect(res.status).toHaveBeenCalledWith(405);
    expect(res.json).toHaveBeenCalledWith({ error: 'Method not allowed' });
    expect(req.logOut).not.toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects credentialed logout origin headers before trusting parsed origins', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const req = {
      method: 'GET',
      get: vi.fn((header: string) => {
        if (header.toLowerCase() === 'origin') return 'https://attacker:secret@yalelabs.io';
        return undefined;
      }),
      user: { netId: 'abc123', userType: 'student' },
      logOut: vi.fn(),
    };
    const res = {
      setHeader: vi.fn(),
      status: vi.fn(function (this: any) {
        return this;
      }),
      json: vi.fn(),
      redirect: vi.fn(),
    };
    const next = vi.fn();

    try {
      await logoutRouteHandler(req as any, res as any, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'Cross-site logout blocked' });
      expect(req.logOut).not.toHaveBeenCalled();
      expect(res.redirect).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    } finally {
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }
    }
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
      setHeader: vi.fn(),
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

  it('rejects oversized CAS redirect targets before parsing or redirecting', async () => {
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
      setHeader: vi.fn(),
      redirect: vi.fn(),
      status: vi.fn(function (this: any) {
        return this;
      }),
      json: vi.fn(),
    };

    try {
      await handler(
        {
          query: { error: `https://yalelabs.io/${'a'.repeat(2049)}` },
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

  it('does not echo Passport auth info messages when CAS returns no user', async () => {
    const authenticateSpy = vi.spyOn(passport, 'authenticate').mockImplementation(
      ((_strategy: unknown, callback: any) =>
        ((req: any, res: any, next: any) =>
          callback(null, false, {
            message: 'CAS ticket ST-secret-ticket for ada@yale.edu failed',
          }, req, res, next))) as any,
    );

    const casRoute = (passportRoutes as any).stack
      .map((layer: any) => layer.route)
      .find((route: any) => route?.path === '/cas');
    expect(casRoute).toBeTruthy();
    const handler = casRoute.stack.at(-1).handle;
    const res = {
      setHeader: vi.fn(),
      redirect: vi.fn(),
      status: vi.fn(function (this: any) {
        return this;
      }),
      json: vi.fn(),
    };

    try {
      await handler({ query: {} }, res, vi.fn());

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'CAS auth but no user' });
      expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain('ST-secret-ticket');
      expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain('ada@yale.edu');
    } finally {
      authenticateSpy.mockRestore();
    }
  });

  it('sanitizes CAS authentication errors before logging', async () => {
    const authError = new Error(
      'CAS failed for ticket=ST-secret-ticket and email ada@yale.edu at https://user:pass@example.test/cas',
    );
    authError.stack = [
      authError.message,
      'Authorization: Bearer secret-access-token',
      'at callback (https://example.test/cas?ticket=ST-stack-ticket)',
    ].join('\n');
    const authenticateSpy = vi.spyOn(passport, 'authenticate').mockImplementation(
      ((_strategy: unknown, callback: any) =>
        ((req: any, res: any, next: any) => callback(authError, false, {}, req, res, next))) as any,
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const casRoute = (passportRoutes as any).stack
      .map((layer: any) => layer.route)
      .find((route: any) => route?.path === '/cas');
    expect(casRoute).toBeTruthy();
    const handler = casRoute.stack.at(-1).handle;
    const res = {
      setHeader: vi.fn(),
      redirect: vi.fn(),
      status: vi.fn(function (this: any) {
        return this;
      }),
      json: vi.fn(),
    };

    try {
      await handler({ query: {} }, res, vi.fn());

      const logged = errorSpy.mock.calls.flat().join(' ');
      expect(logged).toContain('Authentication error details');
      expect(logged).toContain('ticket=[secret-redacted]');
      expect(logged).toContain('[email redacted]');
      expect(logged).toContain('https://[credentials-redacted]@example.test/cas');
      expect(logged).toContain('Bearer [token-redacted]');
      expect(logged).not.toContain('ST-secret-ticket');
      expect(logged).not.toContain('ST-stack-ticket');
      expect(logged).not.toContain('ada@yale.edu');
      expect(logged).not.toContain('user:pass');
    } finally {
      authenticateSpy.mockRestore();
      errorSpy.mockRestore();
      logSpy.mockRestore();
    }
  });
});
