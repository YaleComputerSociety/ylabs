import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  isDepartmentHiringPageUrl,
  isUmbrellaPageCitedByPerson,
  sourceUrlToResearchHomeWebsiteUrl,
} from '../researchHomeWebsiteUrl';
import {
  isPromotableWebsiteUrl,
  isUnservableWebsiteUrl,
} from '../../scripts/backfillResearchEntityWebsiteUrlsCore';

/**
 * Server half of the shared department-hiring-page contract (#3333).
 *
 * See the client half in `client/src/utils/__tests__/departmentHiringPageContract.test.ts`.
 * Both read the same case table, so the refused `websiteUrl` and the refused headline
 * outreach action cannot drift: the arm shipped here first while the client copy went
 * on offering the same URL as the page's primary call to action.
 */
const CONTRACT_PATH = path.resolve(
  __dirname,
  '../../../../contracts/departmentHiringPage.cases.json',
);

interface UrlCase {
  name: string;
  url: string;
}

const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8')) as {
  refused: UrlCase[];
  kept: UrlCase[];
  keptForOrganizationScopedRows: UrlCase[];
};

const PERSON_SCOPED = { entityType: 'LAB' };
const ORGANIZATION_SCOPED = { entityType: 'CENTER' };

describe('department hiring page contract (server)', () => {
  it('covers every contract section', () => {
    expect(contract.refused.length).toBeGreaterThan(0);
    expect(contract.kept.length).toBeGreaterThan(0);
    expect(contract.keptForOrganizationScopedRows.length).toBeGreaterThan(0);
  });

  contract.refused.forEach((testCase) => {
    it(`refuses as a research website: ${testCase.name}`, () => {
      expect(isDepartmentHiringPageUrl(testCase.url)).toBe(true);
      expect(isUmbrellaPageCitedByPerson(testCase.url, PERSON_SCOPED)).toBe(true);
      expect(sourceUrlToResearchHomeWebsiteUrl(testCase.url, PERSON_SCOPED)).toBe('');
    });

    // A refusal only the resolver honours leaves the promotion lane re-filling the slot
    // the repair just cleared, which is a churn loop rather than a fix (#2708).
    it(`never promotes and always clears: ${testCase.name}`, () => {
      expect(isPromotableWebsiteUrl(testCase.url, PERSON_SCOPED)).toBe(false);
      expect(isUnservableWebsiteUrl(testCase.url, PERSON_SCOPED)).toBe(true);
    });
  });

  contract.kept.forEach((testCase) => {
    it(`keeps as a research website: ${testCase.name}`, () => {
      expect(isDepartmentHiringPageUrl(testCase.url)).toBe(false);
      expect(isUmbrellaPageCitedByPerson(testCase.url, PERSON_SCOPED)).toBe(false);
    });
  });

  contract.keptForOrganizationScopedRows.forEach((testCase) => {
    it(`keeps for an organization-scoped row: ${testCase.name}`, () => {
      expect(isUmbrellaPageCitedByPerson(testCase.url, ORGANIZATION_SCOPED)).toBe(false);
      expect(isUnservableWebsiteUrl(testCase.url, ORGANIZATION_SCOPED)).toBe(false);
    });
  });
});
