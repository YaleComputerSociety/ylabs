import { afterEach, describe, expect, it } from 'vitest';
import {
  applyResearchEntityResearchAreaCanonicalization,
  buildResearchAreaResolverIndex,
  createResearchAreaCanonicalizer,
  researchAreaMatchKey,
  resetResearchAreaCanonicalizerCache,
  setResearchAreaCanonicalizerForTesting,
} from '../researchAreaCanonicalization';

const rows = [
  { name: 'Artificial Intelligence' },
  { name: 'Machine Learning' },
  { name: 'Computer Vision' },
  { name: 'Human-Computer Interaction' },
  { name: 'Neuroscience' },
  { name: 'Public Health' },
  { name: 'Climate Change' },
  { name: 'Economics' },
];

const index = buildResearchAreaResolverIndex(rows);
const canonicalizer = createResearchAreaCanonicalizer(index);

afterEach(() => {
  resetResearchAreaCanonicalizerCache();
});

describe('researchAreaMatchKey', () => {
  it('normalizes case, punctuation, and ampersands', () => {
    expect(researchAreaMatchKey('Machine Learning')).toBe('machine-learning');
    expect(researchAreaMatchKey('machine   learning')).toBe('machine-learning');
    expect(researchAreaMatchKey('Human-Computer Interaction')).toBe('human-computer-interaction');
    expect(researchAreaMatchKey(42)).toBe('');
  });
});

describe('canonicalizeResearchAreas', () => {
  it('maps exact names and curated aliases to canonical values', () => {
    const result = canonicalizer.canonicalizeResearchAreas([
      'machine learning',
      'AI',
      'HCI',
    ]);
    expect(result.values).toEqual([
      'Machine Learning',
      'Artificial Intelligence',
      'Human-Computer Interaction',
    ]);
    expect(result.unmatched).toEqual([]);
  });

  it('fails closed: keeps unmatched raw strings and reports them for review', () => {
    const result = canonicalizer.canonicalizeResearchAreas(['Basket Weaving', 'Neuroscience']);
    expect(result.values).toEqual(['Basket Weaving', 'Neuroscience']);
    expect(result.unmatched).toEqual(['Basket Weaving']);
  });

  it('dedupes canonical collisions case-insensitively', () => {
    const result = canonicalizer.canonicalizeResearchAreas(['AI', 'artificial intelligence']);
    expect(result.values).toEqual(['Artificial Intelligence']);
  });
});

describe('matchCanonicalResearchAreas', () => {
  it('returns only canonical matches and drops unmatched candidates', () => {
    expect(
      canonicalizer.matchCanonicalResearchAreas(['Economics', 'Underwater Ceramics']),
    ).toEqual(['Economics']);
  });
});

describe('deriveResearchAreasFromText', () => {
  it('finds multi-word canonical phrases as whole-word matches', () => {
    const text =
      'Our lab studies machine learning and computer vision for climate change adaptation.';
    expect(canonicalizer.deriveResearchAreasFromText(text)).toEqual(
      expect.arrayContaining(['Machine Learning', 'Computer Vision', 'Climate Change']),
    );
  });

  it('does not match a multi-word phrase glued inside a longer token', () => {
    expect(canonicalizer.deriveResearchAreasFromText('biomachine learning device')).toEqual([]);
  });

  it('never derives single-word areas from prose', () => {
    expect(canonicalizer.deriveResearchAreasFromText('the state of the art in economics')).toEqual(
      [],
    );
  });

  it('matches a multi-word alias in prose', () => {
    expect(
      canonicalizer.deriveResearchAreasFromText('work on human computer interaction methods'),
    ).toEqual(['Human-Computer Interaction']);
  });
});

describe('applyResearchEntityResearchAreaCanonicalization', () => {
  it('rewrites the set researchAreas in place and reports unmatched', async () => {
    setResearchAreaCanonicalizerForTesting(canonicalizer);
    const set: Record<string, unknown> = { researchAreas: ['AI', 'Quilting'] };
    const result = await applyResearchEntityResearchAreaCanonicalization(set);
    expect(set.researchAreas).toEqual(['Artificial Intelligence', 'Quilting']);
    expect(result.unmatchedResearchAreas).toEqual(['Quilting']);
  });

  it('is a no-op when researchAreas is absent', async () => {
    setResearchAreaCanonicalizerForTesting(canonicalizer);
    const set: Record<string, unknown> = { school: 'Yale College' };
    const result = await applyResearchEntityResearchAreaCanonicalization(set);
    expect(set).toEqual({ school: 'Yale College' });
    expect(result.unmatchedResearchAreas).toEqual([]);
  });
});
