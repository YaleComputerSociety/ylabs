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
  resolveSiteSearchPage,
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
      occurredAt: undefined,
      foldQueryEdits: false,
      metadata: {
        entityType: 'research_entity',
        resultCount: 12,
        filters: { departments: ['Physics'] },
        page: 1,
        pageSize: 24,
      },
    });
  });

  it('never lets caller metadata overwrite the fields the report is keyed on', async () => {
    await recordSiteSearch(
      record({
        surface: 'research_entity',
        searchQuery: 'quantum materials',
        filters: { departments: ['Physics'] },
        resultCount: 12,
        page: 1,
        metadata: {
          pageSize: 24,
          page: 9,
          entityType: 'program',
          resultCount: 0,
          filters: { departments: ['Economics'] },
        },
      }),
    );

    expect(mocks.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          pageSize: 24,
          entityType: 'research_entity',
          resultCount: 12,
          filters: { departments: ['Physics'] },
          page: 1,
        },
      }),
    );
  });

  it('folds query edits only on the surface that searches from a debounce', async () => {
    await recordSiteSearch(record({ surface: 'program' }));
    expect(mocks.logEvent).toHaveBeenCalledWith(expect.objectContaining({ foldQueryEdits: true }));

    await recordSiteSearch(record({ surface: 'research_entity' }));
    expect(mocks.logEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ foldQueryEdits: false }),
    );
  });

  it('reports the event as happening when the request arrived', async () => {
    const requestArrivedAt = new Date(Date.now() - 1500);
    await recordSiteSearch(record({ requestArrivedAt }));

    expect(mocks.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ occurredAt: requestArrivedAt }),
    );
  });

  it('writes nothing for a request that is not a search', async () => {
    await expect(recordSiteSearch(record({ page: 3 }))).resolves.toBe(false);
    expect(mocks.logEvent).not.toHaveBeenCalled();
  });
});

describe('resolveSiteSearchPage', () => {
  it('prefers the page the response reported', () => {
    expect(resolveSiteSearchPage(3, '1')).toBe(3);
    expect(resolveSiteSearchPage(1, '7')).toBe(1);
  });

  it('falls back to the requested page, then to the first page', () => {
    expect(resolveSiteSearchPage(undefined, '4')).toBe(4);
    expect(resolveSiteSearchPage(undefined, 4)).toBe(4);
    expect(resolveSiteSearchPage(undefined, undefined)).toBe(1);
    expect(resolveSiteSearchPage(undefined, 'later')).toBe(1);
    expect(resolveSiteSearchPage(undefined, '-2')).toBe(1);
  });
});
