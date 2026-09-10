import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  logEvent: vi.fn(),
}));

vi.mock('../analyticsService', () => ({
  logEvent: mocks.logEvent,
}));

vi.mock('../../models/index', () => ({
  AnalyticsEventType: { SEARCH: 'search' },
}));

import {
  hasActiveSiteSearchFilters,
  recordSiteSearch,
  shouldRecordSiteSearch,
} from '../siteSearchAnalytics';

const record = (overrides: Partial<Parameters<typeof recordSiteSearch>[0]> = {}) => ({
  netid: 'student123',
  userType: 'undergraduate',
  surface: 'program' as const,
  searchQuery: 'econ',
  filters: {},
  resultCount: 4,
  page: 1,
  ...overrides,
});

describe('shouldRecordSiteSearch', () => {
  it('records a signed-in first-page search for a query or a filter', () => {
    expect(shouldRecordSiteSearch(record())).toBe(true);
    expect(
      shouldRecordSiteSearch(record({ searchQuery: '', filters: { yearOfStudy: ['Senior'] } })),
    ).toBe(true);
  });

  it('ignores paging through a search that was already recorded', () => {
    expect(shouldRecordSiteSearch(record({ page: 2 }))).toBe(false);
    expect(shouldRecordSiteSearch(record({ page: 7 }))).toBe(false);
  });

  it('ignores a suggestion probe the client issued on the student behalf', () => {
    expect(
      shouldRecordSiteSearch(
        record({
          surface: 'research_entity',
          searchQuery: 'quantum computing',
          suggestionProbe: true,
        }),
      ),
    ).toBe(false);
  });

  it('ignores an unfiltered browse load and an anonymous visitor', () => {
    expect(shouldRecordSiteSearch(record({ searchQuery: '   ' }))).toBe(false);
    expect(shouldRecordSiteSearch(record({ searchQuery: '', filters: { school: [] } }))).toBe(
      false,
    );
    expect(shouldRecordSiteSearch(record({ netid: undefined }))).toBe(false);
  });
});

describe('hasActiveSiteSearchFilters', () => {
  it('counts only a filter with a selection', () => {
    expect(hasActiveSiteSearchFilters({})).toBe(false);
    expect(hasActiveSiteSearchFilters({ school: [], departments: [] })).toBe(false);
    expect(hasActiveSiteSearchFilters({ school: [], departments: ['Economics'] })).toBe(true);
  });
});

describe('recordSiteSearch', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('stores the surface, the result count, and only the selected filters', async () => {
    await expect(
      recordSiteSearch(
        record({
          surface: 'research_entity',
          searchQuery: 'quantum materials',
          filters: { school: [], departments: ['Physics'] },
          resultCount: 12,
          metadata: { pageSize: 24 },
        }),
      ),
    ).resolves.toBe(true);

    expect(mocks.logEvent).toHaveBeenCalledWith({
      eventType: 'search',
      netid: 'student123',
      userType: 'undergraduate',
      searchQuery: 'quantum materials',
      metadata: {
        entityType: 'research_entity',
        resultCount: 12,
        filters: { departments: ['Physics'] },
        page: 1,
        pageSize: 24,
      },
    });
  });

  it('writes nothing for a request that is not a search', async () => {
    await expect(recordSiteSearch(record({ page: 3 }))).resolves.toBe(false);
    expect(mocks.logEvent).not.toHaveBeenCalled();
  });
});
