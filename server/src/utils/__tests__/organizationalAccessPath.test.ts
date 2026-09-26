import { describe, expect, it } from 'vitest';
import {
  hasOrganizationalAlternateAccessPath,
  hasOrganizationalEngagementLink,
  isOrganizationalEngagementUrl,
} from '../organizationalAccessPath';

describe('isOrganizationalEngagementUrl', () => {
  it.each([
    'https://yse.yale.edu/research/industrial-ecology/people',
    'https://yse.yale.edu/about/get-involved',
    'https://medicine.yale.edu/keck/ms/programs/',
    'https://economics.yale.edu/undergraduate/tobin-ra/research-assistantships',
  ])('accepts an engagement path: %s', (url) => {
    expect(isOrganizationalEngagementUrl(url)).toBe(true);
  });

  it.each([
    'https://yse.yale.edu/research/industrial-ecology',
    'https://yse.yale.edu/',
    'https://yse.yale.edu',
    'not-a-url',
  ])('refuses a bare home or unparseable url: %s', (url) => {
    expect(isOrganizationalEngagementUrl(url)).toBe(false);
  });
});

describe('hasOrganizationalEngagementLink', () => {
  it('scans websiteUrl, website and sourceUrls together', () => {
    expect(
      hasOrganizationalEngagementLink({
        websiteUrl: 'https://yse.yale.edu/research/industrial-ecology',
        sourceUrls: ['https://yse.yale.edu/research/industrial-ecology/people'],
      }),
    ).toBe(true);
  });

  it('is false when every recorded url is a bare landing page', () => {
    expect(
      hasOrganizationalEngagementLink({
        websiteUrl: 'https://yse.yale.edu/research/industrial-ecology',
        sourceUrls: ['https://yse.yale.edu/'],
      }),
    ).toBe(false);
  });
});

describe('hasOrganizationalAlternateAccessPath', () => {
  const deadEnd = { websiteUrl: 'https://yse.yale.edu/research/industrial-ecology' };

  it('is false for the measured #1359 shape: no roster, no relationship, no engagement page', () => {
    expect(
      hasOrganizationalAlternateAccessPath({
        entity: deadEnd,
        relatedEntityAccessPathCount: 0,
        rosterCount: 0,
      }),
    ).toBe(false);
  });

  it.each([
    ['a linked entity', { relatedEntityAccessPathCount: 1, rosterCount: 0 }],
    ['a roster entry', { relatedEntityAccessPathCount: 0, rosterCount: 1 }],
  ])('is true on %s alone', (_label, counts) => {
    expect(hasOrganizationalAlternateAccessPath({ entity: deadEnd, ...counts })).toBe(true);
  });

  it('is true on an engagement page with nothing else attached', () => {
    expect(
      hasOrganizationalAlternateAccessPath({
        entity: { websiteUrl: 'https://yse.yale.edu/research/industrial-ecology/people' },
        relatedEntityAccessPathCount: 0,
        rosterCount: 0,
      }),
    ).toBe(true);
  });

  it('treats an omitted rosterCount as no roster rather than as unknown', () => {
    expect(
      hasOrganizationalAlternateAccessPath({ entity: deadEnd, relatedEntityAccessPathCount: 0 }),
    ).toBe(false);
  });
});
