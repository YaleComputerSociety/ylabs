import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  isCourseListingPageUrl,
  isCoursePageUrl,
  isInadmissiblePersonWebsiteUrl,
  isMapOrDirectionsUrl,
  isPatientCarePageUrl,
  isPostingPageUrl,
  isWithheldResearchWebsiteUrl,
} from '../researchHomeWebsiteUrl';

/**
 * Server half of the shared course, posting, patient-care and map or directions page contract
 * (#5376, #5657), and of the bare course listing only a person website refuses (#5860).
 *
 * See the client half in `client/src/utils/__tests__/inadmissibleWebsitePagesContract.test.ts`.
 */
const CONTRACT_PATH = path.resolve(
  __dirname,
  '../../../../contracts/inadmissibleWebsitePages.cases.json',
);

interface UrlCase {
  name: string;
  url: string;
}

type Category = 'patientCare' | 'course' | 'posting' | 'mapOrDirections';

const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8')) as Record<
  Category | 'courseListing',
  { refused: UrlCase[]; kept: UrlCase[] }
>;

const RULES: Record<Category, (url: string) => boolean> = {
  patientCare: isPatientCarePageUrl,
  course: isCoursePageUrl,
  posting: isPostingPageUrl,
  mapOrDirections: isMapOrDirectionsUrl,
};

const FACULTY_ROW = { entityType: 'FACULTY_RESEARCH_AREA', kind: 'individual' };

describe('inadmissible website page contract (server)', () => {
  (Object.keys(RULES) as Category[]).forEach((category) => {
    it(`covers every section of ${category}`, () => {
      expect(contract[category].refused.length).toBeGreaterThan(0);
      expect(contract[category].kept.length).toBeGreaterThan(0);
    });

    contract[category].refused.forEach((testCase) => {
      it(`refuses as ${category}: ${testCase.name}`, () => {
        expect(RULES[category](testCase.url)).toBe(true);
        expect(isInadmissiblePersonWebsiteUrl(testCase.url)).toBe(true);
        expect(isWithheldResearchWebsiteUrl(testCase.url, FACULTY_ROW)).toBe(true);
      });
    });

    contract[category].kept.forEach((testCase) => {
      it(`keeps as ${category}: ${testCase.name}`, () => {
        expect(RULES[category](testCase.url)).toBe(false);
        expect(isInadmissiblePersonWebsiteUrl(testCase.url)).toBe(false);
      });
    });
  });

  describe('courseListing', () => {
    it('covers every section of courseListing', () => {
      expect(contract.courseListing.refused.length).toBeGreaterThan(0);
      expect(contract.courseListing.kept.length).toBeGreaterThan(0);
    });

    contract.courseListing.refused.forEach((testCase) => {
      it(`refuses as a person website only: ${testCase.name}`, () => {
        expect(isCourseListingPageUrl(testCase.url)).toBe(true);
        expect(isInadmissiblePersonWebsiteUrl(testCase.url)).toBe(true);
        expect(isCoursePageUrl(testCase.url)).toBe(false);
      });
    });

    contract.courseListing.kept.forEach((testCase) => {
      it(`keeps as courseListing: ${testCase.name}`, () => {
        expect(isCourseListingPageUrl(testCase.url)).toBe(false);
        expect(isInadmissiblePersonWebsiteUrl(testCase.url)).toBe(false);
      });
    });
  });
});
