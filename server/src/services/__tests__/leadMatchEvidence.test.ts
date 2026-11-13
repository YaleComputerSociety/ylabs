import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  orcidStatements: [] as Array<{ sourceUrl: string; value: string }>,
  foldedRecords: [] as Array<{ dedupedIntoResearcherId: string; profileLinks: unknown[] }>,
  observationQueries: [] as Array<{ sourceUrl: { $in: unknown[] } }>,
  researcherQueries: 0,
}));

vi.mock('../../models/observation', () => ({
  Observation: {
    find: (query: { sourceUrl: { $in: unknown[] } }) => {
      store.observationQueries.push(query);
      const matches = store.orcidStatements.filter((statement) =>
        query.sourceUrl.$in.includes(statement.sourceUrl),
      );
      return { select: () => ({ lean: async () => matches }) };
    },
  },
}));

vi.mock('../../models/researcher', () => ({
  Researcher: {
    find: () => {
      store.researcherQueries += 1;
      return { select: () => ({ lean: async () => store.foldedRecords }) };
    },
  },
}));

import {
  EMPTY_LEAD_MATCH_EVIDENCE,
  foldedProfileDestinationsFromRecords,
  loadLeadMatchEvidence,
  pageOrcidByDestinationFromStatements,
  type LeadMatchEvidence,
} from '../leadMatchEvidence';
import { entityOfficialPersonProfileDestinations } from '../leadProfileIdentity';
import {
  researchDetailLeadIdentity,
  resolveResearchDetailLeadIdentity,
} from '../researchGroupService';
import { syntheticPersonOrcid } from '../../test/syntheticOrcid';

const SYNTHETIC_ORCID_1 = syntheticPersonOrcid(500);
const SYNTHETIC_ORCID_2 = syntheticPersonOrcid(501);
const SYNTHETIC_ORCID_3 = syntheticPersonOrcid(502);

const LEAD_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const UNRELATED_ID = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const LEAD_ORCID = SYNTHETIC_ORCID_1;
const OTHER_ORCID = SYNTHETIC_ORCID_2;
const THIRD_ORCID = SYNTHETIC_ORCID_3;
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
  beforeEach(() => {
    store.orcidStatements.length = 0;
    store.foldedRecords.length = 0;
    store.observationQueries.length = 0;
    store.researcherQueries = 0;
  });

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

  it('loads a page ORCID stored under the root profile when the row cites a section alias', async () => {
    store.orcidStatements.push({ sourceUrl: SCHOOL_A_PROFILE, value: LEAD_ORCID });
    const sectionCitingRow = {
      ...initiative,
      sourceUrls: ['https://medicine.yale.edu/fixture-section/profile/fixture-lead'],
    };
    const leads = leadOnSchoolB(LEAD_ORCID);
    const loaded = await loadLeadMatchEvidence(sectionCitingRow, leads);
    const identity = researchDetailLeadIdentity(sectionCitingRow, leads, loaded);
    expect(identity.leadProfessorPublicKey).toEqual(expect.any(String));
  });

  it('does not load an ORCID stored under a different profile page on the same site', async () => {
    store.orcidStatements.push({
      sourceUrl: 'https://medicine.yale.edu/profile/fixture-lead-other/',
      value: LEAD_ORCID,
    });
    const loaded = await loadLeadMatchEvidence(initiative, leadOnSchoolB(LEAD_ORCID));
    expect(loaded.pageOrcidByDestination.size).toBe(0);
  });

  it('looks up page ORCIDs by exact stored URL spellings, never by a pattern', async () => {
    await loadLeadMatchEvidence(initiative, leadOnSchoolB(LEAD_ORCID));
    expect(store.observationQueries).toHaveLength(1);
    const spellings = store.observationQueries[0].sourceUrl.$in;
    expect(spellings.every((value) => typeof value === 'string')).toBe(true);
    expect(spellings).toContain(SCHOOL_A_PROFILE);
    expect(
      spellings.every((value) => String(value).includes('medicine.yale.edu/profile/fixture-lead')),
    ).toBe(true);
  });

  it('issues no extra query when the lead matches the row through its own official profile', async () => {
    const leadOnSchoolA = [
      {
        role: 'pi',
        user: {
          displayName: 'Fixture Lead',
          profileUrls: { official: SCHOOL_A_PROFILE },
          orcid: LEAD_ORCID,
        },
        row: { identityKey: LEAD_ID },
      },
    ];
    const identity = await resolveResearchDetailLeadIdentity(initiative, leadOnSchoolA);
    expect(identity.leadProfessorPublicKey).toEqual(expect.any(String));
    expect(store.observationQueries).toHaveLength(0);
    expect(store.researcherQueries).toBe(0);
  });

  it('keeps the lead of a row whose evidence names a profile folded into the lead', async () => {
    store.foldedRecords.push({
      dedupedIntoResearcherId: LEAD_ID,
      profileLinks: [{ kind: 'YALE_OFFICIAL', url: SCHOOL_A_PROFILE }],
    });
    const identity = await resolveResearchDetailLeadIdentity(initiative, leadOnSchoolB());
    expect(identity.leadProfessorPublicKey).toEqual(expect.any(String));
    expect(store.researcherQueries).toBe(1);
  });

  it('serves no lead key when a second lead matches the row only through a folded record', async () => {
    const secondLeadSchoolAProfile = 'https://medicine.yale.edu/profile/fixture-second-lead/';
    const twoLeadRow = {
      ...initiative,
      sourceUrls: [SCHOOL_A_PROFILE, secondLeadSchoolAProfile],
    };
    const twoLeads = [
      {
        role: 'pi',
        user: { displayName: 'Fixture Lead', profileUrls: { official: SCHOOL_A_PROFILE } },
        row: { identityKey: LEAD_ID },
      },
      {
        role: 'pi',
        user: {
          displayName: 'Fixture Second Lead',
          profileUrls: {
            official:
              'https://engineering.yale.edu/research-and-faculty/faculty-directory/fixture-second-lead',
          },
        },
        row: { identityKey: UNRELATED_ID },
      },
    ];
    store.foldedRecords.push({
      dedupedIntoResearcherId: UNRELATED_ID,
      profileLinks: [{ kind: 'YALE_OFFICIAL', url: secondLeadSchoolAProfile }],
    });
    expect(await resolveResearchDetailLeadIdentity(twoLeadRow, twoLeads)).toEqual({
      leadIdentityStatus: 'verified',
    });
  });

  it('serves no lead key when neither the fold nor the page vouches for the lead', async () => {
    store.foldedRecords.push({
      dedupedIntoResearcherId: UNRELATED_ID,
      profileLinks: [{ kind: 'YALE_OFFICIAL', url: SCHOOL_A_PROFILE }],
    });
    store.orcidStatements.push({ sourceUrl: SCHOOL_A_PROFILE, value: OTHER_ORCID });
    expect(await resolveResearchDetailLeadIdentity(initiative, leadOnSchoolB(LEAD_ORCID))).toEqual({
      leadIdentityStatus: 'verified',
    });
  });
});
