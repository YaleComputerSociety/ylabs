import { describe, expect, it } from 'vitest';

import {
  aggregateResearchTypeBucketCounts,
  entityTypesForResearchTypeBuckets,
  readResearchTypeBucketKeys,
  researchTypeBucketKeysForEntityTypes,
  researchTypeBucketLabel,
} from '../researchTypeBuckets';

describe('researchTypeBuckets', () => {
  describe('readResearchTypeBucketKeys', () => {
    it('keeps only valid keys, dedupes, and preserves canonical bucket order', () => {
      expect(
        readResearchTypeBucketKeys(['programs', 'labs', 'programs', 'unknown', ' centers ']),
      ).toEqual(['labs', 'centers', 'programs']);
    });

    it('returns an empty list when nothing valid is supplied', () => {
      expect(readResearchTypeBucketKeys([])).toEqual([]);
      expect(readResearchTypeBucketKeys(['nope', ''])).toEqual([]);
    });
  });

  describe('entityTypesForResearchTypeBuckets', () => {
    it('flattens the raw entityType enum values for the selected buckets', () => {
      expect(entityTypesForResearchTypeBuckets(['programs'])).toEqual([
        'PROGRAM',
        'COURSE_SEQUENCE',
      ]);
    });

    it('unions and dedupes across multiple buckets', () => {
      const result = entityTypesForResearchTypeBuckets(['labs', 'centers']);
      expect(result).toContain('LAB');
      expect(result).toContain('CORE_FACILITY');
      expect(new Set(result).size).toBe(result.length);
    });
  });

  describe('researchTypeBucketKeysForEntityTypes', () => {
    it('reverses a flattened entityType list back to its bucket keys', () => {
      const entityTypes = entityTypesForResearchTypeBuckets(['labs', 'collections']);
      expect(researchTypeBucketKeysForEntityTypes(entityTypes)).toEqual(['labs', 'collections']);
    });

    it('only reports a bucket when every one of its entityTypes is present', () => {
      expect(researchTypeBucketKeysForEntityTypes(['LAB', 'GROUP'])).toEqual([]);
      expect(researchTypeBucketKeysForEntityTypes(undefined)).toEqual([]);
    });
  });

  describe('aggregateResearchTypeBucketCounts', () => {
    it('sums raw entityType facet counts into student-facing buckets and hides empties', () => {
      expect(
        aggregateResearchTypeBucketCounts({
          LAB: 10,
          GROUP: 2,
          INDIVIDUAL_RESEARCH: 3,
          PROGRAM: 4,
          CENTER: 0,
        }),
      ).toEqual([
        { key: 'labs', label: 'Research groups & labs', count: 15 },
        { key: 'programs', label: 'Programs & fellowships', count: 4 },
      ]);
    });

    it('ignores non-positive and unknown enum values', () => {
      expect(
        aggregateResearchTypeBucketCounts({ LAB: -1, MADE_UP: 99, INSTITUTE: 2 }),
      ).toEqual([{ key: 'centers', label: 'Centers & institutes', count: 2 }]);
    });

    it('returns an empty list when no counts are supplied', () => {
      expect(aggregateResearchTypeBucketCounts(undefined)).toEqual([]);
    });
  });

  it('exposes readable labels and never leaks raw enum keys', () => {
    expect(researchTypeBucketLabel('collections')).toBe(
      'Collections, museum & digital humanities',
    );
    expect(researchTypeBucketLabel('labs')).not.toMatch(/[A-Z_]{2,}/);
  });
});
