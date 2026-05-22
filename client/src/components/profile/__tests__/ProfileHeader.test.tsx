import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FacultyProfile } from '../../../types/types';
import ProfileHeader from '../ProfileHeader';

const baseProfile: FacultyProfile = {
  netid: 'al123',
  fname: 'Ada',
  lname: 'Lovelace',
  email: 'ada.lovelace@yale.edu',
  title: 'Professor of Computation',
  primary_department: 'Computer Science',
  secondary_departments: [],
  departments: ['Computer Science'],
  profile_urls: {},
  publications: [],
  research_interests: [],
  topics: [],
  profileVerified: false,
  ownListings: [],
};

describe('ProfileHeader', () => {
  it('surfaces ORCID as a low-prominence profile link when an ORCID id is present', () => {
    const { container } = render(
      <ProfileHeader profile={{ ...baseProfile, orcid: '0000-0002-1825-0097' }} />,
    );

    const link = container.querySelector('a[href="https://orcid.org/0000-0002-1825-0097"]');
    expect(link).not.toBeNull();
    expect(link?.textContent).toBe('ORCID');
    expect(link?.getAttribute('aria-label')).toBe('Ada Lovelace ORCID profile');
  });

  it('uses profile_urls.orcid as a fallback and does not render a duplicate generic link', () => {
    const { container } = render(
      <ProfileHeader
        profile={{
          ...baseProfile,
          profile_urls: {
            orcid: 'https://orcid.org/0000-0002-1825-0097',
            lab_website: 'https://example.edu/lab',
          },
        }}
      />,
    );

    const links = Array.from(container.querySelectorAll('a')).filter(
      (link) => link.textContent === 'ORCID',
    );
    expect(links).toHaveLength(1);
    expect(container.textContent).toContain('lab website');
  });

  it('deduplicates profile URL aliases that point to the same destination', () => {
    const { container } = render(
      <ProfileHeader
        profile={{
          ...baseProfile,
          profile_urls: {
            medicine: 'https://medicine.yale.edu/profile/david-vandijk/',
            official: 'https://medicine.yale.edu/profile/david-vandijk/',
          },
        }}
      />,
    );

    const duplicateLinks = container.querySelectorAll(
      'a[href="https://medicine.yale.edu/profile/david-vandijk/"]',
    );
    expect(duplicateLinks).toHaveLength(1);
    expect(duplicateLinks[0].textContent).toBe('medicine');
    expect(container.textContent).not.toContain('official');
  });

  it('renders the professor website as a first-class profile link', () => {
    const { container } = render(
      <ProfileHeader profile={{ ...baseProfile, website: 'https://ada.example.edu/' }} />,
    );

    const link = container.querySelector('a[href="https://ada.example.edu/"]');
    expect(link).not.toBeNull();
    expect(link?.textContent).toBe('Website');
  });

  it('keeps profile contact and external links large enough for touch input', () => {
    const { container } = render(
      <ProfileHeader
        profile={{
          ...baseProfile,
          website: 'https://ada.example.edu/',
          orcid: '0000-0002-1825-0097',
          profile_urls: {
            departmental: 'https://cs.yale.edu/ada-lovelace',
          },
        }}
      />,
    );

    const links = [
      container.querySelector('a[href="mailto:ada.lovelace@yale.edu"]'),
      container.querySelector('a[href="https://ada.example.edu/"]'),
      container.querySelector('a[href="https://orcid.org/0000-0002-1825-0097"]'),
      container.querySelector('a[href="https://cs.yale.edu/ada-lovelace"]'),
    ];

    for (const link of links) {
      expect(link?.className).toContain('min-h-[44px]');
    }
  });

  it('does not surface legacy listing counts from faculty profiles', () => {
    const { container } = render(
      <ProfileHeader profile={{ ...baseProfile, ownListings: ['listing-1', 'listing-2'] }} />,
    );

    expect(container.textContent).not.toContain('listing');
  });

  it('crops profile images toward the face area instead of centering full portraits', () => {
    const { container } = render(
      <ProfileHeader
        profile={{
          ...baseProfile,
          image_url: 'https://example.edu/full-portrait.jpg',
        }}
      />,
    );

    const image = container.querySelector('img[alt="Ada Lovelace"]');
    expect(image?.className).toContain('object-cover');
    expect(image?.className).toContain('object-top');
  });
});
