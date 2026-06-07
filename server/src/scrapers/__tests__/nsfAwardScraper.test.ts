/**
 * Unit tests for NsfAwardScraper.
 *
 * No network, no Mongo — the NSF API and User finder are both injected as
 * dependencies via the scraper's constructor / helper signatures, so the tests
 * exercise the full run() path (pagination, grouping, matching, observation
 * emission) deterministically against canned fixtures.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  NsfAwardScraper,
  awardToRecord,
  findUserForPi,
  groupAwardsByPi,
  maxStartDate,
  parseCoPdpiLine,
  parseDollarAmount,
  parseNsfDate,
  piDisplayName,
  piGroupKey,
  piSlug,
  sortGrantsByRecency,
  type NsfAward,
} from '../sources/nsfAwardScraper';
import type { ObservationInput, ScraperContext } from '../types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const HOLLAND_AWARD: NsfAward = {
  id: '2535171',
  title: 'NSF-ANR CHE: Insights into Alkene Hydrofunctionalization',
  abstractText: 'Catalysis project for sustainability.',
  awardeeName: 'Yale University',
  pdPIName: 'Patrick L Holland',
  piFirstName: 'Patrick',
  piLastName: 'Holland',
  piMiddeInitial: 'L',
  piEmail: 'patrick.holland@yale.edu',
  pi: ['Patrick L Holland patrick.holland@yale.edu'],
  startDate: '01/01/2026',
  expDate: '12/31/2029',
  fundsObligatedAmt: '650151',
  estimatedTotalAmt: '650151',
  fundProgramName: 'PROJECTS',
  agency: 'NSF',
  activeAwd: 'true',
};

const HOLLAND_AWARD_2: NsfAward = {
  ...HOLLAND_AWARD,
  id: '2200001',
  title: 'Earlier Holland award',
  startDate: '07/01/2022',
  expDate: '06/30/2025',
  fundsObligatedAmt: '300000',
};

const BHATTACHARJEE_AWARD: NsfAward = {
  id: '2510152',
  title: 'Co-PI award with Yale collaborators',
  abstractText: 'Multi-institution collaboration.',
  awardeeName: 'Yale University',
  pdPIName: 'Abhishek Bhattacharjee',
  piFirstName: 'Abhishek',
  piLastName: 'Bhattacharjee',
  pi: ['Abhishek Bhattacharjee abhishek.b@princeton.edu'],
  coPDPI: [
    'Rajit Manohar rajit.manohar@yale.edu',
    'Hitten P Zaveri hitten.zaveri@yale.edu',
    'Raghavendra Pothukuchi raghav@cs.unc.edu',
  ],
  startDate: '08/01/2024',
  expDate: '07/31/2027',
  fundsObligatedAmt: '500000',
  agency: 'NSF',
};

const YAN_AWARD: NsfAward = {
  id: '2531367',
  title: 'Bacterial biofilms',
  awardeeName: 'Yale University',
  pdPIName: 'Jing Yan',
  piFirstName: 'Jing',
  piLastName: 'Yan',
  pi: ['Jing Yan jing.yan@yale.edu'],
  startDate: '03/01/2025',
  expDate: '02/28/2028',
  fundsObligatedAmt: '275000',
  agency: 'NSF',
};

// ---------------------------------------------------------------------------
// Pure helper tests
// ---------------------------------------------------------------------------

describe('parseNsfDate', () => {
  it('parses mm/dd/yyyy', () => {
    expect(parseNsfDate('01/15/2024')?.toISOString().slice(0, 10)).toBe('2024-01-15');
  });
  it('returns undefined for blank or malformed', () => {
    expect(parseNsfDate('')).toBeUndefined();
    expect(parseNsfDate(null)).toBeUndefined();
    expect(parseNsfDate(undefined)).toBeUndefined();
    expect(parseNsfDate('not-a-date')).toBeUndefined();
    expect(parseNsfDate('2024-01-15')).toBeUndefined(); // wrong format
  });
});

describe('parseDollarAmount', () => {
  it('parses plain number strings', () => {
    expect(parseDollarAmount('650151')).toBe(650151);
  });
  it('strips commas and dollar signs', () => {
    expect(parseDollarAmount('$1,234,567')).toBe(1234567);
  });
  it('returns undefined for blanks', () => {
    expect(parseDollarAmount('')).toBeUndefined();
    expect(parseDollarAmount(null)).toBeUndefined();
    expect(parseDollarAmount(undefined)).toBeUndefined();
  });
});

describe('piDisplayName', () => {
  it('joins first + last', () => {
    expect(piDisplayName(HOLLAND_AWARD)).toBe('Patrick Holland');
  });
  it('falls back to pdPIName if first/last are missing', () => {
    expect(piDisplayName({ pdPIName: 'Just Pdpi' })).toBe('Just Pdpi');
  });
  it('returns empty string when nothing usable', () => {
    expect(piDisplayName({})).toBe('');
  });
});

describe('piGroupKey', () => {
  it('produces a stable lowercase key', () => {
    expect(piGroupKey('Patrick', 'Holland')).toBe('patrick holland');
    expect(piGroupKey('PATRICK', 'HOLLAND')).toBe('patrick holland');
  });
  it('handles missing first name', () => {
    expect(piGroupKey('', 'Holland')).toBe('holland');
  });
  it('returns "unknown" when both blank', () => {
    expect(piGroupKey('', '')).toBe('unknown');
  });
});

describe('groupAwardsByPi', () => {
  it('groups awards from the same PI together', () => {
    const groups = groupAwardsByPi([HOLLAND_AWARD, HOLLAND_AWARD_2, YAN_AWARD]);
    expect(groups).toHaveLength(2);
    const holland = groups.find((g) => g.piLastName === 'Holland');
    expect(holland).toBeDefined();
    expect(holland!.awards).toHaveLength(2);
    const hollandIds = holland!.awards.map((a) => a.id).sort();
    expect(hollandIds).toEqual(['2200001', '2535171']);
    const yan = groups.find((g) => g.piLastName === 'Yan');
    expect(yan!.awards).toHaveLength(1);
  });

  it('drops awards with no PI name', () => {
    const groups = groupAwardsByPi([
      { id: 'x', awardeeName: 'Yale University' },
      HOLLAND_AWARD,
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].piLastName).toBe('Holland');
  });

  it('case-insensitive grouping (key normalized)', () => {
    const a: NsfAward = { ...HOLLAND_AWARD, id: 'a', piFirstName: 'PATRICK' };
    const b: NsfAward = { ...HOLLAND_AWARD, id: 'b', piFirstName: 'patrick' };
    const groups = groupAwardsByPi([a, b]);
    expect(groups).toHaveLength(1);
    expect(groups[0].awards).toHaveLength(2);
  });
});

describe('awardToRecord', () => {
  it('normalizes an NSF award into a recentGrants subdocument', () => {
    const rec = awardToRecord(HOLLAND_AWARD);
    expect(rec).not.toBeNull();
    expect(rec!.id).toBe('2535171');
    expect(rec!.agency).toBe('NSF');
    expect(rec!.title).toMatch(/Hydrofunctionalization/);
    expect(rec!.dollarAmount).toBe(650151);
    expect(rec!.startDate?.toISOString().slice(0, 10)).toBe('2026-01-01');
    expect(rec!.endDate?.toISOString().slice(0, 10)).toBe('2029-12-31');
    expect(rec!.url).toBe('https://www.nsf.gov/awardsearch/showAward?AWD_ID=2535171');
    expect(rec!.role).toBe('pi');
  });

  it('falls back to estimatedTotalAmt when fundsObligatedAmt is missing', () => {
    const rec = awardToRecord({ ...HOLLAND_AWARD, fundsObligatedAmt: undefined });
    expect(rec!.dollarAmount).toBe(650151);
  });

  it('returns null when id is missing', () => {
    expect(awardToRecord({ ...HOLLAND_AWARD, id: undefined })).toBeNull();
  });

  it('honors a copi role override', () => {
    const rec = awardToRecord(HOLLAND_AWARD, 'copi');
    expect(rec!.role).toBe('copi');
  });
});

describe('sortGrantsByRecency', () => {
  it('sorts most-recent-first by startDate', () => {
    const records = [HOLLAND_AWARD_2, HOLLAND_AWARD, YAN_AWARD]
      .map((a) => awardToRecord(a)!)
      .filter(Boolean);
    const sorted = sortGrantsByRecency(records);
    expect(sorted.map((r) => r.id)).toEqual(['2535171', '2531367', '2200001']);
  });
  it('sinks records without a start date to the end', () => {
    const records = [
      awardToRecord(HOLLAND_AWARD)!,
      awardToRecord({ ...YAN_AWARD, startDate: undefined })!,
    ];
    const sorted = sortGrantsByRecency(records);
    expect(sorted[0].id).toBe('2535171');
    expect(sorted[1].id).toBe('2531367');
  });
});

describe('maxStartDate', () => {
  it('returns the latest startDate', () => {
    const d = maxStartDate([HOLLAND_AWARD_2, HOLLAND_AWARD, YAN_AWARD]);
    expect(d?.toISOString().slice(0, 10)).toBe('2026-01-01');
  });
  it('returns undefined when no awards have a start date', () => {
    expect(maxStartDate([{ id: 'x', startDate: undefined }])).toBeUndefined();
  });
});

describe('parseCoPdpiLine', () => {
  it('extracts name + email when both are present', () => {
    expect(parseCoPdpiLine('Rajit Manohar rajit.manohar@yale.edu')).toEqual({
      fullName: 'Rajit Manohar',
      email: 'rajit.manohar@yale.edu',
    });
  });
  it('handles middle initials in name', () => {
    expect(parseCoPdpiLine('Hitten P Zaveri hitten.zaveri@yale.edu')).toEqual({
      fullName: 'Hitten P Zaveri',
      email: 'hitten.zaveri@yale.edu',
    });
  });
  it('handles a name-only line (no email)', () => {
    expect(parseCoPdpiLine('Just Name')).toEqual({ fullName: 'Just Name' });
  });
  it('returns null for blanks', () => {
    expect(parseCoPdpiLine('')).toBeNull();
    expect(parseCoPdpiLine('   ')).toBeNull();
  });
});

describe('piSlug', () => {
  it('uses user id when matched', () => {
    expect(piSlug('507f1f77bcf86cd799439011', 'Patrick', 'Holland')).toBe(
      'nsf-pi-507f1f77bcf86cd799439011',
    );
  });
  it('falls back to a name-based slug when unmatched', () => {
    expect(piSlug(null, 'Patrick', 'Holland')).toBe('nsf-pi-patrick-holland');
  });
  it('caps slug length at 100 chars', () => {
    const slug = piSlug(null, 'A'.repeat(80), 'B'.repeat(80));
    expect(slug.length).toBeLessThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// findUserForPi (with injected finder; no Mongo)
// ---------------------------------------------------------------------------

describe('findUserForPi', () => {
  it('returns the matched user id on exact lname+fname', async () => {
    const finder = vi.fn(async () => [{ _id: 'user-1' }]);
    const id = await findUserForPi(
      { firstName: 'Patrick', lastName: 'Holland' },
      finder as any,
    );
    expect(id).toBe('user-1');
    expect(finder).toHaveBeenCalledTimes(1);
  });

  it('falls back to lname + first-name prefix when exact misses', async () => {
    const finder = vi
      .fn()
      .mockResolvedValueOnce([]) // exact miss
      .mockResolvedValueOnce([{ _id: 'user-2' }]); // prefix hit
    const id = await findUserForPi({ firstName: 'Pat', lastName: 'Holland' }, finder as any);
    expect(id).toBe('user-2');
    expect(finder).toHaveBeenCalledTimes(2);
    expect(finder).toHaveBeenLastCalledWith(
      expect.objectContaining({
        fname: /^Pat/i,
      }),
    );
  });

  it('does not match full first names by initial only', async () => {
    const finder = vi
      .fn()
      .mockResolvedValueOnce([]) // exact miss
      .mockResolvedValueOnce([]); // Leying prefix does not match Lawrence
    const id = await findUserForPi({ firstName: 'Leying', lastName: 'Guan' }, finder as any);

    expect(id).toBeNull();
    expect(finder).toHaveBeenCalledTimes(2);
    expect(finder).toHaveBeenLastCalledWith(
      expect.objectContaining({
        fname: /^Leying/i,
      }),
    );
  });

  it('uses first-initial fallback only when the source first name is an initial', async () => {
    const finder = vi
      .fn()
      .mockResolvedValueOnce([]) // exact miss
      .mockResolvedValueOnce([{ _id: 'user-3' }]); // initial hit
    const id = await findUserForPi({ firstName: 'P.', lastName: 'Holland' }, finder as any);

    expect(id).toBe('user-3');
    expect(finder).toHaveBeenLastCalledWith(
      expect.objectContaining({
        fname: /^P/i,
      }),
    );
  });

  it('returns null on ambiguous exact match (multiple)', async () => {
    const finder = vi.fn(async () => [{ _id: 'a' }, { _id: 'b' }]);
    const id = await findUserForPi({ firstName: 'John', lastName: 'Smith' }, finder as any);
    expect(id).toBeNull();
    // does NOT fall through to initial when exact is ambiguous
    expect(finder).toHaveBeenCalledTimes(1);
  });

  it('returns null when no last name', async () => {
    const finder = vi.fn();
    const id = await findUserForPi({ firstName: 'X', lastName: '' }, finder as any);
    expect(id).toBeNull();
    expect(finder).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Full run() — paginated, with mocked NSF API + User finder
// ---------------------------------------------------------------------------

function buildContext(overrides: Partial<ScraperContext['options']> = {}) {
  const emitted: ObservationInput[] = [];
  const logs: string[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'test-run',
    sourceId: 'test-source-id',
    sourceName: 'nsf-award-search',
    sourceWeight: 0.9,
    options: {
      dryRun: true,
      useCache: false,
      release: false,
      ...overrides,
    },
    emit: async (input) => {
      const arr = Array.isArray(input) ? input : [input];
      for (const o of arr) emitted.push(o);
    },
    log: (msg) => {
      logs.push(msg);
    },
  };
  return { ctx, emitted, logs };
}

describe('NsfAwardScraper.run', () => {
  it('paginates until an empty page is returned', async () => {
    // Build a single full page (PAGE_SIZE=25 in source), then a short page,
    // then would be empty. Two pages worth of distinct PIs.
    const page1 = Array.from({ length: 25 }, (_v, i) => ({
      ...YAN_AWARD,
      id: `p1-${i}`,
      piFirstName: 'PiFirst' + i,
      piLastName: 'PiLast' + i,
    }));
    const page2 = [HOLLAND_AWARD]; // short page → stop after this
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ awards: page1, totalCount: 26 })
      .mockResolvedValueOnce({ awards: page2, totalCount: 26 });

    const userFinder = vi.fn(async () => []); // no user matches

    const scraper = new NsfAwardScraper({
      fetchPage: fetchPage as any,
      userFinder: userFinder as any,
      dateStart: '01/01/2020',
    });
    const { ctx, emitted, logs } = buildContext();
    const result = await scraper.run(ctx);

    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(result.entitiesObserved).toBe(26); // 26 distinct PIs
    expect(emitted.length).toBeGreaterThan(0);
    expect(logs.some((l) => /totalCount=26/.test(l))).toBe(true);
  });

  it('groups multiple awards by the same PI into one ResearchGroup observation set', async () => {
    const fetchPage = vi.fn().mockResolvedValueOnce({
      awards: [HOLLAND_AWARD, HOLLAND_AWARD_2, YAN_AWARD],
    });
    const userFinder = vi.fn(async () => []);

    const scraper = new NsfAwardScraper({
      fetchPage: fetchPage as any,
      userFinder: userFinder as any,
      dateStart: '01/01/2020',
    });
    const { ctx, emitted } = buildContext();
    const result = await scraper.run(ctx);

    expect(result.entitiesObserved).toBe(2); // Holland + Yan

    // Holland's ResearchGroup observations
    const hollandRg = emitted.filter(
      (o) => o.entityType === 'researchEntity' && o.entityKey?.includes('holland'),
    );
    const grants = hollandRg.find((o) => o.field === 'recentGrants')?.value as Array<{
      id: string;
    }>;
    expect(Array.isArray(grants)).toBe(true);
    expect(grants).toHaveLength(2);
    // Sorted recency — newer (2026 start) first
    expect(grants[0].id).toBe('2535171');
    expect(grants[1].id).toBe('2200001');

    const grantCount = hollandRg.find((o) => o.field === 'recentGrantCount')?.value;
    expect(grantCount).toBe(2);

    const fundingAgencies = hollandRg.find((o) => o.field === 'fundingAgencies')?.value;
    expect(fundingAgencies).toEqual(['NSF']);

    const lastObserved = hollandRg.find((o) => o.field === 'lastObservedAt')?.value as Date;
    expect(lastObserved.toISOString().slice(0, 10)).toBe('2026-01-01');
  });

  it('emits a User observation under nsf-pi: key when PI is unmatched', async () => {
    const fetchPage = vi.fn().mockResolvedValueOnce({ awards: [HOLLAND_AWARD] });
    const userFinder = vi.fn(async () => []); // no match
    const scraper = new NsfAwardScraper({
      fetchPage: fetchPage as any,
      userFinder: userFinder as any,
      dateStart: '01/01/2020',
    });
    const { ctx, emitted } = buildContext();
    await scraper.run(ctx);

    const userObs = emitted.filter((o) => o.entityType === 'user');
    expect(userObs.length).toBeGreaterThan(0);
    expect(userObs[0].entityKey).toBe('nsf-pi:patrick holland');
    expect(userObs.find((o) => o.field === 'fname')?.value).toBe('Patrick');
    expect(userObs.find((o) => o.field === 'lname')?.value).toBe('Holland');
    expect(userObs.find((o) => o.field === 'email')?.value).toBe('patrick.holland@yale.edu');
    expect(userObs.find((o) => o.field === 'dataSources')?.value).toEqual(['nsf-award-search']);
  });

  it('skips emitting User observations and uses user-id slug when PI matches a Yale User', async () => {
    const fetchPage = vi.fn().mockResolvedValueOnce({ awards: [HOLLAND_AWARD] });
    // First call (exact lname+fname) returns one match.
    const userFinder = vi.fn(async () => [{ _id: 'user-holland' }]);

    const scraper = new NsfAwardScraper({
      fetchPage: fetchPage as any,
      userFinder: userFinder as any,
      dateStart: '01/01/2020',
    });
    const { ctx, emitted } = buildContext();
    await scraper.run(ctx);

    // No user observations for matched PI
    expect(emitted.filter((o) => o.entityType === 'user')).toHaveLength(0);

    const rgObs = emitted.filter((o) => o.entityType === 'researchEntity');
    expect(rgObs.find((o) => o.field === 'slug')?.value).toBe('nsf-pi-user-holland');
    expect(rgObs.find((o) => o.field === 'inferredPiUserId')?.value).toBe('user-holland');
    const inferredObs = rgObs.find((o) => o.field === 'inferredPiUserId');
    expect(inferredObs?.confidenceOverride).toBe(0.7);
  });

  it('emits ResearchGroupMember observations only for co-PIs that match Yale Users', async () => {
    const fetchPage = vi.fn().mockResolvedValueOnce({ awards: [BHATTACHARJEE_AWARD] });

    // Sequence of finder calls expected:
    //   (a) PI lookup: Bhattacharjee — exact miss (returns []).
    //   (b) PI lookup: Bhattacharjee — initial fallback miss.
    //   (c) co-PI Rajit Manohar — exact match → user-rajit.
    //   (d) co-PI Hitten Zaveri — exact match → user-hitten.
    //   (e) co-PI Raghavendra Pothukuchi — exact miss → [].
    //   (f) co-PI Raghavendra Pothukuchi — initial miss → [].
    const userFinder = vi
      .fn()
      .mockResolvedValueOnce([]) // (a)
      .mockResolvedValueOnce([]) // (b)
      .mockResolvedValueOnce([{ _id: 'user-rajit' }]) // (c)
      .mockResolvedValueOnce([{ _id: 'user-hitten' }]) // (d)
      .mockResolvedValueOnce([]) // (e)
      .mockResolvedValueOnce([]); // (f)

    const scraper = new NsfAwardScraper({
      fetchPage: fetchPage as any,
      userFinder: userFinder as any,
      dateStart: '01/01/2020',
    });
    const { ctx, emitted } = buildContext();
    await scraper.run(ctx);

    const memberObs = emitted.filter((o) => o.entityType === 'researchGroupMember');
    // Two matched co-PIs × 4 fields each (researchGroupSlug, userId, role, fullName) + email when present
    const userIds = memberObs.filter((o) => o.field === 'userId').map((o) => o.value);
    expect(userIds.sort()).toEqual(['user-hitten', 'user-rajit']);

    const roles = memberObs.filter((o) => o.field === 'role').map((o) => o.value);
    expect(roles.every((r) => r === 'co-pi')).toBe(true);

    // Each matched co-PI should have an email observation (both have @yale.edu emails)
    const emails = memberObs.filter((o) => o.field === 'email').map((o) => o.value);
    expect(emails).toContain('rajit.manohar@yale.edu');
    expect(emails).toContain('hitten.zaveri@yale.edu');
    // Non-Yale co-PI Raghavendra should NOT appear
    expect(emails.find((e) => typeof e === 'string' && (e as string).includes('cs.unc.edu'))).toBeUndefined();
  });

  it('respects ctx.options.limit by capping awards mid-page', async () => {
    const page = Array.from({ length: 25 }, (_v, i) => ({
      ...YAN_AWARD,
      id: `lim-${i}`,
      piFirstName: 'Pi' + i,
      piLastName: 'Last' + i,
    }));
    const fetchPage = vi.fn().mockResolvedValueOnce({ awards: page, totalCount: 25 });
    const userFinder = vi.fn(async () => []);

    const scraper = new NsfAwardScraper({
      fetchPage: fetchPage as any,
      userFinder: userFinder as any,
      dateStart: '01/01/2020',
    });
    const { ctx } = buildContext({ limit: 3 });
    const result = await scraper.run(ctx);

    expect(result.entitiesObserved).toBe(3); // 3 PIs because each award is a distinct PI
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('rejects unsafe runtime limits before fetching NSF pages', async () => {
    const fetchPage = vi.fn().mockResolvedValue({ awards: [YAN_AWARD], totalCount: 1 });
    const userFinder = vi.fn(async () => []);
    const scraper = new NsfAwardScraper({
      fetchPage: fetchPage as any,
      userFinder: userFinder as any,
      dateStart: '01/01/2020',
    });
    const { ctx } = buildContext({ limit: 9007199254740992 } as any);

    await expect(scraper.run(ctx)).rejects.toThrow(/--limit must be a safe positive integer/);
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('aborts pagination cleanly on a network error mid-stream', async () => {
    const page1 = Array.from({ length: 25 }, (_v, i) => ({
      ...YAN_AWARD,
      id: `e-${i}`,
      piFirstName: 'E' + i,
      piLastName: 'Last' + i,
    }));
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ awards: page1, totalCount: 100 })
      .mockRejectedValueOnce(new Error('ECONNRESET'));
    const userFinder = vi.fn(async () => []);

    const scraper = new NsfAwardScraper({
      fetchPage: fetchPage as any,
      userFinder: userFinder as any,
      dateStart: '01/01/2020',
    });
    const { ctx, emitted, logs } = buildContext();
    const result = await scraper.run(ctx);

    expect(result.entitiesObserved).toBe(25); // first page processed
    expect(emitted.length).toBeGreaterThan(0);
    expect(logs.some((l) => /ECONNRESET|aborting/i.test(l))).toBe(true);
  });
});
