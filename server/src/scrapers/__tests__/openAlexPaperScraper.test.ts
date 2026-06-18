/**
 * Unit tests for OpenAlexPaperScraper.
 *
 * Pure helpers (`normalizeOpenAlexId`, `normalizeOrcid`, `isExactNameMatch`)
 * are exercised directly. The author-id lookups
 * (`lookupAuthorIdByOrcid`, `lookupAuthorIdByName`) are tested with an
 * injected fetcher so no real HTTP fires. The full `run()` is tested with
 * both the fetcher and the User model mocked.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  OpenAlexPaperScraper,
  lookupAuthorIdByOrcid,
  lookupAuthorIdByName,
  normalizeOpenAlexId,
  normalizeOrcid,
  isExactNameMatch,
  resolveAuthorIdForFaculty,
  type HttpFetcher,
} from '../sources/openAlexPaperScraper';
import type { ScraperContext, ObservationInput } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<ScraperContext['options']> = {}) {
  const emitted: ObservationInput[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'test-run',
    sourceId: 'test-source',
    sourceName: 'openalex',
    sourceWeight: 0.85,
    options: {
      dryRun: true,
      useCache: false,
      release: false,
      ...overrides,
    },
    emit: async (obs) => {
      if (Array.isArray(obs)) emitted.push(...obs);
      else emitted.push(obs);
    },
    log: () => {},
  };
  return { ctx, emitted };
}

/**
 * Build a mock User.find chain that mirrors the Mongoose `find().lean().limit()`
 * pattern: `lean()` returns a thenable Query that ALSO exposes `.limit()` (which
 * returns the same kind of thenable). Returns the same `rows` for any query
 * shape, applying the limit when provided.
 */
function mockUserModel(rows: any[]) {
  return {
    find: vi.fn(() => buildLeanQuery(rows)) as any,
  };
}

function buildLeanQuery(rows: any[]) {
  // The find() return value supports `.lean()` (chainable) and `.limit()` for
  // the rare callers that limit before leaning. We don't need the raw shape
  // because the scraper always calls `.lean()` first.
  return {
    lean: () => buildThenableLeanQuery(rows),
    limit: (n: number) => ({
      lean: () => buildThenableLeanQuery(rows.slice(0, n)),
    }),
  };
}

function buildThenableLeanQuery(rows: any[]) {
  // Mongoose's Query is thenable AND chainable. Reproduce both:
  //   await query                       → resolves to rows
  //   query.limit(n).then(...)           → resolves to rows.slice(0, n)
  const obj: any = {
    then: (resolve: (v: any) => any, reject?: (e: any) => any) =>
      Promise.resolve(rows).then(resolve, reject),
    limit: (n: number) => buildThenableLeanQuery(rows.slice(0, n)),
  };
  return obj;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('normalizeOpenAlexId', () => {
  it('strips the openalex.org URL prefix', () => {
    expect(normalizeOpenAlexId('https://openalex.org/A12345')).toBe('A12345');
    expect(normalizeOpenAlexId('http://openalex.org/A777')).toBe('A777');
  });
  it('passes through bare ids and trims', () => {
    expect(normalizeOpenAlexId('  A99 ')).toBe('A99');
  });
  it('returns null for falsy input', () => {
    expect(normalizeOpenAlexId('')).toBeNull();
    expect(normalizeOpenAlexId(undefined)).toBeNull();
    expect(normalizeOpenAlexId(null)).toBeNull();
  });
});

describe('normalizeOrcid', () => {
  it('strips the orcid.org URL prefix', () => {
    expect(normalizeOrcid('https://orcid.org/0000-0001-2345-6789')).toBe('0000-0001-2345-6789');
  });
  it('passes through bare ORCIDs', () => {
    expect(normalizeOrcid('0000-0002-1111-2222')).toBe('0000-0002-1111-2222');
  });
  it('returns null on empty', () => {
    expect(normalizeOrcid(undefined)).toBeNull();
  });
});

describe('isExactNameMatch', () => {
  it('matches exact first + last name (case-insensitive)', () => {
    expect(isExactNameMatch('Amy Arnsten', 'Amy', 'Arnsten')).toBe(true);
    expect(isExactNameMatch('AMY ARNSTEN', 'amy', 'arnsten')).toBe(true);
  });
  it('tolerates middle names/initials', () => {
    expect(isExactNameMatch('Amy F Arnsten', 'Amy', 'Arnsten')).toBe(true);
    expect(isExactNameMatch('Amy Frances Arnsten', 'Amy', 'Arnsten')).toBe(true);
  });
  it('rejects different first or last name', () => {
    expect(isExactNameMatch('Amelia Arnsten', 'Amy', 'Arnsten')).toBe(false);
    expect(isExactNameMatch('Amy Aronson', 'Amy', 'Arnsten')).toBe(false);
  });
  it('rejects empty inputs', () => {
    expect(isExactNameMatch(undefined, 'Amy', 'Arnsten')).toBe(false);
    expect(isExactNameMatch('Amy Arnsten', '', 'Arnsten')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// lookupAuthorIdByOrcid
// ---------------------------------------------------------------------------

describe('lookupAuthorIdByOrcid', () => {
  it('returns the OpenAlex author id when one match is found', async () => {
    const fetcher: HttpFetcher = vi.fn(async () => ({
      results: [{ id: 'https://openalex.org/A1234', display_name: 'Amy Arnsten' }],
    }));
    const id = await lookupAuthorIdByOrcid(
      '0000-0001-2345-6789',
      'test@example.com',
      fetcher,
    );
    expect(id).toBe('https://openalex.org/A1234');
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.openalex.org/authors',
      expect.objectContaining({ filter: 'orcid:0000-0001-2345-6789' }),
    );
  });

  it('returns null when the API returns zero authors', async () => {
    const fetcher: HttpFetcher = vi.fn(async () => ({ results: [] }));
    const id = await lookupAuthorIdByOrcid('0000-0001-2345-6789', 'x@y.io', fetcher);
    expect(id).toBeNull();
  });

  it('returns null when ORCID is empty / falsy', async () => {
    const fetcher: HttpFetcher = vi.fn();
    expect(await lookupAuthorIdByOrcid('', 'x@y.io', fetcher)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('returns null when the fetcher throws', async () => {
    const fetcher: HttpFetcher = vi.fn(async () => {
      throw new Error('network down');
    });
    expect(await lookupAuthorIdByOrcid('0000-0001-2345-6789', 'x@y.io', fetcher)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// lookupAuthorIdByName
// ---------------------------------------------------------------------------

describe('lookupAuthorIdByName', () => {
  it('returns the id when a single Yale-affiliated author exactly matches', async () => {
    const fetcher: HttpFetcher = vi.fn(async () => ({
      results: [{ id: 'https://openalex.org/A777', display_name: 'Amy Arnsten' }],
    }));
    const id = await lookupAuthorIdByName('Amy', 'Arnsten', 'x@y.io', fetcher);
    expect(id).toBe('https://openalex.org/A777');
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.openalex.org/authors',
      expect.objectContaining({
        search: 'Amy Arnsten',
        filter: 'affiliations.institution.id:I32971472',
      }),
    );
  });

  it('returns null when results are ambiguous (multiple exact matches)', async () => {
    const fetcher: HttpFetcher = vi.fn(async () => ({
      results: [
        { id: 'https://openalex.org/A1', display_name: 'Amy Arnsten' },
        { id: 'https://openalex.org/A2', display_name: 'Amy Arnsten' },
      ],
    }));
    const id = await lookupAuthorIdByName('Amy', 'Arnsten', 'x@y.io', fetcher);
    expect(id).toBeNull();
  });

  it('returns null when no result has an exactly matching display_name', async () => {
    const fetcher: HttpFetcher = vi.fn(async () => ({
      results: [
        { id: 'https://openalex.org/A1', display_name: 'Amelia Arnsten' },
        { id: 'https://openalex.org/A2', display_name: 'Amy Aronson' },
      ],
    }));
    const id = await lookupAuthorIdByName('Amy', 'Arnsten', 'x@y.io', fetcher);
    expect(id).toBeNull();
  });

  it('tolerates a middle initial in the OpenAlex display_name', async () => {
    const fetcher: HttpFetcher = vi.fn(async () => ({
      results: [{ id: 'https://openalex.org/A777', display_name: 'Amy F Arnsten' }],
    }));
    const id = await lookupAuthorIdByName('Amy', 'Arnsten', 'x@y.io', fetcher);
    expect(id).toBe('https://openalex.org/A777');
  });

  it('returns null on empty fname/lname without making a request', async () => {
    const fetcher: HttpFetcher = vi.fn();
    expect(await lookupAuthorIdByName('', 'Arnsten', 'x@y.io', fetcher)).toBeNull();
    expect(await lookupAuthorIdByName('Amy', '', 'x@y.io', fetcher)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// resolveAuthorIdForFaculty (precedence)
// ---------------------------------------------------------------------------

describe('resolveAuthorIdForFaculty precedence', () => {
  it('prefers ORCID over openAlexId when both present', async () => {
    const fetcher: HttpFetcher = vi.fn(async (url, params) => {
      // Only the ORCID lookup should fire.
      expect(url).toBe('https://api.openalex.org/authors');
      expect(params.filter).toBe('orcid:0000-0001-2345-6789');
      return { results: [{ id: 'https://openalex.org/A-orcid-win' }] };
    });
    const { ctx } = makeContext();
    const resolved = await resolveAuthorIdForFaculty(
      {
        fname: 'Amy',
        lname: 'Arnsten',
        orcid: '0000-0001-2345-6789',
        openAlexId: 'A-stale',
      },
      'x@y.io',
      ctx,
      fetcher,
    );
    expect(resolved.method).toBe('orcid');
    expect(resolved.authorId).toBe('https://openalex.org/A-orcid-win');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('falls back to openAlexId when ORCID lookup returns nothing', async () => {
    const fetcher: HttpFetcher = vi.fn(async () => ({ results: [] }));
    const { ctx } = makeContext();
    const resolved = await resolveAuthorIdForFaculty(
      { fname: 'X', lname: 'Y', orcid: '0000-0001-0000-0000', openAlexId: 'A-existing' },
      'x@y.io',
      ctx,
      fetcher,
    );
    expect(resolved.method).toBe('openAlexId');
    expect(resolved.authorId).toBe('https://openalex.org/A-existing');
  });

  it('falls back to name search when neither orcid nor openAlexId is present', async () => {
    const fetcher: HttpFetcher = vi.fn(async () => ({
      results: [{ id: 'https://openalex.org/A-name-found', display_name: 'Amy Arnsten' }],
    }));
    const { ctx } = makeContext();
    const resolved = await resolveAuthorIdForFaculty(
      { fname: 'Amy', lname: 'Arnsten' },
      'x@y.io',
      ctx,
      fetcher,
    );
    expect(resolved.method).toBe('name');
    expect(resolved.authorId).toBe('https://openalex.org/A-name-found');
  });

  it('returns method "none" when nothing resolves', async () => {
    const fetcher: HttpFetcher = vi.fn(async () => ({ results: [] }));
    const { ctx } = makeContext();
    const resolved = await resolveAuthorIdForFaculty(
      { fname: '', lname: '' },
      'x@y.io',
      ctx,
      fetcher,
    );
    expect(resolved.method).toBe('none');
    expect(resolved.authorId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Full run() — mocked fetcher + mocked User model
// ---------------------------------------------------------------------------

describe('OpenAlexPaperScraper.run', () => {
  it('prefers ORCID over openAlexId when both are present', async () => {
    const calls: { url: string; params: Record<string, string> }[] = [];
    const fetcher: HttpFetcher = vi.fn(async (url, params) => {
      calls.push({ url, params });
      // ORCID lookup
      if (url === 'https://api.openalex.org/authors' && params.filter?.startsWith('orcid:')) {
        return {
          results: [{ id: 'https://openalex.org/A-from-orcid', display_name: 'Amy Arnsten' }],
        };
      }
      // /works call
      if (url === 'https://api.openalex.org/works') {
        return {
          results: [
            {
              id: 'https://openalex.org/W1',
              title: 'Test paper',
              publication_year: 2024,
              cited_by_count: 5,
              open_access: {
                is_oa: true,
                oa_status: 'green',
                oa_url: 'https://example.test/open-paper.pdf',
              },
            },
          ],
          meta: { next_cursor: null },
        };
      }
      return { results: [] };
    });

    const userModel = mockUserModel([
      {
        _id: 'u-amy',
        netid: 'aa1',
        fname: 'Amy',
        lname: 'Arnsten',
        orcid: '0000-0001-2345-6789',
        openAlexId: 'A-stale-id', // present but should be ignored
      },
    ]);

    const scraper = new OpenAlexPaperScraper({ userModel, fetcher });
    const { ctx, emitted } = makeContext({ discoverOpenAlexAuthors: true });
    const result = await scraper.run(ctx);

    // The ORCID path won — the works call should target the ORCID-derived author id.
    const worksCall = calls.find((c) => c.url === 'https://api.openalex.org/works');
    expect(worksCall?.params.filter).toBe('author.id:https://openalex.org/A-from-orcid');

    // No openAlexId lock should fire; the user observation is only a sync marker.
    const userObs = emitted.filter((o) => o.entityType === 'user');
    expect(userObs.map((obs) => obs.field)).toEqual(['openAlexWorksSyncedAt']);

    // Paper observations were emitted.
    const paperObs = emitted.filter((o) => o.entityType === 'paper');
    expect(paperObs.length).toBeGreaterThan(0);
    expect(paperObs.find((o) => o.field === 'paperAuthorshipEvidence')?.value).toMatchObject({
      userId: 'u-amy',
      netid: 'aa1',
      sourceName: 'openalex',
      method: 'openalex-orcid',
    });
    expect(paperObs.find((o) => o.field === 'isOpenAccess')?.value).toBe(true);
    expect(paperObs.find((o) => o.field === 'openAccessStatus')?.value).toBe('green');
    expect(paperObs.find((o) => o.field === 'openAccessUrl')?.value).toBe(
      'https://example.test/open-paper.pdf',
    );
    expect(paperObs.filter((o) => o.field === 'yaleAuthorIds')).toHaveLength(0);
    expect(paperObs.filter((o) => o.field === 'yaleAuthorNetIds')).toHaveLength(0);

    expect(result.notes).toContain('orcid:1');
    expect(result.notes).toContain('openAlexId:0');
    expect(result.notes).toContain('name:0');
  });

  it('keeps successful name lookup review-only and does not create authorship', async () => {
    const fetcher: HttpFetcher = vi.fn(async (url, params) => {
      if (url === 'https://api.openalex.org/authors') {
        // Name search returns one exact match.
        return {
          results: [{ id: 'https://openalex.org/A-discovered', display_name: 'John Smith' }],
        };
      }
      if (url === 'https://api.openalex.org/works') {
        return {
          results: [
            {
              id: 'https://openalex.org/W-name-only',
              title: 'Name-only matched work',
              publication_year: 2025,
            },
          ],
          meta: { next_cursor: null },
        };
      }
      return { results: [] };
    });

    const userModel = mockUserModel([
      {
        _id: 'u-john',
        netid: 'js99',
        fname: 'John',
        lname: 'Smith',
        // no orcid, no openAlexId → name path
      },
    ]);

    const scraper = new OpenAlexPaperScraper({ userModel, fetcher });
    const { ctx, emitted } = makeContext({ discoverOpenAlexAuthors: true });
    const result = await scraper.run(ctx);

    expect(emitted.filter((o) => o.entityType === 'user')).toHaveLength(0);
    expect(emitted.filter((o) => o.field === 'openAlexId' && o.entityType === 'user')).toHaveLength(0);
    expect(emitted.filter((o) => o.field === 'yaleAuthorIds')).toHaveLength(0);
    expect(emitted.filter((o) => o.field === 'yaleAuthorNetIds')).toHaveLength(0);
    expect(emitted.filter((o) => o.field === 'paperAuthorshipEvidence')).toHaveLength(0);
    expect(result.notes).toContain('name:1');
  });

  it('skips name-only discovery by default so dry-run audits do not appear stalled', async () => {
    const fetcher: HttpFetcher = vi.fn(async () => {
      throw new Error('name lookup should not run');
    });
    const userModel = mockUserModel([
      {
        _id: 'u-john',
        netid: 'js99',
        fname: 'John',
        lname: 'Smith',
      },
    ]);

    const scraper = new OpenAlexPaperScraper({ userModel, fetcher });
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);

    expect(fetcher).not.toHaveBeenCalled();
    expect(userModel.find).toHaveBeenCalledWith(
      expect.objectContaining({
        $or: [
          { orcid: { $exists: true, $ne: null, $nin: [''] } },
          { openAlexId: { $exists: true, $ne: null, $nin: [''] } },
        ],
      }),
      expect.anything(),
    );
    expect(emitted).toHaveLength(0);
    expect(result.notes).toContain('skipped:0');
  });

  it('caps OpenAlex work pages per author when requested', async () => {
    const calls: { url: string; params: Record<string, string> }[] = [];
    const fetcher: HttpFetcher = vi.fn(async (url, params) => {
      calls.push({ url, params });
      if (url === 'https://api.openalex.org/works') {
        return {
          results: [
            {
              id: `https://openalex.org/W-${params.cursor}`,
              title: `Paper ${params.cursor}`,
              publication_year: 2024,
            },
          ],
          meta: { next_cursor: `next-${params.cursor}` },
        };
      }
      return { results: [] };
    });
    const userModel = mockUserModel([
      {
        _id: 'u-amy',
        netid: 'aa1',
        fname: 'Amy',
        lname: 'Arnsten',
        openAlexId: 'A-existing',
      },
    ]);

    const scraper = new OpenAlexPaperScraper({ userModel, fetcher });
    const { ctx } = makeContext({ maxOpenAlexPagesPerAuthor: 1 });
    const result = await scraper.run(ctx);

    const workCalls = calls.filter((c) => c.url === 'https://api.openalex.org/works');
    expect(workCalls).toHaveLength(1);
    expect(result.entitiesObserved).toBe(1);
  });

  it('respects --only by filtering to requested netids before processing', async () => {
    const calls: { url: string; params: Record<string, string> }[] = [];
    const fetcher: HttpFetcher = vi.fn(async (url, params) => {
      calls.push({ url, params });
      if (url === 'https://api.openalex.org/works') {
        return {
          results: [
            {
              id: 'https://openalex.org/W-only',
              title: 'Scoped paper',
              publication_year: 2024,
            },
          ],
          meta: { next_cursor: null },
        };
      }
      return { results: [] };
    });
    const userModel = mockUserModel([
      {
        _id: 'u1',
        netid: 'n1',
        fname: 'First',
        lname: 'Faculty',
        openAlexId: 'A-one',
      },
      {
        _id: 'u2',
        netid: 'n2',
        fname: 'Second',
        lname: 'Faculty',
        openAlexId: 'A-two',
      },
    ]);

    const scraper = new OpenAlexPaperScraper({ userModel, fetcher });
    const { ctx } = makeContext({ only: ['n2'] });
    const result = await scraper.run(ctx);

    const workCalls = calls.filter((c) => c.url === 'https://api.openalex.org/works');
    expect(workCalls).toHaveLength(1);
    expect(workCalls[0].params.filter).toBe('author.id:https://openalex.org/A-two');
    expect(result.notes).toContain('Synced papers for 1 faculty');
  });

  it('applies offset plus limit after sorting the eligible OpenAlex cohort', async () => {
    const calls: { url: string; params: Record<string, string> }[] = [];
    const fetcher: HttpFetcher = vi.fn(async (url, params) => {
      calls.push({ url, params });
      if (url === 'https://api.openalex.org/works') {
        return {
          results: [
            {
              id: `https://openalex.org/W-${params.filter}`,
              title: 'Windowed paper',
              publication_year: 2024,
            },
          ],
          meta: { next_cursor: null },
        };
      }
      return { results: [] };
    });
    const userModel = mockUserModel([
      {
        _id: 'u1',
        netid: 'n1',
        fname: 'First',
        lname: 'Faculty',
        openAlexId: 'A-one',
      },
      {
        _id: 'u2',
        netid: 'n2',
        fname: 'Second',
        lname: 'Faculty',
        openAlexId: 'A-two',
      },
      {
        _id: 'u3',
        netid: 'n3',
        fname: 'Third',
        lname: 'Faculty',
        openAlexId: 'A-three',
      },
    ]);

    const scraper = new OpenAlexPaperScraper({ userModel, fetcher });
    const { ctx } = makeContext({ offset: 1, limit: 1 } as any);
    const result = await scraper.run(ctx);

    const workCalls = calls.filter((c) => c.url === 'https://api.openalex.org/works');
    expect(workCalls).toHaveLength(1);
    expect(workCalls[0].params.filter).toBe('author.id:https://openalex.org/A-two');
    expect(result.notes).toContain('Synced papers for 1 faculty');
  });

  it('rejects unsafe OpenAlex pagination bounds before work fetches', async () => {
    const rows = [
      {
        _id: 'u1',
        netid: 'n1',
        fname: 'First',
        lname: 'Faculty',
        openAlexId: 'A-one',
      },
    ];

    for (const [option, message] of [
      [{ offset: 9007199254740992 }, /--offset must be a safe non-negative integer/],
      [{ limit: 9007199254740992 }, /--limit must be a safe positive integer/],
      [
        { maxOpenAlexPagesPerAuthor: 9007199254740992 },
        /--max-openalex-pages-per-author must be a safe positive integer/,
      ],
    ] as const) {
      const fetcher: HttpFetcher = vi.fn(async () => ({ results: [] }));
      const userModel = mockUserModel(rows);
      const scraper = new OpenAlexPaperScraper({ userModel, fetcher });
      const { ctx } = makeContext(option as any);

      await expect(scraper.run(ctx)).rejects.toThrow(message);
      expect(fetcher).not.toHaveBeenCalled();
    }
  });

  it('respects --limit (caps total faculty processed)', async () => {
    const lookupCalls: string[] = [];
    const fetcher: HttpFetcher = vi.fn(async (url, params) => {
      if (url === 'https://api.openalex.org/authors') {
        lookupCalls.push(params.filter || params.search || '');
        // Return a hit so the lookup short-circuits at the ORCID tier
        // (otherwise it would cascade to name search and inflate the count).
        return { results: [{ id: 'https://openalex.org/A-x', display_name: 'A A' }] };
      }
      if (url === 'https://api.openalex.org/works') {
        return { results: [], meta: { next_cursor: null } };
      }
      return { results: [] };
    });

    // Five rows; ask for limit=2 and assert only two were processed after
    // deterministic in-memory ordering.
    const rows = [
      { _id: 'u1', netid: 'n1', fname: 'A', lname: 'A', orcid: '0000-0001-1111-1111' },
      { _id: 'u2', netid: 'n2', fname: 'B', lname: 'B', orcid: '0000-0002-2222-2222' },
      { _id: 'u3', netid: 'n3', fname: 'C', lname: 'C', orcid: '0000-0003-3333-3333' },
      { _id: 'u4', netid: 'n4', fname: 'D', lname: 'D', orcid: '0000-0004-4444-4444' },
      { _id: 'u5', netid: 'n5', fname: 'E', lname: 'E', orcid: '0000-0005-5555-5555' },
    ];
    const buildThenableLean = (rs: any[]): any => ({
      then: (resolve: (v: any) => any, reject?: (e: any) => any) =>
        Promise.resolve(rs).then(resolve, reject),
      limit: (n: number) => buildThenableLean(rs.slice(0, n)),
    });
    const userModel = {
      find: vi.fn(() => ({
        lean: () => buildThenableLean(rows),
        limit: (n: number) => ({ lean: () => buildThenableLean(rows.slice(0, n)) }),
      })) as any,
    };

    const scraper = new OpenAlexPaperScraper({ userModel, fetcher });
    const { ctx } = makeContext({ limit: 2 });
    await scraper.run(ctx);

    // Only two faculty should have been processed → only two ORCID lookups fired.
    expect(lookupCalls.length).toBe(2);
  });
});
