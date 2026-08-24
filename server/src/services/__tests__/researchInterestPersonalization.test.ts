import { describe, expect, it } from 'vitest';
import {
  personalizeBrowseHits,
  researchInterestMatchScore,
  normalizeResearchInterestTerm,
} from '../researchInterestPersonalization';

const hit = (id: string, browseRankScore: number, researchAreas: string[] = []) => ({
  id,
  browseRankScore,
  researchAreas,
});

describe('normalizeResearchInterestTerm', () => {
  it('lowercases, strips punctuation, and collapses whitespace', () => {
    expect(normalizeResearchInterestTerm('  Machine   Learning ')).toBe('machine learning');
    expect(normalizeResearchInterestTerm("Women's Health")).toBe('womens health');
    expect(normalizeResearchInterestTerm(42 as unknown as string)).toBe('');
  });
});

describe('researchInterestMatchScore', () => {
  it('counts distinct declared interests present across governed fields', () => {
    const entity = {
      researchAreas: ['Machine Learning'],
      departments: ['Statistics'],
      studentSearchTerms: ['neural networks'],
      topics: [],
    };
    const interests = new Set(['machine learning', 'statistics', 'oceanography']);
    expect(researchInterestMatchScore(entity, interests)).toBe(2);
  });

  it('never rewards an interest that matches no corpus term (graceful degrade)', () => {
    const entity = { researchAreas: ['Cell Biology'] };
    expect(researchInterestMatchScore(entity, new Set(['quantum gravity']))).toBe(0);
  });
});

describe('personalizeBrowseHits', () => {
  it('is byte-for-byte identity when there are no declared interests', () => {
    const hits = [hit('a', 9), hit('b', 8), hit('c', 7)];
    expect(personalizeBrowseHits(hits, [])).toEqual(hits);
  });

  it('is identity when no home in the pool matches any interest', () => {
    const hits = [hit('a', 9, ['History']), hit('b', 8, ['Art History'])];
    const result = personalizeBrowseHits(hits, ['Machine Learning']);
    expect(result.map((entry) => entry.id)).toEqual(['a', 'b']);
  });

  it('floats interest matches up while preserving browse order within a tier', () => {
    const hits = [
      hit('a', 9, ['History']),
      hit('b', 8, ['Machine Learning']),
      hit('c', 7, ['Robotics']),
      hit('d', 6, ['Machine Learning']),
    ];
    const result = personalizeBrowseHits(hits, ['Machine Learning']);
    expect(result.map((entry) => entry.id)).toEqual(['b', 'd', 'a', 'c']);
  });

  it('ranks a stronger overlap above a weaker one, then falls back to browse order', () => {
    const hits = [
      hit('a', 9, ['History']),
      hit('b', 8, ['Machine Learning']),
      hit('c', 7, ['Machine Learning', 'Statistics']),
    ];
    const result = personalizeBrowseHits(hits, ['Machine Learning', 'Statistics']);
    expect(result.map((entry) => entry.id)).toEqual(['c', 'b', 'a']);
  });

  it('reorders only within the fixed pool so pagination past it stays stable', () => {
    const hits = [
      hit('a', 9, ['History']),
      hit('b', 8, ['History']),
      hit('c', 7, ['Machine Learning']),
    ];
    const result = personalizeBrowseHits(hits, ['Machine Learning'], 2);
    expect(result.map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
  });

  it('is a pure permutation that never mutates the hit objects or their scores', () => {
    const hits = [hit('a', 9, ['History']), hit('b', 8, ['Machine Learning'])];
    const snapshot = hits.map((entry) => ({ ...entry }));
    const result = personalizeBrowseHits(hits, ['Machine Learning']);
    expect(new Set(result)).toEqual(new Set(hits));
    expect(result.every((entry) => hits.includes(entry))).toBe(true);
    expect(hits).toEqual(snapshot);
  });
});
