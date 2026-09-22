import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { PRESS_AND_NEWS_HOSTS, isPressOrNewsSourceUrl } from '../researchDetailSources';

/**
 * Client half of the shared press and news host contract (#2532).
 *
 * See the server half in `server/src/utils/__tests__/pressAndNewsHostsContract.test.ts`.
 * Both read the same case table so a divergence between the duplicated host lists
 * fails on both sides instead of letting the refused `websiteUrl` and the refused
 * outreach action drift apart, which they already did once by six entries.
 */
const CONTRACT_PATH = path.resolve(process.cwd(), '../contracts/pressAndNewsHosts.cases.json');

interface UrlCase {
  name: string;
  url: string;
}

const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8')) as {
  hosts: string[];
  refused: UrlCase[];
  kept: UrlCase[];
};

describe('press and news host contract (client)', () => {
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
      expect(isPressOrNewsSourceUrl(`https://${host}/example/`), host).toBe(true);
    }
  });

  contract.refused.forEach((testCase) => {
    it(`refuses: ${testCase.name}`, () => {
      expect(isPressOrNewsSourceUrl(testCase.url)).toBe(true);
    });
  });

  contract.kept.forEach((testCase) => {
    it(`keeps: ${testCase.name}`, () => {
      expect(isPressOrNewsSourceUrl(testCase.url)).toBe(false);
    });
  });
});
