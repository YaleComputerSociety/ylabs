import { describe, expect, it } from 'vitest';
import {
  formatArchivedVerdictCensus,
  summarizeArchivedVerdictCensus,
  type ArchivedVerdictCensusInput,
} from '../archivedStudentVisibilityVerdictsCore';

const census = (overrides: Partial<ArchivedVerdictCensusInput> = {}) =>
  summarizeArchivedVerdictCensus({
    totalRows: 10,
    archivedRows: 4,
    archivedRowsStoringVerdict: 0,
    archivedRowsByField: {},
    tierRows: [],
    heldRows: [],
    liveRowsNeverGated: 0,
    ...overrides,
  });

describe('summarizeArchivedVerdictCensus', () => {
  it('names the tier a stored verdict on an archived row over-reports', () => {
    const result = census({
      archivedRowsStoringVerdict: 3,
      archivedRowsByField: { studentVisibilityTier: 3 },
      tierRows: [
        { tier: 'student_ready', archived: false, count: 6 },
        { tier: 'student_ready', archived: true, count: 3 },
        { tier: null, archived: true, count: 1 },
      ],
    });

    expect(result.tierCounts).toEqual([{ tier: 'student_ready', allRows: 9, liveRows: 6 }]);
    expect(result.untieredRows).toEqual({ allRows: 1, liveRows: 0 });
    expect(result.violations).toEqual([
      '3 archived rows still store a student-visibility verdict, so a count grouped by tier over-reports',
      'tier student_ready counts 9 over all rows and 6 over live rows',
    ]);
  });

  it('separates the zero-hard-blocker held population by archived state', () => {
    const result = census({
      archivedRowsStoringVerdict: 2,
      heldRows: [
        { archived: true, hasHardBlocker: false },
        { archived: true, hasHardBlocker: false },
        { archived: false, hasHardBlocker: true },
      ],
    });

    expect(result.heldRows).toEqual({
      allRows: 3,
      liveRows: 1,
      zeroHardBlockerAllRows: 2,
      zeroHardBlockerLiveRows: 0,
    });
    expect(result.violations).toContain(
      'the zero-hard-blocker held population reads 2 over all rows and 0 over live rows',
    );
  });

  it('reports no violation once every stored verdict belongs to a live row', () => {
    const result = census({
      tierRows: [
        { tier: 'student_ready', archived: false, count: 6 },
        { tier: null, archived: true, count: 4 },
      ],
      heldRows: [{ archived: false, hasHardBlocker: true }],
    });

    expect(result.violations).toEqual([]);
    expect(formatArchivedVerdictCensus(result)).toContain(
      'invariant holds: every count by tier is live-only',
    );
  });

  it('flags a live row with no stored tier, because an unset tier has to mean archived', () => {
    const result = census({
      tierRows: [{ tier: undefined, archived: false, count: 2 }],
    });

    expect(result.violations).toEqual([
      '2 live rows store no tier, so an unset tier no longer means archived',
    ]);
  });
});
