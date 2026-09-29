import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';

const SOURCE = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../entityMaterializer.ts'),
  'utf8',
);

/**
 * Every resolver invocation in the materializer must be handed the projection's instant.
 *
 * `confidenceResolver` weights each observation by `recencyDecay(observedAt, now, halfLife)` and
 * `confidenceByField` is a stored field, so a call that omits `now` resolves against the wall
 * clock and two runs over identical evidence disagree in the last bits of a float. #3838 pinned
 * one call site and left six others, and the engine benchmark still could not reproduce itself:
 * three rows drifted, always on `fullDescription`, until every site was pinned (#3839).
 *
 * Asserted by reading the source because the defect is an OMITTED argument. A behavioural test
 * would have to make the clock move far enough to change a float, which is what made this so
 * slow to find: a fixture with one observation per field normalises to confidence 1 at any
 * instant and cannot detect it at all.
 */
const RESOLVER_CALL = /\b(resolveAllFields|resolveFieldRanked|resolveField)\(/g;

const callArgumentText = (start: number): string => {
  let depth = 0;
  for (let index = SOURCE.indexOf('(', start); index < SOURCE.length; index += 1) {
    const character = SOURCE[index];
    if (character === '(') depth += 1;
    else if (character === ')') {
      depth -= 1;
      if (depth === 0) return SOURCE.slice(start, index + 1);
    }
  }
  return SOURCE.slice(start);
};

describe('every materializer resolver call pins the projection clock (#3839)', () => {
  const calls = [...SOURCE.matchAll(RESOLVER_CALL)]
    .map((match) => ({ index: match.index ?? 0, name: match[1] }))
    // The import list and the re-export are not calls.
    .filter((call) => !/^\s*(import|export)\b/.test(SOURCE.slice(call.index - 40, call.index)));

  it('finds the resolver calls it is meant to guard', () => {
    expect(calls.length).toBeGreaterThanOrEqual(7);
  });

  it.each([0])('passes a now to every one of them', () => {
    const unpinned = calls
      .map((call) => ({ ...call, text: callArgumentText(call.index) }))
      // `now:`, `now,` and the shorthand `now }` all count. The first draft of this guard
      // accepted only the first two and reported two correctly pinned calls as unpinned.
      .filter((call) => !/\bnow\s*[:,}]/.test(call.text))
      .map((call) => `${call.name} at offset ${call.index}`);

    expect(unpinned).toEqual([]);
  });
});
