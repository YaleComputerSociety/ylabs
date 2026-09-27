import { describe, expect, it } from 'vitest';
import { observedEntityTypes } from '../../models/observation';
import {
  DESCRIPTION_SOURCE_MIN_FOREIGN_CITERS,
  OWNERSHIP_GUARDED_ENTITY_TYPE,
  citersAreOneSubject,
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
    expect(refusesDescriptionOnSharedPage(candidate(), ['Alpha Lab', 'Beta Lab'])).toBe(true);
    expect(
      refusesDescriptionOnSharedPage(
        candidate(),
        Array.from({ length: 130 }, (_, i) => `Subject ${i} Lab`),
      ),
    ).toBe(true);
  });

  it('allows a page one other entity cites, which is usually one subject stored twice', () => {
    expect(refusesDescriptionOnSharedPage(candidate(), ['Alpha Lab'])).toBe(false);
    expect(refusesDescriptionOnSharedPage(candidate(), [])).toBe(false);
  });

  it('pins the bar at a third citer, so widening it is a deliberate edit', () => {
    expect(DESCRIPTION_SOURCE_MIN_FOREIGN_CITERS).toBe(2);
  });

  it("exempts a person's own profile, which several of their rows legitimately cite", () => {
    const profile = candidate({ sourceUrl: 'https://medicine.yale.edu/profile/robin-hansen/' });
    expect(isOwnershipGuardedDescription(profile)).toBe(false);
    expect(
      refusesDescriptionOnSharedPage(
        profile,
        Array.from({ length: 50 }, (_, i) => `Subject ${i} Lab`),
      ),
    ).toBe(false);
  });

  it('leaves every non-description field and non-research entity alone', () => {
    expect(
      refusesDescriptionOnSharedPage(
        candidate({ field: 'websiteUrl' }),
        Array.from({ length: 50 }, (_, i) => `Subject ${i} Lab`),
      ),
    ).toBe(false);
    expect(
      refusesDescriptionOnSharedPage(
        candidate({ field: 'title' }),
        Array.from({ length: 50 }, (_, i) => `Subject ${i} Lab`),
      ),
    ).toBe(false);
    expect(
      refusesDescriptionOnSharedPage(
        candidate({ entityType: 'user' }),
        Array.from({ length: 50 }, (_, i) => `Subject ${i} Lab`),
      ),
    ).toBe(false);
  });

  it('ignores an observation with no cited page at all', () => {
    expect(
      refusesDescriptionOnSharedPage(
        candidate({ sourceUrl: '' }),
        Array.from({ length: 50 }, (_, i) => `Subject ${i} Lab`),
      ),
    ).toBe(false);
    expect(
      refusesDescriptionOnSharedPage(
        candidate({ sourceUrl: 'not a url' }),
        Array.from({ length: 50 }, (_, i) => `Subject ${i} Lab`),
      ),
    ).toBe(false);
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

describe('citersAreOneSubject', () => {
  it('reads a lab minted once per member as ONE subject, so its own page is not refused', () => {
    // This is the defect the citer count shipped: medicine.yale.edu/lab/decamilli is cited
    // by the real lab plus three member rows each minted as their own lab, so the count
    // read 3 foreign citers and refused the lab's own description.
    expect(
      citersAreOneSubject([
        'The De Camilli Lab',
        'De Camilli Lab',
        'De Camilli Lab',
        'De Camilli Lab',
      ]),
    ).toBe(true);
    expect(
      refusesDescriptionOnSharedPage(
        {
          entityType: OWNERSHIP_GUARDED_ENTITY_TYPE,
          field: 'fullDescription',
          sourceUrl: 'https://medicine.yale.edu/lab/decamilli/',
          ownName: 'The De Camilli Lab',
        },
        ['De Camilli Lab', 'De Camilli Lab', 'De Camilli Lab'],
      ),
    ).toBe(false);
  });

  it('still refuses a directory page whose citers share nothing', () => {
    expect(citersAreOneSubject(['Jing Du Research', 'Frank Detterbeck Research'])).toBe(false);
    expect(
      refusesDescriptionOnSharedPage(
        {
          entityType: OWNERSHIP_GUARDED_ENTITY_TYPE,
          field: 'fullDescription',
          sourceUrl: 'https://ysph.yale.edu/school-of-public-health-faculty/directory-name',
          ownName: 'Jing Du Research',
        },
        ['Frank Detterbeck Research', 'Kathleen Fenn Research'],
      ),
    ).toBe(true);
  });

  it('requires EVERY pair to share, so one lab plus an unrelated row is many subjects', () => {
    // A some-pair test would call this one subject because two of the three match.
    expect(citersAreOneSubject(['Flavell Lab', 'Flavell Lab', 'Bindra Lab'])).toBe(false);
  });

  it('ignores words that name no subject, so two different labs never match on "Lab"', () => {
    expect(citersAreOneSubject(['Alpha Lab', 'Beta Lab'])).toBe(false);
    expect(citersAreOneSubject(['Yale Research Program', 'Yale Research Program'])).toBe(false);
  });

  it('treats a nameless citer as unprovable, which refuses rather than serves', () => {
    // Failing toward refusing a description is the side a student is better off on.
    expect(citersAreOneSubject(['Flavell Lab', ''])).toBe(false);
  });

  it('is trivially true below two citers, so a single citer never refuses', () => {
    expect(citersAreOneSubject([])).toBe(true);
    expect(citersAreOneSubject(['Flavell Lab'])).toBe(true);
  });
});
