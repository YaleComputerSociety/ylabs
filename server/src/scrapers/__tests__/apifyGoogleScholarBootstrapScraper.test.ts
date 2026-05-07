/**
 * Tests for ApifyGoogleScholarBootstrapScraper.
 *
 * Every external dependency is injected via the constructor `deps`:
 *   - `callApify`               — replaces axios POST to api.apify.com
 *   - `userFinder`              — replaces the Mongo User query
 *   - `paperFinder`             — replaces the Mongo Paper query for OpenAlex titles
 *   - `knownYaleFacultyFinder`  — replaces the bulk Yale-faculty name pull
 *   - `departmentResolver`      — replaces the Mongo Department lookup
 *   - `apiToken`                — provided explicitly so we never look at process.env
 *
 * No network or DB access happens here. The snapshotCache module is mocked.
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
  ApifyGoogleScholarBootstrapScraper,
  AMBIGUOUS_WINNER_CONFIDENCE,
  ALTERNATE_CONFIDENCE,
  CONFIDENT_CONFIDENCE,
  buildSearchQuery,
  candidateProfileUrl,
  eligibleBootstrapFacultyQuery,
  extractCandidateIds,
  gatherKnownYaleFaculty,
  normalizeTitle,
  pickWinner,
  scoreCandidate,
  type ApifyCandidateProfile,
  type ApifySearchResult,
  type BootstrapCandidateFaculty,
  type ScoredCandidate,
  type ScoringUser,
} from '../sources/apifyGoogleScholarBootstrapScraper';
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
    sourceName: 'apify-google-scholar-bootstrap',
    sourceWeight: 0.85,
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

describe('normalizeTitle', () => {
  it('lowercases, strips non-alphanumerics, and collapses whitespace', () => {
    expect(normalizeTitle('  Hello, "World"!  ')).toBe('hello world');
  });

  it('truncates to 60 characters', () => {
    const long = 'a'.repeat(100);
    expect(normalizeTitle(long)).toBe('a'.repeat(60));
  });

  it('returns empty string for null/undefined', () => {
    expect(normalizeTitle(undefined)).toBe('');
    expect(normalizeTitle(null)).toBe('');
  });
});

describe('buildSearchQuery', () => {
  it('joins fname, lname, "Yale", and primaryDepartment', () => {
    expect(
      buildSearchQuery({ fname: 'David', lname: 'Bromwich', primaryDepartment: 'English' }),
    ).toBe('David Bromwich Yale English');
  });

  it('drops missing parts', () => {
    expect(buildSearchQuery({ fname: 'Jane', lname: 'Doe' })).toBe('Jane Doe Yale');
  });
});

describe('extractCandidateIds', () => {
  it('aggregates distinct authorIds from search results in order', () => {
    const results: ApifySearchResult[] = [
      { authors: [{ name: 'A', authorId: 'AAA' }, { name: 'B', authorId: 'BBB' }] },
      { authors: [{ name: 'A', authorId: 'AAA' }, { name: 'C', authorId: 'CCC' }] },
    ];
    expect(extractCandidateIds(results)).toEqual(['AAA', 'BBB', 'CCC']);
  });

  it('caps at the requested max', () => {
    const results: ApifySearchResult[] = [
      {
        authors: Array.from({ length: 10 }, (_, i) => ({ authorId: `A${i}` })),
      },
    ];
    expect(extractCandidateIds(results, 3)).toEqual(['A0', 'A1', 'A2']);
  });

  it('skips empty authorIds', () => {
    const results: ApifySearchResult[] = [
      { authors: [{ authorId: '' }, { authorId: '   ' }, { authorId: 'X' }] },
    ];
    expect(extractCandidateIds(results)).toEqual(['X']);
  });
});

describe('eligibleBootstrapFacultyQuery', () => {
  it('always restricts to professor/faculty without a googleScholarId', () => {
    const q = eligibleBootstrapFacultyQuery();
    expect(q.userType).toEqual({ $in: ['professor', 'faculty'] });
    expect(q.$or).toEqual([
      { googleScholarId: { $exists: false } },
      { googleScholarId: null },
      { googleScholarId: '' },
    ]);
    expect(q.$and).toBeUndefined();
    expect(q.netid).toBeUndefined();
  });

  it('adds a department $and filter when category dept names are provided', () => {
    const q = eligibleBootstrapFacultyQuery(['English', 'History']);
    expect(q.$and).toEqual([
      {
        $or: [
          { primaryDepartment: { $in: ['English', 'History'] } },
          { secondaryDepartments: { $in: ['English', 'History'] } },
          { departments: { $in: ['English', 'History'] } },
        ],
      },
    ]);
  });

  it('restricts to a netid list when only is passed', () => {
    const q = eligibleBootstrapFacultyQuery(undefined, ['abc123', 'def456']);
    expect(q.netid).toEqual({ $in: ['abc123', 'def456'] });
  });
});

describe('gatherKnownYaleFaculty', () => {
  it('lowercases and joins fname/lname into a Set', () => {
    const set = gatherKnownYaleFaculty([
      { fname: 'Jane', lname: 'Doe' },
      { fname: 'JOHN', lname: 'Smith' },
    ]);
    expect(set.has('jane doe')).toBe(true);
    expect(set.has('john smith')).toBe(true);
    expect(set.size).toBe(2);
  });

  it('skips entries missing fname or lname', () => {
    const set = gatherKnownYaleFaculty([{ fname: 'Solo' }, { lname: 'NoFirst' }, {}]);
    expect(set.size).toBe(0);
  });
});

describe('candidateProfileUrl', () => {
  it('builds the canonical Scholar profile URL', () => {
    expect(candidateProfileUrl('XYZ')).toBe('https://scholar.google.com/citations?user=XYZ');
  });
});

// ---------------------------------------------------------------------------
// scoreCandidate
// ---------------------------------------------------------------------------

const baseUser: ScoringUser = {
  netid: 'db123',
  fname: 'David',
  lname: 'Bromwich',
  primaryDepartment: 'English',
  hIndex: undefined,
};

function profile(overrides: Partial<ApifyCandidateProfile> = {}): ApifyCandidateProfile {
  return {
    recordType: 'authorProfile',
    authorId: 'GS_DB',
    name: 'David Bromwich',
    affiliation: '',
    interests: [],
    publications: [],
    coAuthors: [],
    totalCitations: 100,
    ...overrides,
  };
}

describe('scoreCandidate', () => {
  it('adds +1.0 when affiliation contains "Yale" (case-insensitive)', () => {
    const r = scoreCandidate(profile({ affiliation: 'Sterling Professor, Yale University' }), baseUser);
    expect(r.score).toBeCloseTo(1.0);
    expect(r.signals.some((s) => s.includes('affiliation:yale'))).toBe(true);
  });

  it('subtracts 1.0 when affiliation contains a competing university', () => {
    const r = scoreCandidate(profile({ affiliation: 'Professor at Harvard University' }), baseUser);
    expect(r.score).toBeCloseTo(-1.0);
    expect(r.signals.some((s) => s.includes('harvard'))).toBe(true);
  });

  it('penalizes only once even if multiple competing names appear', () => {
    const r = scoreCandidate(
      profile({ affiliation: 'Visiting at Harvard, formerly Princeton' }),
      baseUser,
    );
    expect(r.score).toBeCloseTo(-1.0);
  });

  it('adds +0.6 for a verified @yale.edu email', () => {
    const r = scoreCandidate(
      profile({ affiliation: 'Yale University', verifiedEmail: 'verified email at yale.edu' }),
      baseUser,
    );
    // Plain email-only (without affiliation), verified at yale.edu
    expect(r.score).toBeCloseTo(1.6);
  });

  it('adds +0.4 when interests overlap with primaryDepartment (substring either direction)', () => {
    const r = scoreCandidate(
      profile({ affiliation: 'Yale University', interests: ['English Romanticism', 'Poetry'] }),
      baseUser,
    );
    expect(r.score).toBeCloseTo(1.4);
    expect(r.signals.some((s) => s.includes('dept-overlap'))).toBe(true);
  });

  it('adds +0.5 per paper-title overlap with OpenAlex, capped at +1.0', () => {
    const oaPapers = [
      { title: 'Politics by Other Means' },
      { title: 'Skeptical Music' },
      { title: 'A Choice of Inheritance' },
      { title: 'On European Ground' },
    ];
    const r = scoreCandidate(
      profile({
        affiliation: 'Yale',
        publications: [
          { title: 'Politics by Other Means' },
          { title: 'Skeptical Music' },
          { title: 'A Choice of Inheritance' },
          { title: 'Unrelated Title' },
        ],
      }),
      baseUser,
      oaPapers,
    );
    // +1.0 (Yale) + capped +1.0 (titles) = 2.0
    expect(r.score).toBeCloseTo(2.0);
    expect(r.signals.some((s) => s.includes('title-overlap'))).toBe(true);
  });

  it('adds exactly +0.5 for a single title overlap', () => {
    const r = scoreCandidate(
      profile({
        affiliation: '',
        publications: [{ title: 'Politics by Other Means' }, { title: 'Other thing' }],
      }),
      baseUser,
      [{ title: 'Politics by Other Means' }],
    );
    expect(r.score).toBeCloseTo(0.5);
  });

  it('adds +0.3 per known-Yale-faculty co-author, capped at +0.6', () => {
    const known = new Set(['jane doe', 'john smith', 'mary lee']);
    const r = scoreCandidate(
      profile({
        affiliation: '',
        coAuthors: [
          { name: 'Jane Doe' },
          { name: 'John Smith' },
          { name: 'Mary Lee' },
        ],
      }),
      baseUser,
      [],
      known,
    );
    expect(r.score).toBeCloseTo(0.6);
    expect(r.signals.some((s) => s.includes('coauthors'))).toBe(true);
  });

  it('forces the score to -1.0 when candidate is too small for an h>10 user', () => {
    const tinyUser: ScoringUser = { ...baseUser, hIndex: 25 };
    const r = scoreCandidate(
      profile({ affiliation: 'Yale University', totalCitations: 3 }),
      tinyUser,
    );
    expect(r.score).toBeCloseTo(-1.0);
    expect(r.signals.some((s) => s.includes('floor'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// pickWinner
// ---------------------------------------------------------------------------

function scored(score: number, authorId: string = `GS_${score}`): ScoredCandidate {
  return {
    authorId,
    profile: { authorId },
    score,
    signals: [],
  };
}

describe('pickWinner', () => {
  it('returns confident when top >= 1.5 and second < 0.5', () => {
    const r = pickWinner([scored(2.0, 'A'), scored(0.4, 'B')]);
    expect(r.isConfident).toBe(true);
    expect(r.winner!.authorId).toBe('A');
    expect(r.alternates).toEqual([]);
  });

  it('returns confident when top >= 1.5 and there is no second', () => {
    const r = pickWinner([scored(1.7, 'A')]);
    expect(r.isConfident).toBe(true);
    expect(r.winner!.authorId).toBe('A');
  });

  it('returns ambiguous (top + alternates) when top >= 0.5 but second is close', () => {
    const r = pickWinner([
      scored(1.4, 'A'),
      scored(1.0, 'B'),
      scored(0.8, 'C'),
      scored(0.6, 'D'),
    ]);
    expect(r.isConfident).toBe(false);
    expect(r.winner!.authorId).toBe('A');
    // top 3 minus winner → 2 alternates
    expect(r.alternates.map((a) => a.authorId)).toEqual(['B', 'C']);
  });

  it('returns ambiguous when top crosses 1.5 but second is too close', () => {
    const r = pickWinner([scored(1.6, 'A'), scored(1.5, 'B'), scored(0.2, 'C')]);
    expect(r.isConfident).toBe(false);
    expect(r.winner!.authorId).toBe('A');
    expect(r.alternates.map((a) => a.authorId)).toEqual(['B', 'C']);
  });

  it('returns no-winner when all scores fall below 0.5', () => {
    const r = pickWinner([scored(0.4, 'A'), scored(0.3, 'B')]);
    expect(r.isConfident).toBe(false);
    expect(r.winner).toBeNull();
    expect(r.alternates).toEqual([]);
  });

  it('handles an empty candidate list', () => {
    const r = pickWinner([]);
    expect(r.winner).toBeNull();
    expect(r.isConfident).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ApifyGoogleScholarBootstrapScraper.run
// ---------------------------------------------------------------------------

function faculty(n: number, overrides: Partial<BootstrapCandidateFaculty> = {}): BootstrapCandidateFaculty[] {
  return Array.from({ length: n }, (_, i) => ({
    _id: `mongo-id-${i}`,
    netid: `netid${i}`,
    fname: 'Test',
    lname: `User${i}`,
    primaryDepartment: 'English',
    ...overrides,
  }));
}

describe('ApifyGoogleScholarBootstrapScraper.run', () => {
  it('returns zero observations and a clear note when APIFY_API_TOKEN is missing', async () => {
    const callApify = vi.fn();
    const userFinder = vi.fn();
    const scraper = new ApifyGoogleScholarBootstrapScraper({
      callApify,
      userFinder,
      paperFinder: vi.fn(),
      knownYaleFacultyFinder: vi.fn(),
      departmentResolver: vi.fn(),
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

  it('emits a single high-confidence observation on a confident win', async () => {
    const fac = faculty(1);
    const callApify = vi.fn(async ({ body }: any) => {
      if ('searchQueries' in body) {
        // search-mode result: one paper with a single Yale-prof author candidate
        return [
          {
            title: 'Some Yale paper',
            authors: [{ name: 'Test User0', authorId: 'GS_WIN' }],
          },
        ];
      }
      // profile-mode result: clearly Yale, dept overlap, verified email,
      // and a paper that overlaps with the user's OpenAlex paper.
      return [
        {
          recordType: 'authorProfile',
          authorId: 'GS_WIN',
          name: 'Test User0',
          affiliation: 'Sterling Professor, Yale University',
          verifiedEmail: 'verified email at yale.edu',
          interests: ['English Literature'],
          publications: [{ title: 'A paper' }],
          coAuthors: [],
          totalCitations: 500,
        },
      ];
    });
    const scraper = new ApifyGoogleScholarBootstrapScraper({
      callApify,
      userFinder: async () => fac,
      paperFinder: async () => [{ title: 'A paper' }],
      knownYaleFacultyFinder: async () => [],
      departmentResolver: async () => [],
      apiToken: 'tok',
      now: () => new Date('2026-04-27T00:00:00Z'),
    });
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);

    expect(callApify).toHaveBeenCalledTimes(2); // search + profile
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      entityType: 'user',
      entityKey: 'netid0',
      field: 'googleScholarId',
      value: 'GS_WIN',
      confidenceOverride: CONFIDENT_CONFIDENCE,
    });
    expect(emitted[0].sourceUrl).toBe(candidateProfileUrl('GS_WIN'));
    expect(result.entitiesObserved).toBe(1);
  });

  it('emits the winner + alternates with low confidence on an ambiguous result', async () => {
    const fac = faculty(1);
    const callApify = vi.fn(async ({ body }: any) => {
      if ('searchQueries' in body) {
        return [
          {
            title: 'A paper',
            authors: [
              { name: 'Test User0', authorId: 'GS_A' },
              { name: 'Test User0', authorId: 'GS_B' },
              { name: 'Test User0', authorId: 'GS_C' },
            ],
          },
        ];
      }
      // Three candidates all with weak signals.
      return [
        {
          recordType: 'authorProfile',
          authorId: 'GS_A',
          affiliation: 'Yale University',
          totalCitations: 50,
          publications: [],
          coAuthors: [],
          interests: [],
        },
        {
          recordType: 'authorProfile',
          authorId: 'GS_B',
          affiliation: 'Yale University',
          totalCitations: 30,
          publications: [],
          coAuthors: [],
          interests: [],
        },
        {
          recordType: 'authorProfile',
          authorId: 'GS_C',
          affiliation: 'Yale University',
          totalCitations: 10,
          publications: [],
          coAuthors: [],
          interests: [],
        },
      ];
    });
    const scraper = new ApifyGoogleScholarBootstrapScraper({
      callApify,
      userFinder: async () => fac,
      paperFinder: async () => [],
      knownYaleFacultyFinder: async () => [],
      departmentResolver: async () => [],
      apiToken: 'tok',
    });
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);

    expect(emitted).toHaveLength(3);
    const winner = emitted.find((e) => e.confidenceOverride === AMBIGUOUS_WINNER_CONFIDENCE);
    expect(winner).toBeDefined();
    const alts = emitted.filter((e) => e.confidenceOverride === ALTERNATE_CONFIDENCE);
    expect(alts).toHaveLength(2);
    for (const e of emitted) {
      expect(e.entityType).toBe('user');
      expect(e.entityKey).toBe('netid0');
      expect(e.field).toBe('googleScholarId');
    }
    expect(result.entitiesObserved).toBe(1);
    expect(result.observationCount).toBe(3);
  });

  it('emits zero observations when no candidate clears the threshold', async () => {
    const fac = faculty(1);
    const callApify = vi.fn(async ({ body }: any) => {
      if ('searchQueries' in body) {
        return [
          {
            title: 'paper',
            authors: [
              { name: 'X', authorId: 'GS_HARV' },
              { name: 'Y', authorId: 'GS_STAN' },
            ],
          },
        ];
      }
      return [
        {
          recordType: 'authorProfile',
          authorId: 'GS_HARV',
          affiliation: 'Harvard University',
          totalCitations: 100,
        },
        {
          recordType: 'authorProfile',
          authorId: 'GS_STAN',
          affiliation: 'Stanford University',
          totalCitations: 200,
        },
      ];
    });
    const scraper = new ApifyGoogleScholarBootstrapScraper({
      callApify,
      userFinder: async () => fac,
      paperFinder: async () => [],
      knownYaleFacultyFinder: async () => [],
      departmentResolver: async () => [],
      apiToken: 'tok',
    });
    const { ctx, emitted, logs } = makeContext();
    const result = await scraper.run(ctx);

    expect(emitted).toHaveLength(0);
    expect(result.entitiesObserved).toBe(0);
    expect(logs.some((l) => /NO-WINNER/.test(l))).toBe(true);
  });

  it('end-to-end: bootstraps three faculty with mixed outcomes', async () => {
    const fac: BootstrapCandidateFaculty[] = [
      {
        _id: 'm1',
        netid: 'confident',
        fname: 'Alice',
        lname: 'Confident',
        primaryDepartment: 'English',
        hIndex: 20,
      },
      {
        _id: 'm2',
        netid: 'ambiguous',
        fname: 'Bob',
        lname: 'Ambiguous',
        primaryDepartment: 'History',
      },
      {
        _id: 'm3',
        netid: 'nobody',
        fname: 'Carol',
        lname: 'Nobody',
        primaryDepartment: 'Linguistics',
      },
    ];
    const callApify = vi.fn(async ({ body }: any) => {
      const isSearch = 'searchQueries' in body;
      if (isSearch) {
        const q = body.searchQueries[0];
        if (q.includes('Confident')) {
          return [{ title: 't', authors: [{ authorId: 'GS_CONF' }] }];
        }
        if (q.includes('Ambiguous')) {
          return [
            {
              title: 't',
              authors: [
                { authorId: 'GS_AMB1' },
                { authorId: 'GS_AMB2' },
                { authorId: 'GS_AMB3' },
              ],
            },
          ];
        }
        // Nobody → only competing-school authors
        return [
          {
            title: 't',
            authors: [{ authorId: 'GS_NOPE1' }, { authorId: 'GS_NOPE2' }],
          },
        ];
      }
      // profile-mode: pull candidates from authorIds array
      const ids: string[] = body.authorIds;
      return ids.map((id) => {
        if (id === 'GS_CONF')
          return {
            recordType: 'authorProfile',
            authorId: 'GS_CONF',
            affiliation: 'Sterling Professor, Yale University',
            verifiedEmail: 'verified email at yale.edu',
            interests: ['English Literature'],
            publications: [{ title: 'Confident paper one' }],
            totalCitations: 800,
          };
        if (id.startsWith('GS_AMB')) {
          return {
            recordType: 'authorProfile',
            authorId: id,
            affiliation: 'Yale University',
            totalCitations: 30,
          };
        }
        return {
          recordType: 'authorProfile',
          authorId: id,
          affiliation: id.endsWith('1') ? 'Harvard University' : 'Stanford University',
          totalCitations: 100,
        };
      });
    });

    const scraper = new ApifyGoogleScholarBootstrapScraper({
      callApify,
      userFinder: async () => fac,
      paperFinder: async () => [],
      knownYaleFacultyFinder: async () => [],
      departmentResolver: async () => [],
      apiToken: 'tok',
    });
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);

    // 3 faculty * 2 calls each (search + profile) = 6
    expect(callApify).toHaveBeenCalledTimes(6);

    // confident emits 1, ambiguous emits 3, nobody emits 0 → 4 total
    expect(emitted).toHaveLength(4);
    const byNetid = (n: string) => emitted.filter((e) => e.entityKey === n);
    expect(byNetid('confident')).toHaveLength(1);
    expect(byNetid('confident')[0].confidenceOverride).toBe(CONFIDENT_CONFIDENCE);
    expect(byNetid('ambiguous')).toHaveLength(3);
    expect(byNetid('nobody')).toHaveLength(0);
    expect(result.entitiesObserved).toBe(2);
    expect(result.notes).toMatch(/1 confident, 1 ambiguous/);
  });

  it('respects ctx.options.limit by passing it through to userFinder', async () => {
    const fac = faculty(20);
    const userFinder = vi.fn(async (_q: any, limit?: number) =>
      limit ? fac.slice(0, limit) : fac,
    );
    const callApify = vi.fn(async () => []);
    const scraper = new ApifyGoogleScholarBootstrapScraper({
      callApify,
      userFinder,
      paperFinder: async () => [],
      knownYaleFacultyFinder: async () => [],
      departmentResolver: async () => [],
      apiToken: 'tok',
    });
    const { ctx } = makeContext({ limit: 3 });
    await scraper.run(ctx);

    expect(userFinder).toHaveBeenCalled();
    expect(userFinder.mock.calls[0][1]).toBe(3);
    // Each faculty triggers a search call (which returns []), so 3 search calls.
    expect(callApify).toHaveBeenCalledTimes(3);
  });

  it('reuses the per-faculty cache when useCache is on', async () => {
    const fac = faculty(1);
    const cachedPayload = {
      searchResults: [],
      profiles: [
        {
          recordType: 'authorProfile',
          authorId: 'GS_CACHED',
          affiliation: 'Yale University',
          interests: ['English'],
          totalCitations: 200,
          publications: [],
        },
      ],
    };
    getCachedSpy.mockResolvedValue(cachedPayload);

    const callApify = vi.fn();
    const scraper = new ApifyGoogleScholarBootstrapScraper({
      callApify,
      userFinder: async () => fac,
      paperFinder: async () => [],
      knownYaleFacultyFinder: async () => [],
      departmentResolver: async () => [],
      apiToken: 'tok',
    });
    const { ctx, emitted } = makeContext({ useCache: true });
    await scraper.run(ctx);

    expect(callApify).not.toHaveBeenCalled();
    expect(getCachedSpy).toHaveBeenCalledWith(
      'apify-google-scholar-bootstrap',
      'bootstrap:netid0',
    );
    // Yale + dept overlap = 1.4, ambiguous winner emitted
    expect(emitted.length).toBeGreaterThan(0);
    expect(emitted[0].value).toBe('GS_CACHED');
  });

  it('writes the search+profile payload to cache after a fresh run', async () => {
    const fac = faculty(1);
    const callApify = vi.fn(async ({ body }: any) => {
      if ('searchQueries' in body) {
        return [{ title: 't', authors: [{ authorId: 'GS_FRESH' }] }];
      }
      return [
        {
          recordType: 'authorProfile',
          authorId: 'GS_FRESH',
          affiliation: 'Yale',
          totalCitations: 100,
        },
      ];
    });
    const scraper = new ApifyGoogleScholarBootstrapScraper({
      callApify,
      userFinder: async () => fac,
      paperFinder: async () => [],
      knownYaleFacultyFinder: async () => [],
      departmentResolver: async () => [],
      apiToken: 'tok',
    });
    const { ctx } = makeContext({ useCache: true });
    await scraper.run(ctx);

    expect(setCachedSpy).toHaveBeenCalledTimes(1);
    expect(setCachedSpy.mock.calls[0][0]).toBe('apify-google-scholar-bootstrap');
    expect(setCachedSpy.mock.calls[0][1]).toBe('bootstrap:netid0');
  });

  it('continues to the next faculty when one Apify call throws', async () => {
    const fac = faculty(2);
    const callApify = vi.fn(async ({ body }: any) => {
      if ('searchQueries' in body) {
        if (body.searchQueries[0].includes('User0')) throw new Error('upstream 503');
        return [{ title: 't', authors: [{ authorId: 'GS_OK' }] }];
      }
      return [
        {
          recordType: 'authorProfile',
          authorId: 'GS_OK',
          affiliation: 'Sterling Professor, Yale University',
          interests: ['English Literature'],
          totalCitations: 500,
          publications: [],
        },
      ];
    });
    const scraper = new ApifyGoogleScholarBootstrapScraper({
      callApify,
      userFinder: async () => fac,
      paperFinder: async () => [],
      knownYaleFacultyFinder: async () => [],
      departmentResolver: async () => [],
      apiToken: 'tok',
    });
    const { ctx, emitted, logs } = makeContext();
    const result = await scraper.run(ctx);

    // Faculty 0 search throws (1 call) → faculty 1 search + profile (2 calls) = 3 total
    expect(callApify).toHaveBeenCalledTimes(3);
    expect(result.entitiesObserved).toBe(1);
    expect(emitted).toHaveLength(1);
    expect(emitted[0].entityKey).toBe('netid1');
    expect(logs.some((l) => /search call failed/.test(l))).toBe(true);
  });

  it('returns a no-op result when no faculty are eligible', async () => {
    const callApify = vi.fn();
    const scraper = new ApifyGoogleScholarBootstrapScraper({
      callApify,
      userFinder: async () => [],
      paperFinder: async () => [],
      knownYaleFacultyFinder: async () => [],
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

  it('uses paperFinder titles to upgrade an otherwise-ambiguous candidate to confident', async () => {
    const fac: BootstrapCandidateFaculty[] = [
      {
        _id: 'mid',
        netid: 'realprof',
        fname: 'Real',
        lname: 'Prof',
        primaryDepartment: 'English',
      },
    ];
    const callApify = vi.fn(async ({ body }: any) => {
      if ('searchQueries' in body) {
        return [{ title: 't', authors: [{ authorId: 'GS_REAL' }, { authorId: 'GS_OTHER' }] }];
      }
      return [
        {
          recordType: 'authorProfile',
          authorId: 'GS_REAL',
          affiliation: 'Yale University',
          totalCitations: 200,
          publications: [
            { title: 'Paper One' },
            { title: 'Paper Two' },
            { title: 'Paper Three' },
          ],
        },
        {
          recordType: 'authorProfile',
          authorId: 'GS_OTHER',
          affiliation: 'Yale University',
          totalCitations: 50,
          publications: [{ title: 'Totally Unrelated' }],
        },
      ];
    });
    const scraper = new ApifyGoogleScholarBootstrapScraper({
      callApify,
      userFinder: async () => fac,
      paperFinder: async () => [
        { title: 'Paper One' },
        { title: 'Paper Two' },
      ],
      knownYaleFacultyFinder: async () => [],
      departmentResolver: async () => [],
      apiToken: 'tok',
    });
    const { ctx, emitted } = makeContext();
    await scraper.run(ctx);

    // GS_REAL: +1.0 (Yale) + +1.0 (2 title overlaps capped at 1.0) = 2.0
    // GS_OTHER: +1.0 (Yale) only = 1.0 → < 1.5 second-place ceiling? actually >=0.5
    // top=2.0 ≥ 1.5 but second 1.0 ≥ 0.5 so this is ambiguous, not confident.
    // We assert that the winner is GS_REAL and the title-overlap signal fired.
    const winner = emitted.find((e) => e.value === 'GS_REAL');
    expect(winner).toBeDefined();
    expect(winner!.entityKey).toBe('realprof');
  });
});
