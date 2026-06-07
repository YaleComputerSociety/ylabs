import dns from 'dns/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  grantAdminAccess: vi.fn(),
  revokeAdminAccess: vi.fn(),
  getListingModel: vi.fn(),
  userFind: vi.fn(),
  fellowshipFind: vi.fn(),
  listAccessReviewEntities: vi.fn(),
}));

vi.mock('../../services/adminGrantService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/adminGrantService')>()),
  grantAdminAccess: mocks.grantAdminAccess,
  revokeAdminAccess: mocks.revokeAdminAccess,
}));

vi.mock('../../services/adminAccessReviewService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/adminAccessReviewService')>()),
  listAccessReviewEntities: mocks.listAccessReviewEntities,
}));

vi.mock('../../db/connections', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../db/connections')>()),
  getListingModel: mocks.getListingModel,
}));

vi.mock('../../models/user', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../models/user')>()),
  User: {
    find: mocks.userFind,
    countDocuments: vi.fn(),
    findOne: vi.fn(),
  },
}));

vi.mock('../../models/fellowship', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../models/fellowship')>()),
  Fellowship: {
    find: mocks.fellowshipFind,
    countDocuments: vi.fn(),
  },
}));

import router, {
  checkAdminUrlReachability,
  isPrivateAddress,
  isPublicHostname,
  MAX_ADMIN_URL_CHECK_URLS,
  normalizeAdminPagination,
  resolveAdminSortField,
  ssrfSafeLookup,
} from '../admin';

const routeByPath = (path: string) =>
  (router as any).stack.map((layer: any) => layer.route).find((route: any) => route?.path === path);

const routeByPathAndMethod = (path: string, method: string) =>
  (router as any).stack
    .map((layer: any) => layer.route)
    .find((route: any) => route?.path === path && route.methods?.[method]);

const middlewareNames = () =>
  (router as any).stack
    .filter((layer: any) => !layer.route)
    .map((layer: any) => layer.handle?.name)
    .filter(Boolean);

const invokeMiddleware = async (name: string) => {
  const layer = (router as any).stack.find(
    (candidate: any) => !candidate.route && candidate.handle?.name === name,
  );
  expect(layer).toBeTruthy();

  const res = {
    setHeader: vi.fn(),
  } as any;
  const next = vi.fn();

  await layer.handle({} as any, res, next);
  return { res, next };
};

const invokeRouteHandler = async (path: string, req: Record<string, any>, method = 'post') => {
  const route = routeByPathAndMethod(path, method) || routeByPath(path);
  const stack = route?.stack || [];
  const handler = stack[stack.length - 1]?.handle;
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };

  await handler(req, res);
  return res;
};

const invokeSafeLookup = (hostname: string) =>
  new Promise<{ error: NodeJS.ErrnoException | null; address?: string; family?: number }>((resolve) => {
    (ssrfSafeLookup as any)(
      hostname,
      {},
      (error: NodeJS.ErrnoException | null, address?: string, family?: number) =>
        resolve({ error, address, family }),
    );
  });

describe('admin routes', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the operator board behind the admin router guards', () => {
    const guardNames = middlewareNames();

    expect(guardNames).toEqual(expect.arrayContaining(['isAuthenticated', 'isAdmin']));
    expect(routeByPath('/operator-board')).toBeTruthy();
    expect(routeByPath('/release-queue')).toBeTruthy();
  });

  it('marks admin responses as private no-store payloads', async () => {
    expect(middlewareNames()).toContain('setPrivateAdminCacheHeaders');

    const { res, next } = await invokeMiddleware('setPrivateAdminCacheHeaders');

    expect(res.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'no-store, private, max-age=0',
    );
    expect(res.setHeader).toHaveBeenCalledWith('Pragma', 'no-cache');
    expect(next).toHaveBeenCalledOnce();
  });

  it('exposes admin grant management routes for the analytics admin access section', () => {
    expect(routeByPath('/admin-grants')).toBeTruthy();
    expect(routeByPath('/admin-grants/:netid/revoke')).toBeTruthy();
  });

  it('does not leak internal messages from admin grant failures', async () => {
    mocks.grantAdminAccess.mockRejectedValue(
      new Error('mongodb://user:pass@example.invalid admin grant failed'),
    );

    const res = await invokeRouteHandler('/admin-grants', {
      user: { netId: 'admin123' },
      body: { netid: 'target123' },
    });

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to grant admin access' });
  });

  it('does not leak raw validation text from admin grant failures', async () => {
    mocks.grantAdminAccess.mockRejectedValue(
      new Error('Invalid netid mongodb://user:pass@example.invalid leaked'),
    );

    const res = await invokeRouteHandler('/admin-grants', {
      user: { netId: 'admin123' },
      body: { netid: 'target123' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid admin grant request' });
  });

  it('does not leak internal messages from admin grant revoke failures', async () => {
    mocks.revokeAdminAccess.mockRejectedValue(
      new Error('mongodb://user:pass@example.invalid admin revoke failed'),
    );

    const res = await invokeRouteHandler('/admin-grants/:netid/revoke', {
      user: { netId: 'admin123' },
      params: { netid: 'target123' },
      body: {},
    });

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to revoke admin access' });
  });

  it('bounds URL checker fan-out before doing outbound work', async () => {
    const res = await invokeRouteHandler('/check-urls', {
      body: { urls: Array.from({ length: MAX_ADMIN_URL_CHECK_URLS + 1 }, (_, i) => `example${i}.com`) },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      error: `At most ${MAX_ADMIN_URL_CHECK_URLS} URLs can be checked at once`,
    });
  });

  it('rejects malformed URL checker batches before doing outbound work', async () => {
    const res = await invokeRouteHandler('/check-urls', {
      body: { urls: ['https://example.com', 42] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Each URL must be a string' });
  });

  it('allowlists admin sort fields before building Mongo sort objects', () => {
    const allowed = new Set(['createdAt', 'title', 'descriptionLength', 'redFlags']);

    expect(resolveAdminSortField('title', allowed, 'createdAt')).toBe('title');
    expect(resolveAdminSortField('descriptionLength', allowed, 'createdAt')).toBe(
      'descriptionLength',
    );
    expect(resolveAdminSortField('$where', allowed, 'createdAt')).toBe('createdAt');
    expect(resolveAdminSortField('__proto__', allowed, 'createdAt')).toBe('createdAt');
    expect(resolveAdminSortField('embedding', allowed, 'createdAt')).toBe('createdAt');
    expect(resolveAdminSortField(['title'], allowed, 'createdAt')).toBe('createdAt');
  });

  it('caps admin list pagination before building Mongo skip and limit values', () => {
    expect(normalizeAdminPagination('999999999', '500')).toEqual({
      page: 1000,
      pageSize: 100,
    });
    expect(normalizeAdminPagination('-20', 'not-a-number')).toEqual({
      page: 1,
      pageSize: 25,
    });
  });

  it('rejects oversized admin search terms before model lookup', async () => {
    for (const path of ['/listings', '/profiles', '/fellowships']) {
      const res = await invokeRouteHandler(
        path,
        {
          query: { search: 'a'.repeat(121) },
        },
        'get',
      );

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ error: 'Search query is too long' });
    }

    expect(mocks.getListingModel).not.toHaveBeenCalled();
    expect(mocks.userFind).not.toHaveBeenCalled();
    expect(mocks.fellowshipFind).not.toHaveBeenCalled();
  });

  it('returns a client error for oversized access-review search terms', async () => {
    mocks.listAccessReviewEntities.mockRejectedValue(new Error('Search query is too long'));

    const res = await invokeRouteHandler(
      '/access-review',
      {
        query: { search: 'a'.repeat(121) },
      },
      'get',
    );

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Search query is too long' });
  });

  it('classifies private and special-use addresses as blocked', () => {
    for (const address of [
      '0.0.0.0',
      '10.1.2.3',
      '100.64.0.1',
      '127.0.0.1',
      '169.254.169.254',
      '172.16.0.1',
      '192.168.0.1',
      '198.18.0.1',
      '224.0.0.1',
      '::',
      '::1',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      '[::ffff:7f00:1]',
      '64:ff9b::127.0.0.1',
      'fc00::1',
      'fe80::1',
      'ff00::1',
    ]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }

    expect(isPrivateAddress('8.8.8.8')).toBe(false);
    expect(isPrivateAddress('2606:4700:4700::1111')).toBe(false);
  });

  it('rejects hostnames when any DNS answer is private', async () => {
    vi.spyOn(dns, 'lookup').mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ] as any);

    await expect(isPublicHostname('rebind.example')).resolves.toBe(false);
  });

  it('allows hostnames only when every DNS answer is public', async () => {
    vi.spyOn(dns, 'lookup').mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '2606:4700:4700::1111', family: 6 },
    ] as any);

    await expect(isPublicHostname('public.example')).resolves.toBe(true);
  });

  it('blocks private DNS answers during the actual outbound connection lookup', async () => {
    vi.spyOn(dns, 'lookup').mockResolvedValue({ address: '169.254.169.254', family: 4 } as any);

    const result = await invokeSafeLookup('rebind.example');

    expect(result.error?.code).toBe('EHOSTUNREACH');
  });

  it('rejects admin URL checks for non-public hosts and unsafe URL forms before connect', async () => {
    await expect(checkAdminUrlReachability('http://169.254.169.254/latest/meta-data')).resolves.toEqual({
      url: 'http://169.254.169.254/latest/meta-data',
      status: 0,
      reachable: false,
      error: 'Blocked host',
    });

    await expect(checkAdminUrlReachability('http://[::ffff:127.0.0.1]')).resolves.toEqual({
      url: 'http://[::ffff:127.0.0.1]',
      status: 0,
      reachable: false,
      error: 'Blocked host',
    });

    await expect(checkAdminUrlReachability('https://example.com:8443')).resolves.toEqual({
      url: 'https://example.com:8443',
      status: 0,
      reachable: false,
      error: 'Unsupported port',
    });

    await expect(checkAdminUrlReachability('https://user:pass@example.com/private')).resolves.toEqual({
      url: 'https://example.com/private',
      status: 0,
      reachable: false,
      error: 'Credentials not supported',
    });
  });
});
