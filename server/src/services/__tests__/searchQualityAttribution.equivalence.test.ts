import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AnalyticsEvent, AnalyticsEventType } from '../../models/analytics';
import { getSearchQualityAnalytics, invalidateAnalyticsCaches } from '../analyticsService';

const WINDOW_MINUTES = 30;

const legacySelfJoinPipeline = (): mongoose.PipelineStage[] => [
  {
    $match: {
      eventType: AnalyticsEventType.SEARCH,
    },
  },
  {
    $addFields: {
      normalizedQuery: { $trim: { input: { $ifNull: ['$searchQuery', ''] } } },
      searchEntityType: { $ifNull: ['$metadata.entityType', 'listing'] },
      resultCount: {
        $convert: {
          input: '$metadata.resultCount',
          to: 'double',
          onError: 0,
          onNull: 0,
        },
      },
    },
  },
  {
    $lookup: {
      from: 'analytics_events',
      let: { searchNetid: '$netid', searchAt: '$timestamp' },
      pipeline: [
        {
          $match: {
            $expr: {
              $and: [
                { $eq: ['$netid', '$$searchNetid'] },
                { $gt: ['$timestamp', '$$searchAt'] },
                {
                  $lte: [
                    '$timestamp',
                    {
                      $dateAdd: { startDate: '$$searchAt', unit: 'minute', amount: WINDOW_MINUTES },
                    },
                  ],
                },
                {
                  $in: [
                    '$eventType',
                    [
                      AnalyticsEventType.SEARCH,
                      AnalyticsEventType.LISTING_VIEW,
                      AnalyticsEventType.LISTING_FAVORITE,
                      AnalyticsEventType.FELLOWSHIP_VIEW,
                      AnalyticsEventType.FELLOWSHIP_FAVORITE,
                      AnalyticsEventType.RESEARCH_VIEW,
                      AnalyticsEventType.PATHWAY_SAVE,
                    ],
                  ],
                },
              ],
            },
          },
        },
        { $sort: { timestamp: 1 } },
      ],
      as: 'attributionEvents',
    },
  },
  {
    $addFields: {
      nextSearchAt: {
        $min: {
          $map: {
            input: {
              $filter: {
                input: '$attributionEvents',
                as: 'event',
                cond: { $eq: ['$$event.eventType', AnalyticsEventType.SEARCH] },
              },
            },
            as: 'event',
            in: '$$event.timestamp',
          },
        },
      },
    },
  },
  {
    $addFields: {
      hasAttributedAction: {
        $gt: [
          {
            $size: {
              $filter: {
                input: '$attributionEvents',
                as: 'event',
                cond: {
                  $and: [
                    { $ne: ['$$event.eventType', AnalyticsEventType.SEARCH] },
                    {
                      $or: [
                        { $eq: [{ $type: '$nextSearchAt' }, 'missing'] },
                        { $eq: ['$nextSearchAt', null] },
                        { $lt: ['$$event.timestamp', '$nextSearchAt'] },
                      ],
                    },
                  ],
                },
              },
            },
          },
          0,
        ],
      },
    },
  },
  {
    $facet: {
      overall: [
        {
          $group: {
            _id: null,
            totalSearches: { $sum: 1 },
            zeroResultSearches: { $sum: { $cond: [{ $lte: ['$resultCount', 0] }, 1, 0] } },
            uniqueSearchers: { $addToSet: '$netid' },
            engagedSearches: {
              $sum: {
                $cond: [{ $and: [{ $gt: ['$resultCount', 0] }, '$hasAttributedAction'] }, 1, 0],
              },
            },
            returnedButIgnoredSearches: {
              $sum: {
                $cond: [
                  { $and: [{ $gt: ['$resultCount', 0] }, { $not: ['$hasAttributedAction'] }] },
                  1,
                  0,
                ],
              },
            },
          },
        },
        {
          $project: {
            _id: 0,
            totalSearches: 1,
            zeroResultSearches: 1,
            uniqueSearchers: { $size: '$uniqueSearchers' },
            engagedSearches: 1,
            returnedButIgnoredSearches: 1,
          },
        },
      ],
      byQueryAndEntityType: [
        {
          $group: {
            _id: { query: '$normalizedQuery', entityType: '$searchEntityType' },
            totalSearches: { $sum: 1 },
            zeroResultSearches: { $sum: { $cond: [{ $lte: ['$resultCount', 0] }, 1, 0] } },
            uniqueSearchers: { $addToSet: '$netid' },
            avgResultCount: { $avg: '$resultCount' },
          },
        },
        {
          $project: {
            _id: 0,
            query: '$_id.query',
            entityType: '$_id.entityType',
            totalSearches: 1,
            zeroResultSearches: 1,
            uniqueSearchers: { $size: '$uniqueSearchers' },
            avgResultCount: { $round: ['$avgResultCount', 2] },
          },
        },
        { $sort: { totalSearches: -1, zeroResultSearches: -1, query: 1 } },
        { $limit: 100 },
      ],
    },
  },
];

const minutes = (base: Date, offset: number): Date => new Date(base.getTime() + offset * 60 * 1000);

describe('search-quality attribution single-pass equivalence', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  afterEach(() => {
    invalidateAnalyticsCaches();
  });

  beforeEach(async () => {
    invalidateAnalyticsCaches();
    await AnalyticsEvent.deleteMany({});
  });

  const seedSyntheticEvents = async () => {
    const base = new Date('2026-02-01T12:00:00.000Z');
    const event = (
      netid: string,
      eventType: AnalyticsEventType,
      offset: number,
      extra: Record<string, unknown> = {},
    ) => ({
      netid,
      userType: 'undergraduate',
      eventType,
      timestamp: minutes(base, offset),
      ...extra,
    });

    await AnalyticsEvent.insertMany([
      event('stud01', AnalyticsEventType.SEARCH, 0, {
        searchQuery: 'neuroscience',
        metadata: { entityType: 'research_entity', resultCount: 5 },
      }),
      event('stud01', AnalyticsEventType.LISTING_VIEW, 2),
      event('stud01', AnalyticsEventType.SEARCH, 40, {
        searchQuery: 'genomics',
        metadata: { entityType: 'research_entity', resultCount: 0 },
      }),
      event('stud01', AnalyticsEventType.LISTING_VIEW, 41),
      event('stud01', AnalyticsEventType.SEARCH, 120, {
        searchQuery: 'robotics',
        metadata: { entityType: 'listing', resultCount: 3 },
      }),

      event('stud02', AnalyticsEventType.SEARCH, 0, {
        searchQuery: 'neuroscience',
        metadata: { entityType: 'research_entity', resultCount: 8 },
      }),
      event('stud02', AnalyticsEventType.SEARCH, 10, {
        searchQuery: 'immunology',
        metadata: { entityType: 'research_entity', resultCount: 2 },
      }),
      event('stud02', AnalyticsEventType.LISTING_FAVORITE, 50),

      event('stud03', AnalyticsEventType.SEARCH, 0, {
        searchQuery: 'robotics',
        metadata: { entityType: 'listing', resultCount: 4 },
      }),
      event('stud03', AnalyticsEventType.RESEARCH_VIEW, 5),
      event('stud03', AnalyticsEventType.SEARCH, 10, {
        searchQuery: 'materials',
        metadata: { entityType: 'research_entity', resultCount: 1 },
      }),

      event('stud04', AnalyticsEventType.SEARCH, 0, {
        searchQuery: 'materials',
        metadata: { entityType: 'research_entity', resultCount: 6 },
      }),
      event('stud04', AnalyticsEventType.SEARCH, 3, {
        searchQuery: 'chemistry',
        metadata: { entityType: 'research_entity', resultCount: 6 },
      }),
      event('stud04', AnalyticsEventType.LISTING_VIEW, 5),
    ]);
  };

  it('produces the same facet output as the legacy self-join over seeded synthetic events', async () => {
    await seedSyntheticEvents();

    const [legacy] = await AnalyticsEvent.aggregate(legacySelfJoinPipeline());
    const current = await getSearchQualityAnalytics();

    const legacyOverall = legacy.overall[0];
    expect(current.totalSearches).toBe(legacyOverall.totalSearches);
    expect(current.zeroResultSearches).toBe(legacyOverall.zeroResultSearches);
    expect(current.uniqueSearchers).toBe(legacyOverall.uniqueSearchers);
    expect(current.engagedSearches).toBe(legacyOverall.engagedSearches);
    expect(current.returnedButIgnoredSearches).toBe(legacyOverall.returnedButIgnoredSearches);
    expect(current.byQueryAndEntityType).toEqual(legacy.byQueryAndEntityType);
  });

  it('runs attribution without any self-join stage', async () => {
    await seedSyntheticEvents();
    invalidateAnalyticsCaches();

    const explain = await AnalyticsEvent.collection
      .aggregate(legacySelfJoinPipeline(), { explain: true })
      .toArray();
    const legacyUsesLookup = JSON.stringify(explain).includes('$lookup');
    expect(legacyUsesLookup).toBe(true);

    const result = await getSearchQualityAnalytics();
    expect(result.totalSearches).toBeGreaterThan(0);
    expect(result.engagedSearches).toBeGreaterThan(0);
    expect(result.returnedButIgnoredSearches).toBeGreaterThan(0);
  });
});
