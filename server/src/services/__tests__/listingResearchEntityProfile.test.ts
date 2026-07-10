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

  it('bounds and filters listing URLs before copying them to research entities', () => {
    const patch = buildListingResearchEntityProfilePatch({
      entity: {
        sourceUrls: [],
        websiteUrl: '',
      },
      listing: {
        websites: [
          'https://example.yale.edu/lab',
          'mailto:hidden@example.edu',
          'data:text/html,<script>alert(1)</script>',
          { toString: () => 'https://object.example.edu' },
          ...Array.from({ length: 60 }, (_, index) => `https://example.yale.edu/source-${index}`),
        ],
      },
    });

    expect(patch.websiteUrl).toBe('https://example.yale.edu/lab');
    expect(patch.sourceUrls).toContain('https://example.yale.edu/lab');
    expect(patch.sourceUrls).toHaveLength(50);
    expect(JSON.stringify(patch.sourceUrls)).not.toContain('mailto:');
    expect(JSON.stringify(patch.sourceUrls)).not.toContain('data:text/html');
    expect(JSON.stringify(patch.sourceUrls)).not.toContain('object.example.edu');
  });

  it('does not promote person-page publication blurbs into entity descriptions', () => {
    const patch = buildListingResearchEntityProfilePatch({
      entity: {
        sourceUrls: [],
        websiteUrl: '',
        shortDescription: '',
        fullDescription: '',
        description: '',
      },
      listing: {
        title: 'John Peters',
        ownerFirstName: 'John',
        ownerLastName: 'Peters',
        websites: ['http://filmstudies.yale.edu/people/john-durham-peters'],
        description:
          'This book explores the materiality of communication and provides a genealogy of the information age up to Google.',
        departments: ['Film and Media Studies', 'English'],
      },
    });

    expect(patch).toMatchObject({
      sourceUrls: ['http://filmstudies.yale.edu/people/john-durham-peters'],
      websiteUrl: 'http://filmstudies.yale.edu/people/john-durham-peters',
      departments: ['Film and Media Studies', 'English'],
    });
    expect(patch).not.toHaveProperty('shortDescription');
    expect(patch).not.toHaveProperty('fullDescription');
    expect(patch).not.toHaveProperty('description');
  });
});
