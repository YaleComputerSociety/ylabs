import { describe, expect, it } from 'vitest';

import {
  relaxResearchQuery,
  suggestCorpusResearchAreas,
} from '../researchZeroResultRecovery';

describe('relaxResearchQuery', () => {
  it('drops the last term of a multi-term query', () => {
    expect(relaxResearchQuery('quantum materials physics')).toBe('quantum materials');
    expect(relaxResearchQuery('  machine   learning  ')).toBe('machine');
  });

  it('returns null when the query cannot be relaxed further', () => {
    expect(relaxResearchQuery('genomics')).toBeNull();
    expect(relaxResearchQuery('   ')).toBeNull();
    expect(relaxResearchQuery('')).toBeNull();
  });
});

describe('suggestCorpusResearchAreas', () => {
  const areas = [
    { name: 'Genomics' },
    { name: 'Machine Learning' },
    { name: 'Machine Vision' },
    { name: 'Ancient DNA' },
    { name: 'Quantum Materials' },
  ];

  it('only returns real corpus research-area names, never synthesized topics', () => {
    const corpusNames = new Set(areas.map((area) => area.name));
    const suggestions = suggestCorpusResearchAreas(areas, 'underwater basket weaving', [], 6);
    expect(suggestions.length).toBeGreaterThan(0);
    suggestions.forEach((suggestion) => {
      expect(corpusNames.has(suggestion)).toBe(true);
    });
  });

  it('ranks corpus areas that share tokens with the query first', () => {
    const suggestions = suggestCorpusResearchAreas(areas, 'machine intelligence', [], 6);
    expect(suggestions.slice(0, 2)).toEqual(['Machine Learning', 'Machine Vision']);
  });

  it('excludes already-selected areas and the query itself', () => {
    const suggestions = suggestCorpusResearchAreas(areas, 'Genomics', ['Machine Learning'], 6);
    expect(suggestions).not.toContain('Genomics');
    expect(suggestions).not.toContain('Machine Learning');
  });

  it('falls back to a deterministic alphabetical order when no query tokens match', () => {
    const suggestions = suggestCorpusResearchAreas(areas, '', [], 3);
    expect(suggestions).toEqual(['Ancient DNA', 'Genomics', 'Machine Learning']);
  });

  it('never invents a value when the config list is empty', () => {
    expect(suggestCorpusResearchAreas([], 'anything', [], 6)).toEqual([]);
  });
});
