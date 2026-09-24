import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { isInstitutionalPublicityPageUrl, isMapOrDirectionsUrl } from '../researchHomeWebsiteUrl';
import {
  isPromotableWebsiteUrl,
  isUnservableWebsiteUrl,
} from '../../scripts/backfillResearchEntityWebsiteUrlsCore';

/**
 * Server half of the shared map / directions / institutional-publicity contract (#3184).
 *
 * See the client half in `client/src/utils/__tests__/mapAndPublicityDestinationsContract.test.ts`.
 * Both read the same case table, so a divergence between the duplicated rules fails on
 * both sides instead of letting the refused `websiteUrl` and the refused headline action
 * drift apart.
 */
const CONTRACT_PATH = path.resolve(
  __dirname,
  '../../../../contracts/mapAndPublicityDestinations.cases.json',
);

interface UrlCase {
  name: string;
  url: string;
}

const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8')) as {
  refused: UrlCase[];
  kept: UrlCase[];
};

const refuses = (url: string): boolean =>
  isMapOrDirectionsUrl(url) || isInstitutionalPublicityPageUrl(url);

describe('map and publicity destination contract (server)', () => {
  it('covers every contract section', () => {
    expect(contract.refused.length).toBeGreaterThan(0);
    expect(contract.kept.length).toBeGreaterThan(0);
  });

  contract.refused.forEach((testCase) => {
    it(`refuses: ${testCase.name}`, () => {
      expect(refuses(testCase.url)).toBe(true);
    });

    // A refusal that only the resolver honours leaves the promotion lane re-filling the
    // slot the repair just cleared, which is a churn loop rather than a fix (#2708).
    it(`never promotes and always clears: ${testCase.name}`, () => {
      expect(isPromotableWebsiteUrl(testCase.url)).toBe(false);
      expect(isUnservableWebsiteUrl(testCase.url)).toBe(true);
    });
  });

  contract.kept.forEach((testCase) => {
    it(`keeps: ${testCase.name}`, () => {
      expect(refuses(testCase.url)).toBe(false);
    });
  });
});
