import { describe, expect, it } from 'vitest';

import { sessionCookieName } from '../sessionCookie';

describe('sessionCookieName', () => {
  it('uses a __Host-prefixed cookie name in deployed runtimes', () => {
    expect(
      sessionCookieName({
        NODE_ENV: 'production',
        SERVER_BASE_URL: 'https://yalelabs.io',
      }),
    ).toBe('__Host-session');
  });

  it('keeps the legacy cookie name only for true local development', () => {
    expect(
      sessionCookieName({
        NODE_ENV: 'development',
        SERVER_BASE_URL: 'http://localhost:4000',
      }),
    ).toBe('session');
  });
});
