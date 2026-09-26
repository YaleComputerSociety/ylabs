import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { researchEntityTitle } from '../researchEntityCopy';

// Resolved from this file rather than from `__contractDir`: a cwd-relative path
// escapes the repository when a run starts anywhere but the package directory,
// which silently drops these assertions from the total.
const __contractDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../contracts',
);

const CONTRACT_PATH = path.resolve(__contractDir, 'researchEntitySearchTitle.cases.json');

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
