import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Request } from 'express';

import { captureServerError, captureStartupError, initializeErrorTracking } from '../errorTracking';
import * as Sentry from '@sentry/node';

vi.mock('@sentry/node', () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  flush: vi.fn(),
}));

const SYNTHETIC_NETID = 'zz9993';

const netidBearingRequest = (): Request =>
  ({
    method: 'POST',
    path: `/api/admin/admin-grants/${SYNTHETIC_NETID}/revoke`,
    originalUrl: `/api/admin/admin-grants/${SYNTHETIC_NETID}/revoke`,
    baseUrl: '/api/admin',
    route: { path: '/admin-grants/:netid/revoke' },
    params: { netid: SYNTHETIC_NETID },
    user: { netId: SYNTHETIC_NETID, userType: 'student', isAdmin: true },
  }) as unknown as Request;

const capturedPayload = (): Record<string, unknown> | undefined => {
  const [call] = vi.mocked(Sentry.captureException).mock.calls;
  return call?.[1] as Record<string, unknown> | undefined;
};

describe('server errorTracking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SENTRY_DSN;
  });

  it('does not initialize without a DSN', () => {
    expect(initializeErrorTracking({ environment: 'test' })).toBe(false);
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('passes configurable environment and release tags to Sentry', () => {
    expect(
      initializeErrorTracking({
        dsn: 'https://public@example.com/1',
        environment: 'production',
        release: 'abc123',
      }),
    ).toBe(true);

    expect(Sentry.init).toHaveBeenCalledWith({
      dsn: 'https://public@example.com/1',
      environment: 'production',
      release: 'abc123',
    });
  });

  it('captures request context without raw query strings', () => {
    process.env.SENTRY_DSN = 'https://public@example.com/1';

    const error = new Error('boom');
    const req = {
      method: 'GET',
      path: '/api/research',
      originalUrl: '/api/research?query=private-search',
      baseUrl: '/api/research',
      route: { path: '/' },
      user: { netId: SYNTHETIC_NETID, userType: 'student' },
    } as unknown as Request;

    captureServerError(error, req);

    expect(Sentry.captureException).toHaveBeenCalledWith(error, {
      tags: {
        method: 'GET',
        path: '/api/research',
        authenticated: 'true',
        userType: 'student',
      },
      contexts: {
        request: {
          path: '/api/research',
          method: 'GET',
        },
      },
    });
  });

  it('sends no netid to the error-reporting provider, as identity or as a path segment', () => {
    process.env.SENTRY_DSN = 'https://public@example.com/1';

    captureServerError(new Error('boom'), netidBearingRequest());

    const payload = capturedPayload();
    expect(payload).toBeTruthy();
    expect(JSON.stringify(payload)).not.toContain(SYNTHETIC_NETID);
  });

  it('sends no user identity at all, because no non-reversible account handle exists', () => {
    process.env.SENTRY_DSN = 'https://public@example.com/1';

    captureServerError(new Error('boom'), netidBearingRequest());

    expect(capturedPayload()).not.toHaveProperty('user');
  });

  it('keeps reports triageable with the route template and a non-identifying principal class', () => {
    process.env.SENTRY_DSN = 'https://public@example.com/1';

    captureServerError(new Error('boom'), netidBearingRequest());

    expect(capturedPayload()).toMatchObject({
      tags: {
        method: 'POST',
        path: '/api/admin/admin-grants/:netid/revoke',
        authenticated: 'true',
        userType: 'student',
      },
      contexts: { request: { path: '/api/admin/admin-grants/:netid/revoke' } },
    });
  });

  it('reports an unmatched request without quoting its path', () => {
    process.env.SENTRY_DSN = 'https://public@example.com/1';

    captureServerError(new Error('boom'), {
      method: 'POST',
      path: `/api/admin/admin-grants/${SYNTHETIC_NETID}/revoke`,
      baseUrl: '',
      user: undefined,
    } as unknown as Request);

    expect(capturedPayload()).toMatchObject({
      tags: {
        path: 'unmatched',
        authenticated: 'false',
        userType: 'unknown',
      },
    });
    expect(JSON.stringify(capturedPayload())).not.toContain(SYNTHETIC_NETID);
  });

  it('captures and flushes startup errors', async () => {
    process.env.SENTRY_DSN = 'https://public@example.com/1';
    vi.mocked(Sentry.flush).mockResolvedValue(true);

    const error = new Error('startup failed');

    await captureStartupError(error);

    expect(Sentry.captureException).toHaveBeenCalledWith(error);
    expect(Sentry.flush).toHaveBeenCalledWith(2000);
  });
});
