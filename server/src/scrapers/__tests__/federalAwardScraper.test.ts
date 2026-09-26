/**
 * Unit tests for FederalAwardScraper.
 *
 * No network, no Mongo - the USAspending page fetcher, User finder, and
 * research-home resolver are all injected via the scraper's constructor, so the
 * full run() path (pagination, inline-PI extraction, fail-closed matching,
 * additive grant emission) runs deterministically against canned fixtures.
 */
import { describe, it, expect, vi } from 'vitest';
import mongoose from 'mongoose';
import axios from 'axios';
import { setCached } from '../snapshotCache';
import {
  FederalAwardScraper,
  awardToRecord,
  awardPublicUrl,
  extractPiName,
  NO_PI_FIELD_NOTE,
  fundingAgenciesForGroup,
  groupAwardsByPi,
  maxStartDate,
  parseAwardAmount,
  parseUsaspendingDate,
  sortGrantsByRecency,
  type FederalAward,
  type UsaspendingAward,
} from '../sources/federalAwardScraper';
import type { ObservationInput, ScraperContext } from '../types';

vi.mock('axios', () => ({ default: { post: vi.fn() } }));
vi.mock('../snapshotCache', () => ({ getCached: vi.fn(), setCached: vi.fn() }));

const DOE_AWARD: UsaspendingAward = {
  'Award ID': 'DESC0004168',
  'Recipient Name': 'YALE UNIV',
  Description: 'TAS::89 0222::TAS; NEW; RELATIVISTIC HEAVY ION PHYSICS;  PI - AVERY PLACEHOLDER',
  'Start Date': '2024-08-26',
  'End Date': '2027-03-31',
  'Award Amount': 19150000,
  'Awarding Agency': 'Department of Energy',
  generated_internal_id: 'ASST_NON_DESC0004168_089',
};

const DOE_AWARD_OLDER: UsaspendingAward = {
  ...DOE_AWARD,
  'Award ID': 'DESC0000001',
  Description: 'NUCLEAR STRUCTURE; PI - AVERY PLACEHOLDER',
  'Start Date': '2021-01-01',
  'Award Amount': 500000,
  generated_internal_id: 'ASST_NON_DESC0000001_089',
};

const NASA_AWARD: UsaspendingAward = {
  'Award ID': 'NNX00AA00A',
  'Recipient Name': 'YALE UNIV',
  Description: 'EXOPLANET RADIAL VELOCITY; PRINCIPAL INVESTIGATOR - AVERY PLACEHOLDER',
  'Start Date': '2023-05-01',
  'End Date': '2026-04-30',
  'Award Amount': 750000,
  'Awarding Agency': 'National Aeronautics and Space Administration',
  generated_internal_id: 'ASST_NON_NNX00AA00A_080',
};

const NO_PI_AWARD: UsaspendingAward = {
  'Award ID': 'DESC0017660',
  'Recipient Name': 'YALE UNIV',
  Description: 'HIGH ENERGY PHYSICS',
  'Start Date': '2022-04-01',
  'Award Amount': 16150000,
  'Awarding Agency': 'Department of Energy',
  generated_internal_id: 'ASST_NON_DESC0017660_089',
};

const entry = (award: UsaspendingAward, agencyAbbreviation = 'DOE'): FederalAward => {
  const pi = extractPiName(award.Description)!;
  return { award, agencyAbbreviation, piFirstName: pi.firstName, piLastName: pi.lastName };
};

describe('extractPiName', () => {
  it('extracts a "PI - NAME" inline principal investigator', () => {
    expect(extractPiName('RELATIVISTIC HEAVY ION PHYSICS;  PI - AVERY PLACEHOLDER')).toEqual({
      firstName: 'Avery',
      lastName: 'Placeholder',
    });
  });
  it('extracts a "PRINCIPAL INVESTIGATOR - NAME" form', () => {
    expect(extractPiName('EXOPLANETS; PRINCIPAL INVESTIGATOR - JORDAN EXAMPLE')).toEqual({
      firstName: 'Jordan',
      lastName: 'Example',
    });
  });
  it('handles a colon separator and a middle initial', () => {
    expect(extractPiName('COMBUSTION STUDY; PI: RILEY Q SAMPLE')).toEqual({
      firstName: 'Riley Q',
      lastName: 'Sample',
    });
  });
  it('stops the name at a trailing stop-word', () => {
    expect(extractPiName('PI - AVERY PLACEHOLDER AND COLLABORATORS')).toEqual({
      firstName: 'Avery',
      lastName: 'Placeholder',
    });
  });
  it('returns null when there is no inline PI', () => {
    expect(extractPiName('HIGH ENERGY PHYSICS')).toBeNull();
    expect(extractPiName('')).toBeNull();
    expect(extractPiName(undefined)).toBeNull();
  });
  it('returns null for a single-token (surname-only) PI', () => {
    expect(extractPiName('PI - PLACEHOLDER')).toBeNull();
  });
  it('does not match "PI" embedded without a separator', () => {
    expect(extractPiName('PIPELINE CORROSION STUDY OF ALLOYS')).toBeNull();
  });
});

describe('parseUsaspendingDate', () => {
  it('parses YYYY-MM-DD', () => {
    expect(parseUsaspendingDate('2024-08-26')?.toISOString().slice(0, 10)).toBe('2024-08-26');
  });
  it('returns undefined for blank or wrong format', () => {
    expect(parseUsaspendingDate('')).toBeUndefined();
    expect(parseUsaspendingDate(null)).toBeUndefined();
    expect(parseUsaspendingDate('08/26/2024')).toBeUndefined();
  });
});

describe('parseAwardAmount', () => {
  it('passes through a numeric amount', () => {
    expect(parseAwardAmount(19150000)).toBe(19150000);
  });
  it('parses a string amount defensively', () => {
    expect(parseAwardAmount('$1,234,567')).toBe(1234567);
  });
  it('returns undefined for blanks', () => {
    expect(parseAwardAmount('')).toBeUndefined();
    expect(parseAwardAmount(null)).toBeUndefined();
    expect(parseAwardAmount(undefined)).toBeUndefined();
  });
});

describe('awardPublicUrl / awardToRecord', () => {
  it('builds the public usaspending award URL from the generated internal id', () => {
    expect(awardPublicUrl(DOE_AWARD)).toBe(
      'https://www.usaspending.gov/award/ASST_NON_DESC0004168_089',
    );
  });
  it('returns null when no generated internal id is present', () => {
    expect(awardPublicUrl({ ...DOE_AWARD, generated_internal_id: undefined })).toBeNull();
  });
  it('normalizes an award into a recentGrants subdocument', () => {
    const rec = awardToRecord(entry(DOE_AWARD));
    expect(rec).not.toBeNull();
    expect(rec!.id).toBe('ASST_NON_DESC0004168_089');
    expect(rec!.agency).toBe('DOE');
    expect(rec!.title).toMatch(/RELATIVISTIC HEAVY ION PHYSICS/);
    expect(rec!.dollarAmount).toBe(19150000);
    expect(rec!.startDate?.toISOString().slice(0, 10)).toBe('2024-08-26');
    expect(rec!.endDate?.toISOString().slice(0, 10)).toBe('2027-03-31');
    expect(rec!.url).toBe('https://www.usaspending.gov/award/ASST_NON_DESC0004168_089');
    expect(rec!.role).toBe('pi');
  });
  it('returns null when there is no usable id/url', () => {
    expect(awardToRecord(entry({ ...DOE_AWARD, generated_internal_id: undefined }))).toBeNull();
  });
});

describe('groupAwardsByPi / fundingAgenciesForGroup', () => {
  it('groups awards from the same inline PI across agencies and unions funders', () => {
    const groups = groupAwardsByPi([
      entry(DOE_AWARD, 'DOE'),
      entry(DOE_AWARD_OLDER, 'DOE'),
      entry(NASA_AWARD, 'NASA'),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].awards).toHaveLength(3);
    expect(fundingAgenciesForGroup(groups[0])).toEqual(['DOE', 'NASA']);
  });
});

describe('sortGrantsByRecency / maxStartDate', () => {
  it('sorts most-recent-first and finds the latest start date', () => {
    const records = [DOE_AWARD_OLDER, DOE_AWARD, NASA_AWARD]
      .map((a) => awardToRecord(entry(a))!)
      .filter(Boolean);
    const sorted = sortGrantsByRecency(records);
    expect(sorted[0].startDate?.toISOString().slice(0, 10)).toBe('2024-08-26');
    const d = maxStartDate([entry(DOE_AWARD_OLDER), entry(DOE_AWARD), entry(NASA_AWARD)]);
    expect(d?.toISOString().slice(0, 10)).toBe('2024-08-26');
  });
});

function fakeUserFinder(users: Array<{ _id: string; fname: string; lname: string }>) {
  return async (name: string) => {
    const lower = name.toLowerCase();
    const matches = users.filter((u) => lower.includes(u.lname.toLowerCase()));
    if (matches.length === 1) {
      return {
        status: 'matched' as const,
        researcherId: new mongoose.Types.ObjectId(matches[0]._id),
      };
    }
    return { status: matches.length > 1 ? ('ambiguous' as const) : ('absent' as const) };
  };
}

function buildContext(overrides: Partial<ScraperContext['options']> = {}) {
  const emitted: ObservationInput[] = [];
  const logs: string[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'test-run',
    sourceId: 'test-source-id',
    sourceName: 'federal-award-usaspending',
    sourceWeight: 0.9,
    options: { dryRun: true, useCache: false, release: false, ...overrides },
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

const ONE_AGENCY = [{ toptierName: 'Department of Energy', abbreviation: 'DOE' }];
const TIME_PERIOD = { start_date: '2020-01-01', end_date: '2026-01-01' };
const PLACEHOLDER_PI = { _id: '507f1f77bcf86cd799439013', fname: 'Avery', lname: 'Placeholder' };

describe('FederalAwardScraper.run', () => {
  it('paginates one agency until hasNext is false', async () => {
    const fetchAgencyPage = vi
      .fn()
      .mockResolvedValueOnce({ awards: [DOE_AWARD], hasNext: true })
      .mockResolvedValueOnce({ awards: [NASA_AWARD], hasNext: false });
    const scraper = new FederalAwardScraper({
      fetchAgencyPage: fetchAgencyPage as any,
      resolveResearcherId: fakeUserFinder([PLACEHOLDER_PI]) as any,
      researchHomeResolver: vi.fn().mockResolvedValue({ status: 'safe-shell' }),
      agencies: ONE_AGENCY,
      timePeriod: TIME_PERIOD,
    });
    const { ctx } = buildContext();
    await scraper.run(ctx);
    expect(fetchAgencyPage).toHaveBeenCalledTimes(2);
  });

  it('skips awards with no inline PI (fail closed)', async () => {
    const fetchAgencyPage = vi
      .fn()
      .mockResolvedValueOnce({ awards: [NO_PI_AWARD], hasNext: false });
    const resolveResearcherId = vi.fn(async () => ({ status: 'absent' as const }));
    const scraper = new FederalAwardScraper({
      fetchAgencyPage: fetchAgencyPage as any,
      resolveResearcherId: resolveResearcherId as any,
      agencies: ONE_AGENCY,
      timePeriod: TIME_PERIOD,
    });
    const { ctx, emitted } = buildContext();
    const result = await scraper.run(ctx);
    expect(emitted).toHaveLength(0);
    expect(resolveResearcherId).not.toHaveBeenCalled();
    expect(result.entitiesObserved).toBe(0);
  });

  it('skips an inline PI that does not resolve to a unique Yale User', async () => {
    const fetchAgencyPage = vi.fn().mockResolvedValueOnce({ awards: [DOE_AWARD], hasNext: false });
    const scraper = new FederalAwardScraper({
      fetchAgencyPage: fetchAgencyPage as any,
      resolveResearcherId: fakeUserFinder([]) as any,
      researchHomeResolver: vi.fn(),
      agencies: ONE_AGENCY,
      timePeriod: TIME_PERIOD,
    });
    const { ctx, emitted } = buildContext();
    await scraper.run(ctx);
    expect(emitted).toHaveLength(0);
  });

  it('skips when two Yale Users share the inline PI name (ambiguous)', async () => {
    const fetchAgencyPage = vi.fn().mockResolvedValueOnce({ awards: [DOE_AWARD], hasNext: false });
    const scraper = new FederalAwardScraper({
      fetchAgencyPage: fetchAgencyPage as any,
      resolveResearcherId: fakeUserFinder([
        { _id: 'a', fname: 'Avery', lname: 'Placeholder' },
        { _id: 'b', fname: 'Avery', lname: 'Placeholder' },
      ]) as any,
      researchHomeResolver: vi.fn(),
      agencies: ONE_AGENCY,
      timePeriod: TIME_PERIOD,
    });
    const { ctx, emitted } = buildContext();
    await scraper.run(ctx);
    expect(emitted).toHaveLength(0);
  });

  it('mints nothing for a matched PI with no existing research row, and says so', async () => {
    const fetchAgencyPage = vi.fn().mockResolvedValueOnce({ awards: [DOE_AWARD], hasNext: false });
    const scraper = new FederalAwardScraper({
      fetchAgencyPage: fetchAgencyPage as any,
      resolveResearcherId: fakeUserFinder([PLACEHOLDER_PI]) as any,
      researchHomeResolver: vi.fn().mockResolvedValue({ status: 'safe-shell' }),
      agencies: ONE_AGENCY,
      timePeriod: TIME_PERIOD,
    });
    const { ctx, emitted } = buildContext();
    const result = await scraper.run(ctx);
    expect(emitted).toHaveLength(0);
    expect(result.observationCount).toBe(0);
    expect(result.notes).toMatch(/1 have no existing research row/);
    expect(result.notes).toContain(NO_PI_FIELD_NOTE);
  });

  it('enriches one resolved canonical home and preserves its identity fields', async () => {
    const fetchAgencyPage = vi.fn().mockResolvedValueOnce({ awards: [DOE_AWARD], hasNext: false });
    const researchHomeResolver = vi
      .fn()
      .mockResolvedValue({ status: 'canonical', slug: 'dept-physics-row' });
    const scraper = new FederalAwardScraper({
      fetchAgencyPage: fetchAgencyPage as any,
      resolveResearcherId: fakeUserFinder([
        { _id: '507f1f77bcf86cd799439011', fname: 'Avery', lname: 'Placeholder' },
      ]) as any,
      researchHomeResolver,
      agencies: ONE_AGENCY,
      timePeriod: TIME_PERIOD,
    });
    const { ctx, emitted } = buildContext();
    await scraper.run(ctx);

    expect(researchHomeResolver).toHaveBeenCalledWith('507f1f77bcf86cd799439011');
    const rg = emitted.filter((o) => o.entityType === 'researchEntity');
    expect(rg.every((o) => o.entityKey === 'dept-physics-row')).toBe(true);
    expect(rg.find((o) => o.field === 'slug')).toBeUndefined();
    expect(rg.find((o) => o.field === 'name')).toBeUndefined();
    expect(rg.find((o) => o.field === 'kind')).toBeUndefined();
    expect(rg.find((o) => o.field === 'recentGrants')).toBeDefined();
    expect(rg.find((o) => o.field === 'inferredPiUserId')?.value).toBe('507f1f77bcf86cd799439011');
  });

  it('skips a matched PI whose home evidence is ambiguous or ineligible', async () => {
    const fetchAgencyPage = vi.fn().mockResolvedValueOnce({ awards: [DOE_AWARD], hasNext: false });
    const scraper = new FederalAwardScraper({
      fetchAgencyPage: fetchAgencyPage as any,
      resolveResearcherId: fakeUserFinder([PLACEHOLDER_PI]) as any,
      researchHomeResolver: vi.fn().mockResolvedValue({ status: 'ambiguous' }),
      agencies: ONE_AGENCY,
      timePeriod: TIME_PERIOD,
    });
    const { ctx, emitted } = buildContext();
    await scraper.run(ctx);
    expect(emitted).toHaveLength(0);
  });

  it('unions fundingAgencies across agencies for the same PI', async () => {
    const fetchAgencyPage = vi.fn(async (agency: { abbreviation: string }) => {
      if (agency.abbreviation === 'DOE') return { awards: [DOE_AWARD], hasNext: false };
      if (agency.abbreviation === 'NASA') return { awards: [NASA_AWARD], hasNext: false };
      return { awards: [], hasNext: false };
    });
    const scraper = new FederalAwardScraper({
      fetchAgencyPage: fetchAgencyPage as any,
      resolveResearcherId: fakeUserFinder([PLACEHOLDER_PI]) as any,
      researchHomeResolver: vi
        .fn()
        .mockResolvedValue({ status: 'canonical', slug: 'dept-physics-row' }),
      agencies: [
        { toptierName: 'Department of Energy', abbreviation: 'DOE' },
        { toptierName: 'National Aeronautics and Space Administration', abbreviation: 'NASA' },
      ],
      timePeriod: TIME_PERIOD,
    });
    const { ctx, emitted } = buildContext();
    const result = await scraper.run(ctx);
    expect(result.entitiesObserved).toBe(1);
    const rg = emitted.filter((o) => o.entityType === 'researchEntity');
    expect(rg.find((o) => o.field === 'fundingAgencies')?.value).toEqual(['DOE', 'NASA']);
    expect(rg.find((o) => o.field === 'recentGrantCount')?.value).toBe(2);
  });

  it('respects ctx.options.limit by capping awards fetched', async () => {
    const page = Array.from({ length: 5 }, (_v, i) => ({
      ...DOE_AWARD,
      'Award ID': `lim-${i}`,
      generated_internal_id: `ASST_NON_lim-${i}_089`,
    }));
    const fetchAgencyPage = vi.fn().mockResolvedValue({ awards: page, hasNext: true });
    const scraper = new FederalAwardScraper({
      fetchAgencyPage: fetchAgencyPage as any,
      resolveResearcherId: fakeUserFinder([PLACEHOLDER_PI]) as any,
      researchHomeResolver: vi.fn().mockResolvedValue({ status: 'safe-shell' }),
      agencies: ONE_AGENCY,
      timePeriod: TIME_PERIOD,
    });
    const { ctx } = buildContext({ limit: 2 });
    await scraper.run(ctx);
    expect(fetchAgencyPage).toHaveBeenCalledTimes(1);
  });

  it('rejects unsafe runtime limits before fetching', async () => {
    const fetchAgencyPage = vi.fn().mockResolvedValue({ awards: [DOE_AWARD], hasNext: false });
    const scraper = new FederalAwardScraper({
      fetchAgencyPage: fetchAgencyPage as any,
      resolveResearcherId: fakeUserFinder([PLACEHOLDER_PI]) as any,
      agencies: ONE_AGENCY,
      timePeriod: TIME_PERIOD,
    });
    const { ctx } = buildContext({ limit: 9007199254740992 } as any);
    await expect(scraper.run(ctx)).rejects.toThrow(/--limit must be a safe positive integer/);
    expect(fetchAgencyPage).not.toHaveBeenCalled();
  });

  it('aborts one agency cleanly on a network error', async () => {
    const fetchAgencyPage = vi.fn().mockRejectedValueOnce(new Error('ECONNRESET'));
    const scraper = new FederalAwardScraper({
      fetchAgencyPage: fetchAgencyPage as any,
      resolveResearcherId: fakeUserFinder([PLACEHOLDER_PI]) as any,
      agencies: ONE_AGENCY,
      timePeriod: TIME_PERIOD,
    });
    const { ctx, emitted, logs } = buildContext();
    const result = await scraper.run(ctx);
    expect(result.entitiesObserved).toBe(0);
    expect(emitted).toHaveLength(0);
    expect(logs.some((l) => /ECONNRESET|aborting/i.test(l))).toBe(true);
  });

  it('says why a run with no inline PI acquired nothing', async () => {
    const fetchAgencyPage = vi.fn(async (agency: { abbreviation: string }) =>
      agency.abbreviation === 'DOE'
        ? { awards: [NO_PI_AWARD, { ...NO_PI_AWARD, 'Award ID': 'DESC0017661' }], hasNext: false }
        : { awards: [], hasNext: false },
    );
    const scraper = new FederalAwardScraper({
      fetchAgencyPage: fetchAgencyPage as any,
      resolveResearcherId: fakeUserFinder([]) as any,
      agencies: [
        { toptierName: 'Department of Energy', abbreviation: 'DOE' },
        { toptierName: 'Department of Defense', abbreviation: 'DOD' },
      ],
      timePeriod: TIME_PERIOD,
    });
    const { ctx } = buildContext();
    const result = await scraper.run(ctx);
    expect(result.observationCount).toBe(0);
    expect(result.notes).toContain('USAspending awards fetched (2020-01-01 to 2026-01-01): 2');
    expect(result.notes).toContain('[DOE 2, DOD 0]');
    expect(result.notes).toContain('awards with an inline PI: 0');
    expect(result.notes).toContain(NO_PI_FIELD_NOTE);
  });

  it('separates an ambiguous PI from an unresolved one in the notes', async () => {
    const OTHER_AWARD = {
      ...NASA_AWARD,
      Description: 'EXOPLANET SURVEY; PI - JORDAN EXAMPLE',
      generated_internal_id: 'ASST_NON_OTHER_080',
    };
    const fetchAgencyPage = vi
      .fn()
      .mockResolvedValueOnce({ awards: [DOE_AWARD, OTHER_AWARD], hasNext: false });
    const scraper = new FederalAwardScraper({
      fetchAgencyPage: fetchAgencyPage as any,
      resolveResearcherId: fakeUserFinder([
        { _id: 'a', fname: 'Avery', lname: 'Placeholder' },
        { _id: 'b', fname: 'Avery', lname: 'Placeholder' },
      ]) as any,
      researchHomeResolver: vi.fn(),
      agencies: ONE_AGENCY,
      timePeriod: TIME_PERIOD,
    });
    const { ctx } = buildContext();
    const result = await scraper.run(ctx);
    expect(result.notes).toMatch(/1 resolved to no researcher, 1 resolved to several researchers/);
  });

  it('fails closed and says so when every agency fetch failed', async () => {
    const fetchAgencyPage = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    const scraper = new FederalAwardScraper({
      fetchAgencyPage: fetchAgencyPage as any,
      resolveResearcherId: fakeUserFinder([]) as any,
      agencies: [
        { toptierName: 'Department of Energy', abbreviation: 'DOE' },
        { toptierName: 'Department of Defense', abbreviation: 'DOD' },
      ],
      timePeriod: TIME_PERIOD,
    });
    const { ctx, emitted } = buildContext();
    const result = await scraper.run(ctx);
    expect(emitted).toHaveLength(0);
    expect(result.notes).toMatch(/^USAspending unreachable; failed closed/);
    expect(result.notes).toContain('DOE 0 (fetch failed), DOD 0 (fetch failed)');
  });

  it('fails closed and says so when the response envelope drops its results array', async () => {
    vi.mocked(axios.post).mockResolvedValue({ data: { detail: 'unexpected error' } });
    const scraper = new FederalAwardScraper({
      resolveResearcherId: fakeUserFinder([]) as any,
      agencies: ONE_AGENCY,
      timePeriod: TIME_PERIOD,
    });
    const { ctx, emitted } = buildContext({ useCache: true });
    const result = await scraper.run(ctx);
    expect(emitted).toHaveLength(0);
    expect(setCached).not.toHaveBeenCalled();
    expect(result.notes).toMatch(/^USAspending unreachable; failed closed/);
    expect(result.notes).toContain('DOE 0 (fetch failed)');
    expect(result.notes).not.toContain(NO_PI_FIELD_NOTE);
  });

  it('fails closed and says so when the response no longer carries Description', async () => {
    const { Description: _dropped, ...withoutDescription } = DOE_AWARD;
    const fetchAgencyPage = vi
      .fn()
      .mockResolvedValueOnce({ awards: [withoutDescription], hasNext: false });
    const resolveResearcherId = vi.fn();
    const scraper = new FederalAwardScraper({
      fetchAgencyPage: fetchAgencyPage as any,
      resolveResearcherId: resolveResearcherId as any,
      agencies: ONE_AGENCY,
      timePeriod: TIME_PERIOD,
    });
    const { ctx, emitted } = buildContext();
    const result = await scraper.run(ctx);
    expect(emitted).toHaveLength(0);
    expect(resolveResearcherId).not.toHaveBeenCalled();
    expect(result.notes).toMatch(
      /response shape drifted: none of 1 awards carried the "Description" field/,
    );
  });

  it('omits the ceiling note once a home is enriched', async () => {
    const fetchAgencyPage = vi.fn().mockResolvedValueOnce({ awards: [DOE_AWARD], hasNext: false });
    const scraper = new FederalAwardScraper({
      fetchAgencyPage: fetchAgencyPage as any,
      resolveResearcherId: fakeUserFinder([PLACEHOLDER_PI]) as any,
      researchHomeResolver: vi
        .fn()
        .mockResolvedValue({ status: 'canonical', slug: 'dept-physics-row' }),
      agencies: ONE_AGENCY,
      timePeriod: TIME_PERIOD,
    });
    const { ctx, emitted } = buildContext();
    const result = await scraper.run(ctx);
    expect(emitted.every((o) => o.entityKey === 'dept-physics-row')).toBe(true);
    expect(emitted.map((o) => o.field)).not.toContain('slug');
    expect(result.notes).toMatch(/rows enriched: 1/);
    expect(result.notes).not.toContain(NO_PI_FIELD_NOTE);
  });
});
