import { describe, expect, it } from 'vitest';

import {
  canonicalScholarlyLinkToProfileLink,
  isLikelySameNameContaminatedProfile,
  normalizePublicProfile,
  paperToScholarlyLink,
} from '../profileService';

describe('profileService profile shaping', () => {
  it('maps canonical user fields to the snake_case profile fields consumed by the client', () => {
    const profile = normalizePublicProfile({
      _id: 'user-1',
      netid: 'abc123',
      fname: 'Ada',
      lname: 'Lovelace',
      imageUrl: 'https://example.test/ada.jpg',
      primaryDepartment: 'Computer Science',
      secondaryDepartments: ['Statistics and Data Science'],
      physicalLocation: '17 Hillhouse',
      buildingDesk: '17 Hillhouse, room 101',
      researchInterests: ['computing history'],
      profileUrls: {
        yale: 'https://cs.yale.edu/people/ada-lovelace',
        orcid: 'https://orcid.org/0000-0000-0000-0000',
      },
      hIndex: 42,
      openAlexId: 'https://openalex.org/A123',
    });

    expect(profile.image_url).toBe('https://example.test/ada.jpg');
    expect(profile.primary_department).toBe('Computer Science');
    expect(profile.secondary_departments).toEqual(['Statistics and Data Science']);
    expect(profile.physical_location).toBe('17 Hillhouse');
    expect(profile.building_desk).toBe('17 Hillhouse, room 101');
    expect(profile.research_interests).toEqual(['computing history']);
    expect(profile.profile_urls).toEqual({
      yale: 'https://cs.yale.edu/people/ada-lovelace',
      orcid: 'https://orcid.org/0000-0000-0000-0000',
    });
    expect(profile.h_index).toBe(42);
    expect(profile.openalex_id).toBe('https://openalex.org/A123');
  });

  it('suppresses obvious same-name contamination from another faculty member', () => {
    const rawProfile = {
      netid: 'tl324',
      fname: 'Tina',
      lname: 'Lu',
      bio: "Lu Lu's website\n\nKline Tower Room 106",
      profileUrls: {
        statistics_data_science: 'https://statistics.yale.edu/profile/lu-lu',
      },
      topics: [
        'Legume Nitrogen Fixing Symbiosis',
        'Genetic and Environmental Crop Studies',
      ],
      openAlexId: 'https://openalex.org/A5103032289',
      hIndex: 2,
      researchInterests: [],
    };

    expect(isLikelySameNameContaminatedProfile(rawProfile)).toBe(true);

    const profile = normalizePublicProfile(rawProfile, {
      scholarlyLinks: [{ title: 'Wrong paper' }],
      researchEntities: [{ name: 'Wrong lab' }],
    });
    expect(profile.bio).toBe('');
    expect(profile.profile_urls).toEqual({});
    expect(profile.topics).toEqual([]);
    expect(profile.openalex_id).toBeUndefined();
    expect(profile.h_index).toBeUndefined();
    expect(profile.scholarlyLinks).toEqual([]);
    expect(profile.researchEntities).toEqual([]);
  });

  it('turns identity-backed papers into inspectable profile research activity links', () => {
    const link = paperToScholarlyLink(
      {
        _id: 'paper-1',
        title: 'A real paper',
        doi: '10.1234/example',
        openAccessUrl: 'https://example.test/free',
        year: 2025,
        venue: 'Journal of Examples',
        sources: ['openalex'],
      },
      'user-1',
    );

    expect(link).toMatchObject({
      _id: 'paper-1',
      userId: 'user-1',
      title: 'A real paper',
      url: 'https://doi.org/10.1234/example',
      destinationKind: 'DOI',
      displaySource: 'DOI',
      freeFullTextUrl: 'https://example.test/free',
      freeFullTextLabel: 'Free full text',
      discoveredVia: 'OPENALEX',
      year: 2025,
      venue: 'Journal of Examples',
    });
  });

  it('turns canonical scholarly links into inspectable profile research activity links', () => {
    const observedAt = new Date('2026-05-20T12:00:00.000Z');
    const link = canonicalScholarlyLinkToProfileLink(
      {
        _id: 'link-1',
        title: 'A canonical scholarly activity',
        url: 'https://doi.org/10.1234/canonical',
        destinationKind: 'DOI',
        displaySource: 'DOI',
        freeFullTextUrl: 'https://example.test/free',
        year: 2026,
        venue: 'Canonical Journal',
        confidence: 0.95,
        lastObservedAt: observedAt,
        externalIds: {
          doi: '10.1234/canonical',
        },
      },
      'user-1',
    );

    expect(link).toMatchObject({
      _id: 'link-1',
      userId: 'user-1',
      title: 'A canonical scholarly activity',
      url: 'https://doi.org/10.1234/canonical',
      destinationKind: 'DOI',
      displaySource: 'DOI',
      freeFullTextUrl: 'https://example.test/free',
      freeFullTextLabel: 'Free full text',
      year: 2026,
      venue: 'Canonical Journal',
      confidence: 0.95,
      observedAt: observedAt.toISOString(),
      externalIds: {
        doi: '10.1234/canonical',
      },
    });
  });
});
