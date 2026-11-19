import { describe, expect, it } from 'vitest';
import { NO_SURNAME_ROSTER } from '../../utils/researchHomeNameIdentityAuthority';
import { rosterResearchEntityMint } from '../sources/departmentRosterScraper';
import { facultyToResearchEntityObservations as yseObservations } from '../sources/yseFacultyDirectoryScraper';
import { facultyToResearchEntityObservations as ysmObservations } from '../sources/ysmFacultyDirectoryScraper';
import {
  coLedGroupSiteFor,
  labUrlIsCoLedGroupSiteOf,
  type CoLedSiteIndex,
  type CoLedSiteLead,
} from '../utils/coLedGroupSites';

const GROUP_SITE = 'https://medicine.example.edu/lab/fixture-group/';
const GROUP_SITE_KEY = 'medicine.example.edu/lab/fixture-group';
const RIVERS_EMAIL = 'jordan.rivers@yale.edu';
const RIVERS_PROFILE = 'https://medicine.example.edu/profile/jordan-rivers/';

const lead = (email: string, profileUrlKey = ''): CoLedSiteLead => ({
  emails: [email],
  netids: [],
  profileUrlKeys: profileUrlKey ? [profileUrlKey] : [],
});

const RIVERS = lead(RIVERS_EMAIL, 'medicine.example.edu/profile/jordan-rivers');
const SLOAN = lead('avery.sloan@yale.edu');
const MORROW = lead('casey.morrow@yale.edu');

const indexWith = (slug: string, leads: CoLedSiteLead[]): CoLedSiteIndex =>
  new Map([[GROUP_SITE_KEY, [{ slug, leads }]]]);

const byField = (observations: Array<{ field: string; value?: unknown }>) =>
  Object.fromEntries(observations.map((observation) => [observation.field, observation.value]));

describe('labUrlIsCoLedGroupSiteOf', () => {
  const coLedWithRivers = indexWith('fixture-group', [RIVERS, SLOAN]);

  it('reads a site owned by a row the person co-leads with another person as a group site', () => {
    expect(
      labUrlIsCoLedGroupSiteOf(coLedWithRivers, GROUP_SITE, 'ysm-faculty-jordan-rivers', {
        email: RIVERS_EMAIL,
      }),
    ).toBe(true);
  });

  it('matches the person by official profile URL when the profile states no email', () => {
    expect(
      labUrlIsCoLedGroupSiteOf(
        coLedWithRivers,
        'http://www.medicine.example.edu/lab/fixture-group',
        'x',
        {
          profileUrl: RIVERS_PROFILE,
        },
      ),
    ).toBe(true);
  });

  it('leaves a single-lead row to the lane', () => {
    expect(
      labUrlIsCoLedGroupSiteOf(indexWith('fixture-group', [RIVERS]), GROUP_SITE, 'x', {
        email: RIVERS_EMAIL,
      }),
    ).toBe(false);
  });

  it('leaves a co-led row the person does not lead to the lane', () => {
    expect(
      labUrlIsCoLedGroupSiteOf(indexWith('fixture-group', [SLOAN, MORROW]), GROUP_SITE, 'x', {
        email: RIVERS_EMAIL,
      }),
    ).toBe(false);
  });

  it('never treats the row the lane mints for the person as the owner', () => {
    expect(
      labUrlIsCoLedGroupSiteOf(
        indexWith('ysm-faculty-jordan-rivers', [RIVERS, SLOAN]),
        GROUP_SITE,
        'ysm-faculty-jordan-rivers',
        { email: RIVERS_EMAIL },
      ),
    ).toBe(false);
  });
});

describe('ysm-faculty-directory on a co-led group site', () => {
  const profile = {
    name: 'Jordan Rivers',
    profileUrl: RIVERS_PROFILE,
    slug: 'jordan-rivers',
    email: RIVERS_EMAIL,
    departments: ['Neurology'],
    appointmentDepartments: ['Neurology'],
    researchAreas: ['Epilepsy'],
    labUrl: GROUP_SITE,
    labName: 'Rivers Lab/FG',
  };
  const mint = (index: CoLedSiteIndex) =>
    byField(
      ysmObservations(
        profile,
        'netid:jr1',
        NO_SURNAME_ROSTER,
        () => false,
        coLedGroupSiteFor(index, 'ysm-faculty-jordan-rivers', {
          email: profile.email,
          profileUrl: profile.profileUrl,
        }),
      ),
    );

  it('makes the person faculty research row and keeps the group site as its website', () => {
    const observed = mint(indexWith('fixture-group', [RIVERS, SLOAN]));
    expect(observed.entityType).toBe('FACULTY_RESEARCH_AREA');
    expect(observed.kind).toBe('individual');
    expect(observed.name).toBe('Jordan Rivers Faculty Research');
    expect(observed.websiteUrl).toBe(GROUP_SITE);
    expect(observed.sourceUrls).toEqual([RIVERS_PROFILE, GROUP_SITE]);
  });

  it('still mints the person own single-lead lab', () => {
    const observed = mint(indexWith('fixture-group', [RIVERS]));
    expect(observed.entityType).toBe('LAB');
    expect(observed.name).toBe('Rivers Lab/FG');
    expect(observed.websiteUrl).toBe(GROUP_SITE);
  });

  it('behaves as before on a co-led site the person does not lead', () => {
    const observed = mint(indexWith('fixture-group', [SLOAN, MORROW]));
    expect(observed.entityType).toBe('LAB');
    expect(observed.name).toBe('Rivers Lab/FG');
  });
});

describe('yse-faculty-directory on a co-led group site', () => {
  const profile = {
    name: 'Jordan Rivers',
    profileUrl: 'https://environment.example.edu/profile/jordan-rivers/',
    slug: 'jordan-rivers',
    email: RIVERS_EMAIL,
    researchAreas: [],
    programs: [],
    labUrl: GROUP_SITE,
  };
  const mint = (index: CoLedSiteIndex) =>
    byField(
      yseObservations(
        profile,
        'yse:jordan-rivers',
        () => 'usable',
        true,
        coLedGroupSiteFor(index, 'yse-faculty-jordan-rivers', { email: profile.email }),
      ),
    );

  it('re-reads the row as the person faculty research row with the group site kept', () => {
    const observed = mint(indexWith('fixture-group', [RIVERS, SLOAN]));
    expect(observed.entityType).toBe('FACULTY_RESEARCH_AREA');
    expect(observed.name).toBe('Jordan Rivers Faculty Research');
    expect(observed.websiteUrl).toBe(GROUP_SITE);
    expect(observed.sourceUrls).toEqual([profile.profileUrl, GROUP_SITE]);
  });

  it('still mints the person own single-lead lab', () => {
    const observed = mint(indexWith('fixture-group', [RIVERS]));
    expect(observed.entityType).toBe('LAB');
    expect(observed.name).toBe('Jordan Rivers Lab');
  });

  it('behaves as before on a co-led site the person does not lead', () => {
    expect(mint(indexWith('fixture-group', [SLOAN, MORROW])).entityType).toBe('LAB');
  });
});

describe('dept-faculty-roster on a co-led group site', () => {
  const dept = {
    deptKey: 'fixture',
    deptName: 'Fixture Studies',
    schoolName: 'Yale Faculty of Arts and Sciences',
    rosterUrl: 'https://fixture.example.edu/people/faculty',
  } as never;
  const entry = {
    name: 'Jordan Rivers',
    email: RIVERS_EMAIL,
    labUrl: GROUP_SITE,
    topics: ['Epilepsy'],
  };
  const mint = (index: CoLedSiteIndex) =>
    byField(
      rosterResearchEntityMint(
        entry,
        dept,
        'https://fixture.example.edu/people/faculty',
        'dept:fixture:jordan-rivers',
        () => false,
        coLedGroupSiteFor(index, 'dept-fixture-jordan-rivers', { email: entry.email }),
      ).observations,
    );

  it('makes the person faculty research row and keeps the group site as its website', () => {
    const observed = mint(indexWith('fixture-group', [RIVERS, SLOAN]));
    expect(observed.entityType).toBe('FACULTY_RESEARCH_AREA');
    expect(observed.name).toBe('Jordan Rivers Faculty Research');
    expect(observed.websiteUrl).toBe(GROUP_SITE);
  });

  it('still mints the person own single-lead lab', () => {
    const observed = mint(indexWith('fixture-group', [RIVERS]));
    expect(observed.entityType).toBe('LAB');
    expect(observed.name).toBe('Jordan Rivers Lab');
  });

  it('behaves as before on a co-led site the person does not lead', () => {
    expect(mint(indexWith('fixture-group', [SLOAN, MORROW])).entityType).toBe('LAB');
  });
});

describe('dept-faculty-roster on a co-led group site in a department without personal rows', () => {
  const dept = {
    deptKey: 'fixture',
    deptName: 'Fixture Studies',
    schoolName: 'Yale Faculty of Arts and Sciences',
    rosterUrl: 'https://fixture.example.edu/people/faculty',
    emitPersonalResearchEntities: false,
  } as never;
  const mint = (labUrl: string, index: CoLedSiteIndex) => {
    const entry = { name: 'Jordan Rivers', email: RIVERS_EMAIL, labUrl, topics: ['Epilepsy'] };
    return rosterResearchEntityMint(
      entry,
      dept,
      'https://fixture.example.edu/people/faculty',
      'dept:fixture:jordan-rivers',
      () => false,
      coLedGroupSiteFor(index, 'dept-fixture-jordan-rivers', { email: entry.email }),
    ).observations;
  };

  it('mints no personal row for a co-led site the link does not assert as a lab', () => {
    const plainSite = 'https://medicine.example.edu/research/fixture-collective/';
    const index: CoLedSiteIndex = new Map([
      [
        'medicine.example.edu/research/fixture-collective',
        [{ slug: 'fixture-group', leads: [RIVERS, SLOAN] }],
      ],
    ]);
    expect(mint(plainSite, index)).toEqual([]);
  });

  it('re-types the lab copy of a co-led site the link asserts as a lab', () => {
    const observed = byField(mint(GROUP_SITE, indexWith('fixture-group', [RIVERS, SLOAN])));
    expect(observed.entityType).toBe('FACULTY_RESEARCH_AREA');
    expect(observed.websiteUrl).toBe(GROUP_SITE);
  });
});
