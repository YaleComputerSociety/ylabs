import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { isCorroboratedPersonPageUrl } from '../yalePersonPagePrefix';

/**
 * Client half of the shared person-page prefix contract (#2912).
 *
 * See the server half in
 * `server/src/utils/__tests__/yalePersonPagePrefixContract.test.ts`. Both read the
 * same case table so a divergence between the duplicated host maps fails on both
 * sides instead of letting the served profile call to action and the scraper's
 * view of a host's person-page shape drift apart.
 */
const CONTRACT_PATH = path.resolve(process.cwd(), '../contracts/yalePersonPagePrefix.cases.json');

interface CorroborationCase {
  name: string;
  url: string;
  personNames: string[];
  expect: boolean;
}

const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8')) as {
  corroboration: CorroborationCase[];
};

describe('Yale person-page prefix contract (client)', () => {
  it('covers every contract section', () => {
    expect(contract.corroboration.length).toBeGreaterThan(0);
  });

  contract.corroboration.forEach((testCase) => {
    it(`corroborates: ${testCase.name}`, () => {
      expect(isCorroboratedPersonPageUrl(testCase.url, testCase.personNames)).toBe(testCase.expect);
    });
  });
});
