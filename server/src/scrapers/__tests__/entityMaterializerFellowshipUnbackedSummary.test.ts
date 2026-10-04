import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Fellowship } from '../../models/fellowship';
import { Observation } from '../../models/observation';
import { ScrapeRun } from '../../models/scrapeRun';
import { materializeEntity } from '../entityMaterializer';
import {
  assertFellowshipEvidenceOnlyFieldsAreClearable,
  planFellowshipUnbackedFieldClears,
} from '../fellowshipUnbackedFieldClear';
import { sourceKeyForFund } from '../fellowshipFundFacets';
import { resetInvalidatedScrapeRunCache } from '../invalidatedScrapeRuns';

const DATABASE = 'student-grants-database';
const OFFICE = 'yale-college-fellowships-office';
const FUND_PAGE = 'https://yale.communityforce.com/Funds/FundDetails.aspx?FIXTUREFUND';
const OFFICIAL_PAGE = 'https://funding.yale.edu/fixture-research-fellowship';
const READ_AT = new Date('2026-09-20T00:00:00Z');

const IMPORTED_SUMMARY = 'Supports doctoral students conducting summer research abroad.';
const OBSERVED_DESCRIPTION =
  'The Fixture Fund supports Master’s or doctoral students conducting summer research abroad in any discipline, with awards of up to $3,000.';

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

const grantsRow = (overrides: Record<string, unknown> = {}) => ({
  _id: 'fixture-id',
  sourceKey: `${DATABASE}:fixture-fund`,
  sourceName: DATABASE,
  title: 'Fixture Fund',
  sourceUrl: FUND_PAGE,
  description: OBSERVED_DESCRIPTION,
  summary: IMPORTED_SUMMARY,
  ...overrides,
});

describe('a fellowship summary no observation backs (#4586)', () => {
  it('clears a stored summary when no live observation on the row states one', async () => {
    const stored = grantsRow();

    const result = await projectFellowship(stored, [
      { field: 'sourceKey', value: stored.sourceKey, sourceName: DATABASE },
      { field: 'title', value: stored.title, sourceName: DATABASE },
      { field: 'description', value: OBSERVED_DESCRIPTION, sourceName: DATABASE },
    ]);

    expect(result.fellowshipUnbackedClears).toEqual(['summary']);
    expect(result.plannedUnset).toMatchObject({ summary: '' });
    expect(result.plannedSet).not.toHaveProperty('summary');
  });

  it('keeps a summary a live observation states', async () => {
    const stored = {
      _id: 'fixture-id',
      sourceKey: `${OFFICE}:fixture-research-fellowship`,
      sourceName: OFFICE,
      title: 'Fixture Research Fellowship',
      sourceUrl: OFFICIAL_PAGE,
      summary: 'Funds a summer of independent research.',
    };

    const result = await projectFellowship(stored, [
      { field: 'sourceKey', value: stored.sourceKey, sourceName: OFFICE },
      { field: 'title', value: stored.title, sourceName: OFFICE },
      { field: 'summary', value: stored.summary, sourceName: OFFICE },
    ]);

    expect(result.fellowshipUnbackedClears).toBeUndefined();
    expect(result.plannedUnset ?? {}).not.toHaveProperty('summary');
  });

  it('leaves another lane’s row alone on a pass entered through a fund key', async () => {
    const stored = {
      _id: 'fixture-id',
      sourceKey: `${OFFICE}:fixture-research-fellowship`,
      sourceName: OFFICE,
      title: 'Fixture Research Fellowship',
      sourceUrl: OFFICIAL_PAGE,
      summary: 'Funds a summer of independent research.',
    };

    const result = await projectFellowship(
      stored,
      [
        { field: 'sourceKey', value: `${DATABASE}:fixture-fund`, sourceName: DATABASE },
        { field: 'title', value: stored.title, sourceName: DATABASE },
      ],
      `${DATABASE}:fixture-fund`,
    );

    expect(result.fellowshipUnbackedClears).toBeUndefined();
    expect(result.plannedUnset ?? {}).not.toHaveProperty('summary');
  });

  it('plans nothing on a second pass over the cleared row', async () => {
    const stored = grantsRow({ summary: '' });

    const result = await projectFellowship(stored, [
      { field: 'sourceKey', value: stored.sourceKey, sourceName: DATABASE },
      { field: 'title', value: stored.title, sourceName: DATABASE },
      { field: 'description', value: OBSERVED_DESCRIPTION, sourceName: DATABASE },
    ]);

    expect(result.fellowshipUnbackedClears).toBeUndefined();
    expect(result.plannedUnset ?? {}).not.toHaveProperty('summary');
  });
});

describe('planFellowshipUnbackedFieldClears', () => {
  const base = {
    stored: { summary: IMPORTED_SUMMARY },
    staged: {},
    unset: {},
    liveObservedFields: new Set<string>(),
    fieldsStatedByCitedFunds: new Set<string>(),
    readRowUnderOwnIdentity: true,
  };

  it('clears only on a pass under the row’s own identity', () => {
    expect(planFellowshipUnbackedFieldClears(base)).toEqual(['summary']);
    expect(planFellowshipUnbackedFieldClears({ ...base, readRowUnderOwnIdentity: false })).toEqual(
      [],
    );
  });

  it('leaves a field the pass stages, already clears, or observes', () => {
    expect(planFellowshipUnbackedFieldClears({ ...base, staged: { summary: 'x' } })).toEqual([]);
    expect(planFellowshipUnbackedFieldClears({ ...base, unset: { summary: '' } })).toEqual([]);
    expect(
      planFellowshipUnbackedFieldClears({ ...base, liveObservedFields: new Set(['summary']) }),
    ).toEqual([]);
  });

  it('refuses a field the classifier derives', () => {
    expect(() => assertFellowshipEvidenceOnlyFieldsAreClearable(['programKind'])).toThrow(
      /derives it/,
    );
  });

  it('keeps a field a fund the row cites states', () => {
    expect(
      planFellowshipUnbackedFieldClears({
        ...base,
        fieldsStatedByCitedFunds: new Set(['summary']),
      }),
    ).toEqual([]);
  });
});

describe('a fellowship contact no observation backs (#4600)', () => {
  const IMPORTED_EMAIL = 'fixture.contact@example.edu';
  const IMPORTED_NAME = 'Fixture Contact';

  it('clears a stored contact email and name when no live observation on the row states them', async () => {
    const stored = grantsRow({
      summary: '',
      contactEmail: IMPORTED_EMAIL,
      contactName: IMPORTED_NAME,
    });

    const result = await projectFellowship(stored, [
      { field: 'sourceKey', value: stored.sourceKey, sourceName: DATABASE },
      { field: 'title', value: stored.title, sourceName: DATABASE },
      { field: 'description', value: OBSERVED_DESCRIPTION, sourceName: DATABASE },
    ]);

    expect(result.fellowshipUnbackedClears).toEqual(['contactEmail', 'contactName']);
    expect(result.plannedUnset).toMatchObject({ contactEmail: '', contactName: '' });
    expect(result.plannedSet).not.toHaveProperty('contactEmail');
  });

  it('keeps a contact email a live observation states', async () => {
    const stored = {
      _id: 'fixture-id',
      sourceKey: `${OFFICE}:fixture-research-fellowship`,
      sourceName: OFFICE,
      title: 'Fixture Research Fellowship',
      sourceUrl: OFFICIAL_PAGE,
      contactEmail: IMPORTED_EMAIL,
    };

    const result = await projectFellowship(stored, [
      { field: 'sourceKey', value: stored.sourceKey, sourceName: OFFICE },
      { field: 'title', value: stored.title, sourceName: OFFICE },
      { field: 'contactEmail', value: IMPORTED_EMAIL, sourceName: OFFICE },
    ]);

    expect(result.fellowshipUnbackedClears ?? []).not.toContain('contactEmail');
    expect(result.plannedUnset ?? {}).not.toHaveProperty('contactEmail');
  });

  it('leaves a contact on another lane’s row alone on a pass entered through a fund key', async () => {
    const stored = {
      _id: 'fixture-id',
      sourceKey: `${OFFICE}:fixture-research-fellowship`,
      sourceName: OFFICE,
      title: 'Fixture Research Fellowship',
      sourceUrl: OFFICIAL_PAGE,
      contactEmail: IMPORTED_EMAIL,
    };

    const result = await projectFellowship(
      stored,
      [
        { field: 'sourceKey', value: `${DATABASE}:fixture-fund`, sourceName: DATABASE },
        { field: 'title', value: stored.title, sourceName: DATABASE },
      ],
      `${DATABASE}:fixture-fund`,
    );

    expect(result.plannedUnset ?? {}).not.toHaveProperty('contactEmail');
  });
});

describe('a fellowship description no observation backs (#4602)', () => {
  const FUND_KEY = sourceKeyForFund(FUND_PAGE);
  const OFFICE_KEY = `${OFFICE}:fixture-research-fellowship`;
  const IMPORTED_DESCRIPTION = 'Imported catalog text that no page states.';
  const OFFICE_DESCRIPTION = 'The office page describes a summer of independent research abroad.';

  const keyMatches = (condition: unknown, key: string): boolean => {
    if (condition === undefined) return true;
    if (typeof condition === 'string') return condition === key;
    const inList = (condition as { $in?: unknown[] })?.$in;
    return Array.isArray(inList) ? inList.includes(key) : false;
  };

  const queryMatches = (query: any, observation: any): boolean => {
    if (!query || typeof query !== 'object') return true;
    if (Array.isArray(query.$or) && query.$or.length > 0) {
      const anyBranch = query.$or.some((branch: any) =>
        branch?.entityKey !== undefined
          ? keyMatches(branch.entityKey, observation.entityKey)
          : true,
      );
      if (!anyBranch) return false;
    }
    if (!keyMatches(query.entityKey, observation.entityKey)) return false;
    if (query.sourceName !== undefined && query.sourceName !== observation.sourceName) return false;
    const fields = query.field?.$in;
    if (Array.isArray(fields) && !fields.includes(observation.field)) return false;
    return true;
  };

  function projectKeyed(
    stored: Record<string, unknown>,
    observations: Array<Observed & { entityKey: string }>,
    passKey: string,
  ) {
    const rows = observations.map((observation) => ({
      _id: `${observation.entityKey}:${observation.field}:${observation.sourceName}`,
      entityType: 'fellowship',
      confidence: 0.9,
      observedAt: READ_AT,
      ...observation,
    }));
    vi.spyOn(Observation, 'find').mockImplementation(
      (query: any) =>
        ({
          lean: vi.fn().mockResolvedValue(rows.filter((row) => queryMatches(query, row))),
        }) as any,
    );
    vi.spyOn(Fellowship, 'findOne').mockReturnValue({
      lean: vi.fn().mockResolvedValue(stored),
      select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(stored) }),
    } as any);
    return materializeEntity('fellowship', { entityKey: passKey }, { dryRun: true });
  }

  const officeRow = (overrides: Record<string, unknown> = {}) => ({
    _id: 'fixture-id',
    sourceKey: OFFICE_KEY,
    sourceName: OFFICE,
    title: 'Fixture Research Fellowship',
    sourceUrl: OFFICIAL_PAGE,
    applicationLink: FUND_PAGE,
    ...overrides,
  });

  const officeRead = [
    { entityKey: OFFICE_KEY, field: 'sourceKey', value: OFFICE_KEY, sourceName: OFFICE },
    {
      entityKey: OFFICE_KEY,
      field: 'title',
      value: 'Fixture Research Fellowship',
      sourceName: OFFICE,
    },
  ];

  it('clears a stored description that neither the row nor a fund it cites states', async () => {
    const stored = grantsRow({ summary: '', description: IMPORTED_DESCRIPTION });

    const result = await projectFellowship(stored, [
      { field: 'sourceKey', value: stored.sourceKey, sourceName: DATABASE },
      { field: 'title', value: stored.title, sourceName: DATABASE },
    ]);

    expect(result.fellowshipUnbackedClears).toEqual(['description']);
    expect(result.plannedUnset).toMatchObject({ description: '' });
  });

  it('keeps a description the cited fund states on the owning lane’s own pass', async () => {
    const stored = officeRow({ description: OBSERVED_DESCRIPTION });

    const result = await projectKeyed(
      stored,
      [
        ...officeRead,
        {
          entityKey: FUND_KEY,
          field: 'title',
          value: 'Fixture Research Fellowship',
          sourceName: DATABASE,
        },
        {
          entityKey: FUND_KEY,
          field: 'description',
          value: OBSERVED_DESCRIPTION,
          sourceName: DATABASE,
        },
      ],
      OFFICE_KEY,
    );

    expect(result.fellowshipUnbackedClears ?? []).not.toContain('description');
    expect(result.plannedUnset ?? {}).not.toHaveProperty('description');
  });

  it('keeps a description a fund the row cites states even when the fund does not speak for the row', async () => {
    const stored = officeRow({
      title: 'Fixture Undergraduate Research Fellowship',
      description: OBSERVED_DESCRIPTION,
    });

    const result = await projectKeyed(
      stored,
      [
        ...officeRead,
        {
          entityKey: FUND_KEY,
          field: 'title',
          value: 'Fixture Graduate Research Fellowship',
          sourceName: DATABASE,
        },
        {
          entityKey: FUND_KEY,
          field: 'description',
          value: OBSERVED_DESCRIPTION,
          sourceName: DATABASE,
        },
      ],
      OFFICE_KEY,
    );

    expect(result.fellowshipUnbackedClears ?? []).not.toContain('description');
    expect(result.plannedUnset ?? {}).not.toHaveProperty('description');
  });

  it('serves the fund’s description over the owning lane’s on the owning lane’s pass', async () => {
    const stored = officeRow({ description: OFFICE_DESCRIPTION });

    const result = await projectKeyed(
      stored,
      [
        ...officeRead,
        {
          entityKey: OFFICE_KEY,
          field: 'description',
          value: OFFICE_DESCRIPTION,
          sourceName: OFFICE,
        },
        {
          entityKey: FUND_KEY,
          field: 'title',
          value: 'Fixture Research Fellowship',
          sourceName: DATABASE,
        },
        {
          entityKey: FUND_KEY,
          field: 'description',
          value: OBSERVED_DESCRIPTION,
          sourceName: DATABASE,
        },
      ],
      OFFICE_KEY,
    );

    expect(result.plannedSet).toMatchObject({ description: OBSERVED_DESCRIPTION });
  });

  it('writes the same fund description on the fund’s own pass, so the two passes agree', async () => {
    const stored = officeRow({ description: OFFICE_DESCRIPTION });

    const result = await projectKeyed(
      stored,
      [
        { entityKey: FUND_KEY, field: 'sourceKey', value: FUND_KEY, sourceName: DATABASE },
        {
          entityKey: FUND_KEY,
          field: 'title',
          value: 'Fixture Research Fellowship',
          sourceName: DATABASE,
        },
        {
          entityKey: FUND_KEY,
          field: 'description',
          value: OBSERVED_DESCRIPTION,
          sourceName: DATABASE,
        },
      ],
      FUND_KEY,
    );

    expect(result.plannedSet).toMatchObject({ description: OBSERVED_DESCRIPTION });
    expect(result.plannedUnset ?? {}).not.toHaveProperty('description');
  });
});
