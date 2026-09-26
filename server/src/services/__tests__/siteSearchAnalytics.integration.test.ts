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

  it('keeps folding an episode whose first snapshot is older than the fold window', async () => {
    await recordSiteSearch(search({ searchQuery: 'mech', resultCount: 0 }));
    await recordSiteSearch(search({ searchQuery: 'mechanical eng', resultCount: 0 }));

    const episodeStart = new Date(Date.now() - 60_000);
    await mongoose.connection
      .db!.collection('analytics_events')
      .updateMany({ eventType: 'search' }, { $set: { timestamp: episodeStart } });

    await recordSiteSearch(search({ searchQuery: 'mechanical engineering', resultCount: 32 }));

    const rows = await recordedSearches();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      searchQuery: 'mechanical engineering',
      metadata: expect.objectContaining({ resultCount: 32 }),
    });
    expect(rows[0].timestamp).toEqual(episodeStart);
  });

  it('counts a reissued filter-only search once and a different filter set separately', async () => {
    await recordSiteSearch(search({ filters: { globalRegions: ['Africa'] }, resultCount: 67 }));
    await recordSiteSearch(search({ filters: { globalRegions: ['Africa'] }, resultCount: 67 }));

    await expect(recordedSearches()).resolves.toHaveLength(1);

    await recordSiteSearch(search({ filters: { globalRegions: ['Asia'] }, resultCount: 70 }));

    const rows = await recordedSearches();
    expect(rows.map((row) => row.metadata?.filters)).toEqual([
      { globalRegions: ['Africa'] },
      { globalRegions: ['Asia'] },
    ]);
  });

  it('keeps the query when the student backspaced after finding something', async () => {
    await recordSiteSearch(search({ searchQuery: 'rosenfeld', resultCount: 1 }));
    await recordSiteSearch(search({ searchQuery: 'rosenfel', resultCount: 0 }));

    const rows = await recordedSearches();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      searchQuery: 'rosenfeld',
      metadata: expect.objectContaining({ resultCount: 1 }),
    });
  });

  it('keeps the query and its coverage gap over a shorter fragment that matched', async () => {
    await recordSiteSearch(search({ searchQuery: 'math', resultCount: 0 }));
    await recordSiteSearch(search({ searchQuery: 'm', resultCount: 5 }));
    await recordSiteSearch(search({ searchQuery: 'ma', resultCount: 5 }));

    const rows = await recordedSearches();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      searchQuery: 'math',
      metadata: expect.objectContaining({ resultCount: 0 }),
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

  it('keeps a zero-result research search when the student edits it and submits again', async () => {
    await recordSiteSearch(
      search({
        surface: 'research_entity',
        searchQuery: 'quantum materials physics',
        resultCount: 0,
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 5));
    await recordSiteSearch(
      search({
        surface: 'research_entity',
        searchQuery: 'quantum materials',
        resultCount: 5,
      }),
    );

    const rows = await recordedSearches();
    expect(rows.map((row) => row.searchQuery)).toEqual([
      'quantum materials physics',
      'quantum materials',
    ]);
    expect(rows[0].metadata?.resultCount).toBe(0);
    expect(rows[1].metadata?.resultCount).toBe(5);
  });

  it('keeps both research searches when the second is an edit of the first', async () => {
    await recordSiteSearch(
      search({ surface: 'research_entity', searchQuery: 'biology', resultCount: 40 }),
    );

    await new Promise((resolve) => setTimeout(resolve, 5));
    await recordSiteSearch(
      search({ surface: 'research_entity', searchQuery: 'bio', resultCount: 12 }),
    );

    const rows = await recordedSearches();
    expect(rows.map((row) => row.searchQuery)).toEqual(['biology', 'bio']);
  });

  it('counts a research re-sort of the same query and filters as the one search it repeats', async () => {
    const searched = search({
      surface: 'research_entity',
      searchQuery: 'econ',
      filters: { school: ['Yale College'] },
      resultCount: 12,
    });
    await recordSiteSearch(searched);

    await new Promise((resolve) => setTimeout(resolve, 5));
    await recordSiteSearch({ ...searched });
    await recordSiteSearch({ ...searched });

    const rows = await recordedSearches();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      searchQuery: 'econ',
      metadata: expect.objectContaining({ filters: { school: ['Yale College'] } }),
    });
  });

  it('keeps two different research queries as two searches', async () => {
    await recordSiteSearch(
      search({ surface: 'research_entity', searchQuery: 'econ', resultCount: 12 }),
    );

    await new Promise((resolve) => setTimeout(resolve, 5));
    await recordSiteSearch(
      search({ surface: 'research_entity', searchQuery: 'goldwater', resultCount: 1 }),
    );

    const rows = await recordedSearches();
    expect(rows.map((row) => row.searchQuery)).toEqual(['econ', 'goldwater']);
  });

  it('drops a snapshot that answered late even after an unrelated search intervened', async () => {
    const staleArrivedAt = new Date(Date.now() - 9000);

    await recordSiteSearch(
      search({
        searchQuery: 'mechanical engineering',
        resultCount: 32,
        requestArrivedAt: new Date(Date.now() - 6000),
      }),
    );
    await recordSiteSearch(
      search({
        searchQuery: 'goldwater',
        resultCount: 1,
        requestArrivedAt: new Date(Date.now() - 3000),
      }),
    );
    await recordSiteSearch(
      search({ searchQuery: 'mechanica', resultCount: 0, requestArrivedAt: staleArrivedAt }),
    );

    const rows = await recordedSearches();
    expect(rows.map((row) => row.searchQuery)).toEqual(['mechanical engineering', 'goldwater']);
    expect(rows.some((row) => row.metadata?.resultCount === 0)).toBe(false);
  });

  it('folds a query typed across a filter toggle into one row with the filters it ran with', async () => {
    await recordSiteSearch(search({ searchQuery: 'econ', resultCount: 40 }));
    await recordSiteSearch(
      search({ searchQuery: 'econ', filters: { yearOfStudy: ['Senior'] }, resultCount: 12 }),
    );
    await recordSiteSearch(
      search({ searchQuery: 'economics', filters: { yearOfStudy: ['Senior'] }, resultCount: 9 }),
    );

    const rows = await recordedSearches();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      searchQuery: 'economics',
      metadata: expect.objectContaining({
        filters: { yearOfStudy: ['Senior'] },
        resultCount: 9,
      }),
    });
  });

  it('lets the query the student settled on win over a snapshot that answered late', async () => {
    const settledArrivedAt = new Date(Date.now() - 3000);
    const staleArrivedAt = new Date(Date.now() - 6000);

    await recordSiteSearch(
      search({
        searchQuery: 'mechanical engineering',
        resultCount: 32,
        requestArrivedAt: settledArrivedAt,
      }),
    );
    await recordSiteSearch(
      search({ searchQuery: 'mechanica', resultCount: 0, requestArrivedAt: staleArrivedAt }),
    );

    const rows = await recordedSearches();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      searchQuery: 'mechanical engineering',
      metadata: expect.objectContaining({ resultCount: 32 }),
    });
    expect(rows[0].timestamp).toEqual(settledArrivedAt);
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
