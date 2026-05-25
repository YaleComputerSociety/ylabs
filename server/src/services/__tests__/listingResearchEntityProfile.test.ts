import { describe, expect, it } from 'vitest';

import { buildListingResearchEntityProfilePatch } from '../listingResearchEntityProfile';

describe('buildListingResearchEntityProfilePatch', () => {
  it('derives source-backed profile fields from a listing when the entity is empty', () => {
    const patch = buildListingResearchEntityProfilePatch({
      entity: {
        sourceUrls: [],
        websiteUrl: '',
        shortDescription: '',
        fullDescription: '',
        description: '',
        departments: [],
        researchAreas: [],
      },
      listing: {
        websites: ['http://som.yale.edu/jacob-thomas'],
        description:
          'Professor Thomas focuses on the relation between accounting information and stock prices.',
        departments: ['South Asian Studies'],
        researchAreas: ['Accounting'],
      },
    });

    expect(patch).toMatchObject({
      sourceUrls: ['http://som.yale.edu/jacob-thomas'],
      websiteUrl: 'http://som.yale.edu/jacob-thomas',
      shortDescription:
        'Professor Thomas focuses on the relation between accounting information and stock prices.',
      fullDescription:
        'Professor Thomas focuses on the relation between accounting information and stock prices.',
      description:
        'Professor Thomas focuses on the relation between accounting information and stock prices.',
      departments: ['South Asian Studies'],
      researchAreas: ['Accounting'],
    });
  });

  it('does not overwrite existing entity profile fields', () => {
    const patch = buildListingResearchEntityProfilePatch({
      entity: {
        sourceUrls: ['https://existing.yale.edu/lab'],
        websiteUrl: 'https://existing.yale.edu/lab',
        shortDescription: 'Existing source-backed profile.',
        fullDescription: 'Existing long profile.',
        description: 'Existing description.',
        departments: ['Existing Department'],
        researchAreas: ['Existing Area'],
      },
      listing: {
        websites: ['https://listing.yale.edu/profile'],
        description: 'Listing description.',
        departments: ['Listing Department'],
        researchAreas: ['Listing Area'],
      },
    });

    expect(patch).toEqual({});
  });

  it('redacts direct contact details before copying listing descriptions', () => {
    const patch = buildListingResearchEntityProfilePatch({
      entity: {},
      listing: {
        websites: ['https://example.yale.edu/lab'],
        description: 'Email jane.doe@yale.edu or call 203-555-1212 to apply.',
      },
    });

    expect(patch.shortDescription).toBe(
      'Email [email redacted] or call [phone redacted] to apply.',
    );
  });
});
