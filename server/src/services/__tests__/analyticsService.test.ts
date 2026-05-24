import { describe, expect, it, vi, afterEach } from 'vitest';

import { AnalyticsEvent, AnalyticsEventType } from '../../models/analytics';
import { getSearchQueryAnalytics, resolveTrendingOpportunityViews } from '../analyticsService';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('analyticsService search query analytics', () => {
  it('returns aggregate query popularity with the people who searched each query', async () => {
    const aggregate = vi.spyOn(AnalyticsEvent, 'aggregate').mockResolvedValue([
      {
        query: 'machine learning',
        totalSearches: 3,
        uniqueSearchers: 2,
        zeroResultSearches: 1,
        avgResultCount: 4.33,
        lastSearchedAt: new Date('2026-05-17T12:00:00.000Z'),
        searchers: [
          {
            netid: 'searcher-one',
            userType: 'undergraduate',
            fname: 'Example',
            lname: 'Student',
            email: 'student@example.edu',
            searchCount: 2,
            lastSearchedAt: new Date('2026-05-17T12:00:00.000Z'),
          },
          {
            netid: 'searcher-two',
            userType: 'graduate',
            searchCount: 1,
            lastSearchedAt: new Date('2026-05-16T12:00:00.000Z'),
          },
        ],
      },
    ] as never);

    const result = await getSearchQueryAnalytics({
      start: new Date('2026-05-01T00:00:00.000Z'),
      end: new Date('2026-05-18T00:00:00.000Z'),
    });

    expect(aggregate).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          $match: expect.objectContaining({
            eventType: AnalyticsEventType.SEARCH,
          }),
        }),
      ]),
    );
    expect(result.queries).toHaveLength(1);
    expect(result.queries[0]).toMatchObject({
      query: 'machine learning',
      totalSearches: 3,
      uniqueSearchers: 2,
      zeroResultSearches: 1,
      avgResultCount: 4.33,
    });
    expect(result.queries[0].searchers).toEqual([
      expect.objectContaining({
        netid: 'searcher-one',
        userType: 'undergraduate',
        email: 'student@example.edu',
        searchCount: 2,
      }),
      expect.objectContaining({
        netid: 'searcher-two',
        userType: 'graduate',
        searchCount: 1,
      }),
    ]);
  });
});

describe('analyticsService trending opportunity resolution', () => {
  it('resolves current posted opportunities and reports orphaned view events', () => {
    const result = resolveTrendingOpportunityViews(
      [
        {
          listingId: 'posted-1',
          views: 4,
          uniqueViewers: 2,
        },
        {
          listingId: 'stale-id',
          views: 3,
          uniqueViewers: 1,
        },
      ],
      [],
      [
        {
          _id: 'posted-1',
          title: 'Summer research assistant',
          status: 'OPEN',
          archived: false,
          researchEntityId: 'entity-1',
        },
      ],
    );

    expect(result.trending).toEqual([
      {
        listingId: 'posted-1',
        sourceRecordId: 'posted-1',
        opportunityId: 'posted-1',
        sourceType: 'postedOpportunity',
        title: 'Summer research assistant',
        status: 'OPEN',
        archived: false,
        researchEntityId: 'entity-1',
        views: 4,
        uniqueViewers: 2,
      },
    ]);
    expect(result.dataHealth).toEqual({
      opportunityViewEventsLast30Days: 7,
      resolvedOpportunityViewEventsLast30Days: 4,
      orphanedOpportunityViewEventsLast30Days: 3,
      orphanedOpportunityIds: ['stale-id'],
    });
  });

  it('falls back to legacy listing records while migration events still exist', () => {
    const result = resolveTrendingOpportunityViews(
      [
        {
          listingId: 'legacy-1',
          views: 2,
          uniqueViewers: 1,
        },
      ],
      [
        {
          _id: 'legacy-1',
          title: 'Legacy RA posting',
          ownerFirstName: 'Example',
          ownerLastName: 'Owner',
          departments: ['Computer Science'],
        },
      ],
      [],
    );

    expect(result.trending).toEqual([
      {
        listingId: 'legacy-1',
        sourceRecordId: 'legacy-1',
        sourceType: 'legacyListing',
        title: 'Legacy RA posting',
        ownerFirstName: 'Example',
        ownerLastName: 'Owner',
        departments: ['Computer Science'],
        views: 2,
        uniqueViewers: 1,
      },
    ]);
    expect(result.dataHealth.orphanedOpportunityViewEventsLast30Days).toBe(0);
  });
});
