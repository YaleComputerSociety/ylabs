import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  analyticsAggregate: vi.fn(),
  analyticsCreate: vi.fn(),
  analyticsFind: vi.fn(),
}));

vi.mock('../../models/analytics', () => ({
  AnalyticsEventType: {
    LOGIN: 'login',
    LOGOUT: 'logout',
    VISITOR: 'visitor',
    LISTING_VIEW: 'listing_view',
    LISTING_FAVORITE: 'listing_favorite',
    LISTING_UNFAVORITE: 'listing_unfavorite',
    FELLOWSHIP_VIEW: 'fellowship_view',
    FELLOWSHIP_FAVORITE: 'fellowship_favorite',
    FELLOWSHIP_UNFAVORITE: 'fellowship_unfavorite',
    SEARCH: 'search',
    OUTREACH_CLICK: 'outreach_click',
    OUTREACH_OUTCOME: 'outreach_outcome',
    LISTING_CREATE: 'listing_create',
    LISTING_UPDATE: 'listing_update',
    LISTING_ARCHIVE: 'listing_archive',
    LISTING_UNARCHIVE: 'listing_unarchive',
    PROFILE_UPDATE: 'profile_update',
  },
  AnalyticsEvent: {
    aggregate: mocks.analyticsAggregate,
    create: mocks.analyticsCreate,
    find: mocks.analyticsFind,
  },
}));

vi.mock('../../models/index', () => ({
  User: {
    findOne: vi.fn(),
  },
}));

vi.mock('../../db/connections', () => ({
  getListingModel: vi.fn(),
}));

import { getUserAnalytics, shouldSuppressBetaAnalyticsEvent } from '../analyticsService';

describe('shouldSuppressBetaAnalyticsEvent', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('suppresses real student analytics in Beta', () => {
    vi.stubEnv('SCRAPER_ENV', 'beta');

    expect(shouldSuppressBetaAnalyticsEvent({ netid: 'aa3246', userType: 'undergraduate' })).toBe(true);
    expect(shouldSuppressBetaAnalyticsEvent({ netid: 'aa3246', userType: 'student' })).toBe(true);
    expect(shouldSuppressBetaAnalyticsEvent({ netid: 'aa3246', userType: 'graduate' })).toBe(true);
  });

  it('keeps Beta admin and fixture analytics available for operator testing', () => {
    vi.stubEnv('SCRAPER_ENV', 'beta');

    expect(shouldSuppressBetaAnalyticsEvent({ netid: 'qz285', userType: 'admin' })).toBe(false);
    expect(shouldSuppressBetaAnalyticsEvent({ netid: 'devadmin', userType: 'undergraduate' })).toBe(false);
    expect(shouldSuppressBetaAnalyticsEvent({ netid: 'test123', userType: 'student' })).toBe(false);
  });

  it('does not suppress production analytics', () => {
    vi.stubEnv('SCRAPER_ENV', 'production');

    expect(shouldSuppressBetaAnalyticsEvent({ netid: 'aa3246', userType: 'undergraduate' })).toBe(false);
  });
});

describe('getUserAnalytics', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('rejects oversized search before building the aggregation pipeline', async () => {
    await expect(getUserAnalytics({ search: 'a'.repeat(121) })).rejects.toThrow('Invalid search');

    expect(mocks.analyticsAggregate).not.toHaveBeenCalled();
  });
});
