import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return { ...actual, syncEntity: vi.fn().mockResolvedValue(undefined) };
});

import { Fellowship } from '../../models/fellowship';
import { Observation } from '../../models/observation';
import { computeProgramStudentVisibility } from '../../services/studentVisibilityTier';
import {
  materializeEntity,
  materializeObservedEntitiesInChunks,
  type ObservedEntityOutcome,
} from '../entityMaterializer';
import { sourceKeyForFund } from '../fellowshipFundFacets';
import { resetInvalidatedScrapeRunCache } from '../invalidatedScrapeRuns';
import { loadCitedFundDetailUrls } from '../sources/studentGrantsDatabaseScraper';

const OFFICE = 'yale-college-fellowships-office';
const GRANTS = 'student-grants-database';
const OFFICE_KEY = `${OFFICE}:fixture-summer-inquiry-award`;
const OFFICE_PAGE = 'https://fellowships.example.edu/fixture-summer-inquiry-award/';
const FUND_PAGE = 'https://yale.communityforce.com/Funds/FundDetails.aspx?FIXTUREFUNDAAA';
const OTHER_FUND_PAGE = 'https://yale.communityforce.com/Funds/FundDetails.aspx?FIXTUREFUNDBBB';
const FUND_KEY = sourceKeyForFund(FUND_PAGE);
const OFFICE_SUMMARY =
  'The award supports Yale College undergraduates spending a summer on scholarly inquiry away from campus, with guidance from an adviser.';

const FUND_FACETS: Record<string, string[]> = {
  purpose: ['Research'],
  termOfAward: ['Summer'],
  yearOfStudy: ['Sophomore', 'Junior'],
  citizenshipStatus: ['U.S. Citizen'],
  globalRegions: ['North America'],
};

type Row = Record<string, any>;

describe("a fund's own facets outrank another lane's inference (#4173)", () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  beforeEach(async () => {
    resetInvalidatedScrapeRunCache();
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['observations', 'fellowships', 'scraperuns']) {
      await db.collection(name).deleteMany({});
    }
  });

  const observe = (
    entityKey: string,
    sourceName: string,
    sourceUrl: string,
    fields: Record<string, unknown>,
    observedAt: string,
  ) =>
    Observation.insertMany(
      Object.entries(fields).map(([field, value]) => ({
        entityType: 'fellowship',
        entityKey,
        field,
        value,
        sourceId: new mongoose.Types.ObjectId(),
        sourceName,
        sourceUrl,
        confidence: 0.95,
        observedAt: new Date(observedAt),
        superseded: false,
      })),
    );

  const seedOfficeRow = async (links: string[]) => {
    await Fellowship.create({
      title: 'Fixture Summer Inquiry Award',
      sourceKey: OFFICE_KEY,
      sourceName: OFFICE,
      sourceUrl: OFFICE_PAGE,
      applicationLink: links[0],
      links: links.map((url) => ({ label: 'Apply', url })),
      summary: OFFICE_SUMMARY,
      purpose: ['Travel'],
      termOfAward: ['Academic Year'],
      archived: false,
    });
    await observe(
      OFFICE_KEY,
      OFFICE,
      OFFICE_PAGE,
      {
        title: 'Fixture Summer Inquiry Award',
        sourceName: OFFICE,
        sourceUrl: OFFICE_PAGE,
        applicationLink: links[0],
        links: links.map((url) => ({ label: 'Apply', url })),
        summary: OFFICE_SUMMARY,
        purpose: ['Travel'],
        termOfAward: ['Academic Year'],
      },
      '2026-03-01T00:00:00Z',
    );
  };

  const seedFund = (fundPage: string, facets: Record<string, string[]>, observedAt: string) =>
    observe(
      sourceKeyForFund(fundPage),
      GRANTS,
      fundPage,
      {
        title: 'Fixture Summer Inquiry Award (Catalog)',
        sourceName: GRANTS,
        sourceUrl: fundPage,
        applicationLink: fundPage,
        summary: 'Catalog summary that must not replace the office summary.',
        ...facets,
      },
      observedAt,
    );

  const officeRow = async () => Fellowship.findOne({ sourceKey: OFFICE_KEY }).lean<Row>();

  const facetsOf = (row: Row | null) =>
    Object.fromEntries(Object.keys(FUND_FACETS).map((field) => [field, row?.[field]]));

  it("the owning lane's pass resolves the fund's facets over its own inference", async () => {
    await seedOfficeRow([FUND_PAGE]);
    await seedFund(FUND_PAGE, FUND_FACETS, '2026-02-01T00:00:00Z');

    await materializeEntity('fellowship', { entityKey: OFFICE_KEY });

    const row = await officeRow();
    expect(facetsOf(row)).toEqual(FUND_FACETS);
    expect(row?.title).toBe('Fixture Summer Inquiry Award');
    expect(row?.summary).toBe(OFFICE_SUMMARY);
    expect(row?.sourceName).toBe(OFFICE);
    expect(row?.manuallyLockedFields ?? []).toEqual([]);
  });

  it("the fund's pass and the owning pass agree, and re-running either changes nothing", async () => {
    await seedOfficeRow([FUND_PAGE]);
    await seedFund(FUND_PAGE, FUND_FACETS, '2026-02-01T00:00:00Z');

    await materializeEntity('fellowship', { entityKey: FUND_KEY });
    const afterFundPass = await officeRow();
    expect(await Fellowship.countDocuments({})).toBe(1);
    expect(facetsOf(afterFundPass)).toEqual(FUND_FACETS);
    expect(afterFundPass?.summary).toBe(OFFICE_SUMMARY);
    expect(afterFundPass?.title).toBe('Fixture Summer Inquiry Award');

    await materializeEntity('fellowship', { entityKey: OFFICE_KEY });
    expect(facetsOf(await officeRow())).toEqual(FUND_FACETS);
    await materializeEntity('fellowship', { entityKey: FUND_KEY });
    await materializeEntity('fellowship', { entityKey: OFFICE_KEY });
    const settled = await officeRow();
    expect(facetsOf(settled)).toEqual(FUND_FACETS);
    expect(settled?.manuallyLockedFields ?? []).toEqual([]);
  });

  it('the chunked run path reads the fund facets through the read source', async () => {
    await seedOfficeRow([FUND_PAGE]);
    await seedFund(FUND_PAGE, FUND_FACETS, '2026-02-01T00:00:00Z');

    const outcomes: ObservedEntityOutcome[] = [];
    await materializeObservedEntitiesInChunks(
      [
        { entityType: 'fellowship', entityKey: OFFICE_KEY },
        { entityType: 'fellowship', entityKey: FUND_KEY },
      ] as any,
      {},
      (_row, outcome) => outcomes.push(outcome),
    );

    expect(outcomes.every((outcome) => !('error' in outcome) || !outcome.error)).toBe(true);
    expect(await Fellowship.countDocuments({})).toBe(1);
    expect(facetsOf(await officeRow())).toEqual(FUND_FACETS);
  });

  it('a facet the fund does not state stays with the owning lane', async () => {
    await seedOfficeRow([FUND_PAGE]);
    await seedFund(FUND_PAGE, { purpose: ['Research'] }, '2026-02-01T00:00:00Z');

    await materializeEntity('fellowship', { entityKey: OFFICE_KEY });

    const row = await officeRow();
    expect(row?.purpose).toEqual(['Research']);
    expect(row?.termOfAward).toEqual(['Academic Year']);
  });

  it('a row citing two different funds loads neither fund on the owning pass', async () => {
    await seedOfficeRow([FUND_PAGE, OTHER_FUND_PAGE]);
    await seedFund(FUND_PAGE, FUND_FACETS, '2026-02-01T00:00:00Z');
    await seedFund(
      OTHER_FUND_PAGE,
      { purpose: ['Internship'], termOfAward: ['Winter'] },
      '2026-02-15T00:00:00Z',
    );

    await materializeEntity('fellowship', { entityKey: OFFICE_KEY });

    const row = await officeRow();
    expect(row?.purpose).toEqual(['Travel']);
    expect(row?.termOfAward).toEqual(['Academic Year']);
  });

  it('a row that previously read as non-research becomes servable once the fund says Research', async () => {
    await seedOfficeRow([FUND_PAGE]);
    const before = computeProgramStudentVisibility((await officeRow()) as any);
    await seedFund(FUND_PAGE, FUND_FACETS, '2026-02-01T00:00:00Z');

    await materializeEntity('fellowship', { entityKey: OFFICE_KEY });
    const after = computeProgramStudentVisibility((await officeRow()) as any);

    expect(before.tier).toBe('suppressed');
    expect(before.reasons).toContain('non_research_program');
    expect(after.tier).not.toBe('suppressed');
    expect(after.reasons).not.toContain('non_research_program');
  });

  it('a fund the portal retired archives the row applying through it on every pass (#4174)', async () => {
    await seedOfficeRow([FUND_PAGE]);
    await observe(OFFICE_KEY, OFFICE, OFFICE_PAGE, { archived: false }, '2026-03-02T00:00:00Z');
    await seedFund(FUND_PAGE, FUND_FACETS, '2026-02-01T00:00:00Z');
    await observe(FUND_KEY, GRANTS, FUND_PAGE, { archived: false }, '2026-02-01T00:00:00Z');
    await observe(FUND_KEY, GRANTS, FUND_PAGE, { archived: true }, '2026-04-01T00:00:00Z');

    await materializeEntity('fellowship', { entityKey: FUND_KEY });
    const afterFundPass = await officeRow();
    await materializeEntity('fellowship', { entityKey: OFFICE_KEY });
    await materializeEntity('fellowship', { entityKey: OFFICE_KEY });
    const afterOwningPasses = await officeRow();

    expect(afterFundPass?.archived).toBe(true);
    expect(afterOwningPasses?.archived).toBe(true);
    expect(await Fellowship.countDocuments({})).toBe(1);
  });

  it('a live fund never revives a row its owning lane archived (#4174)', async () => {
    await seedOfficeRow([FUND_PAGE]);
    await observe(OFFICE_KEY, OFFICE, OFFICE_PAGE, { archived: true }, '2026-03-02T00:00:00Z');
    await seedFund(FUND_PAGE, FUND_FACETS, '2026-02-01T00:00:00Z');
    await observe(FUND_KEY, GRANTS, FUND_PAGE, { archived: false }, '2026-04-01T00:00:00Z');

    await materializeEntity('fellowship', { entityKey: OFFICE_KEY });

    expect((await officeRow())?.archived).toBe(true);
  });

  it('a retired fund that describes a different program archives neither pass (#4174)', async () => {
    await seedOfficeRow([FUND_PAGE]);
    await observe(OFFICE_KEY, OFFICE, OFFICE_PAGE, { archived: false }, '2026-03-02T00:00:00Z');
    await seedFund(FUND_PAGE, FUND_FACETS, '2026-02-01T00:00:00Z');
    await observe(FUND_KEY, GRANTS, FUND_PAGE, { title: 'Common Application' }, '2026-02-02T00:00:00Z');
    await observe(FUND_KEY, GRANTS, FUND_PAGE, { archived: true }, '2026-04-01T00:00:00Z');

    await materializeEntity('fellowship', { entityKey: FUND_KEY });
    const afterFundPass = await officeRow();
    await materializeEntity('fellowship', { entityKey: OFFICE_KEY });

    expect(afterFundPass?.archived).toBe(false);
    expect((await officeRow())?.archived).toBe(false);
  });

  it('keeps reading a retired fund whose only citing row it archived (#4174)', async () => {
    await seedOfficeRow([FUND_PAGE]);
    await Fellowship.updateOne({ sourceKey: OFFICE_KEY }, { $set: { archived: true } });
    await observe(FUND_KEY, GRANTS, FUND_PAGE, { archived: true }, '2026-04-01T00:00:00Z');

    expect(await loadCitedFundDetailUrls()).toContain(FUND_PAGE);
  });

  it("the owning lane's pass keeps the fund's application window over its own (#4412)", async () => {
    await seedOfficeRow([FUND_PAGE]);
    await observe(
      OFFICE_KEY,
      OFFICE,
      OFFICE_PAGE,
      {
        deadline: new Date('2019-11-16T04:59:59.999Z'),
        applicationOpenDate: new Date('2019-06-26T04:00:00.000Z'),
      },
      '2026-03-02T00:00:00Z',
    );
    await observe(
      FUND_KEY,
      GRANTS,
      FUND_PAGE,
      {
        title: 'Fixture Summer Inquiry Award (Catalog)',
        sourceName: GRANTS,
        sourceUrl: FUND_PAGE,
        deadline: new Date('2027-03-01T17:00:00.000Z'),
        applicationOpenDate: new Date('2026-12-01T05:00:00.000Z'),
      },
      '2026-02-01T00:00:00Z',
    );

    await materializeEntity('fellowship', { entityKey: OFFICE_KEY });
    const afterOwningPass = await officeRow();
    await materializeEntity('fellowship', { entityKey: FUND_KEY });
    await materializeEntity('fellowship', { entityKey: OFFICE_KEY });
    const afterBothPasses = await officeRow();

    for (const row of [afterOwningPass, afterBothPasses]) {
      expect(row?.deadline?.toISOString()).toBe('2027-03-01T17:00:00.000Z');
      expect(row?.applicationOpenDate?.toISOString()).toBe('2026-12-01T05:00:00.000Z');
    }
  });

  it("the owning lane's pass that creates the row already serves the fund's window", async () => {
    await seedOfficeRow([FUND_PAGE]);
    await Fellowship.deleteMany({});
    await observe(
      OFFICE_KEY,
      OFFICE,
      OFFICE_PAGE,
      { deadline: new Date('2019-11-16T04:59:59.999Z') },
      '2026-03-02T00:00:00Z',
    );
    await observe(
      FUND_KEY,
      GRANTS,
      FUND_PAGE,
      {
        title: 'Fixture Summer Inquiry Award (Catalog)',
        sourceName: GRANTS,
        sourceUrl: FUND_PAGE,
        deadline: new Date('2027-03-01T17:00:00.000Z'),
        isAcceptingApplications: true,
        reviewRequired: false,
      },
      '2026-02-01T00:00:00Z',
    );

    const outcome = await materializeEntity('fellowship', { entityKey: OFFICE_KEY });

    const row = await officeRow();
    expect(outcome.created).toBe(true);
    expect(row?.deadline?.toISOString()).toBe('2027-03-01T17:00:00.000Z');
    expect(row?.isAcceptingApplications).toBe(true);
    expect(row?.sourceName).toBe(OFFICE);
  });

  it("an owning lane's window stands where the fund states none", async () => {
    await seedOfficeRow([FUND_PAGE]);
    await observe(
      OFFICE_KEY,
      OFFICE,
      OFFICE_PAGE,
      {
        deadline: new Date('2027-01-15T04:59:59.999Z'),
        isAcceptingApplications: true,
        reviewRequired: false,
      },
      '2026-03-02T00:00:00Z',
    );
    await seedFund(FUND_PAGE, FUND_FACETS, '2026-02-01T00:00:00Z');
    await observe(
      FUND_KEY,
      GRANTS,
      FUND_PAGE,
      { isAcceptingApplications: false, reviewRequired: true },
      '2026-02-01T00:00:00Z',
    );

    const rows = [];
    for (const entityKey of [OFFICE_KEY, FUND_KEY, OFFICE_KEY]) {
      await materializeEntity('fellowship', { entityKey });
      rows.push(await officeRow());
    }

    for (const row of rows) {
      expect(row?.deadline?.toISOString()).toBe('2027-01-15T04:59:59.999Z');
      expect(row?.isAcceptingApplications).toBe(true);
    }
  });

  it("a row citing two funds keeps the owning lane's window on every pass", async () => {
    await seedOfficeRow([FUND_PAGE, OTHER_FUND_PAGE]);
    await observe(
      OFFICE_KEY,
      OFFICE,
      OFFICE_PAGE,
      { deadline: new Date('2027-01-15T04:59:59.999Z') },
      '2026-03-02T00:00:00Z',
    );
    await observe(
      FUND_KEY,
      GRANTS,
      FUND_PAGE,
      {
        title: 'Fixture Summer Inquiry Award (Catalog)',
        sourceName: GRANTS,
        sourceUrl: FUND_PAGE,
        applicationLink: FUND_PAGE,
        deadline: new Date('2027-03-01T17:00:00.000Z'),
      },
      '2026-02-01T00:00:00Z',
    );

    const deadlines = [];
    for (const entityKey of [OFFICE_KEY, FUND_KEY, OFFICE_KEY]) {
      await materializeEntity('fellowship', { entityKey });
      deadlines.push((await officeRow())?.deadline?.toISOString());
    }

    expect(deadlines).toEqual(Array(3).fill('2027-01-15T04:59:59.999Z'));
  });
});
