import { describe, expect, it } from 'vitest';
import {
  normalizeResearchTaxonomySlug,
  toResearchTaxonomySlug,
} from '../researchAreaSlug';

describe('toResearchTaxonomySlug', () => {
  it('slugifies a plain area name', () => {
    expect(toResearchTaxonomySlug('Machine Learning')).toBe('machine-learning');
  });

  it('expands ampersands and collapses punctuation', () => {
    expect(toResearchTaxonomySlug('Computing & Artificial Intelligence')).toBe(
      'computing-and-artificial-intelligence',
    );
    expect(toResearchTaxonomySlug('  Health / Medicine  ')).toBe('health-medicine');
  });
});

describe('normalizeResearchTaxonomySlug', () => {
  it('normalizes a valid slug and collapses repeated hyphens', () => {
    expect(normalizeResearchTaxonomySlug('machine--learning')).toBe('machine-learning');
    expect(normalizeResearchTaxonomySlug('Machine-Learning')).toBe('machine-learning');
  });

  it('rejects a malformed or non-string slug', () => {
    expect(normalizeResearchTaxonomySlug('')).toBeNull();
    expect(normalizeResearchTaxonomySlug('  ')).toBeNull();
    expect(normalizeResearchTaxonomySlug('has spaces')).toBeNull();
    expect(normalizeResearchTaxonomySlug('-leading')).toBeNull();
    expect(normalizeResearchTaxonomySlug(null)).toBeNull();
    expect(normalizeResearchTaxonomySlug(42)).toBeNull();
  });

  it('round-trips a slugified taxonomy value', () => {
    for (const value of ['Neuroscience', 'Computing & Artificial Intelligence', 'Climate Science']) {
      const slug = toResearchTaxonomySlug(value);
      expect(normalizeResearchTaxonomySlug(slug)).toBe(slug);
    }
  });
});
