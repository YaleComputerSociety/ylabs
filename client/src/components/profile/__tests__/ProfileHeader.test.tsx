import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import ConfigContext, { defaultConfigContext } from '../../../contexts/ConfigContext';
import { FacultyProfile } from '../../../types/types';
import ProfileHeader from '../ProfileHeader';

const baseProfile: FacultyProfile = {
  netid: 'fixture-profile',
  fname: 'Example',
  lname: 'Researcher',
  email: 'researcher@example.test',
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

const renderProfileHeader = (profile: FacultyProfile) =>
  render(
    <ConfigContext.Provider
      value={{
        ...defaultConfigContext,
        departments: [
          {
            _id: 'cpsc',
            abbreviation: 'CPSC',
            name: 'Computer Science',
            displayName: 'CPSC - Computer Science',
            aliases: ['EASCPS Computer Science'],
            isActive: true,
          } as any,
        ],
      }}
    >
      <ProfileHeader profile={profile} />
    </ConfigContext.Provider>,
  );

describe('ProfileHeader', () => {
  it('surfaces ORCID as a low-prominence profile link when an ORCID id is present', () => {
    const { container } = renderProfileHeader({
      ...baseProfile,
      orcid: '0000-0000-0000-001X',
    });

    const link = container.querySelector('a[href="https://orcid.org/0000-0000-0000-001X"]');
    expect(link).not.toBeNull();
    expect(link?.textContent).toBe('ORCID');
    expect(link?.getAttribute('aria-label')).toBe('Example Researcher ORCID profile');
  });

  it('uses profile_urls.orcid as a fallback and does not render a duplicate generic link', () => {
    const { container } = renderProfileHeader({
      ...baseProfile,
      profile_urls: {
        orcid: 'https://orcid.org/0000-0000-0000-001X',
        lab_website: 'https://research-home.example.test',
      },
    });

    const links = Array.from(container.querySelectorAll('a')).filter(
      (link) => link.textContent === 'ORCID',
    );
    expect(links).toHaveLength(1);
    expect(container.textContent).toContain('lab website');
  });

  it('deduplicates profile URL aliases that point to the same destination', () => {
    const { container } = renderProfileHeader({
      ...baseProfile,
      profile_urls: {
        medicine: 'https://profile.example.test/example-researcher/',
        official: 'https://profile.example.test/example-researcher/',
      },
    });

    const duplicateLinks = container.querySelectorAll(
      'a[href="https://profile.example.test/example-researcher/"]',
    );
    expect(duplicateLinks).toHaveLength(1);
    expect(duplicateLinks[0].textContent).toBe('medicine');
    expect(container.textContent).not.toContain('official');
  });

  it('renders the professor website as a first-class profile link', () => {
    const { container } = renderProfileHeader({
      ...baseProfile,
      website: 'https://researcher.example.test/',
    });

    const link = container.querySelector('a[href="https://researcher.example.test/"]');
    expect(link).not.toBeNull();
    expect(link?.textContent).toBe('Website');
  });

  it('keeps profile contact and external links large enough for touch input', () => {
    const { container } = renderProfileHeader({
      ...baseProfile,
      website: 'https://researcher.example.test/',
      orcid: '0000-0000-0000-001X',
      profile_urls: {
        departmental: 'https://department.example.test/example-researcher',
      },
    });

    const links = [
      container.querySelector('a[href="mailto:researcher@example.test"]'),
      container.querySelector('a[href="https://researcher.example.test/"]'),
      container.querySelector('a[href="https://orcid.org/0000-0000-0000-001X"]'),
      container.querySelector('a[href="https://department.example.test/example-researcher"]'),
    ];

    for (const link of links) {
      expect(link?.className).toContain('min-h-[44px]');
    }
  });

  it('does not render an email link when the profile email contains mailto header injection', () => {
    const { container } = renderProfileHeader({
      ...baseProfile,
      email: 'researcher@example.test?bcc=attacker@example.test',
    });

    expect(container.querySelector('a[href^="mailto:"]')).toBeNull();
    expect(container.textContent).not.toContain('researcher@example.test?bcc=attacker@example.test');
  });

  it('does not surface legacy listing counts from faculty profiles', () => {
    const { container } = renderProfileHeader({
      ...baseProfile,
      ownListings: ['listing-1', 'listing-2'],
    });

    expect(container.textContent).not.toContain('listing');
  });

  it('crops profile images toward the face area instead of centering full portraits', () => {
    const { container } = renderProfileHeader({
      ...baseProfile,
      image_url: 'https://images.example.test/full-portrait.jpg',
    });

    const image = container.querySelector('img[alt="Example Researcher"]');
    expect(image?.className).toContain('object-cover');
    expect(image?.className).toContain('object-top');
  });

  it('shows canonical CPSC profile department labels without raw Yale org-unit labels', () => {
    const { container } = renderProfileHeader({
      ...baseProfile,
      primary_department: 'EASCPS Computer Science',
      secondary_departments: ['EAS School of Engineering and Applied Science'],
      departments: ['Computer Science'],
    });

    expect(container.textContent).toContain('CPSC - Computer Science');
    expect(container.textContent).not.toContain('EASCPS');
  });
});
