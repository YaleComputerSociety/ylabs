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
 * Client half of the shared person-profile ranking contract (#2835).
 *
 * See the server half in
 * `server/src/utils/__tests__/personProfileRankingContract.test.ts`. Both read the
 * same case table so a behavioural divergence between the duplicated copies fails
 * on both sides instead of letting the served profile link and the page the
 * description lane reads drift apart.
 */
// Resolved from this file rather than from `__contractDir`: a cwd-relative path
// escapes the repository when a run starts anywhere but the package directory,
// which silently drops these assertions from the total.
const __contractDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../contracts',
);

const CONTRACT_PATH = path.resolve(__contractDir, 'personProfileRanking.cases.json');

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

describe('person-profile ranking contract (client)', () => {
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
