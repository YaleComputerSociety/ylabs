import { describe, expect, it } from 'vitest';
import {
  buildResearchAreaResolverIndex,
  createResearchAreaCanonicalizer,
} from '../../scrapers/researchAreaCanonicalization';
import {
  normalizeMaxAreas,
  planResearchAreaBackfillRow,
  summarizeResearchAreaBackfill,
} from '../backfillResearchAreasCore';

const canonicalizer = createResearchAreaCanonicalizer(
  buildResearchAreaResolverIndex([
    { name: 'Artificial Intelligence' },
    { name: 'Machine Learning' },
    { name: 'Computer Vision' },
    { name: 'Neuroscience' },
    { name: 'Public Health' },
    { name: 'Climate Change' },
    { name: 'Economics' },
    { name: 'Cell Biology' },
  ]),
);

const options = { onlyEmpty: true, maxAreas: 6 };

describe('planResearchAreaBackfillRow', () => {
  it('derives areas from departments and description for an empty entity', () => {
    const row = planResearchAreaBackfillRow(
      canonicalizer,
      {
        id: '1',
        name: 'Vision Systems Lab',
        departments: ['Computer Vision'],
        existingResearchAreas: [],
        fullDescription: 'We advance machine learning for public health screening.',
      },
      options,
    );
    expect(row.changed).toBe(true);
    expect(row.before).toEqual([]);
    expect(row.after).toEqual(
      expect.arrayContaining(['Computer Vision', 'Machine Learning', 'Public Health']),
    );
    expect(row.fromDepartments).toEqual(['Computer Vision']);
    expect(row.fromDescription).toEqual(
      expect.arrayContaining(['Machine Learning', 'Public Health']),
    );
  });

  it('normalizes existing areas but does not derive when onlyEmpty and areas exist', () => {
    const row = planResearchAreaBackfillRow(
      canonicalizer,
      {
        id: '2',
        name: 'AI Lab',
        departments: ['Economics'],
        existingResearchAreas: ['AI'],
        fullDescription: 'Deep dives into machine learning.',
      },
      options,
    );
    expect(row.after).toEqual(['Artificial Intelligence']);
    expect(row.fromDepartments).toEqual([]);
    expect(row.fromDescription).toEqual([]);
    expect(row.changed).toBe(true);
  });

  it('leaves an already-canonical entity unchanged', () => {
    const row = planResearchAreaBackfillRow(
      canonicalizer,
      { id: '3', existingResearchAreas: ['Neuroscience'] },
      options,
    );
    expect(row.changed).toBe(false);
    expect(row.after).toEqual(['Neuroscience']);
  });

  it('keeps unmatched raw areas and surfaces them for review', () => {
    const row = planResearchAreaBackfillRow(
      canonicalizer,
      { id: '4', existingResearchAreas: ['Basket Weaving'] },
      options,
    );
    expect(row.after).toEqual(['Basket Weaving']);
    expect(row.unmatchedForReview).toEqual(['Basket Weaving']);
    expect(row.changed).toBe(false);
  });

  it('caps derived areas at maxAreas', () => {
    const row = planResearchAreaBackfillRow(
      canonicalizer,
      {
        id: '5',
        existingResearchAreas: [],
        fullDescription:
          'machine learning, computer vision, public health, climate change, neuroscience, cell biology, artificial intelligence',
      },
      { onlyEmpty: true, maxAreas: 2 },
    );
    expect(row.after.length).toBe(2);
  });

  it('derives areas for a non-empty entity when includeNonempty', () => {
    const row = planResearchAreaBackfillRow(
      canonicalizer,
      {
        id: '6',
        existingResearchAreas: ['Neuroscience'],
        fullDescription: 'We combine machine learning with imaging.',
      },
      { onlyEmpty: false, maxAreas: 6 },
    );
    expect(row.after).toEqual(expect.arrayContaining(['Neuroscience', 'Machine Learning']));
    expect(row.fromDescription).toEqual(['Machine Learning']);
    expect(row.changed).toBe(true);
  });
});

describe('planResearchAreaBackfillRow specific-term and department coverage', () => {
  const richCanonicalizer = createResearchAreaCanonicalizer(
    buildResearchAreaResolverIndex([
      { name: 'Immunology' },
      { name: 'Bioinformatics' },
      { name: 'Diagnostics' },
      { name: 'Biophysics' },
      { name: 'Biochemistry' },
      { name: 'Molecular Biophysics' },
      { name: 'Ecology' },
      { name: 'Evolutionary Biology' },
      { name: 'Medicine' },
    ]),
  );

  it('fills an empty entity from specific single-word terms in the description', () => {
    const row = planResearchAreaBackfillRow(
      richCanonicalizer,
      {
        id: 's1',
        name: 'Keck Bioinformatics Resource',
        existingResearchAreas: [],
        fullDescription: 'Consultation on immunology assays and molecular diagnostics for labs.',
      },
      options,
    );
    expect(row.changed).toBe(true);
    expect(row.after).toEqual(
      expect.arrayContaining(['Bioinformatics', 'Immunology', 'Diagnostics']),
    );
    expect(row.after).not.toContain('Medicine');
  });

  it('splits a multi-topic department name into its component areas', () => {
    const row = planResearchAreaBackfillRow(
      richCanonicalizer,
      {
        id: 's2',
        name: 'Certain Lab',
        departments: ['Molecular Biophysics and Biochemistry'],
        existingResearchAreas: [],
      },
      options,
    );
    expect(row.fromDepartments).toEqual(
      expect.arrayContaining(['Molecular Biophysics', 'Biophysics', 'Biochemistry']),
    );
    expect(row.after).toEqual(
      expect.arrayContaining(['Molecular Biophysics', 'Biophysics', 'Biochemistry']),
    );
  });

  it('recovers both areas from an "X and Y Biology" department', () => {
    const row = planResearchAreaBackfillRow(
      richCanonicalizer,
      {
        id: 's3',
        departments: ['Ecology and Evolutionary Biology'],
        existingResearchAreas: [],
      },
      options,
    );
    expect(row.fromDepartments).toEqual(
      expect.arrayContaining(['Ecology', 'Evolutionary Biology']),
    );
  });
});

describe('summarizeResearchAreaBackfill', () => {
  it('aggregates changes, empty fills, and a review queue', () => {
    const rows = [
      planResearchAreaBackfillRow(
        canonicalizer,
        { id: 'a', existingResearchAreas: [], departments: ['Neuroscience'] },
        options,
      ),
      planResearchAreaBackfillRow(
        canonicalizer,
        { id: 'b', existingResearchAreas: ['Basket Weaving'] },
        options,
      ),
      planResearchAreaBackfillRow(
        canonicalizer,
        { id: 'c', existingResearchAreas: ['Basket Weaving'] },
        options,
      ),
    ];
    const summary = summarizeResearchAreaBackfill(rows);
    expect(summary.considered).toBe(3);
    expect(summary.filledFromEmpty).toBe(1);
    expect(summary.changed).toBe(1);
    expect(summary.reviewQueue).toEqual([{ value: 'Basket Weaving', count: 2 }]);
    expect(summary.distinctRawAreasBefore).toBe(1);
    expect(summary.distinctCanonicalAreasAfter).toBe(1);
    expect(summary.distinctFallThroughToRaw).toBe(1);
    expect(summary.entitiesWithCanonicalizedAreaChange).toBe(0);
    expect(summary.distinctLeakageDropped).toBe(0);
    expect(summary.leakageDroppedOccurrences).toBe(0);
  });

  it('reports the distinct-count collapse and leakage dropped for canonicalized areas', () => {
    const rows = [
      planResearchAreaBackfillRow(
        canonicalizer,
        { id: 'z', existingResearchAreas: ['AI', 'Research Areas:', 'artificial intelligence'] },
        { onlyEmpty: false, maxAreas: 6 },
      ),
    ];
    const summary = summarizeResearchAreaBackfill(rows);
    expect(summary.distinctRawAreasBefore).toBe(3);
    expect(summary.distinctCanonicalAreasAfter).toBe(1);
    expect(summary.distinctFallThroughToRaw).toBe(0);
    expect(summary.entitiesWithCanonicalizedAreaChange).toBe(1);
    expect(summary.distinctLeakageDropped).toBe(1);
    expect(summary.leakageDroppedOccurrences).toBe(1);
    expect(rows[0].droppedLeakage).toEqual(['Research Areas:']);
    expect(rows[0].canonicalizationChanged).toBe(true);
  });
});

describe('normalizeMaxAreas', () => {
  it('defaults and floors values', () => {
    expect(normalizeMaxAreas(undefined)).toBe(6);
    expect(normalizeMaxAreas(0)).toBe(6);
    expect(normalizeMaxAreas(3.9)).toBe(3);
  });
});
