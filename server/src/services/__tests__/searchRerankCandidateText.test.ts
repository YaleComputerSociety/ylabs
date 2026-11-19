import { describe, expect, it } from 'vitest';
import {
  SEARCH_RERANK_PROMPT_FULL_DESCRIPTION_CHARACTERS,
  SEARCH_RERANK_PROMPT_SHORT_DESCRIPTION_CHARACTERS,
  buildSearchRerankTextHash,
  searchRerankPromptExcerpts,
} from '../searchRerankCandidateText';

const document = (overrides: Record<string, unknown> = {}) => ({
  name: 'Synthetic Coastal Lab',
  kind: 'lab',
  entityType: 'lab',
  departments: ['Synthetic Department', 'Another Synthetic Department'],
  researchAreas: ['Coastal Ecology', 'Tidal Marsh'],
  shortDescription: 'Studies synthetic tidal marshes.',
  fullDescription: 'A synthetic research description about shoreline restoration.',
  ...overrides,
});

describe('buildSearchRerankTextHash', () => {
  it('is a short stable hex hash that ignores list order', () => {
    const hash = buildSearchRerankTextHash(document());

    expect(hash).toMatch(/^[0-9a-f]{16}$/);
    expect(
      buildSearchRerankTextHash(
        document({
          departments: ['Another Synthetic Department', 'Synthetic Department'],
          researchAreas: ['Tidal Marsh', 'Coastal Ecology'],
        }),
      ),
    ).toBe(hash);
  });

  it.each([
    ['name', { name: 'Synthetic Renamed Lab' }],
    ['topics', { researchAreas: ['Coastal Ecology'] }],
    ['departments', { departments: ['Synthetic Department'] }],
    ['kind', { kind: 'center' }],
    ['entity type', { entityType: 'center' }],
    ['short description', { shortDescription: 'A rewritten synthetic card.' }],
    ['full description', { fullDescription: 'A rewritten synthetic description.' }],
  ])('changes when the %s the prompt shows changes', (_label, overrides) => {
    expect(buildSearchRerankTextHash(document(overrides))).not.toBe(
      buildSearchRerankTextHash(document()),
    );
  });

  it('ignores fields the prompt does not show', () => {
    expect(
      buildSearchRerankTextHash(
        document({
          id: 'synthetic-id',
          schools: ['Synthetic School'],
          methods: ['Synthetic Method'],
          professorNames: ['Synthetic Person'],
          browseRankScore: 4,
          _rankingScore: 0.4,
        }),
      ),
    ).toBe(buildSearchRerankTextHash(document()));
  });

  it('ignores description edits past what the prompt shows', () => {
    const short = 's'.repeat(SEARCH_RERANK_PROMPT_SHORT_DESCRIPTION_CHARACTERS);
    const full = 'f'.repeat(SEARCH_RERANK_PROMPT_FULL_DESCRIPTION_CHARACTERS);
    const base = buildSearchRerankTextHash(
      document({ shortDescription: short, fullDescription: full }),
    );

    expect(
      buildSearchRerankTextHash(
        document({ shortDescription: `${short} tail`, fullDescription: `${full} tail` }),
      ),
    ).toBe(base);
    expect(
      buildSearchRerankTextHash(
        document({ shortDescription: `x${short.slice(1)}`, fullDescription: full }),
      ),
    ).not.toBe(base);
  });
});

describe('searchRerankPromptExcerpts', () => {
  it('cuts descriptions at the same limits the hash reads', () => {
    const excerpts = searchRerankPromptExcerpts({
      departments: ['Synthetic Department'],
      shortDescription: 's'.repeat(500),
      fullDescription: 'f'.repeat(500),
    });

    expect(excerpts.shortDescription).toHaveLength(
      SEARCH_RERANK_PROMPT_SHORT_DESCRIPTION_CHARACTERS,
    );
    expect(excerpts.fullDescription).toHaveLength(SEARCH_RERANK_PROMPT_FULL_DESCRIPTION_CHARACTERS);
  });
});
