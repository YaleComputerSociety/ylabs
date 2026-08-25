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

  it('rejects department roster/listing pages whose category segment is a hyphenated compound (#1203)', () => {
    expect(isLikelyOfficialPersonProfileUrl('https://ling.yale.edu/people/linguistics-faculty')).toBe(
      false,
    );
    expect(isLikelyOfficialPersonProfileUrl('https://english.yale.edu/people/ladder-faculty')).toBe(
      false,
    );
    expect(isLikelyOfficialPersonProfileUrl('https://french.yale.edu/people/professors')).toBe(
      false,
    );
    expect(
      isLikelyOfficialPersonProfileUrl(
        'https://english.yale.edu/people/tenured-and-tenure-track-faculty-assistant-professors/marta-figlerowicz',
      ),
    ).toBe(false);
  });

  it('rejects SOM faculty-directory subdiscipline listing pages but accepts real per-person pages (#1914)', () => {
    expect(
      isLikelyOfficialPersonProfileUrl(
        'https://som.yale.edu/faculty-research/faculty-directory/finance',
      ),
    ).toBe(false);
    expect(
      isLikelyOfficialPersonProfileUrl(
        'https://som.yale.edu/faculty-research/faculty-directory/economics',
      ),
    ).toBe(false);
    expect(
      isLikelyOfficialPersonProfileUrl(
        'https://som.yale.edu/faculty-research/faculty-directory/jordan-fixture',
      ),
    ).toBe(true);
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
          websiteUrl: 'https://medicine.yale.edu/profile/qz990/',
          sourceUrls: ['https://medicine.yale.edu/profile/qz990/'],
        },
        leadMembers: [{ user: { netid: 'ch51', fname: 'Casey', lname: 'Harper' } }],
      }),
    ).toBe(true);
  });

  it('corroborates a netid-slug profile home against the lead netid', () => {
    expect(
      detectProfileIdentityRisk({
        entity: {
          websiteUrl: 'https://medicine.yale.edu/profile/ch51/',
          sourceUrls: ['https://medicine.yale.edu/profile/ch51/'],
        },
        leadMembers: [{ user: { netid: 'ch51', fname: 'Casey', lname: 'Harper' } }],
      }),
    ).toBe(false);
  });

  it('does not flag when the lead official profile is the same person on a different host', () => {
    expect(
      detectProfileIdentityRisk({
        entity: {
          websiteUrl: 'https://medicine.yale.edu/profile/drew-fixture/',
          sourceUrls: ['https://medicine.yale.edu/profile/drew-fixture/'],
        },
        leadMembers: [
          {
            name: 'Drew Fixture',
            user: {
              netid: 'df42',
              profileUrls: { official: 'https://chem.yale.edu/profile/drew-fixture' },
            },
          },
        ],
      }),
    ).toBe(false);
  });

  it('does not flag when the lead full name corroborates despite a differently spelled profile slug', () => {
    expect(
      detectProfileIdentityRisk({
        entity: personDerivedEntity,
        leadMembers: [
          {
            name: 'Jane Doe',
            user: {
              netid: 'jd88',
              fname: 'Jane',
              lname: 'Doe',
              profileUrls: { official: 'https://chem.yale.edu/profile/jane-e-doe' },
            },
          },
        ],
      }),
    ).toBe(false);
  });

  it('flags a surname-only collision even when the lead carries no profile URL', () => {
    expect(
      detectProfileIdentityRisk({
        entity: {
          websiteUrl: 'https://medicine.yale.edu/profile/john-smith/',
          sourceUrls: ['https://medicine.yale.edu/profile/john-smith/'],
        },
        leadMembers: [{ user: { fname: 'Jane', lname: 'Smith' } }],
      }),
    ).toBe(true);
  });

  it('does not treat a lab landing page under /people/ as a contested person profile', () => {
    expect(
      detectProfileIdentityRisk({
        entity: {
          websiteUrl: 'https://campuspress.yale.edu/hive/people/the-avery-lab/',
        },
        leadMembers: [
          {
            name: 'Avery Lane',
            user: {
              netid: 'al88',
              profileUrls: {
                official: 'https://medicine.yale.edu/profile/avery-lane/',
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

  it('does not flag a CENTER whose websiteUrl resolves to an unrelated person profile', () => {
    expect(
      detectProfileIdentityRisk({
        entity: {
          entityType: 'CENTER',
          name: 'Whitney Humanities Center',
          websiteUrl: 'https://medicine.yale.edu/profile/john-smith/',
          sourceUrls: ['https://medicine.yale.edu/profile/john-smith/'],
        },
        leadMembers: [{ user: { fname: 'Jane', lname: 'Doe' } }],
      }),
    ).toBe(false);
  });

  it('does not flag INSTITUTE, INITIATIVE, CORE_FACILITY, or program-kind entities', () => {
    const orgLikeEntities = [
      { entityType: 'INSTITUTE' },
      { entityType: 'INITIATIVE' },
      { entityType: 'CORE_FACILITY' },
      { entityType: 'PROGRAM' },
      { kind: 'program' },
    ];
    for (const orgFields of orgLikeEntities) {
      expect(
        detectProfileIdentityRisk({
          entity: {
            ...orgFields,
            websiteUrl: 'https://medicine.yale.edu/profile/john-smith/',
            sourceUrls: ['https://medicine.yale.edu/profile/john-smith/'],
          },
          leadMembers: [{ user: { fname: 'Jane', lname: 'Doe' } }],
        }),
      ).toBe(false);
    }
  });

  it('still flags a person-derived entity with no entityType/kind override', () => {
    expect(
      detectProfileIdentityRisk({
        entity: personDerivedEntity,
        leadMembers: [
          { user: { profileUrls: { official: 'https://medicine.yale.edu/profile/john-smith/' } } },
        ],
      }),
    ).toBe(true);
  });

  it('corroborates a first-initial+surname slug with a static page extension (#1060)', () => {
    expect(
      detectProfileIdentityRisk({
        entity: {
          websiteUrl: 'https://exoplanets.astro.yale.edu/people/dfischer.php',
          sourceUrls: ['https://exoplanets.astro.yale.edu/people/dfischer.php'],
        },
        leadMembers: [{ user: { netid: 'df295', fname: 'Debra', lname: 'Fischer' } }],
      }),
    ).toBe(false);
  });

  it('corroborates a netid-slug profile home even when the page carries a file extension (#1060)', () => {
    expect(
      detectProfileIdentityRisk({
        entity: {
          websiteUrl: 'https://law.yale.edu/faculty/VSchultz.htm',
          sourceUrls: ['https://law.yale.edu/faculty/VSchultz.htm'],
        },
        leadMembers: [{ user: { netid: 'vschultz', fname: 'Vicki', lname: 'Schultz' } }],
      }),
    ).toBe(false);
  });

  it('corroborates a surname-only self-profile for a single unique lead (#1060)', () => {
    expect(
      detectProfileIdentityRisk({
        entity: {
          websiteUrl: 'https://environment.yale.edu/profile/graedel',
          sourceUrls: ['https://environment.yale.edu/profile/graedel'],
        },
        leadMembers: [{ user: { netid: 'teg5', fname: 'Thomas', lname: 'Graedel' } }],
      }),
    ).toBe(false);
  });

  it('corroborates an initials given name against the lead first name (#1060)', () => {
    expect(
      detectProfileIdentityRisk({
        entity: {
          websiteUrl: 'https://psychology.yale.edu/people/la-paul',
          sourceUrls: ['https://psychology.yale.edu/people/la-paul'],
        },
        leadMembers: [{ user: { netid: 'lap43', fname: 'Laurie', lname: 'Paul' } }],
      }),
    ).toBe(false);
  });

  it('corroborates a nickname-abbreviated given name against the lead first name (#1060)', () => {
    expect(
      detectProfileIdentityRisk({
        entity: {
          websiteUrl: 'https://politicalscience.yale.edu/people/douglas-rae',
          sourceUrls: ['https://politicalscience.yale.edu/people/douglas-rae'],
        },
        leadMembers: [{ user: { netid: 'dougrae', fname: 'Doug', lname: 'Rae' } }],
      }),
    ).toBe(false);
  });

  it('still flags a different given name sharing the surname despite the abbreviation rules (#1060)', () => {
    expect(
      detectProfileIdentityRisk({
        entity: {
          websiteUrl: 'https://politicalscience.yale.edu/people/mary-rae',
          sourceUrls: ['https://politicalscience.yale.edu/people/mary-rae'],
        },
        leadMembers: [{ user: { netid: 'dougrae', fname: 'Doug', lname: 'Rae' } }],
      }),
    ).toBe(true);
  });

  it('does not flag a correctly-attached PI whose only resolvable destination is a department roster page (#1203)', () => {
    expect(
      detectProfileIdentityRisk({
        entity: {
          websiteUrl: 'http://campuspress.yale.edu/jasonshaw/',
          sourceUrls: [
            'https://ling.yale.edu/people/linguistics-faculty',
            'http://campuspress.yale.edu/jasonshaw/',
          ],
        },
        leadMembers: [{ user: { netid: 'jas454', fname: 'Jason', lname: 'Shaw' } }],
      }),
    ).toBe(false);
  });

  it('does not clear a surname-only slug when a competing same-surname lead exists (#1060)', () => {
    expect(
      detectProfileIdentityRisk({
        entity: {
          websiteUrl: 'https://environment.yale.edu/profile/graedel',
          sourceUrls: ['https://environment.yale.edu/profile/graedel'],
        },
        leadMembers: [
          { user: { netid: 'teg5', fname: 'Thomas', lname: 'Graedel' } },
          { user: { netid: 'abg9', fname: 'Alice', lname: 'Graedel' } },
        ],
      }),
    ).toBe(true);
  });

  it('is neutral on a faculty-directory subdiscipline listing URL, not a person profile (#1914)', () => {
    expect(
      detectProfileIdentityRisk({
        entity: {
          name: 'Fixture Faculty - Research',
          websiteUrl: 'https://som.yale.edu/faculty-research/faculty-directory/finance',
          sourceUrls: ['https://som.yale.edu/faculty-research/faculty-directory/finance'],
        },
        leadMembers: [{ user: { netid: 'ff123', fname: 'Fixture', lname: 'Faculty' } }],
      }),
    ).toBe(false);
    for (const subdiscipline of [
      'accounting',
      'economics',
      'marketing',
      'operations',
      'organizational-behavior',
    ]) {
      expect(
        detectProfileIdentityRisk({
          entity: {
            websiteUrl: `https://som.yale.edu/faculty-research/faculty-directory/${subdiscipline}`,
            sourceUrls: [`https://som.yale.edu/faculty-research/faculty-directory/${subdiscipline}`],
          },
          leadMembers: [{ user: { netid: 'ff123', fname: 'Fixture', lname: 'Faculty' } }],
        }),
      ).toBe(false);
    }
  });

  it('still flags a genuinely conflicting person-profile URL under faculty-directory (#1914)', () => {
    expect(
      detectProfileIdentityRisk({
        entity: {
          websiteUrl: 'https://som.yale.edu/faculty-research/faculty-directory/jordan-fixture',
          sourceUrls: ['https://som.yale.edu/faculty-research/faculty-directory/jordan-fixture'],
        },
        leadMembers: [{ user: { netid: 'ff123', fname: 'Fixture', lname: 'Faculty' } }],
      }),
    ).toBe(true);
  });
});
