import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import {
  isLikelyOfficialPersonProfileUrl,
  isRosterNestedPersonPageUrl,
  isSameActionDestination,
  officialProfileMirrorKey,
} from '../researchDetailSources';

/**
 * Client half of the shared cohort-nested person page contract (#3207).
 *
 * See the server half in
 * `server/src/scripts/__tests__/rosterNestedPersonPageContract.test.ts`. Both read the
 * same case table, so the audit's copy of the mirror key cannot drift from the one that
 * decides the detail page's outreach slot. The press-and-news contract records why: two
 * copies of one list drifted by six entries inside the pull request that added them.
 */
// Resolved from this file rather than from `__contractDir`: a cwd-relative path
// escapes the repository when a run starts anywhere but the package directory,
// which silently drops these assertions from the total.
const __contractDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../contracts',
);

const CONTRACT_PATH = path.resolve(__contractDir, 'rosterNestedPersonPage.cases.json');

interface Contract {
  nested: string[];
  notNested: string[];
  sameDestinationGroups: string[][];
  distinctDestinations: string[][];
  flatNotAPerson: string[];
  flatIsAPerson: string[];
}

const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8')) as Contract;

describe('rosterNestedPersonPage contract (client)', () => {
  it('accepts every cohort-nested person page in the contract', () => {
    contract.nested.forEach((url) => {
      expect(isRosterNestedPersonPageUrl(url), url).toBe(true);
    });
  });

  it('refuses every non-nested case in the contract', () => {
    contract.notNested.forEach((url) => {
      expect(isRosterNestedPersonPageUrl(url), url).toBe(false);
    });
  });

  it('treats every spelling in a same-destination group as one destination', () => {
    contract.sameDestinationGroups.forEach((group) => {
      group.slice(1).forEach((url) => {
        expect(isSameActionDestination(group[0], url), `${group[0]} vs ${url}`).toBe(true);
      });
    });
  });

  it('keeps the contract distinct destinations apart', () => {
    contract.distinctDestinations.forEach(([first, second]) => {
      expect(isSameActionDestination(first, second), `${first} vs ${second}`).toBe(false);
    });
  });

  it('gives no mirror key to a flat leaf that names a page rather than a person (#3358)', () => {
    contract.flatNotAPerson.forEach((url) => {
      expect(officialProfileMirrorKey(url), url).toBeNull();
      expect(isLikelyOfficialPersonProfileUrl(url), url).toBe(false);
    });
  });

  it('still keys a flat person page', () => {
    contract.flatIsAPerson.forEach((url) => {
      expect(officialProfileMirrorKey(url), url).not.toBeNull();
    });
  });
});
