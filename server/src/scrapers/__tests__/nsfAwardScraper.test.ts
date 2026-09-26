/**
 * Unit tests for NsfAwardScraper.
 *
 * No network, no Mongo — the NSF API and User finder are both injected as
 * dependencies via the scraper's constructor / helper signatures, so the tests
 * exercise the full run() path (pagination, grouping, matching, observation
 * emission) deterministically against canned fixtures.
 */
import { describe, it, expect, vi } from 'vitest';
import mongoose from 'mongoose';
import {
  NsfAwardScraper,
  awardToRecord,
  groupAwardsByPi,
  maxStartDate,
  parseDollarAmount,
  parseNsfDate,
  piGroupKey,
  sortGrantsByRecency,
  type NsfAward,
} from '../sources/nsfAwardScraper';
import type { ObservationInput, ScraperContext } from '../types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const GRANT_AWARD: NsfAward = {
  id: '2535171',
  title: 'NSF-ANR CHE: Insights into Alkene Hydrofunctionalization',
  abstractText: 'Catalysis project for sustainability.',
  awardeeName: 'Yale University',
  pdPIName: 'Parker L Grant',
  piFirstName: 'Parker',
  piLastName: 'Grant',
  piMiddeInitial: 'L',
  piEmail: 'parker.grant@yale.edu',
  pi: ['Parker L Grant parker.grant@yale.edu'],
  startDate: '01/01/2026',
  expDate: '12/31/2029',
  fundsObligatedAmt: '650151',
  estimatedTotalAmt: '650151',
  fundProgramName: 'PROJECTS',
  agency: 'NSF',
  activeAwd: 'true',
};

const GRANT_AWARD_2: NsfAward = {
  ...GRANT_AWARD,
  id: '2200001',
  title: 'Earlier Grant award',
  startDate: '07/01/2022',
  expDate: '06/30/2025',
  fundsObligatedAmt: '300000',
};

const BHATTACHARJEE_AWARD: NsfAward = {
  id: '2510152',
  title: 'Co-PI award with Yale collaborators',
  abstractText: 'Multi-institution collaboration.',
  awardeeName: 'Yale University',
  pdPIName: 'Avi Systems',
  piFirstName: 'Abhishek',
  piLastName: 'Bhattacharjee',
  pi: ['Avi Systems avi.systems@example.edu'],
  coPDPI: [
    'Rowan Circuit rowan.circuit@yale.edu',
    'Harper Signal harper.signal@yale.edu',
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
  pdPIName: 'Jamie Award',
  piFirstName: 'Jing',
  piLastName: 'Yan',
  pi: ['Jamie Award jamie.award@yale.edu'],
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

describe('piGroupKey', () => {
  it('produces a stable lowercase key', () => {
    expect(piGroupKey('Parker', 'Grant')).toBe('parker grant');
    expect(piGroupKey('PARKER', 'GRANT')).toBe('parker grant');
  });
  it('handles missing first name', () => {
    expect(piGroupKey('', 'Grant')).toBe('grant');
  });
  it('returns "unknown" when both blank', () => {
    expect(piGroupKey('', '')).toBe('unknown');
  });
});

describe('groupAwardsByPi', () => {
  it('groups awards from the same PI together', () => {
    const groups = groupAwardsByPi([GRANT_AWARD, GRANT_AWARD_2, YAN_AWARD]);
    expect(groups).toHaveLength(2);
    const holland = groups.find((g) => g.piLastName === 'Grant');
    expect(holland).toBeDefined();
    expect(holland!.awards).toHaveLength(2);
    const hollandIds = holland!.awards.map((a) => a.id).sort();
    expect(hollandIds).toEqual(['2200001', '2535171']);
    const yan = groups.find((g) => g.piLastName === 'Yan');
    expect(yan!.awards).toHaveLength(1);
  });

  it('drops awards with no PI name', () => {
    const groups = groupAwardsByPi([{ id: 'x', awardeeName: 'Yale University' }, GRANT_AWARD]);
    expect(groups).toHaveLength(1);
    expect(groups[0].piLastName).toBe('Grant');
  });

  it('case-insensitive grouping (key normalized)', () => {
    const a: NsfAward = { ...GRANT_AWARD, id: 'a', piFirstName: 'PARKER' };
    const b: NsfAward = { ...GRANT_AWARD, id: 'b', piFirstName: 'Parker' };
    const groups = groupAwardsByPi([a, b]);
    expect(groups).toHaveLength(1);
    expect(groups[0].awards).toHaveLength(2);
  });
});

describe('awardToRecord', () => {
  it('normalizes an NSF award into a recentGrants subdocument', () => {
    const rec = awardToRecord(GRANT_AWARD);
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
    const rec = awardToRecord({ ...GRANT_AWARD, fundsObligatedAmt: undefined });
    expect(rec!.dollarAmount).toBe(650151);
  });

  it('returns null when id is missing', () => {
    expect(awardToRecord({ ...GRANT_AWARD, id: undefined })).toBeNull();
  });

  it('honors a copi role override', () => {
    const rec = awardToRecord(GRANT_AWARD, 'copi');
    expect(rec!.role).toBe('copi');
  });
});

describe('sortGrantsByRecency', () => {
  it('sorts most-recent-first by startDate', () => {
    const records = [GRANT_AWARD_2, GRANT_AWARD, YAN_AWARD]
      .map((a) => awardToRecord(a)!)
      .filter(Boolean);
    const sorted = sortGrantsByRecency(records);
    expect(sorted.map((r) => r.id)).toEqual(['2535171', '2531367', '2200001']);
  });
  it('sinks records without a start date to the end', () => {
    const records = [
      awardToRecord(GRANT_AWARD)!,
      awardToRecord({ ...YAN_AWARD, startDate: undefined })!,
    ];
    const sorted = sortGrantsByRecency(records);
    expect(sorted[0].id).toBe('2535171');
    expect(sorted[1].id).toBe('2531367');
  });
});

describe('maxStartDate', () => {
  it('returns the latest startDate', () => {
    const d = maxStartDate([GRANT_AWARD_2, GRANT_AWARD, YAN_AWARD]);
    expect(d?.toISOString().slice(0, 10)).toBe('2026-01-01');
  });
  it('returns undefined when no awards have a start date', () => {
    expect(maxStartDate([{ id: 'x', startDate: undefined }])).toBeUndefined();
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

const matchedEveryone = async (_name: string) => ({
  status: 'matched' as const,
  researcherId: new mongoose.Types.ObjectId(),
});

const existingRowPerResearcher = vi.fn(async (researcherId: string) => ({
  status: 'canonical' as const,
  slug: `existing-row-${researcherId}`,
}));

describe('NsfAwardScraper.run', () => {
  it('paginates until an empty page is returned', async () => {
    const page1 = Array.from({ length: 25 }, (_v, i) => ({
      ...YAN_AWARD,
      id: `p1-${i}`,
      piFirstName: 'PiFirst' + i,
      piLastName: 'PiLast' + i,
    }));
    const page2 = [GRANT_AWARD];
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ awards: page1, totalCount: 26 })
      .mockResolvedValueOnce({ awards: page2, totalCount: 26 });

    const scraper = new NsfAwardScraper({
      fetchPage: fetchPage as any,
      resolveResearcherId: matchedEveryone,
      researchHomeResolver: existingRowPerResearcher,
      dateStart: '01/01/2020',
    });
    const { ctx, emitted, logs } = buildContext();
    const result = await scraper.run(ctx);

    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(result.entitiesObserved).toBe(26);
    expect(emitted.length).toBeGreaterThan(0);
    expect(logs.some((l) => /totalCount=26/.test(l))).toBe(true);
  });

  it('groups multiple awards by the same PI into one observation set on the existing row', async () => {
    const fetchPage = vi.fn().mockResolvedValueOnce({
      awards: [GRANT_AWARD, GRANT_AWARD_2, YAN_AWARD],
    });
    const grantPi = new mongoose.Types.ObjectId();
    const scraper = new NsfAwardScraper({
      fetchPage: fetchPage as any,
      resolveResearcherId: async (name: string) =>
        /grant/i.test(name)
          ? { status: 'matched' as const, researcherId: grantPi }
          : matchedEveryone(name),
      researchHomeResolver: existingRowPerResearcher,
      dateStart: '01/01/2020',
    });
    const { ctx, emitted } = buildContext();
    const result = await scraper.run(ctx);

    expect(result.entitiesObserved).toBe(2);

    const grantRow = emitted.filter((o) => o.entityKey === `existing-row-${grantPi}`);
    const grants = grantRow.find((o) => o.field === 'recentGrants')?.value as Array<{
      id: string;
    }>;
    expect(grants).toHaveLength(2);
    expect(grants[0].id).toBe('2535171');
    expect(grants[1].id).toBe('2200001');
    expect(grantRow.find((o) => o.field === 'recentGrantCount')?.value).toBe(2);
    expect(grantRow.find((o) => o.field === 'fundingAgencies')?.value).toEqual(['NSF']);
    const lastObserved = grantRow.find((o) => o.field === 'lastObservedAt')?.value as Date;
    expect(lastObserved.toISOString().slice(0, 10)).toBe('2026-01-01');
  });

  it('enriches the row the canonical resolver names and asserts no identity field', async () => {
    const fetchPage = vi.fn().mockResolvedValueOnce({ awards: [GRANT_AWARD] });
    const researchHomeResolver = vi.fn().mockResolvedValue({
      status: 'canonical',
      slug: 'dept-chem-parker-grant',
    });
    const scraper = new NsfAwardScraper({
      fetchPage: fetchPage as any,
      resolveResearcherId: async () => ({
        status: 'matched' as const,
        researcherId: new mongoose.Types.ObjectId('507f1f77bcf86cd799439011'),
      }),
      researchHomeResolver,
      dateStart: '01/01/2020',
    });
    const { ctx, emitted } = buildContext();
    const result = await scraper.run(ctx);

    expect(researchHomeResolver).toHaveBeenCalledWith('507f1f77bcf86cd799439011');
    expect(emitted.every((o) => o.entityType === 'researchEntity')).toBe(true);
    expect(emitted.every((o) => o.entityKey === 'dept-chem-parker-grant')).toBe(true);
    for (const identityField of ['slug', 'name', 'kind', 'entityType']) {
      expect(emitted.find((o) => o.field === identityField)).toBeUndefined();
    }
    const inferred = emitted.find((o) => o.field === 'inferredPiUserId');
    expect(inferred?.value).toBe('507f1f77bcf86cd799439011');
    expect(inferred?.confidenceOverride).toBe(0.7);
    expect(result.notes).toMatch(/rows enriched: 1/);
  });

  it.each([
    ['no researcher', { status: 'absent' as const }, undefined, /1 resolved to no researcher/],
    [
      'several researchers',
      { status: 'ambiguous' as const },
      undefined,
      /1 resolved to several researchers/,
    ],
    [
      'no existing row',
      { status: 'matched' as const },
      { status: 'safe-shell' as const },
      /1 have no existing research row/,
    ],
    [
      'an ineligible row',
      { status: 'matched' as const },
      { status: 'ineligible' as const },
      /1 ineligible row/,
    ],
    [
      'an ambiguous row',
      { status: 'matched' as const },
      { status: 'ambiguous' as const },
      /1 ambiguous row/,
    ],
  ])('mints nothing and counts a PI that resolves to %s', async (_label, person, row, note) => {
    const fetchPage = vi.fn().mockResolvedValueOnce({ awards: [GRANT_AWARD] });
    const scraper = new NsfAwardScraper({
      fetchPage: fetchPage as any,
      resolveResearcherId: async () =>
        person.status === 'matched'
          ? { status: 'matched' as const, researcherId: new mongoose.Types.ObjectId() }
          : person,
      researchHomeResolver: vi.fn().mockResolvedValue(row),
      dateStart: '01/01/2020',
    });
    const { ctx, emitted } = buildContext();
    const result = await scraper.run(ctx);

    expect(emitted).toEqual([]);
    expect(result.entitiesObserved).toBe(0);
    expect(result.notes).toMatch(/rows enriched: 0/);
    expect(result.notes).toMatch(note);
  });

  it('emits no roster membership even when co-PIs resolve to Yale researchers', async () => {
    const fetchPage = vi.fn().mockResolvedValueOnce({ awards: [BHATTACHARJEE_AWARD] });

    const scraper = new NsfAwardScraper({
      fetchPage: fetchPage as any,
      resolveResearcherId: matchedEveryone,
      researchHomeResolver: existingRowPerResearcher,
      dateStart: '01/01/2020',
    });
    const { ctx, emitted } = buildContext();
    await scraper.run(ctx);

    expect(emitted.filter((o) => o.entityType === 'researchGroupMember')).toEqual([]);
    expect(
      emitted.filter((o) => o.field === 'researchGroupSlug' || o.field === 'researchGroupKey'),
    ).toEqual([]);
    expect(
      emitted.find((o) => o.entityType === 'researchEntity' && o.field === 'recentGrants'),
    ).toBeDefined();
  });

  it('respects ctx.options.limit by capping awards mid-page', async () => {
    const page = Array.from({ length: 25 }, (_v, i) => ({
      ...YAN_AWARD,
      id: `lim-${i}`,
      piFirstName: 'Pi' + i,
      piLastName: 'Last' + i,
    }));
    const fetchPage = vi.fn().mockResolvedValueOnce({ awards: page, totalCount: 25 });

    const scraper = new NsfAwardScraper({
      fetchPage: fetchPage as any,
      resolveResearcherId: matchedEveryone,
      researchHomeResolver: existingRowPerResearcher,
      dateStart: '01/01/2020',
    });
    const { ctx } = buildContext({ limit: 3 });
    const result = await scraper.run(ctx);

    expect(result.entitiesObserved).toBe(3);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('rejects unsafe runtime limits before fetching NSF pages', async () => {
    const fetchPage = vi.fn().mockResolvedValue({ awards: [YAN_AWARD], totalCount: 1 });
    const scraper = new NsfAwardScraper({
      fetchPage: fetchPage as any,
      resolveResearcherId: matchedEveryone,
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

    const scraper = new NsfAwardScraper({
      fetchPage: fetchPage as any,
      resolveResearcherId: matchedEveryone,
      researchHomeResolver: existingRowPerResearcher,
      dateStart: '01/01/2020',
    });
    const { ctx, emitted, logs } = buildContext();
    const result = await scraper.run(ctx);

    expect(result.entitiesObserved).toBe(25);
    expect(emitted.length).toBeGreaterThan(0);
    expect(logs.some((l) => /ECONNRESET|aborting/i.test(l))).toBe(true);
  });
});
