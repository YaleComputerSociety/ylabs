import { describe, expect, it } from 'vitest';

import {
  coreFacilityWebsiteKeys,
  isCoreFacilityWebsite,
  withoutCoreFacilityCitationsOnPersonRow,
  withoutCoreFacilityPagesOnPersonRow,
  withoutCoreFacilityPersonWebsiteObservations,
} from '../coreFacilityWebsites';
import {
  isCoreFacilityPageCitedByPerson,
  isWithheldResearchWebsiteUrl,
  researchHomeWebsiteUrlWriteRefusal,
} from '../../utils/researchHomeWebsiteUrl';

const FACILITY_PAGE = 'https://medicine.example.edu/fixture-core/fixture-imaging-facility/';
const PROFILE_PAGE = 'https://medicine.yale.edu/profile/fixture-quillsby-person/';
const LAB_SITE = 'https://fixturelab.example.org/';
const KEYS = coreFacilityWebsiteKeys([{ websiteUrl: FACILITY_PAGE }]);
const PERSON_ROW = { entityType: 'FACULTY_RESEARCH_AREA', kind: 'individual' };

describe('a core facility page cited by a person row (#5788)', () => {
  it('matches the facility page however the citation spells it', () => {
    for (const spelling of [
      FACILITY_PAGE,
      'https://www.medicine.example.edu/fixture-core/fixture-imaging-facility',
      'http://MEDICINE.example.edu/Fixture-Core/fixture-imaging-facility/',
    ]) {
      expect(isCoreFacilityWebsite(spelling, KEYS)).toBe(true);
    }
    expect(isCoreFacilityWebsite('https://medicine.example.edu/fixture-core/', KEYS)).toBe(false);
  });

  it('refuses it as a person row website, through the write gate and the withheld set', () => {
    const identity = { ...PERSON_ROW, coreFacilityWebsiteKeys: KEYS };
    expect(researchHomeWebsiteUrlWriteRefusal(FACILITY_PAGE, identity)).toBe(
      'core-facility-page-cited-by-person',
    );
    expect(isWithheldResearchWebsiteUrl(FACILITY_PAGE, identity)).toBe(true);
    expect(researchHomeWebsiteUrlWriteRefusal(LAB_SITE, identity)).toBeNull();
  });

  it('leaves the facility row its own website, and a lab or center the page it cites', () => {
    for (const row of [
      { entityType: 'CORE_FACILITY', kind: 'core_facility' },
      { entityType: 'LAB', kind: 'lab' },
      { entityType: 'CENTER', kind: 'center' },
    ]) {
      expect(
        isCoreFacilityPageCitedByPerson(FACILITY_PAGE, { ...row, coreFacilityWebsiteKeys: KEYS }),
      ).toBe(false);
    }
  });

  it('cannot fire without the facility set, so serve-time callers are unchanged', () => {
    expect(isCoreFacilityPageCitedByPerson(FACILITY_PAGE, PERSON_ROW)).toBe(false);
    expect(researchHomeWebsiteUrlWriteRefusal(FACILITY_PAGE, PERSON_ROW)).toBeNull();
  });

  it('takes the facility page out of a person row citation list and keeps the rest', () => {
    const observations = [
      { field: 'sourceUrls', value: [PROFILE_PAGE, FACILITY_PAGE] },
      { field: 'sourceUrls', value: [FACILITY_PAGE] },
      { field: 'websiteUrl', value: FACILITY_PAGE },
      { field: 'website', value: FACILITY_PAGE },
      { field: 'websiteUrl', value: LAB_SITE },
      { field: 'name', value: FACILITY_PAGE },
    ];
    expect(withoutCoreFacilityCitationsOnPersonRow(observations, PERSON_ROW, KEYS)).toEqual([
      { field: 'sourceUrls', value: [PROFILE_PAGE] },
      { field: 'websiteUrl', value: LAB_SITE },
      { field: 'name', value: FACILITY_PAGE },
    ]);
  });

  it('leaves the facility row observations as they are', () => {
    const observations = [
      { field: 'websiteUrl', value: FACILITY_PAGE },
      { field: 'sourceUrls', value: [FACILITY_PAGE] },
    ];
    expect(
      withoutCoreFacilityCitationsOnPersonRow(
        observations,
        { entityType: 'CORE_FACILITY', kind: 'core_facility' },
        KEYS,
      ),
    ).toEqual(observations);
  });

  it('drops a stored facility citation from a person row and is a no-op the second time', () => {
    const identity = { ...PERSON_ROW, coreFacilityWebsiteKeys: KEYS };
    const once = withoutCoreFacilityPagesOnPersonRow([PROFILE_PAGE, FACILITY_PAGE], identity);
    expect(once).toEqual([PROFILE_PAGE]);
    expect(withoutCoreFacilityPagesOnPersonRow(once, identity)).toEqual(once);
  });

  it("ignores a person's own website observation naming a facility page", () => {
    const observations = [
      { field: 'website', value: FACILITY_PAGE },
      { field: 'websiteUrl', value: LAB_SITE },
      { field: 'title', value: 'Professor of Fixtures' },
    ];
    expect(withoutCoreFacilityPersonWebsiteObservations(observations, KEYS)).toEqual([
      { field: 'websiteUrl', value: LAB_SITE },
      { field: 'title', value: 'Professor of Fixtures' },
    ]);
    expect(withoutCoreFacilityPersonWebsiteObservations(observations, new Set())).toEqual(
      observations,
    );
  });
});
