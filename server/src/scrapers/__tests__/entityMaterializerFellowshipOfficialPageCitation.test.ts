import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Fellowship } from '../../models/fellowship';
import { Observation } from '../../models/observation';
import { ScrapeRun } from '../../models/scrapeRun';
import { materializeEntity } from '../entityMaterializer';
import { resetInvalidatedScrapeRunCache } from '../invalidatedScrapeRuns';
import { LANE_PAGE_HEALTH_FIELD } from '../lanePageHealth';
import { PROGRAM_OFFICIAL_PAGE_SOURCE } from '../utils/programOfficialPage';

const DATABASE = 'student-grants-database';
const OFFICE = 'yale-college-fellowships-office';
const FUND_PAGE = 'https://yale.communityforce.com/Funds/FundDetails.aspx?FIXTUREFUND';
const OFFICIAL_PAGE = 'https://fixture-college.yale.edu/resources/fellowships';
const READ_AT = new Date('2026-09-20T00:00:00Z');
const GONE_AT = new Date('2026-09-27T00:00:00Z');

beforeEach(() => {
  resetInvalidatedScrapeRunCache();
  vi.spyOn(ScrapeRun, 'find').mockReturnValue({ lean: vi.fn().mockResolvedValue([]) } as any);
});

afterEach(() => {
  vi.restoreAllMocks();
  resetInvalidatedScrapeRunCache();
});

interface Observed {
  field: string;
  value?: unknown;
  sourceName: string;
  sourceUrl?: string;
  observedAt?: Date;
}

function projectFellowship(
  stored: Record<string, unknown>,
  observations: Observed[],
  passKey = String(stored.sourceKey),
) {
  vi.spyOn(Observation, 'find').mockReturnValue({
    lean: vi.fn().mockResolvedValue(
      observations.map((observation) => ({
        entityType: 'fellowship',
        entityKey: passKey,
        confidence: 0.9,
        observedAt: READ_AT,
        ...observation,
      })),
    ),
  } as any);
  vi.spyOn(Fellowship, 'findOne').mockReturnValue({
    lean: vi.fn().mockResolvedValue(stored),
    select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(stored) }),
  } as any);
  return materializeEntity('fellowship', { entityKey: passKey }, { dryRun: true });
}

const databaseRow = (overrides: Record<string, unknown> = {}) => ({
  _id: 'fixture-id',
  sourceKey: `${DATABASE}:fixture-fund`,
  sourceName: DATABASE,
  title: 'Fixture Summer Fellowship',
  sourceUrl: OFFICIAL_PAGE,
  ...overrides,
});

const fundObservations = (row: Record<string, unknown>): Observed[] => [
  { field: 'sourceKey', value: row.sourceKey, sourceName: DATABASE },
  { field: 'title', value: row.title, sourceName: DATABASE },
  { field: 'sourceUrl', value: FUND_PAGE, sourceName: DATABASE, sourceUrl: FUND_PAGE },
];

const citation = (value: string, observedAt = READ_AT): Observed => ({
  field: 'sourceUrl',
  value,
  sourceName: PROGRAM_OFFICIAL_PAGE_SOURCE,
  sourceUrl: OFFICIAL_PAGE,
  observedAt,
});

describe('a Yale fellowship database program official page as an observed citation (#4601)', () => {
  it('replaces a stored official page that no live observation backs with the fund page', async () => {
    const stored = databaseRow();

    const result = await projectFellowship(stored, fundObservations(stored));

    expect(result.plannedSet).toMatchObject({ sourceUrl: FUND_PAGE });
  });

  it('keeps a stored official page the official-page lane cites', async () => {
    const stored = databaseRow();

    const result = await projectFellowship(stored, [
      ...fundObservations(stored),
      citation(OFFICIAL_PAGE),
    ]);

    expect(result.plannedSet?.sourceUrl ?? OFFICIAL_PAGE).toBe(OFFICIAL_PAGE);
  });

  it('serves the cited official page over the fund page on a row that stores the fund page', async () => {
    const stored = databaseRow({ sourceUrl: FUND_PAGE });

    const result = await projectFellowship(stored, [
      ...fundObservations(stored),
      citation(OFFICIAL_PAGE),
    ]);

    expect(result.plannedSet).toMatchObject({ sourceUrl: OFFICIAL_PAGE });
  });

  it('lets the fund page win once the lane reads the page and finds no mention of the fund', async () => {
    const stored = databaseRow();

    const result = await projectFellowship(stored, [...fundObservations(stored), citation('')]);

    expect(result.plannedSet).toMatchObject({ sourceUrl: FUND_PAGE });
    expect(result.plannedUnset ?? {}).not.toHaveProperty('sourceUrl');
  });

  it('withdraws the citation once the lane confirms the official page is gone', async () => {
    const stored = databaseRow();

    const result = await projectFellowship(stored, [
      ...fundObservations(stored),
      citation(OFFICIAL_PAGE),
      {
        field: LANE_PAGE_HEALTH_FIELD,
        value: { url: OFFICIAL_PAGE, healthStatus: 'UNAVAILABLE', httpStatusCode: 404 },
        sourceName: PROGRAM_OFFICIAL_PAGE_SOURCE,
        sourceUrl: OFFICIAL_PAGE,
        observedAt: GONE_AT,
      },
    ]);

    expect(result.plannedSet).toMatchObject({ sourceUrl: FUND_PAGE });
    expect(result.plannedSet ?? {}).not.toHaveProperty(LANE_PAGE_HEALTH_FIELD);
  });

  it('keeps another lane’s official page on a pass entered through the fund key', async () => {
    const stored = databaseRow({
      sourceKey: `${OFFICE}:fixture-summer-fellowship`,
      sourceName: OFFICE,
    });

    const result = await projectFellowship(
      stored,
      fundObservations({ ...stored, sourceKey: `${DATABASE}:fixture-fund` }),
      `${DATABASE}:fixture-fund`,
    );

    expect(result.plannedSet ?? {}).not.toHaveProperty('sourceUrl');
  });
});
