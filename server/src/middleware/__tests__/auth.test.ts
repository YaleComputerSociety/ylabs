import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAdmin, isAuthenticated } from '../auth';
import { hasActiveAdminGrant } from '../../services/adminGrantService';

vi.mock('../../services/adminGrantService', () => ({
  hasActiveAdminGrant: vi.fn(),
}));

const mockedHasActiveAdminGrant = vi.mocked(hasActiveAdminGrant);

const makeRes = () => ({
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
});

const invokeIsAdmin = async (user: unknown) => {
  const req = { user };
  const res = makeRes();
  const next = vi.fn();

  await isAdmin(req as any, res as any, next);

  return { res, next };
};

const invokeSyncMiddleware = (
  middleware: (req: any, res: any, next: any) => unknown,
  user: unknown,
) => {
  const req = { user };
  const res = makeRes();
  const next = vi.fn();

  middleware(req, res, next);

  return { res, next };
};

describe('isAdmin', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('allows an authenticated user with an active admin grant', async () => {
    mockedHasActiveAdminGrant.mockResolvedValue(true);

    const { res, next } = await invokeIsAdmin({ netId: 'abc123', userType: 'student' });

    expect(mockedHasActiveAdminGrant).toHaveBeenCalledWith('abc123');
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });

  it('denies an authenticated user without an active admin grant regardless of userType', async () => {
    mockedHasActiveAdminGrant.mockResolvedValue(false);

    const { res, next } = await invokeIsAdmin({ netId: 'legacy1', userType: 'admin' });

    expect(mockedHasActiveAdminGrant).toHaveBeenCalledWith('legacy1');
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'Admin privileges required' });
  });

  it('rejects malformed admin principal shapes before grant lookup', async () => {
    mockedHasActiveAdminGrant.mockResolvedValue(true);

    const { res, next } = await invokeIsAdmin({
      netId: { toString: () => 'admin1' },
      userType: 'admin',
    });

    expect(mockedHasActiveAdminGrant).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized', code: 'AUTH_REQUIRED' });
  });
});

describe('isAuthenticated', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('rejects truthy malformed req.user objects before route work', () => {
    const { res, next } = invokeSyncMiddleware(isAuthenticated, {
      netId: { toString: () => 'admin1' },
      userType: 'admin',
    });

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized', code: 'AUTH_REQUIRED' });
  });

  it('allows a valid bounded NetID principal', () => {
    const { res, next } = invokeSyncMiddleware(isAuthenticated, { netId: 'abc123' });

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });
});
