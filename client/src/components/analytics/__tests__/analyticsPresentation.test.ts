import { describe, expect, it } from 'vitest';

import { formatEventType, formatOpenness } from '../analyticsPresentation';

describe('formatEventType', () => {
  it('labels the research search event distinctly from the legacy site search', () => {
    expect(formatEventType('research_search')).toBe('Research searches');
    expect(formatEventType('research_search')).not.toBe('Search');
  });

  it('title-cases an unmapped event type', () => {
    expect(formatEventType('research_profile_open')).toBe('Research Profile Open');
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
