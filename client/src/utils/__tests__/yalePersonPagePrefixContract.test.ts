import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import { YALE_PERSON_PAGE_PREFIXES, isCorroboratedPersonPageUrl } from '../yalePersonPagePrefix';

/**
 * Client half of the shared person-page prefix contract (#2912).
 *
 * See the server half in
 * `server/src/utils/__tests__/yalePersonPagePrefixContract.test.ts`. Both read the
 * same case table so a divergence between the duplicated host maps fails on both
 * sides instead of letting the served profile call to action and the scraper's
 * view of a host's person-page shape drift apart.
 */
// Resolved from this file rather than from `__contractDir`: a cwd-relative path
// escapes the repository when a run starts anywhere but the package directory,
// which silently drops these assertions from the total.
const __contractDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../contracts',
);

const CONTRACT_PATH = path.resolve(__contractDir, 'yalePersonPagePrefix.cases.json');

interface CorroborationCase {
  name: string;
  url: string;
  personNames: string[];
  expect: boolean;
}

interface PersonLeaf {
  leaf: string;
  personNames: string[];
}

const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8')) as {
  corroboration: CorroborationCase[];
  hostPersonPagePrefixes: {
    hosts: Record<string, string[]>;
    personLeaf: PersonLeaf;
    rootPersonLeaf: PersonLeaf;
  };
};

const { hosts, personLeaf, rootPersonLeaf } = contract.hostPersonPagePrefixes;

const personPageUrl = (host: string, prefix: string): { url: string; personNames: string[] } => {
  const { leaf, personNames } = prefix === '' ? rootPersonLeaf : personLeaf;
  return {
    url: prefix === '' ? `https://${host}/${leaf}` : `https://${host}/${prefix}/${leaf}`,
    personNames,
  };
};

describe('Yale person-page prefix contract (client)', () => {
  it('covers every contract section', () => {
    expect(contract.corroboration.length).toBeGreaterThan(0);
    expect(Object.keys(hosts).length).toBeGreaterThan(0);
  });

  it('maps exactly the hosts the contract pins', () => {
    expect(Object.keys(YALE_PERSON_PAGE_PREFIXES).sort()).toEqual(Object.keys(hosts).sort());
  });

  Object.entries(hosts).forEach(([host, prefixes]) => {
    it(`serves person pages under the contract prefixes for ${host}`, () => {
      expect([...(YALE_PERSON_PAGE_PREFIXES[host]?.current ?? [])]).toEqual(prefixes);
      prefixes.forEach((prefix) => {
        const { url, personNames } = personPageUrl(host, prefix);
        expect(isCorroboratedPersonPageUrl(url, personNames)).toBe(true);
      });
    });
  });

  contract.corroboration.forEach((testCase) => {
    it(`corroborates: ${testCase.name}`, () => {
      expect(isCorroboratedPersonPageUrl(testCase.url, testCase.personNames)).toBe(testCase.expect);
    });
  });
});
