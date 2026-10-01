import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/meiliSyncService', async () => {
  const actual = await vi.importActual<typeof import('../../services/meiliSyncService')>(
    '../../services/meiliSyncService',
  );
  return { ...actual, syncEntity: vi.fn().mockResolvedValue(undefined) };
});

import { Fellowship } from '../../models/fellowship';
import { Observation } from '../../models/observation';
import { computeProgramStudentVisibility } from '../../services/studentVisibilityTier';
import { materializeEntity } from '../entityMaterializer';
import { sourceKeyForFund } from '../fellowshipFundFacets';
import { resetInvalidatedScrapeRunCache } from '../invalidatedScrapeRuns';

const OFFICE = 'yale-college-fellowships-office';
const GRANTS = 'student-grants-database';
const OFFICE_KEY = `${OFFICE}:fixture-office-program`;
const OFFICE_PAGE = 'https://fellowships.example.edu/fixture-office-program/';
const FUND_PAGE = 'https://yale.communityforce.com/Funds/FundDetails.aspx?FIXTUREFUNDCCC';
const FUND_KEY = sourceKeyForFund(FUND_PAGE);
const OFFICE_SUMMARY =
  'The program supports Yale College students spending time away from campus with guidance from an adviser.';

const OWN_FACETS = { purpose: ['Travel'], termOfAward: ['Academic Year'] };
const FUND_FACETS = { purpose: ['Research'], termOfAward: ['Summer'] };

type Row = Record<string, any>;

describe('a cited fund page that names a different program (#4173)', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
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

  const seedOfficeRow = async (title: string, lockedFields: string[] = []) => {
    await Fellowship.create({
      title,
      sourceKey: OFFICE_KEY,
      sourceName: OFFICE,
      sourceUrl: OFFICE_PAGE,
      applicationLink: FUND_PAGE,
      links: [{ label: 'Apply', url: FUND_PAGE }],
      summary: OFFICE_SUMMARY,
      ...OWN_FACETS,
      manuallyLockedFields: lockedFields,
      archived: false,
    });
    await observe(
      OFFICE_KEY,
      OFFICE,
      OFFICE_PAGE,
      {
        title,
        sourceName: OFFICE,
        sourceUrl: OFFICE_PAGE,
        applicationLink: FUND_PAGE,
        links: [{ label: 'Apply', url: FUND_PAGE }],
        summary: OFFICE_SUMMARY,
        ...OWN_FACETS,
      },
      '2026-03-01T00:00:00Z',
    );
  };

  const seedFund = (title: string) =>
    observe(
      FUND_KEY,
      GRANTS,
      FUND_PAGE,
      {
        title,
        sourceName: GRANTS,
        sourceUrl: FUND_PAGE,
        applicationLink: FUND_PAGE,
        summary: 'Catalog summary that must not replace the office summary.',
        ...FUND_FACETS,
      },
      '2026-02-01T00:00:00Z',
    );

  const officeRow = async () => Fellowship.findOne({ sourceKey: OFFICE_KEY }).lean<Row>();
  const facetsOf = (row: Row | null) => ({
    purpose: row?.purpose,
    termOfAward: row?.termOfAward,
  });

  const runBothPassesTwice = async () => {
    const observed: Record<string, unknown>[] = [];
    for (const key of [OFFICE_KEY, FUND_KEY, OFFICE_KEY, FUND_KEY]) {
      await materializeEntity('fellowship', { entityKey: key });
      observed.push(facetsOf(await officeRow()));
    }
    return observed;
  };

  it("a common application's facets reach the row in neither pass", async () => {
    await seedOfficeRow('Fixture Postgraduate Fellowships');
    await seedFund('Fixture Postgraduate Fellowships Common Application');

    const observed = await runBothPassesTwice();

    expect(observed).toEqual([OWN_FACETS, OWN_FACETS, OWN_FACETS, OWN_FACETS]);
    expect(await Fellowship.countDocuments({})).toBe(1);
    const row = await officeRow();
    expect(row?.title).toBe('Fixture Postgraduate Fellowships');
    expect(row?.summary).toBe(OFFICE_SUMMARY);
  });

  it("an undergraduate award citing the postgraduate fund keeps its own lane's purpose", async () => {
    await seedOfficeRow('Fixture Undergraduate Travel Fellowship');
    await seedFund('Fixture Postgraduate Fellowship');

    const observed = await runBothPassesTwice();

    expect(observed).toEqual([OWN_FACETS, OWN_FACETS, OWN_FACETS, OWN_FACETS]);
    const visibility = computeProgramStudentVisibility((await officeRow()) as any);
    expect(visibility.reasons).toContain('non_research_program');
  });

  it("a row whose title is locked still refuses the other program's facets in the fund's pass", async () => {
    await seedOfficeRow('Fixture Postgraduate Fellowships', ['title']);
    await seedFund('Fixture Postgraduate Fellowships Common Application');

    const observed = await runBothPassesTwice();

    expect(observed).toEqual([OWN_FACETS, OWN_FACETS, OWN_FACETS, OWN_FACETS]);
    expect((await officeRow())?.title).toBe('Fixture Postgraduate Fellowships');
  });

  it("the row's own fund written differently still supplies its facets in both passes", async () => {
    await seedOfficeRow('Fixture Fellowships for Baltic Studies');
    await seedFund('Fixture Fellowship for Baltic Studies');

    const observed = await runBothPassesTwice();

    expect(observed).toEqual([FUND_FACETS, FUND_FACETS, FUND_FACETS, FUND_FACETS]);
    expect((await officeRow())?.title).toBe('Fixture Fellowships for Baltic Studies');
  });
});
