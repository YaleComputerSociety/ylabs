import { describe, expect, it } from 'vitest';
import { resolveResearchDetailActionLinkContext } from '../researchDetailActionLinks';
import {
  resolveDecisionProfileUrl,
  resolveOutreachApplySource,
  resolveOutreachOfficialSource,
  type ResearchDetailSource,
} from '../researchDetailSources';
import type { ResearchGroup } from '../../types/researchGroup';

const PATIENT_CARE_PAGE = 'https://medicine.example.edu/fixturecenter/patient/programs/fixture/';
const CLINICAL_HOST_PAGE = 'https://www.yalemedicine.org/departments/fixture-care-center';
const COURSE_PAGE = 'https://fixturedept.example.edu/courses/fixture-anatomy';
const POSTING_PAGE = 'https://fixturelab.example.org/positions/';
const LAB_SITE = 'https://medicine.example.edu/lab/fixture/';

const source = (url: string): ResearchDetailSource => ({
  url,
  label: 'Official source',
  contexts: ['Profile source'],
  isLikelyUnavailable: false,
  isPrivateNetworkOnly: false,
});

describe('the headline official-page action refuses the pages the server withholds (#5376)', () => {
  it.each([PATIENT_CARE_PAGE, CLINICAL_HOST_PAGE, COURSE_PAGE, POSTING_PAGE])(
    'does not offer %s as a faculty research row official page',
    (url) => {
      expect(
        resolveOutreachOfficialSource([source(url)], [], false, 'FACULTY_RESEARCH_AREA'),
      ).toBeUndefined();
    },
  );

  it('still offers a lab site', () => {
    expect(
      resolveOutreachOfficialSource([source(LAB_SITE)], [], false, 'FACULTY_RESEARCH_AREA')?.url,
    ).toBe(LAB_SITE);
  });

  it('offers an organization row its own patient-care page but never a course page', () => {
    expect(
      resolveOutreachOfficialSource([source(PATIENT_CARE_PAGE)], [], false, 'CENTER')?.url,
    ).toBe(PATIENT_CARE_PAGE);
    expect(
      resolveOutreachOfficialSource([source(COURSE_PAGE)], [], false, 'CENTER'),
    ).toBeUndefined();
  });

  it('still offers a lab its own vetted posting page as the place to apply', () => {
    expect(
      resolveOutreachApplySource([source(POSTING_PAGE)], [], false, 'LAB', {}, [], [POSTING_PAGE])
        ?.url,
    ).toBe(POSTING_PAGE);
  });

  it('never ranks a patient-care page as the lead profile action', () => {
    expect(
      resolveDecisionProfileUrl(undefined, {
        entityType: 'FACULTY_RESEARCH_AREA',
        sourceUrls: ['https://www.yalemedicine.org/profile/fixture-quillsby/'],
      }),
    ).toBeUndefined();
  });
});

describe('the website button refuses a stored page the server withholds (#5376)', () => {
  const contextFor = (websiteUrl: string, entityType: string) =>
    resolveResearchDetailActionLinkContext({
      group: {
        id: 'fixture-row',
        name: 'Fixture Quillsby Faculty Research',
        entityType,
        websiteUrl,
        sourceUrls: [],
      } as unknown as ResearchGroup,
      members: [],
    });

  it.each([PATIENT_CARE_PAGE, COURSE_PAGE, POSTING_PAGE])(
    'does not link %s as a faculty research row website',
    (url) => {
      expect(contextFor(url, 'FACULTY_RESEARCH_AREA').websiteUrl).toBeUndefined();
    },
  );

  it('links a lab site', () => {
    expect(contextFor(LAB_SITE, 'FACULTY_RESEARCH_AREA').websiteUrl).toBe(LAB_SITE);
  });
});
