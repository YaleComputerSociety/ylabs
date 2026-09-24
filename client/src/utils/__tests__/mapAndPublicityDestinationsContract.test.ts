import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import { isMapOrPublicityPageSourceUrl } from '../researchDetailSources';

/**
 * Client half of the shared map / directions / institutional-publicity contract (#3184).
 *
 * See the server half in
 * `server/src/utils/__tests__/mapAndPublicityDestinationsContract.test.ts`.
 */
// Resolved from this file rather than from `__contractDir`: a cwd-relative path
// escapes the repository when a run starts anywhere but the package directory,
// which silently drops these assertions from the total.
const __contractDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../contracts',
);

const CONTRACT_PATH = path.resolve(__contractDir, 'mapAndPublicityDestinations.cases.json');

interface UrlCase {
  name: string;
  url: string;
}

const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8')) as {
  refused: UrlCase[];
  kept: UrlCase[];
};

describe('map and publicity destination contract (client)', () => {
  it('covers every contract section', () => {
    expect(contract.refused.length).toBeGreaterThan(0);
    expect(contract.kept.length).toBeGreaterThan(0);
  });

  contract.refused.forEach((testCase) => {
    it(`refuses: ${testCase.name}`, () => {
      expect(isMapOrPublicityPageSourceUrl(testCase.url)).toBe(true);
    });
  });

  contract.kept.forEach((testCase) => {
    it(`keeps: ${testCase.name}`, () => {
      expect(isMapOrPublicityPageSourceUrl(testCase.url)).toBe(false);
    });
  });
});
