import { describe, expect, it } from 'vitest';

import {
  diffEngineReplays,
  diffEngineSnapshots,
  engineOutputFingerprint,
  labelsFromCapturedRows,
  scoreEngineReplay,
  type ReplayedRow,
} from '../engineBenchmarkCore';
import { fingerprintChangeIsAttributable } from '../engineBenchmark';

const row = (overrides: Partial<ReplayedRow> = {}): ReplayedRow => ({
  entityKey: 'fixture-row-one',
  plannedSet: { fullDescription: 'Studies calcium regulation in intertidal invertebrates.' },
  plannedUnset: {},
  storedValues: {},
  tier: 'student_ready',
  computedTier: 'student_ready',
  reasons: [],
  unfrozenReads: [],
  ...overrides,
});

describe('engineOutputFingerprint', () => {
  it('is independent of the order rows are replayed in', () => {
    const first = row({ entityKey: 'fixture-row-one' });
    const second = row({ entityKey: 'fixture-row-two' });

    expect(engineOutputFingerprint([first, second])).toBe(engineOutputFingerprint([second, first]));
  });

  it('masks the clock-stamped fields so two replays minutes apart agree', () => {
    const earlier = row({
      plannedSet: { fullDescription: 'Same prose.', lastObservedAt: '2026-01-01T00:00:00.000Z' },
    });
    const later = row({
      plannedSet: { fullDescription: 'Same prose.', lastObservedAt: '2026-09-27T23:11:00.000Z' },
    });

    expect(engineOutputFingerprint([earlier])).toBe(engineOutputFingerprint([later]));
  });

  it('changes when a resolved value changes', () => {
    expect(engineOutputFingerprint([row()])).not.toBe(
      engineOutputFingerprint([row({ plannedSet: { fullDescription: 'Different prose.' } })]),
    );
  });

  /**
   * The case the fingerprint exists for. A change that alters no field but moves a row out
   * of `student_ready` is the change a student feels most, so a digest that covered only
   * resolve would report it as no change at all.
   */
  it('changes when only the gate verdict changes', () => {
    expect(engineOutputFingerprint([row()])).not.toBe(
      engineOutputFingerprint([
        row({
          tier: 'operator_review',
          computedTier: 'operator_review',
          reasons: ['missing_lead'],
        }),
      ]),
    );
  });

  it('is independent of the order the gate listed its reasons in', () => {
    expect(
      engineOutputFingerprint([row({ reasons: ['missing_lead', 'blank_public_description'] })]),
    ).toBe(
      engineOutputFingerprint([row({ reasons: ['blank_public_description', 'missing_lead'] })]),
    );
  });

  it('distinguishes a cleared field from a field that was never resolved', () => {
    expect(
      engineOutputFingerprint([row({ plannedSet: {}, plannedUnset: { fullDescription: '' } })]),
    ).not.toBe(engineOutputFingerprint([row({ plannedSet: {}, plannedUnset: {} })]));
  });
});

describe('scoreEngineReplay', () => {
  it('counts a resolved value a frozen refusal names as wrong', () => {
    const score = scoreEngineReplay(
      [row({ plannedSet: { websiteUrl: 'https://biology.example.edu/other-lab/' } })],
      [
        {
          entityKey: 'fixture-row-one',
          field: 'websiteUrl',
          valueKey: 'biology.example.edu/other-lab',
          rule: 'wrong_owner',
        },
      ],
    );

    expect(score.knownWrong).toBe(1);
    expect(score.labelsMatched).toBe(1);
    expect(score.byField).toEqual([
      {
        field: 'websiteUrl',
        resolved: 1,
        cleared: 0,
        labeledEntityResolved: 1,
        knownWrong: 1,
        values: 1,
      },
    ]);
  });

  /**
   * A refusal is a negative label only, so a value no refusal names is unjudged rather
   * than correct (#3514). The denominator a reader wants is therefore the labeled
   * population, which is why it is reported beside the count.
   */
  it('leaves a value no refusal names unjudged rather than counting it correct', () => {
    const score = scoreEngineReplay(
      [row({ plannedSet: { websiteUrl: 'https://biology.example.edu/intertidal/' } })],
      [
        {
          entityKey: 'fixture-row-one',
          field: 'fullDescription',
          valueKey: 'some other refused prose',
          rule: 'not_this_rows_research',
        },
      ],
    );

    expect(score.knownWrong).toBe(0);
    expect(score.byField[0].labeledEntityResolved).toBe(0);
  });

  it('matches a refusal through the refusal key rather than the raw text', () => {
    const score = scoreEngineReplay(
      [row({ plannedSet: { fullDescription: 'Studies  calcium\nregulation.' } })],
      [
        {
          entityKey: 'fixture-row-one',
          field: 'fullDescription',
          valueKey: 'studies calcium regulation.',
          rule: 'not_this_rows_research',
        },
      ],
    );

    expect(score.knownWrong).toBe(1);
  });

  it('counts a row whose input was not fully frozen', () => {
    const score = scoreEngineReplay(
      [row(), row({ entityKey: 'fixture-row-two', unfrozenReads: ['soleLeadPersonId'] })],
      [],
    );

    expect(score.rowsReplayed).toBe(2);
    expect(score.rowsWithIncompleteInput).toBe(1);
    expect(score.unfrozenReads).toEqual(['soleLeadPersonId']);
  });

  it('reports the gate verdict population', () => {
    const score = scoreEngineReplay(
      [
        row(),
        row({ entityKey: 'fixture-row-two' }),
        row({ entityKey: 'fixture-row-three', tier: 'operator_review' }),
      ],
      [],
    );

    expect(score.gateTiers).toEqual([
      { tier: 'operator_review', rows: 1 },
      { tier: 'student_ready', rows: 2 },
    ]);
  });
});

describe('diffEngineSnapshots', () => {
  it('reports a field the engine stopped resolving as a negative delta', () => {
    const delta = diffEngineSnapshots(
      { byField: [], gateTiers: [{ tier: 'student_ready', rows: 1 }] },
      {
        byField: [
          {
            field: 'fullDescription',
            resolved: 3,
            cleared: 0,
            labeledEntityResolved: 0,
            knownWrong: 0,
            values: 3,
          },
        ],
        gateTiers: [{ tier: 'student_ready', rows: 4 }],
      },
    );

    expect(delta.byField).toEqual([
      {
        field: 'fullDescription',
        resolvedDelta: -3,
        clearedDelta: 0,
        knownWrongDelta: 0,
        valuesDelta: -3,
      },
    ]);
    expect(delta.gateTiers).toEqual([{ tier: 'student_ready', rowsDelta: -3 }]);
  });

  it('treats a first run with no previous snapshot as the whole population arriving', () => {
    const delta = diffEngineSnapshots(
      {
        byField: [
          {
            field: 'fullDescription',
            resolved: 2,
            cleared: 0,
            labeledEntityResolved: 0,
            knownWrong: 0,
            values: 2,
          },
        ],
        gateTiers: [],
      },
      null,
    );

    expect(delta.byField).toEqual([
      {
        field: 'fullDescription',
        resolvedDelta: 2,
        clearedDelta: 0,
        knownWrongDelta: 0,
        valuesDelta: 2,
      },
    ]);
  });
});

describe('diffEngineReplays', () => {
  it('names the field two replays disagreed on', () => {
    const diff = diffEngineReplays(
      [row({ plannedSet: { fullDescription: 'One.' } })],
      [row({ plannedSet: { fullDescription: 'Two.' } })],
    );

    expect(diff.rowsChangedFromPrevious).toBe(1);
    expect(diff.byField).toEqual([
      { field: 'fullDescription', changedFromPrevious: 1, valuesLost: 1, valuesGained: 1 },
    ]);
  });

  it('counts a row the other replay did not cover as unchanged', () => {
    const diff = diffEngineReplays([row(), row({ entityKey: 'fixture-row-new' })], [row()]);

    expect(diff.rowsChangedFromPrevious).toBe(0);
  });

  it('counts a gate verdict change even when no field moved', () => {
    const diff = diffEngineReplays([row({ tier: 'operator_review' })], [row()]);

    expect(diff.gateTierChangedFromPrevious).toBe(1);
    expect(diff.rowsChangedFromPrevious).toBe(1);
  });
});

describe('labelsFromCapturedRows', () => {
  it('reads a standing refusal off the captured document', () => {
    const labels = labelsFromCapturedRows([
      {
        entityKey: 'fixture-row-one',
        entityDoc: {
          fieldValueRefusals: {
            websiteUrl: [
              {
                valueKey: 'biology.example.edu/other-lab',
                rule: 'wrong_owner',
                refusedBy: 'operator',
                refusedAt: new Date('2026-01-01T00:00:00.000Z'),
                note: 'fixture',
              },
            ],
          },
        },
      },
    ]);

    expect(labels).toEqual([
      {
        entityKey: 'fixture-row-one',
        field: 'websiteUrl',
        valueKey: 'biology.example.edu/other-lab',
        rule: 'wrong_owner',
      },
    ]);
  });

  it('ignores a withdrawn refusal, because a withdrawal is history rather than a rule', () => {
    const labels = labelsFromCapturedRows([
      {
        entityKey: 'fixture-row-one',
        entityDoc: {
          fieldValueRefusals: {
            websiteUrl: [
              {
                valueKey: 'biology.example.edu/other-lab',
                rule: 'confirmed_dead_page',
                refusedBy: 'operator',
                refusedAt: new Date('2026-01-01T00:00:00.000Z'),
                note: 'fixture',
                withdrawnAt: new Date('2026-02-01T00:00:00.000Z'),
              },
            ],
          },
        },
      },
    ]);

    expect(labels).toEqual([]);
  });
});

describe('fingerprintChangeIsAttributable', () => {
  it('is attributable when every row replayed on a fully frozen input', () => {
    expect(
      fingerprintChangeIsAttributable({
        rowsWithIncompleteInput: 0,
        invalidatedRunSetChanged: false,
      }),
    ).toBe(true);
  });

  it('is not attributable when a row read something the capture did not freeze', () => {
    expect(
      fingerprintChangeIsAttributable({
        rowsWithIncompleteInput: 1,
        invalidatedRunSetChanged: false,
      }),
    ).toBe(false);
  });

  /**
   * An operator quarantining a run between capture and replay withholds evidence, so the
   * input moved. Calling that a code regression is how a measurement earns being ignored.
   */
  it('is not attributable when the quarantined run set moved', () => {
    expect(
      fingerprintChangeIsAttributable({
        rowsWithIncompleteInput: 0,
        invalidatedRunSetChanged: true,
      }),
    ).toBe(false);
  });
});

describe('the direction of a change (#3871)', () => {
  /**
   * The case the benchmark waved through. #3868's derivation stripped 138 chips from 79 rows, and
   * because `resolved` counts ROWS rather than values, a row going from five chips to two moved
   * nothing in the snapshot: the field was still resolved. The snapshot read as a change in which
   * one row gained three topics.
   */
  it('counts values, not just rows, so a shortened list moves a number', () => {
    const before = scoreEngineReplay(
      [row({ plannedSet: { researchAreas: ['Immunology', 'Genetics', 'Biophysics'] } })],
      [],
    );
    const after = scoreEngineReplay([row({ plannedSet: { researchAreas: ['Immunology'] } })], []);

    expect(before.byField[0].resolved).toBe(after.byField[0].resolved);
    expect(before.byField[0].values).toBe(3);
    expect(after.byField[0].values).toBe(1);
    expect(diffEngineSnapshots(after, before).byField[0]).toEqual({
      field: 'researchAreas',
      resolvedDelta: 0,
      clearedDelta: 0,
      knownWrongDelta: 0,
      valuesDelta: -2,
    });
  });

  it('names the rows losing a value, which is the number that makes a regression unmistakable', () => {
    const diff = diffEngineReplays(
      [
        row({ entityKey: 'a', plannedSet: { researchAreas: ['Immunology'] } }),
        row({ entityKey: 'b', plannedSet: { researchAreas: ['Genetics', 'Biophysics'] } }),
      ],
      [
        row({ entityKey: 'a', plannedSet: { researchAreas: ['Immunology', 'Genetics'] } }),
        row({ entityKey: 'b', plannedSet: { researchAreas: ['Genetics', 'Biophysics'] } }),
      ],
    );

    expect(diff.rowsLosingAValue).toBe(1);
    expect(diff.valuesLost).toBe(1);
    expect(diff.valuesGained).toBe(0);
  });

  it('reports a pure gain as no loss, so an addition is never read as a removal', () => {
    const diff = diffEngineReplays(
      [row({ plannedSet: { researchAreas: ['Immunology', 'Genetics'] } })],
      [row({ plannedSet: { researchAreas: ['Immunology'] } })],
    );

    expect(diff.rowsLosingAValue).toBe(0);
    expect(diff.valuesGained).toBe(1);
    expect(diff.valuesLost).toBe(0);
  });

  /** A reordering is not a change of values, so it must not read as one lost and one gained. */
  it('treats a reordered list as no loss and no gain', () => {
    const diff = diffEngineReplays(
      [row({ plannedSet: { researchAreas: ['Genetics', 'Immunology'] } })],
      [row({ plannedSet: { researchAreas: ['Immunology', 'Genetics'] } })],
    );

    expect(diff.valuesLost).toBe(0);
    expect(diff.valuesGained).toBe(0);
  });

  /**
   * Reported, never failed: a value legitimately leaves when a refusal or a retraction takes it.
   * What this stops is a reader inferring a direction the snapshot never gave.
   */
  it('reports a replaced scalar as one lost and one gained', () => {
    const diff = diffEngineReplays(
      [row({ plannedSet: { fullDescription: 'After.' } })],
      [row({ plannedSet: { fullDescription: 'Before.' } })],
    );

    expect(diff.valuesLost).toBe(1);
    expect(diff.valuesGained).toBe(1);
  });
});

describe('the direction is read on the OUTCOME, not on the plan (#3871)', () => {
  /**
   * The case that made #3872 report the wrong sign, reproduced from the real one.
   *
   * #3873 did not change which values a derivation plans, it changed whether the field is planned
   * at all. The fixed code plans nothing and the row keeps its eight stored chips; the regression
   * plans five that REPLACE them. Comparing plans reads 5 against 0 and calls it a gain of five.
   * Comparing outcomes reads 5 against 8 and calls it a loss of three, which is what happens to
   * the row. Measured on Development: 10 rows, 26 chips, reported by #3872 as 24 gained and 0 lost.
   */
  const EIGHT_STORED = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const FIVE_PLANNED = ['a', 'b', 'c', 'd', 'e'];

  const keepsStored = row({
    plannedSet: {},
    storedValues: { researchAreas: EIGHT_STORED },
  });
  const replacesStored = row({
    plannedSet: { researchAreas: FIVE_PLANNED },
    storedValues: { researchAreas: EIGHT_STORED },
  });

  it('reports a replacement that shortens the list as a LOSS', () => {
    const diff = diffEngineReplays([replacesStored], [keepsStored]);

    expect(diff.rowsLosingAValue).toBe(1);
    expect(diff.valuesLost).toBe(3);
    expect(diff.valuesGained).toBe(0);
  });

  it('reports the fix, which plans nothing and keeps the row whole, as no loss', () => {
    const diff = diffEngineReplays([keepsStored], [replacesStored]);

    expect(diff.rowsLosingAValue).toBe(0);
    expect(diff.valuesLost).toBe(0);
    expect(diff.valuesGained).toBe(3);
  });

  it('counts the values a row keeps, so planning nothing is not counted as holding nothing', () => {
    expect(scoreEngineReplay([keepsStored], []).byField).toEqual([
      {
        field: 'researchAreas',
        resolved: 0,
        cleared: 0,
        labeledEntityResolved: 0,
        knownWrong: 0,
        values: 8,
      },
    ]);
  });

  it('moves the stored snapshot delta negative when a replacement shortens the list', () => {
    const delta = diffEngineSnapshots(
      scoreEngineReplay([replacesStored], []),
      scoreEngineReplay([keepsStored], []),
    );

    expect(delta.byField.find((field) => field.field === 'researchAreas')?.valuesDelta).toBe(-3);
  });

  it('reads a planned-away field as holding nothing, whatever it stored', () => {
    const cleared = row({
      plannedSet: {},
      plannedUnset: { researchAreas: '' },
      storedValues: { researchAreas: EIGHT_STORED },
    });

    expect(diffEngineReplays([cleared], [keepsStored]).valuesLost).toBe(8);
  });
});
