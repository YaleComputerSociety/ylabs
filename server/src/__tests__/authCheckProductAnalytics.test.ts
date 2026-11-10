import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ensureProductAnalyticsId: vi.fn(),
  isProductAnalyticsAllowedForSession: vi.fn(),
}));

vi.mock('../services/productAnalyticsIdentityService', () => ({
  ensureProductAnalyticsId: mocks.ensureProductAnalyticsId,
}));

vi.mock('../utils/posthogConfig', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/posthogConfig')>()),
  isProductAnalyticsAllowedForSession: mocks.isProductAnalyticsAllowedForSession,
}));

import { passportRoutes } from '../passport';

const SYNTHETIC_POSTHOG_ID = '3f2b6c1e-8d4a-4f0b-9c7e-2a1d5e6f7a8b';

const sessionUser = {
  netId: 'abc123',
  userType: 'undergraduate',
  userConfirmed: true,
  profileVerified: false,
  isAdmin: false,
};

const callCheck = (user: unknown) => {
  const checkRoute = (passportRoutes as any).stack
    .map((layer: any) => layer.route)
    .find((route: any) => route?.path === '/check');
  const handler = checkRoute.stack.at(-1).handle;
  return new Promise<Record<string, unknown>>((resolve) => {
    handler(
      { user },
      { setHeader: vi.fn(), json: (body: Record<string, unknown>) => resolve(body) },
    );
  });
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('GET /check product analytics fields', () => {
  it('serves the opaque PostHog ID, never the netid, when the session may be measured', async () => {
    mocks.isProductAnalyticsAllowedForSession.mockReturnValue(true);
    mocks.ensureProductAnalyticsId.mockResolvedValue(SYNTHETIC_POSTHOG_ID);

    const body = await callCheck(sessionUser);

    expect(body).toMatchObject({
      auth: true,
      productAnalytics: true,
      productAnalyticsId: SYNTHETIC_POSTHOG_ID,
    });
    expect(String(body.productAnalyticsId)).not.toContain('abc123');
    expect(mocks.ensureProductAnalyticsId).toHaveBeenCalledWith('abc123');
  });

  it('assigns no ID and turns PostHog off when the session may not be measured', async () => {
    mocks.isProductAnalyticsAllowedForSession.mockReturnValue(false);

    const body = await callCheck({ ...sessionUser, isAdmin: true });

    expect(body).toMatchObject({ auth: true, productAnalytics: false });
    expect(body).not.toHaveProperty('productAnalyticsId');
    expect(mocks.ensureProductAnalyticsId).not.toHaveBeenCalled();
  });

  it('stays anonymous when the account has no ID to give', async () => {
    mocks.isProductAnalyticsAllowedForSession.mockReturnValue(true);
    mocks.ensureProductAnalyticsId.mockResolvedValue(null);

    const body = await callCheck(sessionUser);

    expect(body).toMatchObject({ auth: true, productAnalytics: true });
    expect(body).not.toHaveProperty('productAnalyticsId');
  });

  it('turns PostHog off when the ID lookup fails', async () => {
    mocks.isProductAnalyticsAllowedForSession.mockReturnValue(true);
    mocks.ensureProductAnalyticsId.mockRejectedValue(new Error('lookup failed'));

    const body = await callCheck(sessionUser);

    expect(body).toMatchObject({ auth: true, productAnalytics: false });
    expect(body).not.toHaveProperty('productAnalyticsId');
  });
});
