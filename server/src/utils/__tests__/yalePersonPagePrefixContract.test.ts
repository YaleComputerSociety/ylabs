import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import { YALE_PERSON_PAGE_PREFIXES, isCorroboratedPersonPageUrl } from '../yalePersonPagePrefix';

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

describe('Yale person-page prefix contract (server)', () => {
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
