import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Fellowship } from '../../models/fellowship';
import { Observation } from '../../models/observation';
import { ScrapeRun } from '../../models/scrapeRun';
import { materializeEntity } from '../entityMaterializer';
import { resetInvalidatedScrapeRunCache } from '../invalidatedScrapeRuns';

const DATABASE = 'student-grants-database';
const OFFICE = 'yale-college-fellowships-office';
const FUND_PAGE = 'https://yale.communityforce.com/Funds/FundDetails.aspx?FIXTUREFUND';
const OFFICIAL_PAGE = 'https://funding.yale.edu/fixture-research-fellowship';

const READ_AT = new Date('2026-09-20T00:00:00Z');
const EARLIER = new Date('2026-07-01T00:00:00Z');

// Mocked reads rather than a database, as the sibling fellowship projection cases do,
// which means the invalidated-run fence needs its own stub (#2469).
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
  observedAt: Date;
  assertsNoValueFor?: string[];
}

function projectFellowship(stored: Record<string, unknown> | null, observations: Observed[]) {
  vi.spyOn(Observation, 'find').mockReturnValue({
    lean: vi.fn().mockResolvedValue(
      observations.map((observation) => ({
        entityType: 'fellowship',
        entityKey: stored?.sourceKey ?? 'fixture-key',
        confidence: 0.9,
        ...observation,
      })),
    ),
  } as any);
  vi.spyOn(Fellowship, 'findOne').mockReturnValue({
    lean: vi.fn().mockResolvedValue(stored),
    select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(stored) }),
  } as any);
  return materializeEntity(
    'fellowship',
    { entityKey: String(stored?.sourceKey ?? 'fixture-key') },
    { dryRun: true },
  );
}

const identity = (
  sourceName: string,
  sourceKey: string,
  assertsNoValueFor?: string[],
): Observed => ({
  field: 'sourceKey',
  value: sourceKey,
  sourceName,
  observedAt: READ_AT,
  ...(assertsNoValueFor ? { assertsNoValueFor } : {}),
});

describe('a fellowship lane withdrawing a value it no longer asserts (#4230)', () => {
  it('clears a stored date the owning lane says the page no longer states', async () => {
    const stored = {
      _id: 'fixture-id',
      sourceKey: `${OFFICE}:fixture-research-fellowship`,
      sourceName: OFFICE,
      title: 'Fixture Research Fellowship',
      sourceUrl: OFFICIAL_PAGE,
      deadline: new Date('2026-12-15T00:00:00Z'),
    };

    const result = await projectFellowship(stored, [
      identity(OFFICE, stored.sourceKey, ['deadline']),
      { field: 'title', value: stored.title, sourceName: OFFICE, observedAt: READ_AT },
      {
        field: 'deadline',
        value: new Date('2026-12-15T00:00:00Z'),
        sourceName: OFFICE,
        observedAt: EARLIER,
      },
    ]);

    expect(result.fellowshipAbsenceClears).toEqual([{ field: 'deadline', assertedBy: [OFFICE] }]);
    expect(result.plannedUnset).toMatchObject({ deadline: '' });
    expect(result.plannedSet).not.toHaveProperty('deadline');
  });

  it('clears a stored list and a stored string the same way', async () => {
    const stored = {
      _id: 'fixture-id',
      sourceKey: `${DATABASE}:fixture-fund`,
      sourceName: DATABASE,
      title: 'Fixture Fund',
      sourceUrl: FUND_PAGE,
      applicationLink: FUND_PAGE,
      yearOfStudy: ['First-Year Student', 'Sophomore'],
    };

    const result = await projectFellowship(stored, [
      identity(DATABASE, stored.sourceKey, ['applicationLink', 'yearOfStudy']),
      { field: 'title', value: stored.title, sourceName: DATABASE, observedAt: READ_AT },
      { field: 'applicationLink', value: FUND_PAGE, sourceName: DATABASE, observedAt: EARLIER },
      {
        field: 'yearOfStudy',
        value: ['First-Year Student', 'Sophomore'],
        sourceName: DATABASE,
        observedAt: EARLIER,
      },
    ]);

    expect(result.fellowshipAbsenceClears?.map((clear) => clear.field)).toEqual([
      'applicationLink',
      'yearOfStudy',
    ]);
    expect(result.plannedUnset).toMatchObject({ applicationLink: '', yearOfStudy: '' });
  });

  it('keeps a value the same lane re-asserted in a later read', async () => {
    const stored = {
      _id: 'fixture-id',
      sourceKey: `${OFFICE}:fixture-research-fellowship`,
      sourceName: OFFICE,
      title: 'Fixture Research Fellowship',
      deadline: new Date('2026-12-15T00:00:00Z'),
    };

    const result = await projectFellowship(stored, [
      identity(OFFICE, stored.sourceKey, ['deadline']),
      {
        field: 'deadline',
        value: new Date('2027-02-01T00:00:00Z'),
        sourceName: OFFICE,
        observedAt: new Date('2026-09-28T00:00:00Z'),
      },
    ]);

    expect(result.fellowshipAbsenceClears).toBeUndefined();
    expect(result.plannedUnset).not.toHaveProperty('deadline');
    expect(result.plannedSet?.deadline).toEqual(new Date('2027-02-01T00:00:00Z'));
  });

  it('keeps a value another lane still states', async () => {
    const stored = {
      _id: 'fixture-id',
      sourceKey: `${DATABASE}:fixture-fund`,
      sourceName: DATABASE,
      title: 'Fixture Fund',
      yearOfStudy: ['Junior'],
    };

    const result = await projectFellowship(stored, [
      identity(DATABASE, stored.sourceKey, ['yearOfStudy']),
      { field: 'yearOfStudy', value: ['Junior'], sourceName: DATABASE, observedAt: EARLIER },
      { field: 'yearOfStudy', value: ['Senior'], sourceName: OFFICE, observedAt: EARLIER },
    ]);

    expect(result.fellowshipAbsenceClears).toBeUndefined();
    expect(result.plannedUnset).not.toHaveProperty('yearOfStudy');
    expect(result.plannedSet?.yearOfStudy).toEqual(['Senior']);
  });

  it('refuses an enrich-only lane clearing a field on another lane’s row', async () => {
    const stored = {
      _id: 'fixture-id',
      sourceKey: `${OFFICE}:fixture-research-fellowship`,
      sourceName: OFFICE,
      title: 'Fixture Research Fellowship',
      sourceUrl: OFFICIAL_PAGE,
      yearOfStudy: ['Junior'],
    };

    const result = await projectFellowship(stored, [
      identity(DATABASE, stored.sourceKey, ['yearOfStudy']),
      { field: 'yearOfStudy', value: ['Junior'], sourceName: DATABASE, observedAt: EARLIER },
    ]);

    expect(result.fellowshipAbsenceClears).toBeUndefined();
    expect(result.plannedUnset).not.toHaveProperty('yearOfStudy');
  });

  it('never clears the operator’s own fields, whatever a lane claims', async () => {
    const stored = {
      _id: 'fixture-id',
      sourceKey: `${OFFICE}:fixture-research-fellowship`,
      sourceName: OFFICE,
      title: 'Fixture Research Fellowship',
      studentVisibilityOverrideTier: 'student_ready',
      studentVisibilityTier: 'student_ready',
      deadline: new Date('2026-12-15T00:00:00Z'),
    };

    const result = await projectFellowship(stored, [
      identity(OFFICE, stored.sourceKey, [
        'studentVisibilityOverrideTier',
        'studentVisibilityTier',
        'deadline',
      ]),
      {
        field: 'deadline',
        value: new Date('2026-12-15T00:00:00Z'),
        sourceName: OFFICE,
        observedAt: EARLIER,
      },
    ]);

    expect(result.fellowshipAbsenceClears).toEqual([{ field: 'deadline', assertedBy: [OFFICE] }]);
    expect(result.plannedUnset).not.toHaveProperty('studentVisibilityOverrideTier');
    expect(result.plannedUnset).not.toHaveProperty('studentVisibilityTier');
  });

  it('clears nothing on a read that carries no claim', async () => {
    const stored = {
      _id: 'fixture-id',
      sourceKey: `${OFFICE}:fixture-research-fellowship`,
      sourceName: OFFICE,
      title: 'Fixture Research Fellowship',
      deadline: new Date('2026-12-15T00:00:00Z'),
    };

    const result = await projectFellowship(stored, [
      identity(OFFICE, stored.sourceKey),
      { field: 'title', value: stored.title, sourceName: OFFICE, observedAt: READ_AT },
    ]);

    expect(result.fellowshipAbsenceClears).toBeUndefined();
    expect(result.plannedUnset).not.toHaveProperty('deadline');
  });
});
