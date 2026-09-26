import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import { isUmbrellaPageCitedByPersonUrl } from '../researchDetailSources';

/**
 * Client half of the shared department-hiring-page contract (#3333).
 *
 * See the server half in
 * `server/src/utils/__tests__/departmentHiringPageContract.test.ts`.
 */
// Resolved from this file rather than from the cwd: a cwd-relative path escapes the
// repository when a run starts anywhere but the package directory, which silently
// drops these assertions from the total.
const __contractDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../contracts',
);

const CONTRACT_PATH = path.resolve(__contractDir, 'departmentHiringPage.cases.json');

interface UrlCase {
  name: string;
  url: string;
}

const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8')) as {
  refused: UrlCase[];
  kept: UrlCase[];
  keptForOrganizationScopedRows: UrlCase[];
};

const PERSON_SCOPED_ENTITY_TYPE = 'LAB';
const ORGANIZATION_SCOPED_ENTITY_TYPE = 'CENTER';

describe('department hiring page contract (client)', () => {
  it('covers every contract section', () => {
    expect(contract.refused.length).toBeGreaterThan(0);
    expect(contract.kept.length).toBeGreaterThan(0);
    expect(contract.keptForOrganizationScopedRows.length).toBeGreaterThan(0);
  });

  contract.refused.forEach((testCase) => {
    it(`refuses as a headline action: ${testCase.name}`, () => {
      expect(isUmbrellaPageCitedByPersonUrl(testCase.url, PERSON_SCOPED_ENTITY_TYPE)).toBe(true);
    });
  });

  contract.kept.forEach((testCase) => {
    it(`keeps as a headline action: ${testCase.name}`, () => {
      expect(isUmbrellaPageCitedByPersonUrl(testCase.url, PERSON_SCOPED_ENTITY_TYPE)).toBe(false);
    });
  });

  contract.keptForOrganizationScopedRows.forEach((testCase) => {
    it(`keeps for an organization-scoped row: ${testCase.name}`, () => {
      expect(isUmbrellaPageCitedByPersonUrl(testCase.url, ORGANIZATION_SCOPED_ENTITY_TYPE)).toBe(
        false,
      );
    });
  });
});
