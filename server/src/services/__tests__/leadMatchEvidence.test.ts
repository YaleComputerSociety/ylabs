import { describe, expect, it } from 'vitest';
import {
  EMPTY_LEAD_MATCH_EVIDENCE,
  foldedProfileDestinationsFromRecords,
  pageOrcidByDestinationFromStatements,
  type LeadMatchEvidence,
} from '../leadMatchEvidence';
import { entityOfficialPersonProfileDestinations } from '../leadProfileIdentity';
import { researchDetailLeadIdentity } from '../researchGroupService';

const LEAD_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const UNRELATED_ID = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const LEAD_ORCID = '9999-9999-9999-9994';
const OTHER_ORCID = '9999-9999-9999-9986';
const THIRD_ORCID = '9999-9999-9999-9978';
const SCHOOL_A_PROFILE = 'https://medicine.yale.edu/profile/fixture-lead/';
const SCHOOL_B_PROFILE =
  'https://engineering.yale.edu/research-and-faculty/faculty-directory/fixture-lead';

const initiative = {
  entityType: 'INITIATIVE',
  name: 'Fixture Atlas Initiative',
  sourceUrls: [SCHOOL_A_PROFILE],
};
const destinations = entityOfficialPersonProfileDestinations(initiative);

const leadOnSchoolB = (orcid?: string) => [
  {
    role: 'pi',
    user: {
      displayName: 'Fixture Lead',
      profileUrls: { official: SCHOOL_B_PROFILE },
      ...(orcid ? { orcid } : {}),
    },
    row: { identityKey: LEAD_ID },
  },
];

const evidence = (overrides: Partial<LeadMatchEvidence>): LeadMatchEvidence => ({
  ...EMPTY_LEAD_MATCH_EVIDENCE,
  ...overrides,
});

describe('lead match evidence (#5970)', () => {
  it('drops the lead key when the lead only holds another school official profile', () => {
    expect(researchDetailLeadIdentity(initiative, leadOnSchoolB())).toEqual({
      leadIdentityStatus: 'verified',
    });
  });

  it('matches the lead through the official profile of a record folded into it', () => {
    const folded = foldedProfileDestinationsFromRecords(
      [
        {
          dedupedIntoResearcherId: LEAD_ID,
          profileLinks: [{ kind: 'YALE_OFFICIAL', url: SCHOOL_A_PROFILE }],
        },
      ],
      new Set([LEAD_ID]),
    );
    const identity = researchDetailLeadIdentity(
      initiative,
      leadOnSchoolB(),
      evidence({ foldedProfileDestinationsByLeadId: folded }),
    );
    expect(identity.leadIdentityStatus).toBe('verified');
    expect(identity.leadProfessorPublicKey).toEqual(expect.any(String));
  });

  it('does not match through a profile folded into a different researcher', () => {
    const folded = foldedProfileDestinationsFromRecords(
      [
        {
          dedupedIntoResearcherId: UNRELATED_ID,
          profileLinks: [{ kind: 'YALE_OFFICIAL', url: SCHOOL_A_PROFILE }],
        },
      ],
      new Set([LEAD_ID]),
    );
    const pageOrcids = pageOrcidByDestinationFromStatements(
      [{ sourceUrl: SCHOOL_A_PROFILE, value: OTHER_ORCID }],
      destinations,
    );
    expect(
      researchDetailLeadIdentity(
        initiative,
        leadOnSchoolB(LEAD_ORCID),
        evidence({ foldedProfileDestinationsByLeadId: folded, pageOrcidByDestination: pageOrcids }),
      ),
    ).toEqual({ leadIdentityStatus: 'verified' });
  });

  it('matches the lead when the destination page states only the lead ORCID', () => {
    const pageOrcids = pageOrcidByDestinationFromStatements(
      [{ sourceUrl: SCHOOL_A_PROFILE, value: `https://orcid.org/${LEAD_ORCID}` }],
      destinations,
    );
    const identity = researchDetailLeadIdentity(
      initiative,
      leadOnSchoolB(LEAD_ORCID),
      evidence({ pageOrcidByDestination: pageOrcids }),
    );
    expect(identity.leadProfessorPublicKey).toEqual(expect.any(String));
  });

  it('does not match when the destination page states another person ORCID', () => {
    const pageOrcids = pageOrcidByDestinationFromStatements(
      [{ sourceUrl: SCHOOL_A_PROFILE, value: OTHER_ORCID }],
      destinations,
    );
    expect(
      researchDetailLeadIdentity(
        initiative,
        leadOnSchoolB(LEAD_ORCID),
        evidence({ pageOrcidByDestination: pageOrcids }),
      ),
    ).toEqual({ leadIdentityStatus: 'verified' });
  });

  it('refuses a page that states several ORCIDs, even when one is the lead ORCID', () => {
    const pageOrcids = pageOrcidByDestinationFromStatements(
      [
        { sourceUrl: SCHOOL_A_PROFILE, value: LEAD_ORCID },
        { sourceUrl: SCHOOL_A_PROFILE.replace('https://', 'http://'), value: THIRD_ORCID },
      ],
      destinations,
    );
    expect(pageOrcids.size).toBe(0);
    expect(
      researchDetailLeadIdentity(
        initiative,
        leadOnSchoolB(LEAD_ORCID),
        evidence({ pageOrcidByDestination: pageOrcids }),
      ),
    ).toEqual({ leadIdentityStatus: 'verified' });
  });

  it('keeps statements for pages that are not this row destination out of the evidence', () => {
    const pageOrcids = pageOrcidByDestinationFromStatements(
      [{ sourceUrl: SCHOOL_B_PROFILE, value: LEAD_ORCID }],
      destinations,
    );
    expect(pageOrcids.size).toBe(0);
  });

  it('derives the same answer when run twice over the same evidence', () => {
    const records = [
      {
        dedupedIntoResearcherId: LEAD_ID,
        profileLinks: [{ kind: 'YALE_OFFICIAL', url: SCHOOL_A_PROFILE }],
      },
    ];
    const run = () =>
      researchDetailLeadIdentity(
        initiative,
        leadOnSchoolB(),
        evidence({
          foldedProfileDestinationsByLeadId: foldedProfileDestinationsFromRecords(
            records,
            new Set([LEAD_ID]),
          ),
        }),
      );
    const first = run();
    expect(run()).toEqual(first);
    expect(first.leadProfessorPublicKey).toEqual(expect.any(String));
    expect(records[0].profileLinks).toHaveLength(1);
  });
});
