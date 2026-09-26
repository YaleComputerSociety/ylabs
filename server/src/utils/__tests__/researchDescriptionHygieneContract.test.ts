import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import { resolveResearchHomeCardSummary } from '../researchHomeCardSummary';

/**
 * Server half of the shared research-description hygiene contract (#2433).
 *
 * `researchHomeCardSummary.ts` and `client/src/utils/researchTextNormalization.ts`
 * carry independent copies of the same predicates, and
 * `researchHomeCardSummary.ts:192` documents that the two sides must stay in sync
 * so served card text is byte-identical. Nothing enforced it: each package tested
 * only its own copy.
 *
 * Both suites read the same case table and drive their own public entry point, so
 * the invariant is pinned by behaviour rather than by source text. Either copy can
 * be refactored freely; neither can change what it decides without the other's
 * suite failing. Add cases to the shared table, never to one suite alone.
 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = path.resolve(
  __dirname,
  '../../../../contracts/researchDescriptionHygiene.cases.json',
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

/**
 * The server does not export its composite predicate, so probe it through the
 * public resolver instead of widening the module's surface for a test: a kept
 * description resolves to a `complete` summary carrying that exact text, and a
 * suppressed one falls through to the `sparse` branch.
 */
const serverVerdict = (input: string): 'kept' | 'suppressed' => {
  const summary = resolveResearchHomeCardSummary({ shortDescription: input });
  return summary.state === 'complete' && summary.text === input.replace(/\s+/g, ' ').trim()
    ? 'kept'
    : 'suppressed';
};

describe('research description hygiene contract (server)', () => {
  it('loads a non-trivial shared case table', () => {
    expect(contract.suppression.length).toBeGreaterThanOrEqual(20);
    expect(contract.cardSummary.length).toBeGreaterThanOrEqual(8);
  });

  it.each(contract.suppression.map((testCase) => [testCase.name, testCase] as const))(
    'suppression: %s',
    (_name, testCase) => {
      expect(serverVerdict(testCase.input)).toBe(testCase.expect);
    },
  );

  it.each(contract.cardSummary.map((testCase) => [testCase.name, testCase] as const))(
    'card summary: %s',
    (_name, testCase) => {
      const summary = resolveResearchHomeCardSummary(testCase.input as any);
      expect(summary.state).toBe(testCase.expectState);
      expect(summary.text).toBe(testCase.expectText);
    },
  );
});
