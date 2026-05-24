import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

import { applyLocalAuthBypass } from '../auth';

const originalNodeEnv = process.env.NODE_ENV;
const originalLocalAuthBypass = process.env.LOCAL_AUTH_BYPASS;

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
  process.env.LOCAL_AUTH_BYPASS = originalLocalAuthBypass;
  vi.restoreAllMocks();
});

function makeResponse() {
  return {
    locals: {},
  } as Response;
}

describe('applyLocalAuthBypass', () => {
  it('injects a default dev admin user in enabled development requests', () => {
    process.env.NODE_ENV = 'development';
    process.env.LOCAL_AUTH_BYPASS = 'true';

    const req = {
      path: '/users/savedPrograms',
      user: undefined,
      header: vi.fn(() => undefined),
    } as unknown as Request;
    const next = vi.fn();

    applyLocalAuthBypass(req, makeResponse(), next);

    expect(req.user).toMatchObject({
      netId: 'devadmin',
      userType: 'admin',
      userConfirmed: true,
      profileVerified: true,
    });
    expect(next).toHaveBeenCalledOnce();
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
  });
});
