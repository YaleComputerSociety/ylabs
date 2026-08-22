import { describe, expect, it } from 'vitest';

import { formatOpenness } from '../analyticsPresentation';

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
