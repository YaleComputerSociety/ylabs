import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import {
  PRESS_AND_NEWS_HOSTS,
  PRESS_AND_NEWS_HOST_URL_PATTERN,
  isPressOrNewsHostUrl,
} from '../researchHomeWebsiteUrl';

/**
 * Server half of the shared press and news host contract (#2532).
 *
 * The list exists in both packages because this side refuses the host as a stored
 * `websiteUrl` while the client refuses it as the detail page's headline outreach
 * action. Both suites read the same case table and drive their own public entry
 * points, so neither copy can change what it decides without the other's suite
 * failing. Add hosts and cases to the shared table, never to one suite alone.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = path.resolve(__dirname, '../../../../contracts/pressAndNewsHosts.cases.json');

interface UrlCase {
  name: string;
  url: string;
}

const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8')) as {
  hosts: string[];
  refused: UrlCase[];
  kept: UrlCase[];
};

describe('press and news host contract (server)', () => {
  it('covers every contract section', () => {
    expect(contract.hosts.length).toBeGreaterThan(0);
    expect(contract.refused.length).toBeGreaterThan(0);
    expect(contract.kept.length).toBeGreaterThan(0);
  });

  it('holds exactly the hosts the contract pins', () => {
    expect([...PRESS_AND_NEWS_HOSTS].sort()).toEqual([...contract.hosts].sort());
  });

  it('pins no entry that can never match a hostname', () => {
    for (const host of contract.hosts) {
      expect(host, host).not.toContain('/');
      expect(isPressOrNewsHostUrl(`https://${host}/example/`), host).toBe(true);
    }
  });

  contract.refused.forEach((testCase) => {
    it(`refuses: ${testCase.name}`, () => {
      expect(isPressOrNewsHostUrl(testCase.url)).toBe(true);
      expect(PRESS_AND_NEWS_HOST_URL_PATTERN.test(testCase.url)).toBe(true);
    });
  });

  contract.kept.forEach((testCase) => {
    it(`keeps: ${testCase.name}`, () => {
      expect(isPressOrNewsHostUrl(testCase.url)).toBe(false);
      expect(PRESS_AND_NEWS_HOST_URL_PATTERN.test(testCase.url)).toBe(false);
    });
  });
});
