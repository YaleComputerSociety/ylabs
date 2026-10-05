import { describe, expect, it } from 'vitest';
import {
  checkDeadlineSortOrder,
  checkFilteredRowsCarryValue,
  checkOfferedOptionsServeARow,
  checkProgramFieldAttribution,
  checkServedRowsAreInServedTier,
  checkServedRowsPassTheGate,
  checkWalkCoversReportedTotal,
  tallyProgramFieldAttribution,
  tallyServedRowGate,
  withSurfaceId,
  type ServedRowGateObservation,
} from '../journeyEvalProgramMetrics';
import { buildInvariant, type CorpusFingerprint } from '../journeyEvalMetrics';

const steadyCorpus: CorpusFingerprint = {
  rowCount: 146,
  latestUpdatedAt: '2026-09-30T12:00:00.000Z',
};
const movedCorpus: CorpusFingerprint = {
  rowCount: 147,
  latestUpdatedAt: '2026-09-30T12:00:03.000Z',
};

const admittedRow: ServedRowGateObservation = {
  servedVersionMatchesStored: true,
  storedRowFound: true,
  storedTierIsServed: true,
  archived: false,
  gateTierIsServed: true,
  gateReasons: [],
};

describe('withSurfaceId', () => {
  it('prefixes a shared invariant id with its surface', () => {
    const result = withSurfaceId('programs', buildInvariant('some-check', 'A check', true, {}));

    expect(result.id).toBe('programs-some-check');
    expect(result.status).toBe('pass');
  });
});

describe('checkWalkCoversReportedTotal', () => {
  it('passes when the walk serves exactly the reported total', () => {
    expect(
      checkWalkCoversReportedTotal('programs', 146, 146, steadyCorpus, steadyCorpus).status,
    ).toBe('pass');
  });

  it('fails when a steady corpus serves fewer rows than it reports', () => {
    expect(
      checkWalkCoversReportedTotal('programs', 140, 146, steadyCorpus, steadyCorpus).status,
    ).toBe('fail');
  });

  it('is inconclusive when the corpus moved during the walk', () => {
    expect(
      checkWalkCoversReportedTotal('programs', 140, 146, steadyCorpus, movedCorpus).status,
    ).toBe('inconclusive');
  });
});

describe('checkOfferedOptionsServeARow', () => {
  it('fails on an offered option that returns nothing and names only its field', () => {
    const result = checkOfferedOptionsServeARow(
      'programs',
      [
        {
          field: 'yearOfStudy',
          value: 'Senior',
          filteredTotal: 0,
          servedOnFirstPage: 0,
          servedCarryingValue: 0,
        },
        {
          field: 'yearOfStudy',
          value: 'Junior',
          filteredTotal: 4,
          servedOnFirstPage: 4,
          servedCarryingValue: 4,
        },
      ],
      steadyCorpus,
      steadyCorpus,
    );

    expect(result.status).toBe('fail');
    expect(result.detail.deadOptionsByField).toEqual({ yearOfStudy: 1 });
  });

  it('is inconclusive when no option was offered', () => {
    expect(checkOfferedOptionsServeARow('programs', [], steadyCorpus, steadyCorpus).status).toBe(
      'inconclusive',
    );
  });
});

describe('checkFilteredRowsCarryValue', () => {
  it('fails when a filtered browse serves a row without the chosen value', () => {
    const result = checkFilteredRowsCarryValue('programs', [
      {
        field: 'programKind',
        value: 'RA_PROGRAM',
        filteredTotal: 3,
        servedOnFirstPage: 3,
        servedCarryingValue: 2,
      },
    ]);

    expect(result.status).toBe('fail');
    expect(result.detail.mismatchesByField).toEqual({ programKind: 1 });
  });

  it('is inconclusive when no filtered browse served a row', () => {
    const result = checkFilteredRowsCarryValue('programs', [
      {
        field: 'programKind',
        value: 'RA_PROGRAM',
        filteredTotal: 0,
        servedOnFirstPage: 0,
        servedCarryingValue: 0,
      },
    ]);

    expect(result.status).toBe('inconclusive');
  });
});

describe('checkDeadlineSortOrder', () => {
  const storedAt = (storedDeadlineMs: number | null) => ({
    storedRowFound: true,
    storedDeadlineMs,
  });

  it('passes undated rows first, then non-decreasing stored deadlines', () => {
    const result = checkDeadlineSortOrder(
      'programs',
      [storedAt(null), storedAt(5), storedAt(10), storedAt(10), storedAt(20)],
      steadyCorpus,
      steadyCorpus,
    );

    expect(result.status).toBe('pass');
  });

  it('fails on an inversion or an undated row after a dated one', () => {
    const inverted = checkDeadlineSortOrder(
      'programs',
      [storedAt(20), storedAt(10)],
      steadyCorpus,
      steadyCorpus,
    );
    const undatedLate = checkDeadlineSortOrder(
      'programs',
      [storedAt(10), storedAt(null)],
      steadyCorpus,
      steadyCorpus,
    );

    expect(inverted.status).toBe('fail');
    expect(undatedLate.status).toBe('fail');
  });

  it('skips and counts a served row whose stored row is gone', () => {
    const result = checkDeadlineSortOrder(
      'programs',
      [storedAt(10), { storedRowFound: false, storedDeadlineMs: null }, storedAt(20)],
      steadyCorpus,
      steadyCorpus,
    );

    expect(result.status).toBe('pass');
    expect(result.detail.storedRowMissing).toBe(1);
  });
});

describe('served row gate checks', () => {
  it('passes when every comparable served row is student-ready and admitted', () => {
    const tally = tallyServedRowGate([admittedRow, admittedRow]);

    expect(
      checkServedRowsAreInServedTier('programs', tally, steadyCorpus, steadyCorpus).status,
    ).toBe('pass');
    expect(checkServedRowsPassTheGate('programs', tally, steadyCorpus, steadyCorpus).status).toBe(
      'pass',
    );
  });

  it('fails on a served row outside the served tier and one the gate refuses', () => {
    const tally = tallyServedRowGate([
      { ...admittedRow, storedTierIsServed: false },
      { ...admittedRow, gateTierIsServed: false, gateReasons: ['missing_application_route'] },
    ]);

    expect(
      checkServedRowsAreInServedTier('programs', tally, steadyCorpus, steadyCorpus).status,
    ).toBe('fail');
    const gate = checkServedRowsPassTheGate('programs', tally, steadyCorpus, steadyCorpus);
    expect(gate.status).toBe('fail');
    expect(gate.detail.refusedRowReasons).toEqual({ missing_application_route: 1 });
  });

  it('skips a row written after the walk began and is inconclusive when none remain', () => {
    const tally = tallyServedRowGate([
      { ...admittedRow, servedVersionMatchesStored: false, gateTierIsServed: false },
    ]);

    expect(tally.skippedStaleIndex).toBe(1);
    expect(checkServedRowsPassTheGate('programs', tally, steadyCorpus, steadyCorpus).status).toBe(
      'inconclusive',
    );
  });

  it('counts a served row with no stored row as outside the served tier', () => {
    const tally = tallyServedRowGate([
      admittedRow,
      { ...admittedRow, storedRowFound: false, servedVersionMatchesStored: false },
    ]);

    expect(tally.missingStoredRow).toBe(1);
    expect(
      checkServedRowsAreInServedTier('programs', tally, steadyCorpus, steadyCorpus).status,
    ).toBe('fail');
    expect(
      checkServedRowsAreInServedTier('programs', tally, steadyCorpus, movedCorpus).status,
    ).toBe('inconclusive');
  });
});

describe('program field attribution', () => {
  it('passes when every difference names a guard and reports the guard counts', () => {
    const tally = tallyProgramFieldAttribution([
      {
        servedVersionMatchesStored: true,
        outcomes: [
          { field: 'deadline', status: 'attributed', guard: 'projectNextCycleDeadline' },
          { field: 'applicationLink', status: 'unchanged' },
        ],
      },
    ]);

    expect(tally.byField.deadline.byGuard).toEqual({ projectNextCycleDeadline: 1 });
    expect(checkProgramFieldAttribution('programs', tally, steadyCorpus, steadyCorpus).status).toBe(
      'pass',
    );
  });

  it('fails on an unexplained difference on a steady corpus and is inconclusive on a moving one', () => {
    const tally = tallyProgramFieldAttribution([
      {
        servedVersionMatchesStored: true,
        outcomes: [{ field: 'eligibility', status: 'unexplained', reason: 'withheld' }],
      },
    ]);

    expect(checkProgramFieldAttribution('programs', tally, steadyCorpus, steadyCorpus).status).toBe(
      'fail',
    );
    expect(checkProgramFieldAttribution('programs', tally, steadyCorpus, movedCorpus).status).toBe(
      'inconclusive',
    );
  });

  it('ignores a stale row and is inconclusive when nothing could be compared', () => {
    const tally = tallyProgramFieldAttribution([
      {
        servedVersionMatchesStored: false,
        outcomes: [{ field: 'eligibility', status: 'unexplained', reason: 'withheld' }],
      },
    ]);

    expect(tally.unexplained).toBe(0);
    expect(checkProgramFieldAttribution('programs', tally, steadyCorpus, steadyCorpus).status).toBe(
      'inconclusive',
    );
  });
});
