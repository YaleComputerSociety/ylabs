import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { researchEntityTitle } from '../researchEntityCopy';

const CONTRACT_PATH = path.resolve(
  process.cwd(),
  '../contracts/researchEntitySearchTitle.cases.json',
);

interface ContractCase {
  why: string;
  entity: Record<string, unknown>;
  expected: string;
}

const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8')) as {
  cases: ContractCase[];
};

describe('researchEntityTitle matches the shared contract', () => {
  it('carries cases, so an empty contract cannot pass vacuously', () => {
    expect(contract.cases.length).toBeGreaterThan(5);
  });

  for (const testCase of contract.cases) {
    it(testCase.why, () => {
      expect(researchEntityTitle(testCase.entity)).toBe(testCase.expected);
    });
  }
});
