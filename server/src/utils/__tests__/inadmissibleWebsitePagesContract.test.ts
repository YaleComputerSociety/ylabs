import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  isCoursePageUrl,
  isInadmissiblePersonWebsiteUrl,
  isPatientCarePageUrl,
  isPostingPageUrl,
  isWithheldResearchWebsiteUrl,
} from '../researchHomeWebsiteUrl';

/**
 * Server half of the shared course, posting and patient-care page contract (#5376).
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

type Category = 'patientCare' | 'course' | 'posting';

const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8')) as Record<
  Category,
  { refused: UrlCase[]; kept: UrlCase[] }
>;

const RULES: Record<Category, (url: string) => boolean> = {
  patientCare: isPatientCarePageUrl,
  course: isCoursePageUrl,
  posting: isPostingPageUrl,
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
      });
    });
  });
});
