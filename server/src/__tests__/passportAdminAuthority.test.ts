import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  validateAccount: vi.fn(),
  hasActiveAdminGrant: vi.fn(),
}));

vi.mock('../services/accountService', () => ({
  validateAccount: mocks.validateAccount,
  recordAccountLogin: vi.fn(),
}));

vi.mock('../services/yaliesService', () => ({
  classifyYalieByNetid: vi.fn(),
}));

vi.mock('../services/directoryService', () => ({
  fetchFromDirectory: vi.fn(),
  isFacultyTitle: vi.fn(() => false),
}));

vi.mock('../services/analyticsService', () => ({
  logEvent: vi.fn(),
}));

vi.mock('../services/adminGrantService', () => ({
  hasActiveAdminGrant: mocks.hasActiveAdminGrant,
  ensureBootstrapAdminGrant: vi.fn(),
}));

import passport from '../passport';

const deserialize = async (principal: Record<string, unknown>) => {
  const deserializer = (passport as any)._deserializers[0];

  return new Promise<{ error: unknown; user: any }>((resolve) => {
    deserializer(principal, (error: unknown, user: any) => resolve({ error, user }));
  });
};

describe('passport admin authority', () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.SSOBASEURL;
    delete process.env.SERVER_BASE_URL;
    process.env.NODE_ENV = 'test';
  });

  it('flags grant-backed users as admin while preserving their classification', async () => {
    mocks.validateAccount.mockResolvedValue({
      _id: 'acc-abc123',
      netid: 'abc123',
      email: 'abc123@yale.edu',
      status: 'ACTIVE',
      archived: false,
    });
    mocks.hasActiveAdminGrant.mockResolvedValue(true);

    const { error, user } = await deserialize({
      netId: 'abc123',
      userType: 'student',
      userConfirmed: true,
      profileVerified: false,
    });

    expect(error).toBeNull();
    expect(mocks.validateAccount).toHaveBeenCalledWith('abc123');
    expect(mocks.hasActiveAdminGrant).toHaveBeenCalledWith('abc123');
    expect(user).toMatchObject({
      netId: 'abc123',
      userType: 'student',
      userConfirmed: true,
      profileVerified: false,
      isAdmin: true,
    });
  });

  it('does not flag a user as admin without an active grant', async () => {
    mocks.validateAccount.mockResolvedValue({
      _id: 'acc-legacy1',
      netid: 'legacy1',
      email: 'legacy1@yale.edu',
      status: 'ACTIVE',
      archived: false,
    });
    mocks.hasActiveAdminGrant.mockResolvedValue(false);

    const { error, user } = await deserialize({
      netId: 'legacy1',
      userType: 'admin',
      userConfirmed: true,
      profileVerified: true,
    });

    expect(error).toBeNull();
    expect(mocks.hasActiveAdminGrant).toHaveBeenCalledWith('legacy1');
    expect(user).toMatchObject({
      netId: 'legacy1',
      userType: 'unknown',
      userConfirmed: true,
      profileVerified: true,
      isAdmin: false,
    });
  });
});
