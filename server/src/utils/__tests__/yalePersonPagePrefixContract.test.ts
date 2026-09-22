import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import { isCorroboratedPersonPageUrl } from '../yalePersonPagePrefix';

/**
 * Server half of the shared person-page prefix contract (#2912).
 *
 * `yalePersonPagePrefix.ts` exists in both packages because the client picks the
 * profile call to action from a row's own citations while the server re-points a
 * migrated citation during a scrape. Both suites read the same case table and drive
 * their own public entry points, so neither copy can change what it decides without
 * the other's suite failing. Add cases to the shared table, never to one suite
 * alone.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = path.resolve(
  __dirname,
  '../../../../contracts/yalePersonPagePrefix.cases.json',
);

interface CorroborationCase {
  name: string;
  url: string;
  personNames: string[];
  expect: boolean;
}

const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8')) as {
  corroboration: CorroborationCase[];
};

describe('Yale person-page prefix contract (server)', () => {
  it('covers every contract section', () => {
    expect(contract.corroboration.length).toBeGreaterThan(0);
  });

  contract.corroboration.forEach((testCase) => {
    it(`corroborates: ${testCase.name}`, () => {
      expect(isCorroboratedPersonPageUrl(testCase.url, testCase.personNames)).toBe(testCase.expect);
    });
  });
});
