import { describe, expect, it } from 'vitest';

import { searchQueryFromResearchSlug } from '../researchSlugSearchQuery';

describe('searchQueryFromResearchSlug', () => {
  it.each([
    ['dept-psych-fixture-scholar', 'fixture scholar'],
    ['ysm-faculty-fixture-scholar', 'fixture scholar'],
    ['faculty-research-area-fixture-scholar', 'fixture scholar'],
    ['dept-ysph-fixture-scholar', 'fixture scholar'],
    ['nih-pi-fixture-scholar', 'fixture scholar'],
    ['center-example-studies', 'center example studies'],
    ['Example-Imaging-LAB', 'example imaging lab'],
  ])('turns %s into the words a student would search for', (slug, query) => {
    expect(searchQueryFromResearchSlug(slug)).toBe(query);
  });

  it('keeps the trailing name when a long department name fills the address', () => {
    expect(
      searchQueryFromResearchSlug(
        'dept-molecular-cellular-and-developmental-biology-fixture-middle-scholar',
      ),
    ).toBe('and developmental biology fixture middle scholar');
  });

  it('keeps markup and overlong junk out of the suggested search', () => {
    expect(searchQueryFromResearchSlug('%3Cscript%3Ealert(1)%3C%2Fscript%3E')).toBe(
      'script alert script',
    );
    expect(searchQueryFromResearchSlug('a'.repeat(300))).toBe('');
  });

  it('suggests nothing for a slug made only of source prefixes or malformed escapes', () => {
    expect(searchQueryFromResearchSlug('ysm-faculty')).toBe('');
    expect(searchQueryFromResearchSlug('%E0%A4%A')).toBe('');
    expect(searchQueryFromResearchSlug(undefined)).toBe('');
  });
});
