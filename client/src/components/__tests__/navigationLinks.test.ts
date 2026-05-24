import { describe, expect, it } from 'vitest';

import { primaryNavLinks } from '../navigationLinks';

describe('primaryNavLinks', () => {
  it('uses Yale Labs and Programs as the primary student destinations', () => {
    expect(primaryNavLinks.map((link) => link.label)).toEqual([
      'Yale Labs',
      'Programs & Fellowships',
      'Dashboard',
    ]);
    expect(primaryNavLinks.map((link) => link.to)).toEqual([
      '/research',
      '/programs',
      '/account',
    ]);
    expect(primaryNavLinks.some((link) => link.label === 'Listings')).toBe(false);
    expect(primaryNavLinks.some((link) => link.label === 'Find Pathways')).toBe(false);
    expect(primaryNavLinks.some((link) => link.to === '/pathways')).toBe(false);
  });
});
