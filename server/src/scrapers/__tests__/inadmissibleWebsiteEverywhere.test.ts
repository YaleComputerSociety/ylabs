import { describe, expect, it } from 'vitest';

import {
  publicResearchDetailGroup,
  servableMemberWebsite,
} from '../../services/researchGroupService';
import { toPublicResearchEntityDto } from '../../services/researchEntityDto';
import { shouldIgnoreObservationForEntityMaterialization } from '../entityMaterializer';
import { planWithheldLegacyWebsiteClear } from '../refusedStoredWebsiteUrl';

const FACULTY_ROW = { entityType: 'FACULTY_RESEARCH_AREA', kind: 'individual' };
const PATIENT_CARE_PAGE = 'https://medicine.example.edu/fixturecenter/patient/programs/fixture/';
const COURSE_PAGE = 'https://fixturedept.example.edu/courses/fixture-anatomy';
const POSTING_PAGE = 'https://medicine.example.edu/lab/fixture/jobs/';
const PROFILE_PAGE = 'https://medicine.yale.edu/profile/fixture-quillsby-person/';
const LAB_SITE = 'https://medicine.example.edu/lab/fixture/';

describe('the legacy website field is cleared of what the payload withholds (#5376)', () => {
  it.each([PATIENT_CARE_PAGE, COURSE_PAGE, POSTING_PAGE])('clears a stored %s', (url) => {
    expect(
      planWithheldLegacyWebsiteClear({
        stored: { website: url },
        staged: {},
        identity: FACULTY_ROW,
        lockedFields: [],
      }),
    ).toEqual({ declineStaged: false, clearStored: true, skipped: null });
  });

  it('declines a resolved withheld value so a live observation cannot re-adopt it', () => {
    expect(
      planWithheldLegacyWebsiteClear({
        stored: { website: PATIENT_CARE_PAGE },
        staged: { website: PATIENT_CARE_PAGE },
        identity: FACULTY_ROW,
        lockedFields: [],
      }),
    ).toEqual({ declineStaged: true, clearStored: true, skipped: null });
  });

  it('keeps a stored withheld value when the pass stages an admissible one', () => {
    expect(
      planWithheldLegacyWebsiteClear({
        stored: { website: PATIENT_CARE_PAGE },
        staged: { website: LAB_SITE },
        identity: FACULTY_ROW,
        lockedFields: [],
      }),
    ).toEqual({ declineStaged: false, clearStored: false, skipped: null });
  });

  it('keeps a profile page, which the detail page reads as the lead profile link', () => {
    expect(
      planWithheldLegacyWebsiteClear({
        stored: { website: PROFILE_PAGE },
        staged: {},
        identity: FACULTY_ROW,
        lockedFields: [],
      }).clearStored,
    ).toBe(false);
  });

  it('keeps an organization row its own patient-care page', () => {
    expect(
      planWithheldLegacyWebsiteClear({
        stored: { website: PATIENT_CARE_PAGE },
        staged: {},
        identity: { entityType: 'CENTER' },
        lockedFields: [],
      }).clearStored,
    ).toBe(false);
  });

  it('honours a lock and reports it', () => {
    expect(
      planWithheldLegacyWebsiteClear({
        stored: { website: PATIENT_CARE_PAGE },
        staged: {},
        identity: FACULTY_ROW,
        lockedFields: ['website'],
      }),
    ).toEqual({ declineStaged: false, clearStored: false, skipped: 'field-is-locked' });
  });

  it('withholds a stored legacy website the same way in the detail payload', () => {
    const served = toPublicResearchEntityDto(
      publicResearchDetailGroup({
        _id: 'entity-legacy-website',
        slug: 'fixture-legacy-website-row',
        name: 'Fixture Quillsby Faculty Research',
        ...FACULTY_ROW,
        website: PATIENT_CARE_PAGE,
        sourceUrls: [LAB_SITE],
      }),
    ) as Record<string, unknown>;
    expect(served.website).toBeUndefined();
  });
});

describe("a lead's member website refuses course, posting and patient-care pages (#5376)", () => {
  it.each([PATIENT_CARE_PAGE, COURSE_PAGE, POSTING_PAGE])(
    'ignores a %s observed as a person website',
    (url) => {
      for (const field of ['website', 'websiteUrl']) {
        expect(
          shouldIgnoreObservationForEntityMaterialization('user', {
            field,
            sourceName: 'dept-faculty-roster',
            value: url,
          }),
        ).toBe(true);
      }
    },
  );

  it('still reads an ordinary personal website', () => {
    expect(
      shouldIgnoreObservationForEntityMaterialization('user', {
        field: 'website',
        sourceName: 'dept-faculty-roster',
        value: 'https://fixtureperson.example.org/',
      }),
    ).toBe(false);
  });

  it('serves the first candidate that is a person website, and nothing when none is', () => {
    expect(servableMemberWebsite(PATIENT_CARE_PAGE, LAB_SITE)).toBe(LAB_SITE);
    expect(servableMemberWebsite(COURSE_PAGE, POSTING_PAGE, PATIENT_CARE_PAGE)).toBeUndefined();
    expect(servableMemberWebsite(undefined, 'not a url')).toBeUndefined();
  });
});
