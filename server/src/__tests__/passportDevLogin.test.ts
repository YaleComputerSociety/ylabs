import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildDevLoginUser, safeRedirectTarget, upsertDevLoginUser } from '../passport';
import { createUser, updateUser, validateUser } from '../services/userService';

vi.mock('../services/userService', () => ({
  createUser: vi.fn(),
  updateUser: vi.fn(),
  validateUser: vi.fn(),
}));

const originalNodeEnv = process.env.NODE_ENV;
const originalServerBaseUrl = process.env.SERVER_BASE_URL;
const originalClientBaseUrl = process.env.CLIENT_BASE_URL;
const mockedCreateUser = vi.mocked(createUser);
const mockedUpdateUser = vi.mocked(updateUser);
const mockedValidateUser = vi.mocked(validateUser);

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
  process.env.SERVER_BASE_URL = originalServerBaseUrl;
  process.env.CLIENT_BASE_URL = originalClientBaseUrl;
  vi.restoreAllMocks();
  mockedCreateUser.mockReset();
  mockedUpdateUser.mockReset();
  mockedValidateUser.mockReset();
});

describe('passport development login helpers', () => {
  it('allows local client redirects during development', () => {
    process.env.NODE_ENV = 'development';
    process.env.SERVER_BASE_URL = 'http://localhost:4000';
    delete process.env.CLIENT_BASE_URL;

    expect(safeRedirectTarget('http://localhost:3000/analytics')).toBe(
      'http://localhost:3000/analytics',
    );
  });

  it('builds an admin dev-login session when requested', () => {
    const user = buildDevLoginUser({ netid: 'admin123', userType: 'admin' });

    expect(user).toMatchObject({
      netId: 'admin123',
      userType: 'admin',
      userConfirmed: true,
      profileVerified: true,
    });
  });

  it('refuses to overwrite an existing real user as a dev admin', async () => {
    mockedValidateUser.mockResolvedValue({
      netid: 'fixture-real-user',
      userType: 'undergraduate',
      email: 'fixture-real-user@example.invalid',
      fname: 'Fixture',
      lname: 'Person',
    } as any);

    await expect(
      upsertDevLoginUser(buildDevLoginUser({ netid: 'fixture-real-user', userType: 'admin' })),
    ).rejects.toThrow(/Refusing to overwrite/);

    expect(mockedUpdateUser).not.toHaveBeenCalled();
    expect(mockedCreateUser).not.toHaveBeenCalled();
  });
});
