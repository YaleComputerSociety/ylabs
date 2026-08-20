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
        description: 'We advance machine learning for public health screening.',
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
        description: 'Deep dives into machine learning.',
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
        description:
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
        description: 'We combine machine learning with imaging.',
      },
      { onlyEmpty: false, maxAreas: 6 },
    );
    expect(row.after).toEqual(expect.arrayContaining(['Neuroscience', 'Machine Learning']));
    expect(row.fromDescription).toEqual(['Machine Learning']);
    expect(row.changed).toBe(true);
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
  });
});

describe('normalizeMaxAreas', () => {
  it('defaults and floors values', () => {
    expect(normalizeMaxAreas(undefined)).toBe(6);
    expect(normalizeMaxAreas(0)).toBe(6);
    expect(normalizeMaxAreas(3.9)).toBe(3);
  });
});
