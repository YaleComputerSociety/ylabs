import { afterEach, describe, expect, it } from 'vitest';

import { buildDevLoginUser, safeRedirectTarget } from '../passport';

const originalNodeEnv = process.env.NODE_ENV;
const originalServerBaseUrl = process.env.SERVER_BASE_URL;
const originalClientBaseUrl = process.env.CLIENT_BASE_URL;

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
  process.env.SERVER_BASE_URL = originalServerBaseUrl;
  process.env.CLIENT_BASE_URL = originalClientBaseUrl;
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
});
