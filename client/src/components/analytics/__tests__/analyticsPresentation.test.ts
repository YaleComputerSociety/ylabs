import { describe, expect, it } from 'vitest';

import { formatOpenness, formatSearchResultOutcome } from '../analyticsPresentation';

describe('formatSearchResultOutcome', () => {
  it('never labels a zero-result query as hits and states 0 results', () => {
    const outcome = formatSearchResultOutcome({ query: 'da Silva', zeroResults: 1 }, true);

    expect(outcome).toBe('1 search, 0 results');
    expect(outcome).not.toContain('hit');
  });

  it('pluralizes the search count for zero-result queries', () => {
    expect(formatSearchResultOutcome({ query: 'ai', totalSearches: 3 }, true)).toBe(
      '3 searches, 0 results',
    );
  });

  it('reports an approximate result count for low-result queries', () => {
    expect(
      formatSearchResultOutcome({ query: 'genomics', totalSearches: 4, avgResults: 1.5 }, false),
    ).toBe('4 searches, ~1.5 results');
  });

  it('falls back to a plain low-result label when no average is present', () => {
    expect(formatSearchResultOutcome({ query: 'x', count: 1 }, false)).toBe(
      '1 search, few results',
    );
  });
});

describe('formatOpenness', () => {
  it('maps each computed acceptance level to its own label', () => {
    expect(formatOpenness('verified')).toBe('Verified accepting');
    expect(formatOpenness('likely')).toBe('Likely accepting');
    expect(formatOpenness('none')).toBe('No access evidence');
  });

  it('labels a missing acceptance level distinctly from a computed "none"', () => {
    const computedNone = formatOpenness('none');
    const notComputed = formatOpenness(undefined);

    expect(notComputed).toBe('Acceptance not computed');
    expect(notComputed).not.toBe(computedNone);
  });

  it('passes through an unrecognized status verbatim', () => {
    expect(formatOpenness('experimental')).toBe('experimental');
  });
});
