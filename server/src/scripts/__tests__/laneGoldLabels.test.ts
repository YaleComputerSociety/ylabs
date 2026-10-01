import { describe, expect, it } from 'vitest';
import { classificationFromObservedFacts } from '../../scrapers/fellowshipClassificationDerivation';
import { parseGoldLabelFile } from '../laneBenchmarkLabelCore';
import {
  goldComparisonFor,
  goldEmissionMatches,
  goldValueKey,
  goldValueMatches,
  newYorkMinute,
  normalizedGoldUrl,
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
      falseNegative: 2,
      trueNegative: 1,
      precision: 1 / 3,
      recall: 1 / 3,
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

const fellowshipKey = 'fixture-lane:fixture-research-fellowship';

const fellowshipObservation = (field: string, value: unknown, entityKey = fellowshipKey) => ({
  entityType: 'fellowship',
  entityKey,
  field,
  value,
});

const present = (field: string, acceptable: string[], entityKey = fellowshipKey): GoldLabel => ({
  entityKey,
  field,
  expected: 'present',
  acceptable,
});

const scoreOf = (
  observations: Parameters<typeof scoreGoldLabels>[0],
  label: GoldLabel,
): ReturnType<typeof scoreGoldLabels>[number] => {
  const [score] = scoreGoldLabels(observations, [label]);
  return score;
};

describe('scoreGoldLabels on fellowship observations', () => {
  it('scores a fellowship observation rather than skipping it', () => {
    const score = scoreOf(
      [fellowshipObservation('title', 'Fixture Research Fellowship')],
      present('title', ['Fixture Research Fellowship']),
    );
    expect(score).toMatchObject({ truePositive: 1, falsePositive: 0, falseNegative: 0 });
  });

  it('keeps text containment for a fellowship title and contact office', () => {
    expect(goldComparisonFor('fellowship', 'title')).toBe('text');
    expect(goldComparisonFor('fellowship', 'contactOffice')).toBe('text');
    const score = scoreOf(
      [fellowshipObservation('contactOffice', 'Fixture Office of Fellowships and Funding')],
      present('contactOffice', ['Office of Fellowships and Funding']),
    );
    expect(score.truePositive).toBe(1);
  });

  it('scores eligibility as a statement that may not run far past the judged text', () => {
    expect(goldComparisonFor('fellowship', 'eligibility')).toBe('statement');
    expect(goldComparisonFor('researchEntity', 'eligibility')).toBe('text');
    const judged = 'Currently enrolled sophomores and juniors are eligible to apply.';
    const statement = scoreOf(
      [
        fellowshipObservation(
          'eligibility',
          `${judged} Applicants must be enrolled at the time of the award.`,
        ),
      ],
      present('eligibility', [judged]),
    );
    expect(statement).toMatchObject({ truePositive: 1, falsePositive: 0 });

    const clause = scoreOf(
      [fellowshipObservation('eligibility', 'sophomores and juniors are eligible')],
      present('eligibility', [judged]),
    );
    expect(clause.truePositive).toBe(1);

    const pageDump = scoreOf(
      [fellowshipObservation('eligibility', `${'Program overview prose. '.repeat(40)}${judged}`)],
      present('eligibility', [judged]),
    );
    expect(pageDump).toMatchObject({ truePositive: 0, falsePositive: 1, falseNegative: 1 });
  });

  it('counts an asserted empty contact office as no emission', () => {
    const score = scoreOf([fellowshipObservation('contactOffice', '')], {
      entityKey: fellowshipKey,
      field: 'contactOffice',
      expected: 'absent',
    });
    expect(score).toMatchObject({ trueNegative: 1, falsePositive: 0 });
  });

  it('still leaves an entity type it does not score unjudged', () => {
    const score = scoreOf(
      [{ entityType: 'user', entityKey: fellowshipKey, field: 'title', value: 'Fixture' }],
      present('title', ['Fixture']),
    );
    expect(score).toMatchObject({ truePositive: 0, falsePositive: 0, falseNegative: 1 });
  });
});

describe('field-aware fellowship comparison', () => {
  const matches = (field: string, value: unknown, acceptable: string[]) =>
    goldEmissionMatches({ entityType: 'fellowship', field, value }, acceptable);

  it.each([
    ['http://Example.ORG/apply', 'https://example.org/apply'],
    ['https://example.org/apply/', 'https://example.org/apply'],
    ['https://example.org/apply#form', 'https://example.org/apply'],
    ['HTTP://EXAMPLE.org/apply/#top', 'https://example.org/apply'],
    ['https://example.org/', 'https://example.org'],
    ['https://example.org/apply/?cycle=2027', 'https://example.org/apply?cycle=2027'],
  ])('treats %s as the same application URL as %s', (emitted, judged) => {
    expect(normalizedGoldUrl(emitted)).toBe(normalizedGoldUrl(judged));
    expect(matches('applicationLink', emitted, [judged])).toBe(true);
  });

  it.each([
    ['https://example.org/apply/form', 'https://example.org/apply'],
    ['https://example.org/apply?cycle=2027', 'https://example.org/apply?cycle=2026'],
    ['https://example.org/Apply', 'https://example.org/apply'],
    ['https://other.example.org/apply', 'https://example.org/apply'],
  ])('refuses %s as the application URL %s', (emitted, judged) => {
    expect(matches('applicationLink', emitted, [judged])).toBe(false);
  });

  it('matches a set regardless of order and duplicates', () => {
    expect(matches('yearOfStudy', ['Senior', 'Junior', 'Junior'], ['["Junior","Senior"]'])).toBe(
      true,
    );
    expect(matches('termOfAward', ['Summer'], ['["Fall"]', '["Summer"]'])).toBe(true);
    expect(matches('purpose', ['Research'], ['["Research"]'])).toBe(true);
  });

  it('refuses a superset and a subset of the judged set', () => {
    expect(matches('yearOfStudy', ['Junior', 'Senior', 'Sophomore'], ['["Junior","Senior"]'])).toBe(
      false,
    );
    expect(matches('yearOfStudy', ['Junior'], ['["Junior","Senior"]'])).toBe(false);
  });

  it('refuses an acceptable set that is not a JSON array', () => {
    expect(matches('purpose', ['Research'], ['Research'])).toBe(false);
  });

  it('matches a date-only deadline on the New York calendar date of the emitted instant', () => {
    const endOfUtcDay = new Date('2026-10-15T23:59:59.999Z');
    expect(newYorkMinute(endOfUtcDay)).toBe('2026-10-15T19:59');
    expect(matches('deadline', endOfUtcDay, ['2026-10-15'])).toBe(true);
    expect(matches('deadline', endOfUtcDay.toISOString(), ['2026-10-15'])).toBe(true);
    expect(matches('deadline', new Date('2026-10-16T03:00:00Z'), ['2026-10-16'])).toBe(false);
    expect(matches('deadline', new Date('2026-10-16T03:00:00Z'), ['2026-10-15'])).toBe(true);
  });

  it('matches a timed deadline only at the same New York minute', () => {
    expect(matches('deadline', new Date('2026-10-15T17:00:00Z'), ['2026-10-15T13:00'])).toBe(true);
    expect(matches('deadline', new Date('2026-10-15T23:59:00Z'), ['2026-10-15T13:00'])).toBe(false);
    expect(matches('deadline', new Date('2026-10-16T03:59:00Z'), ['2026-10-15T23:59'])).toBe(true);
    expect(matches('deadline', new Date('2026-10-15T23:59:59.999Z'), ['2026-10-15T13:00'])).toBe(
      false,
    );
  });

  it('refuses a deadline label in any other format and an unparseable emitted value', () => {
    expect(matches('deadline', new Date('2026-10-15T17:00:00Z'), ['November 1, 2026'])).toBe(false);
    expect(matches('deadline', 'rolling', ['2026-10-15'])).toBe(false);
  });

  it('compares the classifier fields by exact value', () => {
    expect(matches('requiresMentorBeforeApply', true, ['true'])).toBe(true);
    expect(matches('requiresMentorBeforeApply', false, ['true'])).toBe(false);
    expect(matches('entryMode', 'APPLY_TO_PROGRAM', ['APPLY_TO_PROGRAM'])).toBe(true);
    expect(matches('entryMode', 'APPLY_TO_PROGRAM', ['APPLY'])).toBe(false);
  });

  it('keys the comparison on the entity type, so a research-entity field of the same name keeps containment', () => {
    expect(goldComparisonFor('researchEntity', 'applicationLink')).toBe('text');
    expect(goldComparisonFor('researchEntity', 'deadline')).toBe('text');
    const researchEntity = (field: string, value: unknown) => ({
      entityType: 'researchEntity',
      entityKey: 'lab-a',
      field,
      value,
    });
    expect(
      scoreOf(
        [researchEntity('applicationLink', 'https://example.org/apply/')],
        present('applicationLink', ['http://example.org/apply'], 'lab-a'),
      ).truePositive,
    ).toBe(0);
    expect(
      scoreOf(
        [researchEntity('deadline', 'Applications are due 2026-10-15 at noon')],
        present('deadline', ['2026-10-15'], 'lab-a'),
      ).truePositive,
    ).toBe(1);
    expect(
      scoreOf(
        [fellowshipObservation('applicationLink', 'https://example.org/apply/')],
        present('applicationLink', ['http://example.org/apply']),
      ).truePositive,
    ).toBe(1);
  });
});

describe('classifier-derived fellowship gold fields', () => {
  const facts = [
    fellowshipObservation('title', 'Fixture Research Fellowship'),
    fellowshipObservation(
      'description',
      'Students must secure a faculty mentor before applying and conduct independent research over the summer.',
    ),
    fellowshipObservation('purpose', ['Research']),
    fellowshipObservation('termOfAward', ['Summer']),
  ];
  const derived = classificationFromObservedFacts(
    facts.map(({ field, value }) => ({ field, value })),
  );

  it('scores a label on the value the real classifier derives from the planned facts', () => {
    expect(
      scoreOf(
        facts,
        present('requiresMentorBeforeApply', [String(derived.requiresMentorBeforeApply)]),
      ).truePositive,
    ).toBe(1);
    expect(scoreOf(facts, present('entryMode', [derived.entryMode])).truePositive).toBe(1);
    expect(
      scoreOf(
        facts,
        present('requiresMentorBeforeApply', [String(!derived.requiresMentorBeforeApply)]),
      ),
    ).toMatchObject({ truePositive: 0, falsePositive: 1, falseNegative: 1 });
  });

  it('scores the derivation, not a value a lane emitted for a classifier-owned field', () => {
    const score = scoreOf(
      [...facts, fellowshipObservation('entryMode', 'FIXTURE_NOT_A_MODE')],
      present('entryMode', [derived.entryMode]),
    );
    expect(score).toMatchObject({ truePositive: 1, falsePositive: 0, falseNegative: 0 });
  });

  it('derives nothing for a key with no planned observations', () => {
    const [absent, missed] = scoreGoldLabels(facts, [
      { entityKey: 'fixture-lane:unplanned', field: 'entryMode', expected: 'absent' },
      present('requiresMentorBeforeApply', ['false'], 'fixture-lane:unplanned'),
    ]);
    expect(absent).toMatchObject({ field: 'entryMode', trueNegative: 1, falsePositive: 0 });
    expect(missed).toMatchObject({ truePositive: 0, falsePositive: 0, falseNegative: 1 });
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

  it('refuses every label when the benchmark has no captured scope', () => {
    expect(() =>
      parseGoldLabelFile([{ entityKey: 'lab-a', field: 'f', expected: 'absent' }], { only: [] }),
    ).toThrow(/not captured with --only/);
  });
});
