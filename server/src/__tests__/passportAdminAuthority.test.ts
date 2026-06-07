import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  validateUser: vi.fn(),
  hasActiveAdminGrant: vi.fn(),
}));

vi.mock('../services/userService', () => ({
  validateUser: mocks.validateUser,
  createUser: vi.fn(),
  updateUser: vi.fn(),
}));

vi.mock('../services/yaliesService', () => ({
  fetchYalie: vi.fn(),
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
  allowsLegacyAdminUserType: vi.fn(
    () =>
      process.env.NODE_ENV === 'development' &&
      process.env.SERVER_BASE_URL === 'http://localhost:4000',
  ),
}));

import passport from '../passport';

const deserialize = async (netId: string) => {
  const deserializer = (passport as any)._deserializers[0];

  return new Promise<{ error: unknown; user: any }>((resolve) => {
    deserializer(netId, (error: unknown, user: any) => resolve({ error, user }));
  });
};

describe('passport admin authority', () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.SSOBASEURL;
    delete process.env.SERVER_BASE_URL;
    process.env.NODE_ENV = 'test';
  });

  it('exposes grant-backed admins to authenticated clients as admin users', async () => {
    mocks.validateUser.mockResolvedValue({
      netid: 'abc123',
      userType: 'student',
      userConfirmed: true,
      profileVerified: false,
    });
    mocks.hasActiveAdminGrant.mockResolvedValue(true);

    const { error, user } = await deserialize('abc123');

    expect(error).toBeNull();
    expect(mocks.hasActiveAdminGrant).toHaveBeenCalledWith('abc123');
    expect(user).toMatchObject({
      netId: 'abc123',
      userType: 'admin',
      userConfirmed: true,
      profileVerified: false,
    });
  });

  it('does not expose legacy admin rows as production admins without an active grant', async () => {
    process.env.NODE_ENV = 'production';
    process.env.SSOBASEURL = 'https://secure.its.yale.edu/cas';
    process.env.SERVER_BASE_URL = 'https://yalelabs.io';
    mocks.validateUser.mockResolvedValue({
      netid: 'legacy1',
      userType: 'admin',
      userConfirmed: true,
      profileVerified: true,
    });
    mocks.hasActiveAdminGrant.mockResolvedValue(false);

    const { error, user } = await deserialize('legacy1');

    expect(error).toBeNull();
    expect(mocks.hasActiveAdminGrant).toHaveBeenCalledWith('legacy1');
    expect(user).toMatchObject({
      netId: 'legacy1',
      userType: 'unknown',
      userConfirmed: true,
      profileVerified: true,
    });
  });
});
