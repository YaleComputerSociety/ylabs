import { describe, expect, it } from 'vitest';
import {
  assertDeclarableFellowshipAbsenceField,
  assertFellowshipAbsenceContractsAreDeclarable,
  fellowshipAbsenceAssertion,
  fellowshipFieldsAssertedAbsent,
  planFellowshipAbsenceClears,
  withoutFellowshipFieldsAssertedAbsent,
} from '../fellowshipFieldAbsence';

const DATABASE = 'student-grants-database';
const OFFICE = 'yale-college-fellowships-office';

const witness = (sourceName: string, assertsNoValueFor: string[], observedAt: string) => ({
  field: 'sourceKey',
  value: 'fixture-key',
  sourceName,
  observedAt: new Date(observedAt),
  assertsNoValueFor,
});

const value = (sourceName: string, field: string, fieldValue: unknown, observedAt: string) => ({
  field,
  value: fieldValue,
  sourceName,
  observedAt: new Date(observedAt),
});

describe('what a fellowship lane may say has no value', () => {
  it('declares every contract field', () => {
    expect(() => assertFellowshipAbsenceContractsAreDeclarable()).not.toThrow();
  });

  it('refuses an identity field, an operator field, and a derived field', () => {
    expect(() => assertDeclarableFellowshipAbsenceField('sourceKey')).toThrow(/identifies the row/);
    expect(() => assertDeclarableFellowshipAbsenceField('studentVisibilityOverrideTier')).toThrow(
      /operator intent/,
    );
    expect(() => assertDeclarableFellowshipAbsenceField('studentVisibilityTier')).toThrow(
      /operator intent/,
    );
    expect(() => assertDeclarableFellowshipAbsenceField('programCategory')).toThrow(/derives it/);
  });

  it('refuses a claim no contract declares', () => {
    expect(() => fellowshipAbsenceAssertion(DATABASE, ['description'])).toThrow(
      /not declared in fellowshipAbsenceAssertionContracts/,
    );
    expect(() => fellowshipAbsenceAssertion(OFFICE, ['yearOfStudy'])).toThrow(/not declared/);
  });

  it('refuses a read that both asserts a value and denies one', () => {
    expect(() => fellowshipAbsenceAssertion(OFFICE, ['deadline'], ['deadline'])).toThrow(
      /both a value and no value/,
    );
  });

  it('carries nothing when the read claims nothing', () => {
    expect(fellowshipAbsenceAssertion(OFFICE, [])).toEqual({});
    expect(fellowshipAbsenceAssertion(OFFICE, ['deadline'])).toEqual({
      assertsNoValueFor: ['deadline'],
    });
  });
});

describe('reading live fellowship absence claims', () => {
  it('withdraws the claiming source’s own stale value and nothing else', () => {
    const observations = [
      witness(OFFICE, ['deadline'], '2026-09-01T00:00:00Z'),
      value(OFFICE, 'deadline', new Date('2026-12-15T00:00:00Z'), '2026-07-01T00:00:00Z'),
      value(DATABASE, 'deadline', new Date('2027-03-01T00:00:00Z'), '2026-07-01T00:00:00Z'),
    ];

    const absent = fellowshipFieldsAssertedAbsent(observations);
    expect([...absent.keys()]).toEqual(['deadline']);
    expect([...(absent.get('deadline') ?? [])]).toEqual([OFFICE]);

    const kept = withoutFellowshipFieldsAssertedAbsent(observations, absent);
    expect(kept.map((observation) => observation.sourceName)).toEqual([OFFICE, DATABASE]);
    expect(kept.filter((observation) => observation.field === 'deadline')).toHaveLength(1);
  });

  it('keeps a value a later read of the same source re-asserted', () => {
    const absent = fellowshipFieldsAssertedAbsent([
      witness(OFFICE, ['deadline'], '2026-09-01T00:00:00Z'),
      value(OFFICE, 'deadline', new Date('2027-02-01T00:00:00Z'), '2026-09-20T00:00:00Z'),
    ]);

    expect(absent.size).toBe(0);
  });

  it('ignores a claim about a field the source does not declare', () => {
    const absent = fellowshipFieldsAssertedAbsent([
      witness(OFFICE, ['yearOfStudy', 'studentVisibilityOverrideTier'], '2026-09-01T00:00:00Z'),
    ]);

    expect(absent.size).toBe(0);
  });
});

describe('planning a fellowship absence clear', () => {
  const absent = fellowshipFieldsAssertedAbsent([
    witness(DATABASE, ['yearOfStudy'], '2026-09-01T00:00:00Z'),
  ]);

  it('clears a stored value nothing states', () => {
    expect(
      planFellowshipAbsenceClears({
        stored: { sourceName: DATABASE, yearOfStudy: ['Junior'] },
        staged: {},
        resolvedFields: ['title'],
        absentByField: absent,
      }),
    ).toEqual([{ field: 'yearOfStudy', assertedBy: [DATABASE] }]);
  });

  it('leaves a field another source still states to the resolver', () => {
    expect(
      planFellowshipAbsenceClears({
        stored: { sourceName: DATABASE, yearOfStudy: ['Junior'] },
        staged: { yearOfStudy: ['Senior'] },
        resolvedFields: ['yearOfStudy'],
        absentByField: absent,
      }),
    ).toEqual([]);
  });

  it('plans nothing on a second pass, because the row stores nothing to clear', () => {
    expect(
      planFellowshipAbsenceClears({
        stored: { sourceName: DATABASE, yearOfStudy: [] },
        staged: {},
        resolvedFields: [],
        absentByField: absent,
      }),
    ).toEqual([]);
  });

  it('withholds a clear its caller refuses', () => {
    expect(
      planFellowshipAbsenceClears({
        stored: { sourceName: OFFICE, yearOfStudy: ['Junior'] },
        staged: {},
        resolvedFields: [],
        absentByField: absent,
        withheldBySourcePrecedence: (field, assertedBy) =>
          field === 'yearOfStudy' && assertedBy.includes(DATABASE),
      }),
    ).toEqual([]);
  });
});
