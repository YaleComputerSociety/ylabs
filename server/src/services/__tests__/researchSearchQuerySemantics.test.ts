import { describe, expect, it } from 'vitest';
import { RESEARCH_SEARCH_QUALITY_CASES } from './researchSearchQualityCases';
import { buildResearchSearchQuerySemantics } from '../researchSearchQuerySemantics';

describe('buildResearchSearchQuerySemantics', () => {
  it.each(RESEARCH_SEARCH_QUALITY_CASES)(
    'maps "$query" into exploratory concepts and methods',
    ({ query, expectedConcepts, expectedMethods, expectedExpansionIncludes }) => {
      const semantics = buildResearchSearchQuerySemantics(query);

      expect(semantics.originalQuery).toBe(query);
      expect(semantics.normalizedQuery).toBe(query.toLowerCase());
      expect(semantics.concepts).toEqual(expect.arrayContaining(expectedConcepts));
      expect(semantics.methods).toEqual(expect.arrayContaining(expectedMethods));
      expect(semantics.expansionQueries.join(' ')).toEqual(
        expect.stringContaining(expectedExpansionIncludes[0]),
      );
      for (const expectedExpansion of expectedExpansionIncludes) {
        expect(semantics.expansionQueries.join(' ')).toContain(expectedExpansion);
      }
    },
  );

  it('deduplicates expansions and keeps the original query first', () => {
    const semantics = buildResearchSearchQuerySemantics('wet lab wet lab');

    expect(semantics.expansionQueries[0]).toBe('wet lab wet lab');
    expect(new Set(semantics.expansionQueries).size).toBe(
      semantics.expansionQueries.length,
    );
  });

  it('matches short aliases such as ai only as standalone terms', () => {
    const brainImaging = buildResearchSearchQuerySemantics('brain imaging');
    const sustainability = buildResearchSearchQuerySemantics('sustainability policy');
    const ai = buildResearchSearchQuerySemantics('ai for biology');

    expect(brainImaging.concepts).not.toContain('machine learning');
    expect(sustainability.concepts).not.toContain('machine learning');
    expect(ai.concepts).toContain('machine learning');
  });

  it('keeps archival research expansions evidence-specific', () => {
    const semantics = buildResearchSearchQuerySemantics('archival research');

    expect(semantics.expansionQueries).toEqual(
      expect.arrayContaining([
        'archival research',
        'archives',
        'archival',
        'manuscripts',
        'special collections',
        'library collections',
        'museum collections',
        'curatorial',
        'rare books',
        'primary sources',
        'oral history',
        'material culture',
      ]),
    );
    expect(semantics.expansionQueries).not.toContain('history humanities');
  });

  it('does not need one-off semantic rules for specific proper-noun queries', () => {
    const semantics = buildResearchSearchQuerySemantics('black scholes');

    expect(semantics.concepts).toEqual([]);
    expect(semantics.methods).toEqual([]);
    expect(semantics.expansionQueries).toEqual(['black scholes']);
  });
});
