import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import {
  isRosterNestedPersonPageUrl,
  personPageMirrorKey,
} from '../auditPersonPageCitationMirrorsCore';

/**
 * Server half of the shared cohort-nested person page contract (#3207).
 *
 * See the client half in
 * `client/src/utils/__tests__/rosterNestedPersonPageContract.test.ts`. The audit keeps its
 * own copy because the client module reaches DOM globals through its URL helpers and the
 * server tsconfig has no DOM lib; this contract is what stops the copy drifting.
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
}

const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8')) as Contract;

describe('rosterNestedPersonPage contract (server audit copy)', () => {
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

  it('gives every spelling in a same-destination group one mirror key', () => {
    contract.sameDestinationGroups.forEach((group) => {
      const key = personPageMirrorKey(group[0]);
      expect(key, group[0]).not.toBeNull();
      group.slice(1).forEach((url) => {
        expect(personPageMirrorKey(url), url).toBe(key);
      });
    });
  });

  it('keeps the contract distinct destinations on different keys', () => {
    contract.distinctDestinations.forEach(([first, second]) => {
      expect(personPageMirrorKey(first), `${first} vs ${second}`).not.toBe(
        personPageMirrorKey(second),
      );
    });
  });
});
