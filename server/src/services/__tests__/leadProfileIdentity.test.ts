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

  it('does not flag when the lead directory name corroborates the profile home', () => {
    expect(
      detectProfileIdentityRisk({
        entity: personDerivedEntity,
        leadMembers: [{ user: { fname: 'Jane', lname: 'Doe' } }],
      }),
    ).toBe(false);
  });

  it('flags when the profile home is a different person than a lead with no profile URL', () => {
    expect(
      detectProfileIdentityRisk({
        entity: {
          websiteUrl: 'https://medicine.yale.edu/profile/mog8/',
          sourceUrls: ['https://medicine.yale.edu/profile/mog8/'],
        },
        leadMembers: [{ user: { netid: 'mjg24', fname: 'Mark', lname: 'Graham' } }],
      }),
    ).toBe(true);
  });

  it('corroborates a netid-slug profile home against the lead netid', () => {
    expect(
      detectProfileIdentityRisk({
        entity: {
          websiteUrl: 'https://medicine.yale.edu/profile/mjg24/',
          sourceUrls: ['https://medicine.yale.edu/profile/mjg24/'],
        },
        leadMembers: [{ user: { netid: 'mjg24', fname: 'Mark', lname: 'Graham' } }],
      }),
    ).toBe(false);
  });

  it('does not flag when the lead official profile is the same person on a different host', () => {
    expect(
      detectProfileIdentityRisk({
        entity: {
          websiteUrl: 'https://medicine.yale.edu/profile/james-mayer/',
          sourceUrls: ['https://medicine.yale.edu/profile/james-mayer/'],
        },
        leadMembers: [
          {
            name: 'James Mayer',
            user: {
              netid: 'jmm362',
              profileUrls: { official: 'https://chem.yale.edu/profile/james-mayer' },
            },
          },
        ],
      }),
    ).toBe(false);
  });

  it('does not treat a lab landing page under /people/ as a contested person profile', () => {
    expect(
      detectProfileIdentityRisk({
        entity: {
          websiteUrl: 'https://campuspress.yale.edu/squirrel/people/the-bagriantsev-lab/',
        },
        leadMembers: [
          {
            name: 'Sviatoslav Bagriantsev',
            user: {
              netid: 'sb864',
              profileUrls: {
                official: 'https://medicine.yale.edu/profile/sviatoslav-bagriantsev/',
              },
            },
          },
        ],
      }),
    ).toBe(false);
  });

  it('does not flag without any resolvable lead identity', () => {
    expect(
      detectProfileIdentityRisk({
        entity: personDerivedEntity,
        leadMembers: [{ user: {} }],
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
