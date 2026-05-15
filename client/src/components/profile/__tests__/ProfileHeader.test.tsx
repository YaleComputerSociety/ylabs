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
});
