import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Fellowship } from '../../models/fellowship';
import { Observation } from '../../models/observation';
import { ScrapeRun } from '../../models/scrapeRun';
import { materializeEntity } from '../entityMaterializer';
import {
  assertFellowshipEvidenceOnlyFieldsAreClearable,
  planFellowshipUnbackedFieldClears,
} from '../fellowshipUnbackedFieldClear';
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

  it('refuses a field the classifier derives or a fund page can state', () => {
    expect(() => assertFellowshipEvidenceOnlyFieldsAreClearable(['programKind'])).toThrow(
      /derives it/,
    );
    expect(() => assertFellowshipEvidenceOnlyFieldsAreClearable(['deadline'])).toThrow(/fund key/);
  });
});
