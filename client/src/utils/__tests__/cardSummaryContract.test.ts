import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import { cardSummary } from '../cardSummary';

const __contractDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../contracts',
);

const CONTRACT_PATH = path.resolve(__contractDir, 'browseCardSummary.cases.json');

interface BrowseCardSummaryCase {
  name: string;
  input: string | null;
  expect: string;
}

const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8')) as {
  cases: BrowseCardSummaryCase[];
};

describe('browse card summary contract (client)', () => {
  it('covers the contract', () => {
    expect(contract.cases.length).toBeGreaterThan(0);
  });

  contract.cases.forEach((testCase) => {
    it(testCase.name, () => {
      expect(cardSummary(testCase.input ?? undefined)).toBe(testCase.expect);
    });
  });
});
