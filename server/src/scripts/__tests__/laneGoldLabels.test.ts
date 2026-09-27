import { describe, expect, it } from 'vitest';
import { parseGoldLabelFile } from '../laneBenchmarkLabelCore';
import {
  goldValueKey,
  goldValueMatches,
  scoreGoldLabels,
  summarizeGoldRuns,
  type GoldLabel,
} from '../laneScorecardCore';

const quote = (entityKey: string, value: string) => ({
  entityType: 'researchEntity',
  entityKey,
  field: 'undergradEvidenceQuote',
  value,
});

const judged = 'Undergraduates join the lab each summer to run field experiments.';

describe('scoreGoldLabels', () => {
  const labels: GoldLabel[] = [
    {
      entityKey: 'lab-a',
      field: 'undergradEvidenceQuote',
      expected: 'present',
      acceptable: [judged],
    },
    {
      entityKey: 'lab-b',
      field: 'undergradEvidenceQuote',
      expected: 'present',
      acceptable: [judged],
    },
    {
      entityKey: 'lab-c',
      field: 'undergradEvidenceQuote',
      expected: 'present',
      acceptable: [judged],
    },
    { entityKey: 'lab-d', field: 'undergradEvidenceQuote', expected: 'absent' },
    { entityKey: 'lab-e', field: 'undergradEvidenceQuote', expected: 'absent' },
  ];

  it('counts each labeled pair once and derives precision and recall', () => {
    const [score] = scoreGoldLabels(
      [
        quote('lab-a', 'Undergraduates join the lab each summer'),
        quote('lab-b', 'The department offers a summer grant to undergraduate students.'),
        quote('lab-d', 'Undergraduate students are welcome to inquire.'),
        quote('lab-unlabeled', 'Anything at all about undergraduates.'),
      ],
      labels,
    );
    expect(score).toEqual({
      field: 'undergradEvidenceQuote',
      labeled: 5,
      truePositive: 1,
      falsePositive: 2,
      falseNegative: 1,
      trueNegative: 1,
      precision: 1 / 3,
      recall: 1 / 2,
    });
  });

  it('reports an undefined rate as null rather than as zero or one', () => {
    const [score] = scoreGoldLabels([], [labels[3]]);
    expect(score.precision).toBeNull();
    expect(score.recall).toBeNull();
    expect(score.trueNegative).toBe(1);
  });

  it('judges an access verdict on the verdict, not the quote beside it', () => {
    const [score] = scoreGoldLabels(
      [
        {
          entityType: 'researchEntity',
          entityKey: 'lab-a',
          field: 'undergradAccessEvidence',
          value: { openToUndergrads: 'yes', evidenceQuote: 'any wording' },
        },
      ],
      [
        {
          entityKey: 'lab-a',
          field: 'undergradAccessEvidence',
          expected: 'present',
          acceptable: ['yes'],
        },
      ],
    );
    expect(score.truePositive).toBe(1);
  });

  it('resolves an observation keyed only by entity id through the slug map', () => {
    const [score] = scoreGoldLabels(
      [
        {
          entityType: 'researchEntity',
          entityId: 'id-1',
          field: 'undergradEvidenceQuote',
          value: judged,
        },
      ],
      [labels[0]],
      new Map([['id-1', 'lab-a']]),
    );
    expect(score.truePositive).toBe(1);
  });
});

describe('goldValueMatches', () => {
  it('accepts a clause of a judged sentence but not a fragment too short to carry a claim', () => {
    expect(
      goldValueMatches(goldValueKey('f', 'join the lab each summer to run field'), [judged]),
    ).toBe(true);
    expect(goldValueMatches(goldValueKey('f', 'the lab'), [judged])).toBe(false);
  });

  it('ignores whitespace, case, typographic marks and redaction tokens', () => {
    expect(
      goldValueMatches(
        goldValueKey('f', 'Email [email redacted]  about the lab’s summer program'),
        ["email pi@yale.edu about the lab's summer program"],
      ),
    ).toBe(false);
    expect(
      goldValueMatches(goldValueKey('f', 'Email  about the lab’s summer program'), [
        "Email [email redacted] about the lab's summer program",
      ]),
    ).toBe(true);
  });
});

describe('summarizeGoldRuns', () => {
  it('spreads each rate over the runs where it was defined', () => {
    const row = (precision: number | null) => ({
      field: 'undergradEvidenceQuote',
      labeled: 4,
      truePositive: 0,
      falsePositive: 0,
      falseNegative: 0,
      trueNegative: 0,
      precision,
      recall: null,
    });
    expect(summarizeGoldRuns([[row(0.5)], [row(1)], [row(null)]])).toEqual([
      {
        field: 'undergradEvidenceQuote',
        precision: { min: 0.5, max: 1, mean: 0.75 },
        recall: null,
      },
    ]);
  });
});

describe('parseGoldLabelFile', () => {
  const scope = { only: ['lab-a', 'lab-b'] };

  it('accepts a well-formed file', () => {
    expect(
      parseGoldLabelFile(
        [
          {
            entityKey: 'lab-a',
            field: 'undergradEvidenceQuote',
            expected: 'present',
            acceptable: [judged],
          },
          {
            entityKey: 'lab-b',
            field: 'undergradEvidenceQuote',
            expected: 'absent',
            note: 'silent page',
          },
        ],
        scope,
      ),
    ).toHaveLength(2);
  });

  it.each([
    [[{ entityKey: 'lab-z', field: 'f', expected: 'absent' }], /outside the benchmark/],
    [[{ entityKey: 'lab-a', field: 'f', expected: 'present' }], /no acceptable value/],
    [
      [{ entityKey: 'lab-a', field: 'f', expected: 'absent', acceptable: ['x'] }],
      /absent but lists/,
    ],
    [[{ entityKey: 'lab-a', field: 'f', expected: 'maybe' }], /"present" or "absent"/],
    [
      [
        { entityKey: 'lab-a', field: 'f', expected: 'absent' },
        { entityKey: 'lab-a', field: 'f', expected: 'absent' },
      ],
      /repeats/,
    ],
    [{ not: 'an array' }, /JSON array/],
  ])('refuses %j', (raw, message) => {
    expect(() => parseGoldLabelFile(raw, scope)).toThrow(message);
  });
});
