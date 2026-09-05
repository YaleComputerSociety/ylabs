import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { buildResearchHomeContextSummary } from '../researchDiscoveryAdapters';
import { publicResearchDescriptionText } from '../researchTextNormalization';

/**
 * Client half of the shared research-description hygiene contract (#2433).
 *
 * See the server half in
 * `server/src/utils/__tests__/researchDescriptionHygieneContract.test.ts`. Both
 * read the same case table so a behavioural divergence between the duplicated
 * copies fails on both sides instead of going undetected.
 */
const CONTRACT_PATH = path.resolve(
  process.cwd(),
  '../contracts/researchDescriptionHygiene.cases.json',
);

interface SuppressionCase {
  name: string;
  input: string;
  expect: 'kept' | 'suppressed';
}

interface CardSummaryCase {
  name: string;
  input: Record<string, unknown>;
  expectState: 'complete' | 'sparse';
  expectText: string;
}

const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8')) as {
  suppression: SuppressionCase[];
  cardSummary: CardSummaryCase[];
};

const clientVerdict = (input: string): 'kept' | 'suppressed' =>
  publicResearchDescriptionText(input) === '' ? 'suppressed' : 'kept';

describe('research description hygiene contract (client)', () => {
  it('loads a non-trivial shared case table', () => {
    expect(contract.suppression.length).toBeGreaterThanOrEqual(20);
    expect(contract.cardSummary.length).toBeGreaterThanOrEqual(8);
  });

  it.each(contract.suppression.map((testCase) => [testCase.name, testCase] as const))(
    'suppression: %s',
    (_name, testCase) => {
      expect(clientVerdict(testCase.input)).toBe(testCase.expect);
    },
  );

  it.each(contract.cardSummary.map((testCase) => [testCase.name, testCase] as const))(
    'card summary: %s',
    (_name, testCase) => {
      const summary = buildResearchHomeContextSummary(testCase.input as any);
      expect(summary.state).toBe(testCase.expectState);
      expect(summary.text).toBe(testCase.expectText);
    },
  );
});
