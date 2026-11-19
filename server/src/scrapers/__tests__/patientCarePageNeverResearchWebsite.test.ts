import { describe, expect, it } from 'vitest';

import {
  isPromotableWebsiteUrl,
  isUnservableWebsiteUrl,
  resolveBackfillWebsiteUrl,
} from '../../scripts/backfillResearchEntityWebsiteUrlsCore';
import { isClinicalDirectoryUrl } from '../../scripts/findLabWebsitesCore';
import { publicResearchDetailGroup } from '../../services/researchGroupService';
import { toPublicResearchEntityDto } from '../../services/researchEntityDto';
import { NO_SURNAME_ROSTER } from '../../utils/researchHomeNameIdentityAuthority';
import {
  isPatientCarePageUrl,
  researchHomeWebsiteUrlWriteRefusal,
  sourceUrlToResearchHomeWebsiteUrl,
} from '../../utils/researchHomeWebsiteUrl';
import { planRefusedStoredWebsiteUrlClear } from '../refusedStoredWebsiteUrl';
import {
  extractProfile,
  facultyToResearchEntityObservations,
  type RawYsmFaculty,
} from '../sources/ysmFacultyDirectoryScraper';

const FACULTY_ROW = { entityType: 'FACULTY_RESEARCH_AREA', kind: 'individual' };
const LAB_ROW = { entityType: 'LAB', kind: 'lab' };

const CLINICAL_DEPARTMENT_PAGE = 'https://www.yalemedicine.org/departments/fixture-care-center';
const PATIENT_PROGRAM_PAGE = 'https://medicine.yale.edu/fixturecenter/patient/programs/fixture/';
const PATIENT_CONDITION_PAGE =
  'https://medicine.yale.edu/fixturedept/patient/conditions/fixture-condition.aspx';
const LAB_SITE = 'https://medicine.yale.edu/lab/fixture/';

describe('a patient-care page is recognised by shape (#5364)', () => {
  it.each([
    CLINICAL_DEPARTMENT_PAGE,
    'https://yalemedicine.org/conditions/fixture-condition',
    'https://www.ynhh.org/fixture-hospital/services/fixture-care',
    'https://fixture.ynhhs.org/fixture-service',
    PATIENT_PROGRAM_PAGE,
    PATIENT_CONDITION_PAGE,
    'https://medicine.yale.edu/fixturecenter/patient/specialty/fixture-program/',
    'https://fixturedept.yale.edu/care/services/fixture.aspx',
  ])('recognises %s', (url) => {
    expect(isPatientCarePageUrl(url)).toBe(true);
  });

  it.each([
    LAB_SITE,
    'https://medicine.yale.edu/lab/clinical-fixture/',
    'https://medicine.yale.edu/fixturedept/research/clinics-and-programs/fixture/',
    'https://medicine.yale.edu/fixturedept/research/clinical-innovations/fixture-lab/',
    'https://medicine.yale.edu/fixturedept/services/community-programs/fixture-program/',
    'https://medicine.yale.edu/fixturedept/patient-oriented-research/fixture/',
    'https://fixturelab.yale.edu/',
    'https://notyalemedicine.org/fixture/',
    'not a url',
  ])('leaves %s alone', (url) => {
    expect(isPatientCarePageUrl(url)).toBe(false);
  });
});

describe('the shared resolver refuses a patient-care page as a research website', () => {
  it.each([CLINICAL_DEPARTMENT_PAGE, PATIENT_PROGRAM_PAGE, PATIENT_CONDITION_PAGE])(
    'refuses %s for a faculty research row and a lab, and blocks the write',
    (url) => {
      expect(researchHomeWebsiteUrlWriteRefusal(url, FACULTY_ROW)).toBe('patient-care-page');
      expect(researchHomeWebsiteUrlWriteRefusal(url, LAB_ROW)).toBe('patient-care-page');
      expect(sourceUrlToResearchHomeWebsiteUrl(url, FACULTY_ROW)).toBe('');
    },
  );

  it('leaves an organization row its own clinic page, the scope the umbrella-page rule uses', () => {
    expect(researchHomeWebsiteUrlWriteRefusal(PATIENT_PROGRAM_PAGE, { entityType: 'CENTER' })).toBe(
      null,
    );
  });

  it('keeps a research program page that sits under a clinical section', () => {
    const researchProgram =
      'https://medicine.yale.edu/fixturedept/research/clinics-and-programs/fixture/';
    expect(researchHomeWebsiteUrlWriteRefusal(researchProgram, FACULTY_ROW)).toBeNull();
  });

  it('plans a clear for a stored patient-care page on resolve', () => {
    expect(
      planRefusedStoredWebsiteUrlClear({
        stored: { websiteUrl: CLINICAL_DEPARTMENT_PAGE },
        identity: FACULTY_ROW,
        lockedFields: [],
      }),
    ).toEqual({ clear: true, refusal: 'patient-care-page', skipped: null });
  });

  it('is the same predicate the lab-site search uses to reject a clinical page', () => {
    expect(isClinicalDirectoryUrl(CLINICAL_DEPARTMENT_PAGE)).toBe(true);
    expect(isClinicalDirectoryUrl(PATIENT_PROGRAM_PAGE)).toBe(true);
  });
});

describe('the website backfill never promotes or keeps a patient-care page', () => {
  it('neither promotes one nor keeps a stored one', () => {
    expect(isPromotableWebsiteUrl(PATIENT_PROGRAM_PAGE, FACULTY_ROW)).toBe(false);
    expect(isUnservableWebsiteUrl(PATIENT_PROGRAM_PAGE, FACULTY_ROW)).toBe(true);
    expect(isUnservableWebsiteUrl(CLINICAL_DEPARTMENT_PAGE, LAB_ROW)).toBe(true);
  });

  it('clears a stored patient-care page when no research website is cited', () => {
    expect(
      resolveBackfillWebsiteUrl({
        ...FACULTY_ROW,
        websiteUrl: CLINICAL_DEPARTMENT_PAGE,
        sourceUrls: ['https://medicine.yale.edu/profile/fixture-person/', CLINICAL_DEPARTMENT_PAGE],
      }),
    ).toEqual({ action: 'clear' });
  });

  it('re-picks a cited lab site over a stored patient-care page', () => {
    expect(
      resolveBackfillWebsiteUrl({
        ...LAB_ROW,
        websiteUrl: PATIENT_PROGRAM_PAGE,
        sourceUrls: [PATIENT_PROGRAM_PAGE, LAB_SITE],
      }),
    ).toEqual({ action: 'set', websiteUrl: LAB_SITE });
  });

  it('does not fill an empty slot from a cited patient-care page', () => {
    expect(
      resolveBackfillWebsiteUrl({ ...FACULTY_ROW, sourceUrls: [PATIENT_CONDITION_PAGE] }),
    ).toEqual({ action: 'keep' });
  });
});

describe('the detail payload withholds a stored patient-care page', () => {
  const storedRow = (websiteUrl: string) => ({
    _id: 'entity-patient-care-website',
    slug: 'fixture-patient-care-website-row',
    name: 'Fixture Person Faculty Research',
    ...FACULTY_ROW,
    websiteUrl,
    sourceUrls: [LAB_SITE],
  });

  it('withholds it while the stored row waits for its resolve', () => {
    const served = toPublicResearchEntityDto(
      publicResearchDetailGroup(storedRow(CLINICAL_DEPARTMENT_PAGE)),
    ) as Record<string, unknown>;
    expect(served.websiteUrl).toBeUndefined();
  });

  it('serves a lab site on the same school host', () => {
    const served = toPublicResearchEntityDto(
      publicResearchDetailGroup(storedRow(LAB_SITE)),
    ) as Record<string, unknown>;
    expect(served.websiteUrl).toBe(LAB_SITE);
  });
});

describe('the YSM faculty directory lane never asserts a patient-care page as a website', () => {
  const FACULTY: RawYsmFaculty = {
    name: 'Person, Fixture',
    profileUrl: 'https://medicine.yale.edu/profile/fixture-person/',
    slug: 'fixture-person',
  };

  const profilePage = (labWebsite: { name: string; url: string }): string => {
    const sections = [
      { sectionType: 'about', bio: '', workdayTitle: 'Professor', appointments: [] },
      {
        sectionType: 'research',
        researchDescription: '<p>Studies fixture biology.</p>',
        meshKeywords: [],
        labWebsite,
        orcids: [],
      },
      { sectionType: 'getInTouch', email: '' },
    ];
    const pageData = {
      mainComponents: [{ key: 'ProfileDetails', model: { fullName: 'Fixture Person', sections } }],
    };
    return `<html><body><script id='page-data' type='application/json'>${JSON.stringify(
      pageData,
    )}</script></body></html>`;
  };

  const fieldsFor = (labWebsite: { name: string; url: string }) =>
    Object.fromEntries(
      facultyToResearchEntityObservations(
        extractProfile(profilePage(labWebsite), FACULTY)!,
        'ysm:fixture-person',
        NO_SURNAME_ROSTER,
      ).map((observation) => [observation.field, observation.value]),
    );

  it.each([
    ['Reproductive Care Center', CLINICAL_DEPARTMENT_PAGE],
    ['Lab Website', CLINICAL_DEPARTMENT_PAGE],
    ['Person Lab', PATIENT_CONDITION_PAGE],
  ])(
    'states the slot labelled %s linking %s as a refusal, and keeps the row faculty research',
    (name, url) => {
      const fields = fieldsFor({ name, url });
      expect(fields.websiteUrl).toBeUndefined();
      expect(fields.refusedWebsiteUrl).toBe(url);
      expect(fields.entityType).toBe('FACULTY_RESEARCH_AREA');
      expect(fields.name).toBe('Fixture Person Faculty Research');
      expect(fields.sourceUrls).toEqual([FACULTY.profileUrl]);
    },
  );

  it('still adopts a lab site from the same slot', () => {
    const fields = fieldsFor({ name: 'Person Lab', url: LAB_SITE });
    expect(fields.websiteUrl).toBe(LAB_SITE);
    expect(fields.entityType).toBe('LAB');
  });
});
