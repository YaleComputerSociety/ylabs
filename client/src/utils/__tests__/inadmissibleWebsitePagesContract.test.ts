import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import {
  isCoursePageSourceUrl,
  isMapOrPublicityPageSourceUrl,
  isPatientCarePageSourceUrl,
  isPostingPageSourceUrl,
  isRefusedResearchWebsitePageUrl,
} from '../researchDetailSources';

/**
 * Client half of the shared course, posting, patient-care and map or directions page contract
 * (#5376, #5657), and of the bare course listing only a person website refuses (#5860).
 *
 * See the server half in `server/src/utils/__tests__/inadmissibleWebsitePagesContract.test.ts`.
 */
const __contractDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../contracts',
);

const CONTRACT_PATH = path.resolve(__contractDir, 'inadmissibleWebsitePages.cases.json');

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
  patientCare: isPatientCarePageSourceUrl,
  course: isCoursePageSourceUrl,
  posting: isPostingPageSourceUrl,
  mapOrDirections: isMapOrPublicityPageSourceUrl,
};

const WEBSITE_BUTTON_REFUSES: Partial<Record<Category, (url: string) => boolean>> = {
  patientCare: (url) => isRefusedResearchWebsitePageUrl(url, 'FACULTY_RESEARCH_AREA'),
  course: (url) => isRefusedResearchWebsitePageUrl(url, 'FACULTY_RESEARCH_AREA'),
  posting: (url) => isRefusedResearchWebsitePageUrl(url, 'FACULTY_RESEARCH_AREA'),
};

describe('inadmissible website page contract (client)', () => {
  (Object.keys(RULES) as Category[]).forEach((category) => {
    it(`covers every section of ${category}`, () => {
      expect(contract[category].refused.length).toBeGreaterThan(0);
      expect(contract[category].kept.length).toBeGreaterThan(0);
    });

    contract[category].refused.forEach((testCase) => {
      it(`refuses as ${category}: ${testCase.name}`, () => {
        expect(RULES[category](testCase.url)).toBe(true);
        const websiteButtonRefuses = WEBSITE_BUTTON_REFUSES[category];
        if (websiteButtonRefuses) expect(websiteButtonRefuses(testCase.url)).toBe(true);
      });
    });

    contract[category].kept.forEach((testCase) => {
      it(`keeps as ${category}: ${testCase.name}`, () => {
        expect(RULES[category](testCase.url)).toBe(false);
      });
    });
  });

  it('leaves an organization row its own posting and patient-care pages, as the server does', () => {
    for (const testCase of [...contract.patientCare.refused, ...contract.posting.refused]) {
      expect(isRefusedResearchWebsitePageUrl(testCase.url, 'CENTER')).toBe(false);
    }
    for (const testCase of contract.course.refused) {
      expect(isRefusedResearchWebsitePageUrl(testCase.url, 'CENTER')).toBe(true);
    }
  });

  it('keeps a bare course listing as a research website, as the server does', () => {
    for (const testCase of contract.courseListing.refused) {
      expect(isCoursePageSourceUrl(testCase.url)).toBe(false);
      expect(isRefusedResearchWebsitePageUrl(testCase.url, 'LAB')).toBe(false);
    }
  });
});
