/**
 * Tests for ApifyGoogleScholarScraper.
 *
 * Every external dependency is injected via the constructor `deps` argument:
 *   - `callApify`           — replaces axios POST to api.apify.com
 *   - `userFinder`          — replaces the Mongo User query
 *   - `departmentResolver`  — replaces the Mongo Department lookup
 *   - `apiToken`            — provided explicitly so we never look at process.env
 *
 * No network or DB access happens in this suite. The snapshotCache module is
 * mocked so cache assertions don't need MongoDB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getCachedSpy, setCachedSpy } = vi.hoisted(() => ({
  getCachedSpy: vi.fn(),
  setCachedSpy: vi.fn(),
}));
vi.mock('../snapshotCache', () => ({
  getCached: getCachedSpy,
  setCached: setCachedSpy,
}));

import {
  ApifyGoogleScholarScraper,
  buildApifyInput,
  chunk,
  eligibleFacultyQuery,
  mapAuthorProfileToObservations,
  paperHash,
  PAPER_SOURCE_TAG,
  TARGET_CATEGORIES,
  type ApifyAuthorProfile,
  type CandidateFaculty,
  type MapTargetUser,
} from '../sources/apifyGoogleScholarScraper';
import type { ObservationInput, ScraperContext } from '../types';

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

function makeContext(
  overrides: Partial<ScraperContext['options']> = {},
): { ctx: ScraperContext; emitted: ObservationInput[]; logs: string[] } {
  const emitted: ObservationInput[] = [];
  const logs: string[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'test-run',
    sourceId: 'test-source',
    sourceName: 'apify-google-scholar',
    sourceWeight: 0.7,
    options: {
      dryRun: true,
      useCache: false,
      release: false,
      ...overrides,
    },
    emit: async (obs) => {
      const arr = Array.isArray(obs) ? obs : [obs];
      emitted.push(...arr);
    },
    log: (msg) => {
      logs.push(msg);
    },
  };
  return { ctx, emitted, logs };
}

beforeEach(() => {
  getCachedSpy.mockReset();
  setCachedSpy.mockReset();
  getCachedSpy.mockResolvedValue(null);
  setCachedSpy.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('buildApifyInput', () => {
  it('wraps scholar IDs in the expected shape with default maxResults', () => {
    const input = buildApifyInput(['abc', 'def']);
    expect(input).toEqual({ authorIds: ['abc', 'def'], maxResults: 200 });
  });

  it('drops empty / whitespace-only IDs', () => {
    const input = buildApifyInput(['abc', '', '   ', 'def']);
    expect(input.authorIds).toEqual(['abc', 'def']);
  });

  it('honors a custom maxResults', () => {
    expect(buildApifyInput(['x'], 50).maxResults).toBe(50);
  });
});

describe('eligibleFacultyQuery', () => {
  it('always restricts to professor/faculty with a non-empty googleScholarId and unlocked h_index', () => {
    const q = eligibleFacultyQuery();
    expect(q.userType).toEqual({ $in: ['professor', 'faculty'] });
    expect(q.googleScholarId).toEqual({ $exists: true, $nin: [null, ''] });
    expect(q.manuallyLockedFields).toEqual({ $nin: ['h_index'] });
    expect(q.$or).toBeUndefined();
  });

  it('adds an $or department filter when category dept names are provided', () => {
    const q = eligibleFacultyQuery(['English', 'History']);
    expect(q.$or).toEqual([
      { primary_department: { $in: ['English', 'History'] } },
      { secondary_departments: { $in: ['English', 'History'] } },
      { departments: { $in: ['English', 'History'] } },
    ]);
  });

  it('drops the $or filter when the dept-name list is empty', () => {
    const q = eligibleFacultyQuery([]);
    expect(q.$or).toBeUndefined();
  });
});

describe('paperHash', () => {
  it('is deterministic for identical title+year', () => {
    expect(paperHash('A Theory of Justice', 1971)).toBe(paperHash('A Theory of Justice', 1971));
  });

  it('is whitespace-/case-insensitive on title', () => {
    expect(paperHash('  a theory  of  JUSTICE ', 1971)).toBe(
      paperHash('A Theory of Justice', 1971),
    );
  });

  it('differs when title differs', () => {
    expect(paperHash('Title A', 2020)).not.toBe(paperHash('Title B', 2020));
  });

  it('differs when year differs', () => {
    expect(paperHash('Same Title', 2020)).not.toBe(paperHash('Same Title', 2021));
  });

  it('handles missing year', () => {
    expect(typeof paperHash('Some title', undefined)).toBe('string');
  });
});

describe('chunk', () => {
  it('splits arrays into batches of the requested size', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('returns one batch when the array is smaller than the size', () => {
    expect(chunk([1, 2, 3], 10)).toEqual([[1, 2, 3]]);
  });

  it('returns [] when input is empty', () => {
    expect(chunk([], 5)).toEqual([]);
  });

  it('rejects a non-positive size', () => {
    expect(() => chunk([1], 0)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// mapAuthorProfileToObservations
// ---------------------------------------------------------------------------

describe('mapAuthorProfileToObservations', () => {
  const fixedDate = new Date('2026-04-27T12:00:00Z');

  const baseUser: MapTargetUser = {
    _id: 'user-id-1',
    netid: 'abc123',
  };

  const baseProfile: ApifyAuthorProfile = {
    recordType: 'authorProfile',
    authorId: 'GS_AUTHOR_1',
    name: 'Jane Doe',
    affiliation: 'Yale University',
    hIndex: 24,
    i10Index: 40,
    totalCitations: 1234,
    interests: ['Phenomenology', 'Critical Theory'],
    profileImageUrl: 'https://scholar.google.com/img/jane.jpg',
    publications: [],
  };

  it('maps hIndex → h_index and interests → topics, keyed by netid', () => {
    const obs = mapAuthorProfileToObservations(baseProfile, baseUser, fixedDate);
    const h = obs.find((o) => o.field === 'h_index');
    expect(h).toBeDefined();
    expect(h!.value).toBe(24);
    expect(h!.entityKey).toBe('abc123');
    expect(h!.entityType).toBe('user');

    const topics = obs.find((o) => o.field === 'topics');
    expect(topics!.value).toEqual(['Phenomenology', 'Critical Theory']);

    const gsId = obs.find((o) => o.field === 'googleScholarId');
    expect(gsId!.value).toBe('GS_AUTHOR_1');

    const updatedAt = obs.find((o) => o.field === 'googleScholarMetricsUpdatedAt');
    expect(updatedAt!.value).toEqual(fixedDate);

    // sourceUrl points at the Scholar profile page
    expect(h!.sourceUrl).toBe('https://scholar.google.com/citations?user=GS_AUTHOR_1');
  });

  it('maps profileImageUrl → image_url only when the user has no existing image', () => {
    const withImage: MapTargetUser = { ...baseUser, image_url: 'https://existing.example/photo.jpg' };
    const obsWith = mapAuthorProfileToObservations(baseProfile, withImage, fixedDate);
    expect(obsWith.find((o) => o.field === 'image_url')).toBeUndefined();

    const obsWithout = mapAuthorProfileToObservations(baseProfile, baseUser, fixedDate);
    const img = obsWithout.find((o) => o.field === 'image_url');
    expect(img!.value).toBe('https://scholar.google.com/img/jane.jpg');
  });

  it('skips h_index when manuallyLockedFields includes "h_index"', () => {
    const locked: MapTargetUser = { ...baseUser, manuallyLockedFields: ['h_index'] };
    const obs = mapAuthorProfileToObservations(baseProfile, locked, fixedDate);
    expect(obs.find((o) => o.field === 'h_index')).toBeUndefined();
    // googleScholarId, googleScholarMetricsUpdatedAt, topics, image_url still emitted
    expect(obs.find((o) => o.field === 'googleScholarId')).toBeDefined();
  });

  it('skips topics when manuallyLockedFields includes "topics" and image_url when locked', () => {
    const locked: MapTargetUser = { ...baseUser, manuallyLockedFields: ['topics', 'image_url'] };
    const obs = mapAuthorProfileToObservations(baseProfile, locked, fixedDate);
    expect(obs.find((o) => o.field === 'topics')).toBeUndefined();
    expect(obs.find((o) => o.field === 'image_url')).toBeUndefined();
  });

  it('handles an empty publications array without crashing', () => {
    const obs = mapAuthorProfileToObservations(
      { ...baseProfile, publications: [] },
      baseUser,
      fixedDate,
    );
    // Should still emit the user-level observations; no Paper observations.
    expect(obs.some((o) => o.entityType === 'paper')).toBe(false);
    expect(obs.find((o) => o.field === 'googleScholarMetricsUpdatedAt')).toBeDefined();
  });

  it('emits Paper observations with deterministic gs:<authorId>:<hash> entityKeys', () => {
    const obs = mapAuthorProfileToObservations(
      {
        ...baseProfile,
        publications: [
          {
            title: 'A Theory of Justice',
            authors: 'John Rawls, Jane Doe',
            venue: 'Harvard University Press',
            year: 1971,
            citationCount: 87654,
          },
          {
            title: 'On Liberty',
            authors: 'J.S. Mill',
            year: '1859',
            citationCount: 12345,
          },
        ],
      },
      baseUser,
      fixedDate,
    );

    const paperObs = obs.filter((o) => o.entityType === 'paper');
    const titles = paperObs.filter((o) => o.field === 'title').map((o) => o.value);
    expect(titles).toContain('A Theory of Justice');
    expect(titles).toContain('On Liberty');

    // Each paper entityKey starts with gs:<authorId>:
    const keys = new Set(paperObs.map((o) => o.entityKey!));
    for (const k of keys) expect(k.startsWith('gs:GS_AUTHOR_1:')).toBe(true);

    // year was coerced from string for the Mill paper
    const millObs = paperObs.filter((o) => o.entityKey === `gs:GS_AUTHOR_1:${paperHash('On Liberty', 1859)}`);
    expect(millObs.find((o) => o.field === 'year')!.value).toBe(1859);

    // sources tag is google-scholar
    const srcs = paperObs.filter((o) => o.field === 'sources');
    expect(srcs.length).toBeGreaterThan(0);
    for (const s of srcs) expect(s.value).toEqual([PAPER_SOURCE_TAG]);

    // yaleAuthorIds and yaleAuthorNetIds are set from the user
    const ids = paperObs.find((o) => o.field === 'yaleAuthorIds');
    expect(ids!.value).toEqual(['user-id-1']);
    const netids = paperObs.find((o) => o.field === 'yaleAuthorNetIds');
    expect(netids!.value).toEqual(['abc123']);

    // authors string was split
    const authorsField = paperObs.find(
      (o) => o.field === 'authors' && o.entityKey === `gs:GS_AUTHOR_1:${paperHash('A Theory of Justice', 1971)}`,
    );
    expect(authorsField!.value).toEqual(['John Rawls', 'Jane Doe']);
  });

  it('skips publications with no title', () => {
    const obs = mapAuthorProfileToObservations(
      {
        ...baseProfile,
        publications: [
          { title: '', year: 2020, citationCount: 5 },
          { title: '   ', year: 2020 },
          { title: 'Real Title', year: 2020 },
        ],
      },
      baseUser,
      fixedDate,
    );
    const titles = obs.filter((o) => o.entityType === 'paper' && o.field === 'title');
    expect(titles).toHaveLength(1);
    expect(titles[0].value).toBe('Real Title');
  });
});

describe('TARGET_CATEGORIES', () => {
  it('targets humanities + social sciences', () => {
    expect(TARGET_CATEGORIES).toContain('Humanities & Arts');
    expect(TARGET_CATEGORIES).toContain('Social Sciences');
  });
});

// ---------------------------------------------------------------------------
// ApifyGoogleScholarScraper.run — full path
// ---------------------------------------------------------------------------

function makeFaculty(n: number): CandidateFaculty[] {
  return Array.from({ length: n }, (_, i) => ({
    _id: `id-${i}`,
    netid: `netid${i}`,
    fname: 'Test',
    lname: `User${i}`,
    googleScholarId: `GS_${i}`,
    image_url: '',
    manuallyLockedFields: [],
  }));
}

function profileFor(scholarId: string, overrides: Partial<ApifyAuthorProfile> = {}): ApifyAuthorProfile {
  return {
    recordType: 'authorProfile',
    authorId: scholarId,
    name: 'Mock',
    affiliation: 'Yale University',
    hIndex: 10,
    i10Index: 8,
    totalCitations: 200,
    interests: ['Topic A'],
    publications: [
      { title: `Paper for ${scholarId}`, authors: 'Mock', year: 2020, citationCount: 5 },
    ],
    profileImageUrl: 'https://scholar.google.com/img/x.jpg',
    ...overrides,
  };
}

describe('ApifyGoogleScholarScraper.run', () => {
  it('returns zero observations and a clear note when APIFY_API_TOKEN is missing', async () => {
    const callApify = vi.fn();
    const userFinder = vi.fn();
    const departmentResolver = vi.fn();
    const scraper = new ApifyGoogleScholarScraper({
      callApify,
      userFinder,
      departmentResolver,
      apiToken: '',
    });
    const { ctx, logs, emitted } = makeContext();
    const result = await scraper.run(ctx);

    expect(result.observationCount).toBe(0);
    expect(result.entitiesObserved).toBe(0);
    expect(result.notes).toMatch(/APIFY_API_TOKEN/);
    expect(emitted).toHaveLength(0);
    expect(callApify).not.toHaveBeenCalled();
    expect(userFinder).not.toHaveBeenCalled();
    expect(logs.some((l) => /APIFY_API_TOKEN/.test(l))).toBe(true);
  });

  it('batches eligible faculty into groups of 10 per Apify call', async () => {
    const faculty = makeFaculty(23);
    const callApify = vi.fn(async ({ body }) =>
      body.authorIds.map((id: string) => profileFor(id)),
    );
    const scraper = new ApifyGoogleScholarScraper({
      callApify,
      userFinder: async () => faculty,
      departmentResolver: async () => [],
      apiToken: 'apify-test',
    });
    const { ctx } = makeContext();
    await scraper.run(ctx);

    // 23 ids → batches of 10 / 10 / 3 → 3 calls
    expect(callApify).toHaveBeenCalledTimes(3);
    const sizes = callApify.mock.calls.map((c: any[]) => c[0].body.authorIds.length);
    expect(sizes).toEqual([10, 10, 3]);
  });

  it('rejects profiles whose affiliation does not mention Yale (homonym guard)', async () => {
    const faculty: CandidateFaculty[] = [
      {
        _id: 'mongo-id-1',
        netid: 'jdoe',
        googleScholarId: 'GS_WRONG_PERSON',
        image_url: '',
        manuallyLockedFields: [],
      },
    ];
    const profile: ApifyAuthorProfile = {
      recordType: 'authorProfile',
      authorId: 'GS_WRONG_PERSON',
      name: 'Jane Doe',
      affiliation: 'Professor, Office of Polar Programs',
      hIndex: 50,
      publications: [{ title: 'A Climate Paper', year: 2020, citationCount: 10 }],
    };
    const callApify = vi.fn(async () => [profile]);
    const scraper = new ApifyGoogleScholarScraper({
      callApify,
      userFinder: async () => faculty,
      departmentResolver: async () => [],
      apiToken: 'tok',
    });
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);

    expect(callApify).toHaveBeenCalledTimes(1);
    expect(result.entitiesObserved).toBe(0);
    expect(emitted.length).toBe(0);
  });

  it('admin-locked googleScholarId bypasses the Yale-affiliation guard', async () => {
    const faculty: CandidateFaculty[] = [
      {
        _id: 'mongo-id-1',
        netid: 'jdoe',
        googleScholarId: 'GS_JDOE',
        image_url: '',
        manuallyLockedFields: ['googleScholarId'],
      },
    ];
    const profile: ApifyAuthorProfile = {
      recordType: 'authorProfile',
      authorId: 'GS_JDOE',
      name: 'Jane Doe',
      affiliation: 'Visiting Scholar (recently moved)',
      hIndex: 22,
      publications: [{ title: 'Real Paper', year: 2024, citationCount: 5 }],
    };
    const callApify = vi.fn(async () => [profile]);
    const scraper = new ApifyGoogleScholarScraper({
      callApify,
      userFinder: async () => faculty,
      departmentResolver: async () => [],
      apiToken: 'tok',
    });
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);

    expect(result.entitiesObserved).toBe(1);
    expect(emitted.some((o) => o.field === 'h_index')).toBe(true);
  });

  it('emits the expected User + Paper observations end-to-end', async () => {
    const faculty: CandidateFaculty[] = [
      {
        _id: 'mongo-id-1',
        netid: 'jdoe',
        googleScholarId: 'GS_JDOE',
        image_url: '',
        manuallyLockedFields: [],
      },
    ];
    const profile: ApifyAuthorProfile = {
      recordType: 'authorProfile',
      authorId: 'GS_JDOE',
      name: 'Jane Doe',
      affiliation: 'Professor, Yale University',
      hIndex: 33,
      interests: ['Anthropology of Religion'],
      profileImageUrl: 'https://gs/jdoe.jpg',
      publications: [
        { title: 'Ritual Studies', authors: 'Jane Doe, Co Author', year: 2018, citationCount: 42 },
      ],
    };
    const callApify = vi.fn(async () => [profile]);
    const scraper = new ApifyGoogleScholarScraper({
      callApify,
      userFinder: async () => faculty,
      departmentResolver: async () => [],
      apiToken: 'tok',
      now: () => new Date('2026-04-27T00:00:00Z'),
    });
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);

    expect(callApify).toHaveBeenCalledTimes(1);
    expect(result.entitiesObserved).toBe(1);

    const userObs = emitted.filter((o) => o.entityType === 'user');
    const fields = new Set(userObs.map((o) => o.field));
    expect(fields.has('googleScholarId')).toBe(true);
    expect(fields.has('h_index')).toBe(true);
    expect(fields.has('image_url')).toBe(true);
    expect(fields.has('topics')).toBe(true);
    expect(fields.has('googleScholarMetricsUpdatedAt')).toBe(true);

    const paperObs = emitted.filter((o) => o.entityType === 'paper');
    expect(paperObs.length).toBeGreaterThan(0);
    const title = paperObs.find((o) => o.field === 'title');
    expect(title!.value).toBe('Ritual Studies');
    expect(title!.entityKey!.startsWith('gs:GS_JDOE:')).toBe(true);
  });

  it('respects ctx.options.limit by passing it through to userFinder', async () => {
    const faculty = makeFaculty(50);
    const userFinder = vi.fn(async (_q: any, limit?: number) =>
      limit ? faculty.slice(0, limit) : faculty,
    );
    const callApify = vi.fn(async ({ body }) =>
      body.authorIds.map((id: string) => profileFor(id)),
    );
    const scraper = new ApifyGoogleScholarScraper({
      callApify,
      userFinder,
      departmentResolver: async () => [],
      apiToken: 'tok',
    });
    const { ctx } = makeContext({ limit: 5 });
    const result = await scraper.run(ctx);

    expect(userFinder).toHaveBeenCalled();
    expect(userFinder.mock.calls[0][1]).toBe(5);
    // 5 faculty → 1 batch of 5
    expect(callApify).toHaveBeenCalledTimes(1);
    expect(callApify.mock.calls[0][0].body.authorIds).toHaveLength(5);
    expect(result.entitiesObserved).toBe(5);
  });

  it('skips the Apify call when every scholarId in a batch is in the cache', async () => {
    const faculty = makeFaculty(2);
    const callApify = vi.fn();
    getCachedSpy.mockImplementation(async (_src: string, key: string) => {
      // Both IDs hit the cache.
      const m = key.match(/^apify-gs:(.+)$/);
      if (!m) return null;
      return profileFor(m[1]);
    });
    const scraper = new ApifyGoogleScholarScraper({
      callApify,
      userFinder: async () => faculty,
      departmentResolver: async () => [],
      apiToken: 'tok',
      batchSize: 10,
    });
    const { ctx, emitted } = makeContext({ useCache: true });
    const result = await scraper.run(ctx);

    expect(callApify).not.toHaveBeenCalled();
    // We still emit observations from the cached payload
    expect(result.entitiesObserved).toBe(2);
    expect(emitted.some((o) => o.field === 'h_index')).toBe(true);
  });

  it('writes each returned profile to the per-scholarId cache after a fresh Apify call', async () => {
    const faculty = makeFaculty(2);
    const callApify = vi.fn(async ({ body }) =>
      body.authorIds.map((id: string) => profileFor(id)),
    );
    const scraper = new ApifyGoogleScholarScraper({
      callApify,
      userFinder: async () => faculty,
      departmentResolver: async () => [],
      apiToken: 'tok',
      batchSize: 10,
    });
    const { ctx } = makeContext({ useCache: true });
    await scraper.run(ctx);

    expect(callApify).toHaveBeenCalledTimes(1);
    expect(setCachedSpy).toHaveBeenCalledTimes(2);
    const keys = setCachedSpy.mock.calls.map((c: any[]) => c[1]);
    expect(keys).toEqual(expect.arrayContaining(['apify-gs:GS_0', 'apify-gs:GS_1']));
  });

  it('does not crash when Apify returns an empty array; logs progress', async () => {
    const faculty = makeFaculty(3);
    const callApify = vi.fn(async () => []);
    const scraper = new ApifyGoogleScholarScraper({
      callApify,
      userFinder: async () => faculty,
      departmentResolver: async () => [],
      apiToken: 'tok',
    });
    const { ctx, emitted, logs } = makeContext();
    const result = await scraper.run(ctx);

    expect(callApify).toHaveBeenCalledTimes(1);
    expect(emitted).toHaveLength(0);
    expect(result.entitiesObserved).toBe(0);
    expect(logs.some((l) => /progress: batch 1\/1/.test(l))).toBe(true);
  });

  it('continues to the next batch when one Apify call throws', async () => {
    const faculty = makeFaculty(15);
    const callApify = vi.fn(async ({ body }) => {
      if (body.authorIds.includes('GS_0')) {
        throw new Error('upstream 503');
      }
      return body.authorIds.map((id: string) => profileFor(id));
    });
    const scraper = new ApifyGoogleScholarScraper({
      callApify,
      userFinder: async () => faculty,
      departmentResolver: async () => [],
      apiToken: 'tok',
    });
    const { ctx, emitted, logs } = makeContext();
    const result = await scraper.run(ctx);

    expect(callApify).toHaveBeenCalledTimes(2);
    // Only the second batch (5 authors) produced observations
    expect(result.entitiesObserved).toBe(5);
    expect(emitted.length).toBeGreaterThan(0);
    expect(logs.some((l) => /Apify call failed/.test(l))).toBe(true);
  });

  it('returns a no-op result when no faculty are eligible', async () => {
    const callApify = vi.fn();
    const scraper = new ApifyGoogleScholarScraper({
      callApify,
      userFinder: async () => [],
      departmentResolver: async () => [],
      apiToken: 'tok',
    });
    const { ctx } = makeContext();
    const result = await scraper.run(ctx);

    expect(callApify).not.toHaveBeenCalled();
    expect(result.observationCount).toBe(0);
    expect(result.entitiesObserved).toBe(0);
    expect(result.notes).toMatch(/No eligible faculty/);
  });

  it('uses the resolved department names to scope the userFinder query when filterByCategory is on', async () => {
    const userFinder = vi.fn<(q: Record<string, unknown>, limit?: number) => Promise<CandidateFaculty[]>>(
      async () => [],
    );
    const departmentResolver = vi.fn(async () => ['English', 'History', 'Anthropology']);
    const scraper = new ApifyGoogleScholarScraper({
      callApify: vi.fn(),
      userFinder,
      departmentResolver,
      apiToken: 'tok',
      filterByCategory: true,
    });
    const { ctx } = makeContext();
    await scraper.run(ctx);

    expect(departmentResolver).toHaveBeenCalledWith(TARGET_CATEGORIES);
    const passedQuery = userFinder.mock.calls[0][0];
    expect(passedQuery.$or).toEqual([
      { primary_department: { $in: ['English', 'History', 'Anthropology'] } },
      { secondary_departments: { $in: ['English', 'History', 'Anthropology'] } },
      { departments: { $in: ['English', 'History', 'Anthropology'] } },
    ]);
  });

  it('drops the category filter when filterByCategory is off', async () => {
    const userFinder = vi.fn<(q: Record<string, unknown>, limit?: number) => Promise<CandidateFaculty[]>>(
      async () => [],
    );
    const departmentResolver = vi.fn();
    const scraper = new ApifyGoogleScholarScraper({
      callApify: vi.fn(),
      userFinder,
      departmentResolver,
      apiToken: 'tok',
      filterByCategory: false,
    });
    const { ctx } = makeContext();
    await scraper.run(ctx);

    expect(departmentResolver).not.toHaveBeenCalled();
    const passedQuery = userFinder.mock.calls[0][0];
    expect(passedQuery.$or).toBeUndefined();
  });

  it('skips Apify-returned profiles whose authorId does not match any queried user', async () => {
    const faculty: CandidateFaculty[] = [
      { _id: 'a', netid: 'a1', googleScholarId: 'GS_A', image_url: '', manuallyLockedFields: [] },
    ];
    const callApify = vi.fn(async () => [
      profileFor('GS_A'),
      profileFor('GS_GHOST'), // not in our user set
    ]);
    const scraper = new ApifyGoogleScholarScraper({
      callApify,
      userFinder: async () => faculty,
      departmentResolver: async () => [],
      apiToken: 'tok',
    });
    const { ctx, emitted, logs } = makeContext();
    const result = await scraper.run(ctx);

    expect(result.entitiesObserved).toBe(1);
    // No observations were emitted with the ghost authorId baked into entityKey
    const keys = emitted.map((o) => o.entityKey ?? '');
    expect(keys.some((k) => k.includes('GS_GHOST'))).toBe(false);
    expect(logs.some((l) => /GS_GHOST/.test(l))).toBe(true);
  });
});
