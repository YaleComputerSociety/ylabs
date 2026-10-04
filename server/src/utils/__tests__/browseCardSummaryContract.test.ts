import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import {
  browseCardHasSixWordsOrFewer,
  browseCardIsCutMidSentence,
  browseCardSummary,
} from '../browseCardSummary';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = path.resolve(__dirname, '../../../../contracts/browseCardSummary.cases.json');

interface BrowseCardSummaryCase {
  name: string;
  input: string | null;
  expect: string;
}

const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8')) as {
  cases: BrowseCardSummaryCase[];
};

describe('browse card summary contract (server)', () => {
  it('covers the contract', () => {
    expect(contract.cases.length).toBeGreaterThan(0);
  });

  contract.cases.forEach((testCase) => {
    it(testCase.name, () => {
      expect(browseCardSummary(testCase.input ?? undefined)).toBe(testCase.expect);
    });
  });
});

describe('browse card shape', () => {
  it('reads a trailing ellipsis as a card cut mid-sentence', () => {
    const cut = contract.cases.find((testCase) => testCase.expect.endsWith('…'));
    expect(cut).toBeDefined();
    expect(browseCardIsCutMidSentence(cut!.expect)).toBe(true);
    expect(browseCardIsCutMidSentence('Studies how cells divide.')).toBe(false);
  });

  it('counts six words or fewer, and never an empty card', () => {
    expect(browseCardHasSixWordsOrFewer('Studies human behavior.')).toBe(true);
    expect(browseCardHasSixWordsOrFewer('Studies how cells divide during early development.')).toBe(
      false,
    );
    expect(browseCardHasSixWordsOrFewer('')).toBe(false);
  });
});
