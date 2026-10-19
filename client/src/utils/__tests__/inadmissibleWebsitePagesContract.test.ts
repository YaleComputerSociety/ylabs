import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import {
  isCoursePageSourceUrl,
  isPatientCarePageSourceUrl,
  isPostingPageSourceUrl,
  isRefusedResearchWebsitePageUrl,
} from '../researchDetailSources';

/**
 * Client half of the shared course, posting and patient-care page contract (#5376).
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

type Category = 'patientCare' | 'course' | 'posting';

const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8')) as Record<
  Category,
  { refused: UrlCase[]; kept: UrlCase[] }
>;

const RULES: Record<Category, (url: string) => boolean> = {
  patientCare: isPatientCarePageSourceUrl,
  course: isCoursePageSourceUrl,
  posting: isPostingPageSourceUrl,
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
        expect(isRefusedResearchWebsitePageUrl(testCase.url, 'FACULTY_RESEARCH_AREA')).toBe(true);
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
});
