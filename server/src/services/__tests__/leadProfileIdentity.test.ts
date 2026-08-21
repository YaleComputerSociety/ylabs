import { describe, expect, it } from 'vitest';

import {
  detectProfileIdentityRisk,
  entityOfficialPersonProfileDestinations,
  isLikelyOfficialPersonProfileUrl,
  officialProfileUrlFromRosterEntry,
} from '../leadProfileIdentity';

describe('isLikelyOfficialPersonProfileUrl', () => {
  it('accepts specific Yale person profile paths and rejects generic lab or directory pages', () => {
    expect(isLikelyOfficialPersonProfileUrl('https://medicine.yale.edu/profile/jane-doe/')).toBe(
      true,
    );
    expect(isLikelyOfficialPersonProfileUrl('https://example.yale.edu/labs/example-lab')).toBe(
      false,
    );
    expect(isLikelyOfficialPersonProfileUrl('https://medicine.yale.edu/profile/')).toBe(false);
    expect(isLikelyOfficialPersonProfileUrl('https://not-yale.example.com/profile/jane-doe')).toBe(
      false,
    );
  });
});

describe('entityOfficialPersonProfileDestinations', () => {
  it('collects only the official person profile destinations from an entity', () => {
    const destinations = entityOfficialPersonProfileDestinations({
      websiteUrl: 'https://medicine.yale.edu/profile/jane-doe/',
      sourceUrls: ['https://example.yale.edu/labs/example-lab'],
    });
    expect([...destinations]).toEqual(['medicine.yale.edu/profile/jane-doe']);
  });
});

describe('officialProfileUrlFromRosterEntry', () => {
  it('prefers a verified Yale-official profile link', () => {
    expect(
      officialProfileUrlFromRosterEntry({
        profileLinks: [
          {
            kind: 'YALE_OFFICIAL',
            purpose: 'PRIMARY_IDENTITY',
            url: 'https://medicine.yale.edu/profile/john-smith/',
            verifiedAt: new Date(0),
            healthStatus: 'HEALTHY',
          },
        ],
      }),
    ).toBe('https://medicine.yale.edu/profile/john-smith/');
  });

  it('falls back to a person-profile websiteUrl and ignores non-profile sites', () => {
    expect(
      officialProfileUrlFromRosterEntry({
        websiteUrl: 'https://medicine.yale.edu/profile/john-smith/',
      }),
    ).toBe('https://medicine.yale.edu/profile/john-smith/');
    expect(
      officialProfileUrlFromRosterEntry({
        websiteUrl: 'https://example.yale.edu/labs/example-lab',
      }),
    ).toBe('');
  });
});

describe('detectProfileIdentityRisk', () => {
  const personDerivedEntity = {
    websiteUrl: 'https://medicine.yale.edu/profile/jane-doe/',
    sourceUrls: ['https://medicine.yale.edu/profile/jane-doe/'],
  };

  it('flags a person-derived entity whose lead profile does not match', () => {
    expect(
      detectProfileIdentityRisk({
        entity: personDerivedEntity,
        leadMembers: [
          { user: { profileUrls: { official: 'https://medicine.yale.edu/profile/john-smith/' } } },
        ],
      }),
    ).toBe(true);
  });

  it('does not flag when a lead profile matches the entity identity', () => {
    expect(
      detectProfileIdentityRisk({
        entity: personDerivedEntity,
        leadMembers: [
          { user: { profileUrls: { official: 'https://medicine.yale.edu/profile/jane-doe/' } } },
        ],
      }),
    ).toBe(false);
  });

  it('does not flag without any lead profile evidence', () => {
    expect(
      detectProfileIdentityRisk({
        entity: personDerivedEntity,
        leadMembers: [{ user: { fname: 'Jane', lname: 'Doe' } }],
      }),
    ).toBe(false);
  });

  it('does not flag entities whose identity is not a person profile', () => {
    expect(
      detectProfileIdentityRisk({
        entity: { websiteUrl: 'https://example.yale.edu/labs/example-lab' },
        leadMembers: [
          { user: { profileUrls: { official: 'https://medicine.yale.edu/profile/john-smith/' } } },
        ],
      }),
    ).toBe(false);
  });
});
