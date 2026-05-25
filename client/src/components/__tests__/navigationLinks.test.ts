import { describe, expect, it } from 'vitest';

import { primaryNavLinks } from '../navigationLinks';

describe('primaryNavLinks', () => {
  it('makes Research the first primary destination and removes Listings from primary nav', () => {
    expect(primaryNavLinks.map((link) => link.label)).toEqual([
      'Research',
      'Pathways',
      'Programs',
      'Dashboard',
    ]);
    expect(primaryNavLinks.map((link) => link.to)).toEqual([
      '/research',
      '/pathways',
      '/programs',
      '/account',
    ]);
    expect(primaryNavLinks.some((link) => link.label === 'Listings')).toBe(false);
  });
});
