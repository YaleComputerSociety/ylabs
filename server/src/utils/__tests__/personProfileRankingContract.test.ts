import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import {
  isCrossSchoolDirectoryProfileUrl,
  personProfileSourceRoleLabel,
  rankPersonProfileUrls,
} from '../personProfileRanking';

/**
 * Server half of the shared person-profile ranking contract (#2835).
 *
 * `personProfileRanking.ts` exists in both packages because the client picks the
 * profile call to action and the source-row order while the server picks the page
 * the description lane writes prose from. Both suites read the same case table and
 * drive their own public entry points, so either copy can be refactored freely and
 * neither can change what it decides without the other's suite failing. Add cases
 * to the shared table, never to one suite alone.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = path.resolve(
  __dirname,
  '../../../../contracts/personProfileRanking.cases.json',
);

interface RankingCase {
  name: string;
  urls: string[];
  schools?: string[];
  provenanceUrls?: string[];
  expectFirst: string;
}

interface RoleLabelCase {
  name: string;
  url: string;
  expect: string | null;
}

interface CrossSchoolCase {
  name: string;
  url: string;
  schools: string[];
  expect: boolean;
}

const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8')) as {
  ranking: RankingCase[];
  roleLabel: RoleLabelCase[];
  crossSchool: CrossSchoolCase[];
};

describe('person-profile ranking contract (server)', () => {
  it('covers every contract section', () => {
    expect(contract.ranking.length).toBeGreaterThan(0);
    expect(contract.roleLabel.length).toBeGreaterThan(0);
    expect(contract.crossSchool.length).toBeGreaterThan(0);
  });

  contract.ranking.forEach((testCase) => {
    it(`ranks: ${testCase.name}`, () => {
      const ranked = rankPersonProfileUrls(testCase.urls, {
        schools: testCase.schools,
        provenanceUrls: testCase.provenanceUrls,
      });
      expect(ranked[0]).toBe(testCase.expectFirst);
      expect([...ranked].sort()).toEqual([...testCase.urls].sort());
    });
  });

  contract.roleLabel.forEach((testCase) => {
    it(`labels: ${testCase.name}`, () => {
      expect(personProfileSourceRoleLabel(testCase.url) ?? null).toBe(testCase.expect);
    });
  });

  contract.crossSchool.forEach((testCase) => {
    it(`classifies: ${testCase.name}`, () => {
      expect(isCrossSchoolDirectoryProfileUrl(testCase.url, testCase.schools)).toBe(
        testCase.expect,
      );
    });
  });
});
