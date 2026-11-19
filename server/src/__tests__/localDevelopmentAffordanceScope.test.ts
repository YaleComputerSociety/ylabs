import { afterEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';

const accountServiceMock = vi.hoisted(() => ({
  recordAccountLogin: vi.fn(async (data: any) => ({
    _id: 'acc-test',
    netid: data.netid,
    email: data.email,
    status: 'ACTIVE',
    archived: false,
  })),
  validateAccount: vi.fn(),
}));
vi.mock('../services/accountService', () => accountServiceMock);

const adminGrantServiceMock = vi.hoisted(() => ({
  ensureBootstrapAdminGrant: vi.fn(async () => undefined),
  hasActiveAdminGrant: vi.fn(async (_netid?: unknown) => false),
}));
vi.mock('../services/adminGrantService', () => adminGrantServiceMock);

const analyticsServiceMock = vi.hoisted(() => ({
  logEvent: vi.fn(async () => 'recorded'),
}));
vi.mock('../services/analyticsService', () => analyticsServiceMock);

const ORIGINAL_ENV = { ...process.env };

const LOCAL_DEVELOPMENT_ENV = {
  NODE_ENV: 'development',
  SERVER_BASE_URL: 'http://localhost:4000',
  SSOBASEURL: 'https://secure.its.yale.edu/cas',
};

const DEPLOYED_ENV = {
  NODE_ENV: 'production',
  SERVER_BASE_URL: 'https://yalelabs.io',
  SSOBASEURL: 'https://secure.its.yale.edu/cas',
};

const loadPassportModule = async (env: NodeJS.ProcessEnv) => {
  vi.resetModules();
  // Re-importing the module graph recompiles every Mongoose model, which the
  // model registry refuses unless the previous registration is dropped first.
  mongoose.deleteModel(/.+/);
  process.env = { ...ORIGINAL_ENV, ...env };
  return import('../passport');
};

const routeHandler = (router: any, path: string) => {
  const route = router.stack.map((layer: any) => layer.route).find((r: any) => r?.path === path);
  return route ? route.stack.at(-1).handle : undefined;
};

const fakeResponse = () => {
  const res: any = { statusCode: 200, headers: {} as Record<string, unknown> };
  res.setHeader = (name: string, value: unknown) => {
    res.headers[name] = value;
  };
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload: unknown) => {
    res.body = payload;
    return res;
  };
  res.redirect = (url: string) => {
    res.redirectedTo = url;
    return res;
  };
  return res;
};

const fakeRequest = ({
  remoteAddress,
  host,
  headers = {},
}: {
  remoteAddress?: string;
  host?: string;
  headers?: Record<string, string>;
}) => {
  const allHeaders: Record<string, string | undefined> = { ...headers, host };
  const req: any = {
    headers: allHeaders,
    socket: { remoteAddress },
    query: {},
    path: '/check',
    session: {},
    get: (name: string) => allHeaders[name.toLowerCase()],
    isAuthenticated: () => false,
  };
  req.logIn = (user: unknown, callback: (error: Error | null) => void) => {
    req.user = user;
    return callback(null);
  };
  return req;
};

const LOOPBACK_CALLER = { remoteAddress: '127.0.0.1', host: 'localhost:4000' };

describe('development-only affordances are scoped to the developer machine', () => {
  afterEach(() => {
    vi.resetModules();
    mongoose.deleteModel(/.+/);
    process.env = { ...ORIGINAL_ENV };
    accountServiceMock.recordAccountLogin.mockClear();
    adminGrantServiceMock.ensureBootstrapAdminGrant.mockClear();
    adminGrantServiceMock.hasActiveAdminGrant.mockReset();
    adminGrantServiceMock.hasActiveAdminGrant.mockImplementation(async (_netid?: unknown) => false);
    analyticsServiceMock.logEvent.mockClear();
  });

  it('serves the dev login route to a loopback caller', async () => {
    const { passportRoutes } = await loadPassportModule(LOCAL_DEVELOPMENT_ENV);
    const handler = routeHandler(passportRoutes, '/dev-login');
    expect(handler).toBeTypeOf('function');

    const req = fakeRequest(LOOPBACK_CALLER);
    const res = fakeResponse();
    await handler(req, res, vi.fn());

    expect(res.statusCode).toBe(200);
    expect(res.redirectedTo).toBe('http://localhost:3000');
    expect(req.user).toMatchObject({ netId: 'test123' });
  });

  it('refuses a non-loopback caller on the dev login route', async () => {
    const { passportRoutes } = await loadPassportModule(LOCAL_DEVELOPMENT_ENV);
    const handler = routeHandler(passportRoutes, '/dev-login');

    const req = fakeRequest({ remoteAddress: '203.0.113.5', host: 'localhost:4000' });
    const res = fakeResponse();
    await handler(req, res, vi.fn());

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
    expect(req.user).toBeUndefined();
    expect(accountServiceMock.recordAccountLogin).not.toHaveBeenCalled();
  });

  it('refuses a caller whose Host header is not a localhost form', async () => {
    const { passportRoutes } = await loadPassportModule(LOCAL_DEVELOPMENT_ENV);
    const handler = routeHandler(passportRoutes, '/dev-login');

    const req = fakeRequest({ remoteAddress: '127.0.0.1', host: 'yalelabs.io' });
    const res = fakeResponse();
    await handler(req, res, vi.fn());

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
    expect(accountServiceMock.recordAccountLogin).not.toHaveBeenCalled();
  });

  it('does not register the dev login route in a deployed runtime', async () => {
    const { passportRoutes, isDevLoginRequestAllowed } = await loadPassportModule(DEPLOYED_ENV);

    expect(routeHandler(passportRoutes, '/dev-login')).toBeUndefined();
    expect(isDevLoginRequestAllowed(fakeRequest(LOOPBACK_CALLER))).toBe(false);
  });

  it('applies the local auth bypass only to a loopback caller', async () => {
    const { passportRoutes } = await loadPassportModule({
      ...LOCAL_DEVELOPMENT_ENV,
      LOCAL_AUTH_BYPASS: 'true',
      LOCAL_AUTH_BYPASS_NETID: 'devadmin',
      LOCAL_AUTH_BYPASS_USER_TYPE: 'admin',
    });
    const bypassMiddleware = (passportRoutes as any).stack[0].handle;

    const loopbackReq = fakeRequest(LOOPBACK_CALLER);
    await bypassMiddleware(loopbackReq, fakeResponse(), vi.fn());
    expect(loopbackReq.user).toMatchObject({ netId: 'devadmin', userType: 'admin' });

    const remoteReq = fakeRequest({ remoteAddress: '203.0.113.5', host: 'localhost:4000' });
    const remoteNext = vi.fn();
    await bypassMiddleware(remoteReq, fakeResponse(), remoteNext);
    expect(remoteReq.user).toBeUndefined();
    expect(remoteNext).toHaveBeenCalledWith();
  });

  it('honours the dev netid header only for a loopback caller', async () => {
    const { passportRoutes } = await loadPassportModule({
      ...LOCAL_DEVELOPMENT_ENV,
      LOCAL_AUTH_BYPASS: 'true',
      LOCAL_AUTH_BYPASS_NETID: 'devadmin',
      LOCAL_AUTH_BYPASS_USER_TYPE: 'admin',
    });
    const bypassMiddleware = (passportRoutes as any).stack[0].handle;
    const devHeaders = { 'x-dev-netid': 'devother', 'x-dev-user-type': 'undergraduate' };

    const loopbackReq = fakeRequest({ ...LOOPBACK_CALLER, headers: devHeaders });
    await bypassMiddleware(loopbackReq, fakeResponse(), vi.fn());
    expect(loopbackReq.user).toMatchObject({ netId: 'devother', userType: 'undergraduate' });

    const remoteReq = fakeRequest({
      remoteAddress: '203.0.113.5',
      host: 'localhost:4000',
      headers: devHeaders,
    });
    await bypassMiddleware(remoteReq, fakeResponse(), vi.fn());
    expect(remoteReq.user).toBeUndefined();
  });

  it('keeps the bypass unavailable in a deployed runtime for a loopback caller', async () => {
    const { isLocalAuthBypassRequestAllowed } = await loadPassportModule({
      ...DEPLOYED_ENV,
      LOCAL_AUTH_BYPASS: 'true',
    });

    expect(isLocalAuthBypassRequestAllowed(fakeRequest(LOOPBACK_CALLER))).toBe(false);
  });

  it('keeps the granted env netid when only the user type header asks for a student', async () => {
    adminGrantServiceMock.hasActiveAdminGrant.mockImplementation(
      async (netid: unknown) => netid === 'devadmin',
    );
    const { passportRoutes } = await loadPassportModule({
      ...LOCAL_DEVELOPMENT_ENV,
      LOCAL_AUTH_BYPASS: 'true',
      LOCAL_AUTH_BYPASS_NETID: 'devadmin',
      LOCAL_AUTH_BYPASS_USER_TYPE: 'admin',
    });
    const bypassMiddleware = (passportRoutes as any).stack[0].handle;

    const req = fakeRequest({
      ...LOOPBACK_CALLER,
      headers: { 'x-dev-user-type': 'undergraduate' },
    });
    await bypassMiddleware(req, fakeResponse(), vi.fn());

    expect(req.user).toMatchObject({ netId: 'devadmin', userType: 'undergraduate' });
  });

  it('resolves a grant-less bypass netid as a non-admin student', async () => {
    adminGrantServiceMock.hasActiveAdminGrant.mockImplementation(
      async (netid: unknown) => netid === 'devadmin',
    );
    const { passportRoutes } = await loadPassportModule({
      ...LOCAL_DEVELOPMENT_ENV,
      LOCAL_AUTH_BYPASS: 'true',
      LOCAL_AUTH_BYPASS_NETID: 'devstudent',
      LOCAL_AUTH_BYPASS_USER_TYPE: 'undergraduate',
    });
    const bypassMiddleware = (passportRoutes as any).stack[0].handle;

    const req = fakeRequest(LOOPBACK_CALLER);
    await bypassMiddleware(req, fakeResponse(), vi.fn());

    expect(req.user).toMatchObject({
      netId: 'devstudent',
      userType: 'undergraduate',
      isAdmin: false,
    });
    expect(adminGrantServiceMock.ensureBootstrapAdminGrant).not.toHaveBeenCalled();
  });

  it('leaves a caller anonymous when the bypass flag is explicitly false', async () => {
    const { passportRoutes } = await loadPassportModule({
      ...LOCAL_DEVELOPMENT_ENV,
      LOCAL_AUTH_BYPASS: 'false',
      LOCAL_AUTH_BYPASS_NETID: 'devadmin',
      LOCAL_AUTH_BYPASS_USER_TYPE: 'admin',
    });
    const bypassMiddleware = (passportRoutes as any).stack[0].handle;

    const req = fakeRequest({
      ...LOOPBACK_CALLER,
      headers: { 'x-dev-netid': 'devadmin', 'x-dev-user-type': 'admin' },
    });
    const next = vi.fn();
    await bypassMiddleware(req, fakeResponse(), next);

    expect(req.user).toBeUndefined();
    expect(next).toHaveBeenCalledWith();
    expect(accountServiceMock.recordAccountLogin).not.toHaveBeenCalled();
    expect(adminGrantServiceMock.ensureBootstrapAdminGrant).not.toHaveBeenCalled();
  });
  it('announces an active bypass at startup only in a local runtime with the flag on', async () => {
    const { localAuthBypassStartupNotice } = await loadPassportModule(LOCAL_DEVELOPMENT_ENV);

    expect(
      localAuthBypassStartupNotice({ ...LOCAL_DEVELOPMENT_ENV, LOCAL_AUTH_BYPASS: 'true' }),
    ).toMatch(/LOCAL_AUTH_BYPASS is on[\s\S]*LOCAL_AUTH_BYPASS=false/);
    expect(
      localAuthBypassStartupNotice({ ...LOCAL_DEVELOPMENT_ENV, LOCAL_AUTH_BYPASS: 'false' }),
    ).toBeNull();
    expect(localAuthBypassStartupNotice({ ...DEPLOYED_ENV, LOCAL_AUTH_BYPASS: 'true' })).toBeNull();
  });

  it('shouts when the bypass is on against the shared Development database and stays quiet when off', async () => {
    const { localAuthBypassStartupNotice } = await loadPassportModule(LOCAL_DEVELOPMENT_ENV);
    const developmentDatabase = {
      ...LOCAL_DEVELOPMENT_ENV,
      MONGODBURL: 'mongodb+srv://synthetic-cluster.example.invalid/Development',
    };

    const developmentNotice = localAuthBypassStartupNotice({
      ...developmentDatabase,
      LOCAL_AUTH_BYPASS: 'true',
    });
    expect(developmentNotice).toMatch(
      /LOCAL_AUTH_BYPASS IS ON AGAINST THE SHARED DEVELOPMENT DATABASE[\s\S]*no read from this server is an anonymous served check/,
    );
    expect(developmentNotice).toContain('yarn served-check');
    expect(developmentNotice).not.toContain('synthetic-cluster');

    expect(
      localAuthBypassStartupNotice({
        ...LOCAL_DEVELOPMENT_ENV,
        MONGODBURL: 'mongodb+srv://synthetic-cluster.example.invalid/Unlabelled',
        LOCAL_AUTH_BYPASS: 'true',
      }),
    ).toMatch(/LOCAL_AUTH_BYPASS IS ON AGAINST A DATABASE THAT IS NOT ON THIS MACHINE/);

    const localNotice = localAuthBypassStartupNotice({
      ...LOCAL_DEVELOPMENT_ENV,
      MONGODBURL: 'mongodb://127.0.0.1:27017/ylabs_local',
      LOCAL_AUTH_BYPASS: 'true',
    });
    expect(localNotice).toMatch(/LOCAL_AUTH_BYPASS is on/);
    expect(localNotice).not.toMatch(/IS ON AGAINST/);

    expect(
      localAuthBypassStartupNotice({ ...developmentDatabase, LOCAL_AUTH_BYPASS: 'false' }),
    ).toBeNull();
    expect(localAuthBypassStartupNotice({ ...developmentDatabase })).toBeNull();
  });
});
