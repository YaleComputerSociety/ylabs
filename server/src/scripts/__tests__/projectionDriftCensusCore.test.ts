import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import {
  classifyEntityProjectionDrift,
  isProjectionBookkeepingKey,
  parseProjectionDriftCensusArgs,
  projectionDriftReportsForUnloadedSlugs,
  researchEntityFieldIsStorable,
  scaleProjectionDriftCensusToCorpus,
  scaleProjectionDriftRowCount,
  summarizeProjectionDriftCensus,
  type ProjectionDriftStorageSchema,
} from '../projectionDriftCensusCore';

/**
 * A real schema rather than a list of path names, because the census compares a
 * planned value in its cast form and a hand-written stand-in for mongoose's cast
 * would be the thing under test.
 */
const SCHEMA = new mongoose.Schema({
  slug: { type: String },
  name: { type: String },
  fullDescription: { type: String },
  shortDescription: { type: String },
  researchAreas: { type: [String], default: [] },
  websiteUrl: { type: String },
  confidenceByField: { type: mongoose.Schema.Types.Mixed },
  fieldProvenance: { type: mongoose.Schema.Types.Mixed },
  sourceLinkHealth: { url: { type: String } },
  lastObservedAt: { type: Date },
  recentGrants: {
    type: [
      {
        id: { type: String },
        agency: { type: String },
        abstract: { type: String, default: '' },
        startDate: { type: Date },
        dollarAmount: { type: Number },
        role: { type: String, enum: ['pi', 'copi'], default: 'pi' },
      },
    ],
    default: [],
  },
});

const SCHEMA_PATHS = Object.keys(SCHEMA.paths);

const classify = (
  plannedSet: Record<string, unknown>,
  stored: Record<string, unknown> = {},
  plannedUnset: Record<string, unknown> = {},
) =>
  classifyEntityProjectionDrift({
    stored,
    plannedSet,
    plannedUnset,
    schema: SCHEMA as unknown as ProjectionDriftStorageSchema,
  });

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
    expect(classify({ inferredPiUserId: 'user-1' }, { inferredPiUserId: 'user-2' })).toEqual([
      { field: 'inferredPiUserId', driftClass: 'unstorable' },
    ]);
    expect(
      classify({}, { inferredPiUserId: 'user-1' }, { inferredPiUserId: '' }),
    ).toEqual([{ field: 'inferredPiUserId', driftClass: 'unstorable' }]);
  });

  it('reports no divergence when an unstorable field already stores the planned value', () => {
    expect(classify({ inferredPiUserId: 'user-1' }, { inferredPiUserId: 'user-1' })).toEqual([]);
    expect(classify({}, { inferredPiUserId: '' }, { inferredPiUserId: '' })).toEqual([]);
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

  it('reads an unchanged grant list as unchanged despite the cast mongoose applied on write', () => {
    const plannedGrant = {
      id: '10000001',
      agency: 'NIH',
      startDate: '2024-01-02',
      dollarAmount: 500000,
    };
    const storedGrant = {
      id: '10000001',
      agency: 'NIH',
      abstract: '',
      startDate: new Date('2024-01-02T00:00:00.000Z'),
      dollarAmount: 500000,
      role: 'pi',
      _id: new mongoose.Types.ObjectId('000000000000000000000001'),
    };

    expect(classify({ recentGrants: [plannedGrant] }, { recentGrants: [storedGrant] })).toEqual([]);
  });

  it('still reports an overwrite when a grant the row holds really changed', () => {
    const storedGrant = {
      id: '10000001',
      agency: 'NIH',
      abstract: '',
      startDate: new Date('2024-01-02T00:00:00.000Z'),
      dollarAmount: 500000,
      role: 'pi',
      _id: new mongoose.Types.ObjectId('000000000000000000000001'),
    };

    expect(
      classify(
        { recentGrants: [{ id: '10000001', agency: 'NSF', startDate: '2024-01-02' }] },
        { recentGrants: [storedGrant] },
      ),
    ).toEqual([{ field: 'recentGrants', driftClass: 'overwrite' }]);
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

describe('scaleProjectionDriftCensusToCorpus', () => {
  it('divides by every row drawn so a skipped row does not inflate the estimate', () => {
    const summary = summarizeProjectionDriftCensus([
      { slug: 'a', findings: [{ field: 'fullDescription', driftClass: 'fill-empty' as const }] },
      { slug: 'b', findings: [] },
      { slug: 'c', skipped: 'archived-entity', findings: [] },
      { slug: 'd', error: 'boom', findings: [] },
    ]);

    expect(summary.rowsSampled).toBe(2);
    expect(scaleProjectionDriftCensusToCorpus(summary, 400)).toEqual({
      rowsWithAnyDrift: 100,
      rowsWithActionableDrift: 100,
      rowsWithPermanentDriftOnly: 0,
      rowsByClass: { unstorable: 0, 'fill-empty': 100, overwrite: 0, 'clear-stored': 0 },
    });
  });

  it('reports zero rather than dividing by an empty draw', () => {
    expect(scaleProjectionDriftCensusToCorpus(summarizeProjectionDriftCensus([]), 4743)).toEqual({
      rowsWithAnyDrift: 0,
      rowsWithActionableDrift: 0,
      rowsWithPermanentDriftOnly: 0,
      rowsByClass: { unstorable: 0, 'fill-empty': 0, overwrite: 0, 'clear-stored': 0 },
    });
  });
});

describe('projectionDriftReportsForUnloadedSlugs', () => {
  it('carries a row for a requested slug that named no document', () => {
    expect(
      projectionDriftReportsForUnloadedSlugs(
        ['live-lab', 'absent-lab'],
        [{ slug: 'live-lab', findings: [] }],
      ),
    ).toEqual([{ slug: 'absent-lab', skipped: 'entity-not-found', findings: [] }]);
  });

  it('adds nothing when every requested slug reported', () => {
    expect(
      projectionDriftReportsForUnloadedSlugs(
        ['live-lab', 'archived-lab'],
        [
          { slug: 'live-lab', findings: [] },
          { slug: 'archived-lab', skipped: 'archived-entity', findings: [] },
        ],
      ),
    ).toEqual([]);
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
