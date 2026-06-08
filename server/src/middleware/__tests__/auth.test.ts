import { afterEach, describe, expect, it, vi } from 'vitest';
import { canCreateListing, isAdmin, isProfessor } from '../auth';
import { hasActiveAdminGrant } from '../../services/adminGrantService';

vi.mock('../../services/adminGrantService', () => ({
  hasActiveAdminGrant: vi.fn(),
  allowsLegacyAdminUserType: vi.fn(
    () =>
      process.env.NODE_ENV === 'development' &&
      process.env.SERVER_BASE_URL === 'http://localhost:4000',
  ),
}));

const mockedHasActiveAdminGrant = vi.mocked(hasActiveAdminGrant);

const invokeIsAdmin = async (user: unknown) => {
  const req = { user };
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
  const next = vi.fn();

  await isAdmin(req as any, res as any, next);

  return { res, next };
};

const invokeSyncMiddleware = (middleware: (req: any, res: any, next: any) => unknown, user: unknown) => {
  const req = { user };
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
  const next = vi.fn();

  middleware(req, res, next);

  return { res, next };
};

describe('isAdmin', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.SERVER_BASE_URL;
    process.env.NODE_ENV = 'test';
  });

  it('allows an authenticated user with an active admin grant', async () => {
    mockedHasActiveAdminGrant.mockResolvedValue(true);

    const { res, next } = await invokeIsAdmin({ netId: 'abc123', userType: 'student' });

    expect(mockedHasActiveAdminGrant).toHaveBeenCalledWith('abc123');
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });

  it('does not treat legacy admin userType as production admin authority', async () => {
    process.env.NODE_ENV = 'production';
    process.env.SERVER_BASE_URL = 'https://yalelabs.io';
    mockedHasActiveAdminGrant.mockResolvedValue(false);

    const { res, next } = await invokeIsAdmin({ netId: 'legacy1', userType: 'admin' });

    expect(mockedHasActiveAdminGrant).toHaveBeenCalledWith('legacy1');
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'Admin privileges required' });
  });

  it('keeps local development admin bypasses usable without a persisted grant', async () => {
    process.env.NODE_ENV = 'development';
    process.env.SERVER_BASE_URL = 'http://localhost:4000';
    mockedHasActiveAdminGrant.mockResolvedValue(false);

    const { next } = await invokeIsAdmin({ netId: 'devadmin', userType: 'admin' });

    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('professor/faculty authority', () => {
  it('does not let unconfirmed professor rows pass professor-only route guards', () => {
    const { res, next } = invokeSyncMiddleware(isProfessor, {
      netId: 'prof1',
      userType: 'professor',
      userConfirmed: false,
    });

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'Professor privileges required' });
  });

  it('does not let unconfirmed faculty create listings even after profile verification', () => {
    const { res, next } = invokeSyncMiddleware(canCreateListing, {
      netId: 'prof1',
      userType: 'professor',
      userConfirmed: false,
      profileVerified: true,
    });

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'Account must be confirmed before creating listings' });
  });
});
