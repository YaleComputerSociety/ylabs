import { describe, expect, it } from 'vitest';
import {
  classifyEntityProjectionDrift,
  isProjectionBookkeepingKey,
  parseProjectionDriftCensusArgs,
  researchEntityFieldIsStorable,
  scaleProjectionDriftRowCount,
  summarizeProjectionDriftCensus,
} from '../projectionDriftCensusCore';

const SCHEMA_PATHS = [
  'slug',
  'name',
  'fullDescription',
  'shortDescription',
  'researchAreas',
  'websiteUrl',
  'confidenceByField',
  'fieldProvenance',
  'sourceLinkHealth.url',
  'lastObservedAt',
];

const classify = (
  plannedSet: Record<string, unknown>,
  stored: Record<string, unknown> = {},
  plannedUnset: Record<string, unknown> = {},
) => classifyEntityProjectionDrift({ stored, plannedSet, plannedUnset, schemaPaths: SCHEMA_PATHS });

describe('researchEntityFieldIsStorable', () => {
  it('accepts a declared path and a declared subpath root', () => {
    expect(researchEntityFieldIsStorable(SCHEMA_PATHS, 'fullDescription')).toBe(true);
    expect(researchEntityFieldIsStorable(SCHEMA_PATHS, 'sourceLinkHealth')).toBe(true);
  });

  it('refuses a field the schema has no path for', () => {
    expect(researchEntityFieldIsStorable(SCHEMA_PATHS, 'inferredPiUserId')).toBe(false);
    expect(researchEntityFieldIsStorable(SCHEMA_PATHS, 'sourceLink')).toBe(false);
  });
});

describe('isProjectionBookkeepingKey', () => {
  it('excludes the keys every projection rewrites', () => {
    expect(isProjectionBookkeepingKey('lastObservedAt')).toBe(true);
    expect(isProjectionBookkeepingKey('confidenceByField')).toBe(true);
    expect(isProjectionBookkeepingKey('fieldProvenance.fullDescription')).toBe(true);
    expect(isProjectionBookkeepingKey('confidenceByField.researchAreas')).toBe(true);
  });

  it('keeps a real field', () => {
    expect(isProjectionBookkeepingKey('fullDescription')).toBe(false);
  });
});

describe('classifyEntityProjectionDrift', () => {
  it('calls a field the schema cannot store permanently divergent, not a backlog item', () => {
    expect(classify({ inferredPiUserId: 'user-1' }, { inferredPiUserId: undefined })).toEqual([
      { field: 'inferredPiUserId', driftClass: 'unstorable' },
    ]);
  });

  it('separates a fill from an overwrite on the same field', () => {
    expect(classify({ fullDescription: 'Projected prose.' }, { fullDescription: '' })).toEqual([
      { field: 'fullDescription', driftClass: 'fill-empty' },
    ]);
    expect(
      classify({ fullDescription: 'Projected prose.' }, { fullDescription: 'Stored.' }),
    ).toEqual([{ field: 'fullDescription', driftClass: 'overwrite' }]);
  });

  it('calls an emptied or unset stored value a removal', () => {
    expect(classify({ researchAreas: [] }, { researchAreas: ['Genomics'] })).toEqual([
      { field: 'researchAreas', driftClass: 'clear-stored' },
    ]);
    expect(classify({}, { websiteUrl: 'https://example.edu/lab/' }, { websiteUrl: '' })).toEqual([
      { field: 'websiteUrl', driftClass: 'clear-stored' },
    ]);
  });

  it('reports nothing when projection matches the stored value or empties an empty one', () => {
    expect(classify({ name: 'Fixture Lab' }, { name: 'Fixture Lab' })).toEqual([]);
    expect(classify({ researchAreas: ['A'] }, { researchAreas: ['A'] })).toEqual([]);
    expect(classify({}, { shortDescription: '' }, { shortDescription: '' })).toEqual([]);
  });

  it('ignores the bookkeeping keys so an unchanged row reads as unchanged', () => {
    expect(
      classify(
        {
          lastObservedAt: new Date('2026-01-01T00:00:00.000Z'),
          confidenceByField: { name: 0.9 },
          'fieldProvenance.name': { sourceUrl: 'https://example.edu/' },
          name: 'Fixture Lab',
        },
        { name: 'Fixture Lab' },
      ),
    ).toEqual([]);
  });

  it('counts a field once even when it is both set and unset', () => {
    expect(
      classify(
        { fullDescription: 'Projected.' },
        { fullDescription: 'Stored.' },
        { fullDescription: '' },
      ),
    ).toEqual([{ field: 'fullDescription', driftClass: 'overwrite' }]);
  });
});

describe('summarizeProjectionDriftCensus', () => {
  const reports = [
    { slug: 'a', findings: [{ field: 'inferredPiUserId', driftClass: 'unstorable' as const }] },
    {
      slug: 'b',
      findings: [
        { field: 'inferredPiUserId', driftClass: 'unstorable' as const },
        { field: 'fullDescription', driftClass: 'fill-empty' as const },
      ],
    },
    { slug: 'c', findings: [{ field: 'researchAreas', driftClass: 'clear-stored' as const }] },
    { slug: 'd', findings: [] },
    { slug: 'e', skipped: 'redirected-to-canonical', findings: [] },
    { slug: 'f', error: 'boom', findings: [] },
  ];

  it('keeps the permanently divergent rows out of the actionable count', () => {
    const summary = summarizeProjectionDriftCensus(reports);

    expect(summary.rowsSampled).toBe(4);
    expect(summary.rowsSkipped).toBe(1);
    expect(summary.rowsFailed).toBe(1);
    expect(summary.rowsWithAnyDrift).toBe(3);
    expect(summary.rowsWithActionableDrift).toBe(2);
    expect(summary.rowsWithPermanentDriftOnly).toBe(1);
  });

  it('counts a row once per class and a field once per occurrence', () => {
    const summary = summarizeProjectionDriftCensus(reports);

    expect(summary.rowsByClass).toEqual({
      unstorable: 2,
      'fill-empty': 1,
      overwrite: 0,
      'clear-stored': 1,
    });
    expect(summary.fieldOccurrencesByClass.unstorable).toBe(2);
    expect(summary.fieldsByClass.unstorable).toEqual({ inferredPiUserId: 2 });
    expect(summary.fieldsByClass['fill-empty']).toEqual({ fullDescription: 1 });
  });
});

describe('scaleProjectionDriftRowCount', () => {
  it('scales a sample to the corpus and refuses to divide by an empty sample', () => {
    expect(scaleProjectionDriftRowCount(96, 200, 4743)).toBe(2277);
    expect(scaleProjectionDriftRowCount(3, 0, 4743)).toBe(0);
  });
});

describe('parseProjectionDriftCensusArgs', () => {
  it('defaults to a sample of the live corpus', () => {
    expect(parseProjectionDriftCensusArgs([])).toEqual({
      sample: 200,
      slugs: [],
      includeArchived: false,
    });
  });

  it('accepts a sample size, slugs and archived rows', () => {
    expect(
      parseProjectionDriftCensusArgs(['--sample=40', '--slugs=a-lab,b-lab', '--include-archived']),
    ).toEqual({ sample: 40, slugs: ['a-lab', 'b-lab'], includeArchived: true });
  });

  it('refuses a malformed sample, a malformed slug and an unknown flag', () => {
    expect(() => parseProjectionDriftCensusArgs(['--sample=0'])).toThrow('positive integer');
    expect(() => parseProjectionDriftCensusArgs(['--slugs=../etc'])).toThrow('Invalid entity slug');
    expect(() => parseProjectionDriftCensusArgs(['--apply'])).toThrow('Unknown projection drift');
  });
});
