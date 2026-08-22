import { describe, expect, it } from 'vitest';

import { normalizeResearchEntityNameDashes } from '../researchEntityNameNormalization';

describe('normalizeResearchEntityNameDashes', () => {
  it('converts an em-dash faculty-research suffix to a plain hyphen (#519)', () => {
    expect(normalizeResearchEntityNameDashes('Jane Doe — Research')).toBe('Jane Doe - Research');
  });

  it('converts en dashes inside descriptive names', () => {
    expect(
      normalizeResearchEntityNameDashes(
        'FRESH Collaborative – Family-centered Research in Equity, Safety and Healing',
      ),
    ).toBe('FRESH Collaborative - Family-centered Research in Equity, Safety and Healing');
  });

  it('leaves plain-hyphen and dash-free names untouched', () => {
    expect(normalizeResearchEntityNameDashes('Jordan Example - Research')).toBe(
      'Jordan Example - Research',
    );
    expect(normalizeResearchEntityNameDashes('Example Lab')).toBe('Example Lab');
  });

  it('collapses doubled spaces left by dash removal but preserves single spacing', () => {
    expect(normalizeResearchEntityNameDashes('Example  —  Research')).toBe('Example - Research');
  });
});
