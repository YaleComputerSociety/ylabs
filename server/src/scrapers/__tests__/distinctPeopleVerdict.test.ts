import { describe, expect, it } from 'vitest';
import {
  buildDistinctPeopleVerdictIndex,
  distinctPeopleVerdictPairsJoinedByFold,
} from '../distinctPeopleVerdict';

const index = (verdicts: Array<[string, string[]]>, dedupedInto: Array<[string, string]> = []) =>
  buildDistinctPeopleVerdictIndex({
    verdicts: verdicts.map(([researcherId, distinctFromResearcherIds]) => ({
      researcherId,
      distinctFromResearcherIds,
    })),
    dedupedIntoByResearcherId: new Map(dedupedInto),
  });

describe('buildDistinctPeopleVerdictIndex', () => {
  it('reads a verdict recorded on only one of the two researchers, in either direction', () => {
    const verdicts = index([['person-x', ['person-y']]]);
    expect(verdicts.areDistinctPeople('person-x', 'person-y')).toBe(true);
    expect(verdicts.areDistinctPeople('person-y', 'person-x')).toBe(true);
    expect(verdicts.verdictPairs()).toEqual([['person-x', 'person-y']]);
  });

  it('carries a verdict through a researcher fold chain onto the surviving researcher', () => {
    const verdicts = index(
      [['person-x-old', ['person-y']]],
      [
        ['person-x-old', 'person-x-mid'],
        ['person-x-mid', 'person-x'],
      ],
    );
    expect(verdicts.areDistinctPeople('person-x', 'person-y')).toBe(true);
    expect(verdicts.areDistinctPeople('person-x-mid', 'person-y')).toBe(true);
  });

  it('drops a verdict whose two sides were folded into one researcher, and survives a cycle', () => {
    const verdicts = index(
      [['person-x', ['person-y']]],
      [
        ['person-y', 'person-x'],
        ['person-x', 'person-y-loop'],
        ['person-y-loop', 'person-x'],
      ],
    );
    expect(verdicts.size).toBe(0);
  });
});

describe('distinctPeopleVerdictPairsJoinedByFold', () => {
  const verdicts = index([
    ['person-x', ['person-y']],
    ['person-y', ['person-x']],
  ]);

  it('refuses folding one person`s row into the other person`s row', () => {
    expect(distinctPeopleVerdictPairsJoinedByFold([['person-x'], ['person-y']], verdicts)).toEqual([
      ['person-x', 'person-y'],
    ]);
  });

  it('refuses folding one person`s own row into a lab the two co-lead', () => {
    expect(
      distinctPeopleVerdictPairsJoinedByFold([['person-x', 'person-y'], ['person-x']], verdicts),
    ).toHaveLength(1);
    expect(
      distinctPeopleVerdictPairsJoinedByFold([['person-y'], ['person-x', 'person-y']], verdicts),
    ).toHaveLength(1);
  });

  it('does not refuse two copies of a lab both people co-lead, or a co-led row folding a leadless twin', () => {
    expect(
      distinctPeopleVerdictPairsJoinedByFold(
        [
          ['person-x', 'person-y'],
          ['person-y', 'person-x'],
        ],
        verdicts,
      ),
    ).toEqual([]);
    expect(
      distinctPeopleVerdictPairsJoinedByFold([['person-x', 'person-y'], []], verdicts),
    ).toEqual([]);
  });

  it('does not refuse rows whose leads hold no verdict', () => {
    expect(
      distinctPeopleVerdictPairsJoinedByFold([['person-x'], ['person-x', 'person-z']], verdicts),
    ).toEqual([]);
    expect(distinctPeopleVerdictPairsJoinedByFold([['person-x']], verdicts)).toEqual([]);
  });

  it('refuses across a researcher fold chain on either side', () => {
    const chained = index([['person-x', ['person-y-old']]], [['person-y-old', 'person-y']]);
    expect(
      distinctPeopleVerdictPairsJoinedByFold([['person-x'], ['person-y']], chained),
    ).toHaveLength(1);
  });

  it('refuses a group when any two of its rows join a verdict pair', () => {
    expect(
      distinctPeopleVerdictPairsJoinedByFold(
        [['person-z'], ['person-x'], ['person-z', 'person-y']],
        verdicts,
      ),
    ).toHaveLength(1);
  });
});
