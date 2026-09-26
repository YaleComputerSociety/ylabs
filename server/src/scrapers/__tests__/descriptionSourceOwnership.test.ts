import { describe, expect, it } from 'vitest';
import { observedEntityTypes } from '../../models/observation';
import {
  DESCRIPTION_SOURCE_MIN_FOREIGN_CITERS,
  OWNERSHIP_GUARDED_ENTITY_TYPE,
  isOwnershipGuardedDescription,
  ownershipGuardedCitedUrls,
  refusesDescriptionOnSharedPage,
} from '../descriptionSourceOwnership';

const candidate = (over: Record<string, unknown> = {}) => ({
  entityType: OWNERSHIP_GUARDED_ENTITY_TYPE,
  field: 'fullDescription',
  sourceUrl: 'https://ysph.yale.edu/school-of-public-health-faculty/directory-name/',
  ...over,
});

describe('description source ownership', () => {
  it('guards the entity type observations actually carry', () => {
    // The first cut compared against 'research_entity', which no observation carries,
    // so the refusal was inert everywhere and still typechecked.
    expect(observedEntityTypes).toContain(OWNERSHIP_GUARDED_ENTITY_TYPE);
    expect(isOwnershipGuardedDescription(candidate({ entityType: 'research_entity' }))).toBe(false);
    expect(isOwnershipGuardedDescription(candidate())).toBe(true);
  });

  it('refuses a description whose page two other entities already cite', () => {
    expect(refusesDescriptionOnSharedPage(candidate(), 2)).toBe(true);
    expect(refusesDescriptionOnSharedPage(candidate(), 130)).toBe(true);
  });

  it('allows a page one other entity cites, which is usually one subject stored twice', () => {
    expect(refusesDescriptionOnSharedPage(candidate(), 1)).toBe(false);
    expect(refusesDescriptionOnSharedPage(candidate(), 0)).toBe(false);
  });

  it('pins the bar at a third citer, so widening it is a deliberate edit', () => {
    expect(DESCRIPTION_SOURCE_MIN_FOREIGN_CITERS).toBe(2);
  });

  it("exempts a person's own profile, which several of their rows legitimately cite", () => {
    const profile = candidate({ sourceUrl: 'https://medicine.yale.edu/profile/robin-hansen/' });
    expect(isOwnershipGuardedDescription(profile)).toBe(false);
    expect(refusesDescriptionOnSharedPage(profile, 50)).toBe(false);
  });

  it('leaves every non-description field and non-research entity alone', () => {
    expect(refusesDescriptionOnSharedPage(candidate({ field: 'websiteUrl' }), 50)).toBe(false);
    expect(refusesDescriptionOnSharedPage(candidate({ field: 'title' }), 50)).toBe(false);
    expect(refusesDescriptionOnSharedPage(candidate({ entityType: 'user' }), 50)).toBe(false);
  });

  it('ignores an observation with no cited page at all', () => {
    expect(refusesDescriptionOnSharedPage(candidate({ sourceUrl: '' }), 50)).toBe(false);
    expect(refusesDescriptionOnSharedPage(candidate({ sourceUrl: 'not a url' }), 50)).toBe(false);
  });

  it('returns cited URLs normalized, so a lookup and a refusal test the same string', () => {
    const urls = ownershipGuardedCitedUrls([
      candidate({ sourceUrl: 'https://WWW.Ysph.Yale.edu/a/b/?tab=1#x' }),
      candidate({ sourceUrl: 'https://ysph.yale.edu/a/b' }),
      candidate({ field: 'websiteUrl', sourceUrl: 'https://ysph.yale.edu/ignored' }),
    ]);
    expect(urls).toEqual(['https://ysph.yale.edu/a/b']);
  });
});
