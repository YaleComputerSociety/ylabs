import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { recordSiteSearch, type SiteSearchRecord } from '../siteSearchAnalytics';

const NETID = 'teststud1';

let memoryServer: MongoMemoryServer | undefined;

const search = (overrides: Partial<SiteSearchRecord> = {}): SiteSearchRecord => ({
  netid: NETID,
  userType: 'undergraduate',
  surface: 'program',
  searchQuery: '',
  filters: {},
  resultCount: 0,
  page: 1,
  ...overrides,
});

const recordedSearches = async () =>
  mongoose.connection
    .db!.collection('analytics_events')
    .find({ eventType: 'search' })
    .sort({ timestamp: 1 })
    .toArray();

describe('recorded searches over a real store', () => {
  beforeAll(async () => {
    let mongoUrl = process.env.SITE_SEARCH_ANALYTICS_TEST_MONGO_URL;
    if (!mongoUrl) {
      memoryServer = await MongoMemoryServer.create();
      mongoUrl = memoryServer.getUri('site_search_analytics_test');
    }
    await mongoose.connect(mongoUrl);
  }, 120_000);

  beforeEach(async () => {
    await mongoose.connection.db!.collection('analytics_events').deleteMany({});
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await memoryServer?.stop();
  });

  it('keeps one row for a query typed a character at a time', async () => {
    for (const [index, searchQuery] of [
      'mech',
      'mechengineering',
      'mechaniengineering',
      'mechanicaengineering',
      'mechanical engineering',
    ].entries()) {
      await recordSiteSearch(search({ searchQuery, resultCount: index === 4 ? 32 : 0 }));
    }

    const rows = await recordedSearches();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      searchQuery: 'mechanical engineering',
      metadata: expect.objectContaining({ resultCount: 32 }),
    });
  });

  it('does not count paging through one result set as more searches', async () => {
    await recordSiteSearch(search({ searchQuery: 'fellowship', resultCount: 74, page: 1 }));
    await recordSiteSearch(search({ searchQuery: 'fellowship', resultCount: 74, page: 2 }));
    await recordSiteSearch(search({ searchQuery: 'fellowship', resultCount: 74, page: 3 }));

    const rows = await recordedSearches();
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata?.page).toBe(1);
  });

  it('records the next thing the student looks up as its own search', async () => {
    await recordSiteSearch(search({ searchQuery: 'goldwater', resultCount: 1 }));
    await recordSiteSearch(search({ searchQuery: 'rosenfeld', resultCount: 1 }));

    const rows = await recordedSearches();
    expect(rows.map((row) => row.searchQuery)).toEqual(['goldwater', 'rosenfeld']);
  });

  it('keeps each filter-only search instead of one nameless bucket', async () => {
    await recordSiteSearch(search({ filters: { globalRegions: ['Africa'] }, resultCount: 67 }));
    await recordSiteSearch(search({ filters: { globalRegions: ['Asia'] }, resultCount: 70 }));

    const rows = await recordedSearches();
    expect(rows.map((row) => row.metadata?.filters)).toEqual([
      { globalRegions: ['Africa'] },
      { globalRegions: ['Asia'] },
    ]);
  });

  it('keeps a zero-result search intact when the page probes a relaxed query', async () => {
    await recordSiteSearch(
      search({
        surface: 'research_entity',
        searchQuery: 'quantum computing photonics',
        resultCount: 0,
      }),
    );
    await recordSiteSearch(
      search({
        surface: 'research_entity',
        searchQuery: 'quantum computing',
        resultCount: 5,
        suggestionProbe: true,
      }),
    );

    const rows = await recordedSearches();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      searchQuery: 'quantum computing photonics',
      metadata: expect.objectContaining({ resultCount: 0 }),
    });
  });

  it('keeps two short lookups apart even though one spells out inside the other', async () => {
    await recordSiteSearch(search({ searchQuery: 'ai', resultCount: 0 }));
    await recordSiteSearch(search({ searchQuery: 'machine learning', resultCount: 8 }));

    const rows = await recordedSearches();
    expect(rows.map((row) => row.searchQuery)).toEqual(['ai', 'machine learning']);
    expect(rows[0].metadata?.resultCount).toBe(0);
  });

  it('keeps the episode timestamp so a click between two snapshots stays attributable', async () => {
    await recordSiteSearch(search({ searchQuery: 'econ', resultCount: 12 }));
    const [firstRow] = await recordedSearches();

    await new Promise((resolve) => setTimeout(resolve, 5));
    await recordSiteSearch(search({ searchQuery: 'economics', resultCount: 9 }));

    const rows = await recordedSearches();
    expect(rows).toHaveLength(1);
    expect(rows[0].searchQuery).toBe('economics');
    expect(rows[0].timestamp).toEqual(firstRow.timestamp);
  });

  it('records nothing for an unfiltered browse load or an anonymous visitor', async () => {
    await recordSiteSearch(search({ surface: 'research_entity', resultCount: 2572 }));
    await recordSiteSearch(search({ netid: undefined, searchQuery: 'econ', resultCount: 4 }));

    await expect(recordedSearches()).resolves.toHaveLength(0);
  });
});
