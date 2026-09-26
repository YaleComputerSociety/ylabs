import { describe, expect, it } from 'vitest';
import { fieldValueRefusalKey } from '../../utils/researchEntityFieldValueRefusals';
import {
  plannedOutputFingerprint,
  scoreLaneReplay,
  type BenchmarkLabel,
} from '../laneScorecardCore';

const wrongSite = 'https://example.org/someone-elses-lab';
const label = (entityKey: string, field: string, value: string): BenchmarkLabel => ({
  entityKey,
  field,
  valueKey: fieldValueRefusalKey(field, value),
  rule: 'wrong_owner',
});

describe('scoreLaneReplay', () => {
  it('counts a planned citation of a refused website as known wrong', () => {
    const score = scoreLaneReplay(
      [
        {
          entityType: 'researchEntity',
          entityKey: 'row-a',
          field: 'sourceUrls',
          value: [wrongSite],
        },
        {
          entityType: 'researchEntity',
          entityKey: 'row-a',
          field: 'sourceUrls',
          value: ['https://ok.org'],
        },
        {
          entityType: 'researchEntity',
          entityKey: 'row-b',
          field: 'sourceUrls',
          value: [wrongSite],
        },
      ],
      [label('row-a', 'websiteUrl', wrongSite)],
    );
    expect(score.emitted).toBe(3);
    expect(score.knownWrong).toBe(1);
    expect(score.labelsMatched).toBe(1);
    expect(score.byField).toEqual([
      { field: 'sourceUrls', emitted: 3, labeledEntityEmitted: 2, knownWrong: 1 },
    ]);
  });

  it('resolves an entityId-keyed observation through the slug map', () => {
    const score = scoreLaneReplay(
      [{ entityType: 'researchEntity', entityId: 'id-1', field: 'websiteUrl', value: wrongSite }],
      [label('row-a', 'websiteUrl', wrongSite)],
      new Map([['id-1', 'row-a']]),
    );
    expect(score.knownWrong).toBe(1);
  });

  it('never labels an observation about another subject', () => {
    const score = scoreLaneReplay(
      [{ entityType: 'user', entityKey: 'row-a', field: 'websiteUrl', value: wrongSite }],
      [label('row-a', 'websiteUrl', wrongSite)],
    );
    expect(score.knownWrong).toBe(0);
    expect(score.byField[0].labeledEntityEmitted).toBe(0);
  });

  it('does not read a URL citation against a prose label', () => {
    const score = scoreLaneReplay(
      [
        {
          entityType: 'researchEntity',
          entityKey: 'row-a',
          field: 'sourceUrls',
          value: ['Borrowed prose.'],
        },
      ],
      [label('row-a', 'fullDescription', 'Borrowed prose.')],
    );
    expect(score.knownWrong).toBe(0);
    expect(score.byField[0].labeledEntityEmitted).toBe(0);
  });
});

describe('plannedOutputFingerprint', () => {
  const a = { entityType: 'researchEntity', entityKey: 'row-a', field: 'name', value: 'A' };
  const b = { entityType: 'researchEntity', entityKey: 'row-b', field: 'name', value: 'B' };

  it('does not depend on emission order', () => {
    expect(plannedOutputFingerprint([a, b])).toBe(plannedOutputFingerprint([b, a]));
  });

  it('changes when a planned value changes', () => {
    expect(plannedOutputFingerprint([a, b])).not.toBe(
      plannedOutputFingerprint([a, { ...b, value: 'B2' }]),
    );
  });
});
