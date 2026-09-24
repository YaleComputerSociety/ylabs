import { describe, expect, it } from 'vitest';
import {
  RESEARCH_ENTITY_SLUG_OBSERVATION_FIELD,
  unreadResearchEntitySlugAlias,
} from '../entityMaterializer';

const field = (value: unknown, sourceName = 'nsf-award-search') => ({ value, sourceName });

describe('the research-entity slug observation field has one owner (#3253)', () => {
  it('is the name the stored corpus actually carries', () => {
    expect(RESEARCH_ENTITY_SLUG_OBSERVATION_FIELD).toBe('researchGroupKey');
  });

  it('is not the name the grant lanes write, so the two cannot be conflated (#3274)', () => {
    expect(RESEARCH_ENTITY_SLUG_OBSERVATION_FIELD).not.toBe('researchGroupSlug');
  });
});

describe('an unread slug alias is named rather than read (#3274)', () => {
  it('names the alias and its source when the slug arrives under a name no reader accepts', () => {
    expect(unreadResearchEntitySlugAlias({ researchGroupSlug: field('smith-lab') })).toEqual({
      field: 'researchGroupSlug',
      sourceName: 'nsf-award-search',
    });
  });

  it('reports nothing when the slug arrives under the name the reader uses', () => {
    expect(
      unreadResearchEntitySlugAlias({
        [RESEARCH_ENTITY_SLUG_OBSERVATION_FIELD]: field('smith-lab', 'ysm-atoz-index'),
      }),
    ).toBeNull();
  });

  it('reports nothing for a genuinely absent slug, which is silence and not a defect', () => {
    expect(unreadResearchEntitySlugAlias({})).toBeNull();
    expect(unreadResearchEntitySlugAlias({ researchGroupSlug: field('') })).toBeNull();
    expect(unreadResearchEntitySlugAlias({ researchGroupSlug: field(undefined) })).toBeNull();
  });

  it('falls back to a named source rather than an empty string, so a warning is attributable', () => {
    expect(unreadResearchEntitySlugAlias({ researchGroupSlug: field('smith-lab', '') })).toEqual({
      field: 'researchGroupSlug',
      sourceName: 'unknown',
    });
  });
});
