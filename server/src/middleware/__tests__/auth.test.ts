import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

import { applyLocalAuthBypass } from '../auth';
import { isAdminNetid } from '../../services/adminAccessService';
import { createUser, updateUser, validateUser } from '../../services/userService';

vi.mock('../../services/adminAccessService', () => ({
  isAdminNetid: vi.fn(),
}));

vi.mock('../../services/userService', () => ({
  createUser: vi.fn(),
  updateUser: vi.fn(),
  validateUser: vi.fn(),
}));

const originalNodeEnv = process.env.NODE_ENV;
const originalLocalAuthBypass = process.env.LOCAL_AUTH_BYPASS;
const mockedCreateUser = vi.mocked(createUser);
const mockedIsAdminNetid = vi.mocked(isAdminNetid);
const mockedUpdateUser = vi.mocked(updateUser);
const mockedValidateUser = vi.mocked(validateUser);

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
  process.env.LOCAL_AUTH_BYPASS = originalLocalAuthBypass;
  vi.restoreAllMocks();
  mockedCreateUser.mockReset();
  mockedIsAdminNetid.mockReset();
  mockedUpdateUser.mockReset();
  mockedValidateUser.mockReset();
});

function makeResponse() {
  return {
    locals: {},
  } as Response;
}

describe('applyLocalAuthBypass', () => {
  it('injects and creates a default dev admin user in enabled development requests', async () => {
    process.env.NODE_ENV = 'development';
    process.env.LOCAL_AUTH_BYPASS = 'true';
    mockedValidateUser.mockResolvedValue(null);
    mockedCreateUser.mockResolvedValue({ netid: 'devadmin' } as any);

    const req = {
      path: '/users/savedPrograms',
      user: undefined,
      header: vi.fn(() => undefined),
    } as unknown as Request;
    const next = vi.fn();

    applyLocalAuthBypass(req, makeResponse(), next);

    await vi.waitFor(() => expect(next).toHaveBeenCalledOnce());
    expect(req.user).toMatchObject({
      netId: 'devadmin',
      userType: 'admin',
      userConfirmed: true,
      profileVerified: true,
    });
    expect(mockedValidateUser).toHaveBeenCalledWith('devadmin');
    expect(mockedCreateUser).toHaveBeenCalledWith({
      netid: 'devadmin',
      fname: 'Dev',
      lname: 'Admin',
      email: 'devadmin@example.test',
      userType: 'admin',
      userConfirmed: true,
      profileVerified: true,
    });
  });

  it('updates an existing local bypass user to match the requested role', async () => {
    process.env.NODE_ENV = 'development';
    process.env.LOCAL_AUTH_BYPASS = 'true';
    mockedValidateUser.mockResolvedValue({
      netid: 'test123',
      userType: 'undergraduate',
      email: 'test123@example.test',
      fname: 'Dev',
    } as any);
    mockedUpdateUser.mockResolvedValue({ netid: 'test123', userType: 'faculty' } as any);

    const req = {
      path: '/users/savedPrograms',
      user: undefined,
      header: vi.fn((name: string) => {
        if (name === 'x-dev-user-type') return 'faculty';
        if (name === 'x-dev-netid') return 'test123';
        return undefined;
      }),
    } as unknown as Request;
    const next = vi.fn();

    applyLocalAuthBypass(req, makeResponse(), next);

    await vi.waitFor(() => expect(next).toHaveBeenCalledOnce());
    expect(req.user).toMatchObject({ netId: 'test123', userType: 'faculty' });
    expect(mockedUpdateUser).toHaveBeenCalledWith('test123', {
      netid: 'test123',
      fname: 'Dev',
      lname: 'User',
      email: 'test123@example.test',
      userType: 'faculty',
      userConfirmed: true,
      profileVerified: true,
    });
  });

  it('refuses to overwrite an existing real user as a dev admin', async () => {
    process.env.NODE_ENV = 'development';
    process.env.LOCAL_AUTH_BYPASS = 'true';
    mockedValidateUser.mockResolvedValue({
      netid: 'fixture-real-user',
      userType: 'undergraduate',
      email: 'fixture-real-user@example.invalid',
      fname: 'Fixture',
      lname: 'Person',
    } as any);

    const req = {
      path: '/users/savedPrograms',
      user: undefined,
      header: vi.fn((name: string) => {
        if (name === 'x-dev-user-type') return 'admin';
        if (name === 'x-dev-netid') return 'fixture-real-user';
        return undefined;
      }),
    } as unknown as Request;
    const next = vi.fn();

    applyLocalAuthBypass(req, makeResponse(), next);

    await vi.waitFor(() => expect(next).toHaveBeenCalledOnce());
    expect(req.user).toBeUndefined();
    expect(mockedUpdateUser).not.toHaveBeenCalled();
    expect(next.mock.calls[0][0]).toBeInstanceOf(Error);
    expect((next.mock.calls[0][0] as Error).message).toMatch(/Refusing to overwrite/);
  });

  it('does not bypass CAS routes so real CAS remains testable', () => {
    process.env.NODE_ENV = 'development';
    process.env.LOCAL_AUTH_BYPASS = 'true';

    const req = {
      path: '/cas',
      user: undefined,
      header: vi.fn(() => undefined),
    } as unknown as Request;
    const next = vi.fn();

    applyLocalAuthBypass(req, makeResponse(), next);

    expect(req.user).toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
    expect(mockedValidateUser).not.toHaveBeenCalled();
  });

  it('stays disabled in production even if the bypass flag is present', () => {
    process.env.NODE_ENV = 'production';
    process.env.LOCAL_AUTH_BYPASS = 'true';

    const req = {
      path: '/users/savedPrograms',
      user: undefined,
      header: vi.fn(() => undefined),
    } as unknown as Request;
    const next = vi.fn();

    applyLocalAuthBypass(req, makeResponse(), next);

    expect(req.user).toBeUndefined();
    expect(next).toHaveBeenCalledOnce();
    expect(mockedValidateUser).not.toHaveBeenCalled();
  });
});

describe('isAdmin', () => {
  const makeJson = vi.fn();
  const makeStatus = vi.fn(() => ({ json: makeJson }));

  const makeResponseWithStatus = () =>
    ({
      status: makeStatus,
    }) as unknown as Response;

  afterEach(() => {
    makeJson.mockClear();
    makeStatus.mockClear();
  });

  it('allows users with an active admin grant regardless of profile userType', async () => {
    const { isAdmin } = await import('../auth');
    mockedIsAdminNetid.mockResolvedValue(true);
    const next = vi.fn();

    isAdmin(
      { user: { netId: 'fixture-admin', userType: 'undergraduate' } } as unknown as Request,
      makeResponseWithStatus(),
      next,
    );

    await vi.waitFor(() => expect(next).toHaveBeenCalledOnce());
    expect(mockedIsAdminNetid).toHaveBeenCalledWith('fixture-admin');
    expect(makeStatus).not.toHaveBeenCalled();
  });

  it('rejects legacy admin userType when no active grant exists', async () => {
    const { isAdmin } = await import('../auth');
    mockedIsAdminNetid.mockResolvedValue(false);
    const next = vi.fn();

    isAdmin(
      { user: { netId: 'fixture-legacy-admin', userType: 'admin' } } as unknown as Request,
      makeResponseWithStatus(),
      next,
    );

    await vi.waitFor(() => expect(makeStatus).toHaveBeenCalledWith(403));
    expect(next).not.toHaveBeenCalled();
    expect(makeJson).toHaveBeenCalledWith({ error: 'Admin privileges required' });
  });
});
