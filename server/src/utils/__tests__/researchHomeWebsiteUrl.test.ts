import { describe, expect, it } from 'vitest';
import {
  isListingOrIndexUrl,
  isPersonProfileOrDirectoryUrl,
  isProfileOrPeopleDirectoryPath,
  sourceUrlToResearchHomeWebsiteUrl,
} from '../researchHomeWebsiteUrl';

describe('isProfileOrPeopleDirectoryPath', () => {
  it('matches profile, people, faculty, and faculty-directory paths', () => {
    expect(isProfileOrPeopleDirectoryPath('/profile/jordan-example/')).toBe(true);
    expect(isProfileOrPeopleDirectoryPath('/people/jordan-example/')).toBe(true);
    expect(isProfileOrPeopleDirectoryPath('/person/jordan-example/')).toBe(true);
    expect(isProfileOrPeopleDirectoryPath('/faculty/jordan-example/')).toBe(true);
    expect(
      isProfileOrPeopleDirectoryPath('/research-and-faculty/faculty-directory/jordan-example/'),
    ).toBe(true);
    expect(isProfileOrPeopleDirectoryPath('/directory/faculty/jordan-example/')).toBe(true);
    expect(isProfileOrPeopleDirectoryPath('/who-we-are/faculty/jordan-example/')).toBe(true);
  });

  it('does not match real lab or research home paths', () => {
    expect(isProfileOrPeopleDirectoryPath('/')).toBe(false);
    expect(isProfileOrPeopleDirectoryPath('/research/')).toBe(false);
    expect(isProfileOrPeopleDirectoryPath('/genomics/')).toBe(false);
    expect(isProfileOrPeopleDirectoryPath('/labs/molecular-biology/')).toBe(false);
  });
});

describe('isListingOrIndexUrl', () => {
  it('flags A-Z / lab-website index pages', () => {
    expect(
      isListingOrIndexUrl('https://medicine.example.edu/about/a-to-z-index/lab-websites'),
    ).toBe(true);
    expect(isListingOrIndexUrl('https://medicine.example.edu/about/a-to-z-index/')).toBe(true);
  });

  it('flags paginated directory listings', () => {
    expect(isListingOrIndexUrl('https://physics.example.edu/people?page=8')).toBe(true);
    expect(isListingOrIndexUrl('https://physics.example.edu/faculty?page=2&sort=az')).toBe(true);
  });

  it('flags bare people, people/faculty, and faculty roster roots', () => {
    expect(isListingOrIndexUrl('https://physics.example.edu/people')).toBe(true);
    expect(isListingOrIndexUrl('https://physics.example.edu/people/')).toBe(true);
    expect(isListingOrIndexUrl('https://physics.example.edu/people/faculty')).toBe(true);
    expect(isListingOrIndexUrl('https://physics.example.edu/mcdb/faculty/')).toBe(true);
    expect(isListingOrIndexUrl('https://centers.example.edu/directory')).toBe(true);
  });

  it('does not flag real lab, center, or person pages', () => {
    expect(isListingOrIndexUrl('https://example-computing-lab.example.org/')).toBe(false);
    expect(isListingOrIndexUrl('https://centers.example.edu/genomics/')).toBe(false);
    expect(isListingOrIndexUrl('https://physics.example.edu/people/jordan-example/')).toBe(false);
    expect(isListingOrIndexUrl('mailto:someone@example.org')).toBe(false);
    expect(isListingOrIndexUrl(undefined)).toBe(false);
  });
});

describe('isPersonProfileOrDirectoryUrl', () => {
  it('flags Yale-style profile and faculty-directory pages regardless of host', () => {
    expect(
      isPersonProfileOrDirectoryUrl(
        'https://engineering.example.edu/research-and-faculty/faculty-directory/jordan-example/',
      ),
    ).toBe(true);
    expect(
      isPersonProfileOrDirectoryUrl('https://medicine.example.edu/profile/jordan-example/'),
    ).toBe(true);
    expect(isPersonProfileOrDirectoryUrl('https://physics.example.edu/people/jordan-example')).toBe(
      true,
    );
  });

  it('does not flag real lab microsites or external personal sites', () => {
    expect(isPersonProfileOrDirectoryUrl('https://lab.example.org/')).toBe(false);
    expect(isPersonProfileOrDirectoryUrl('https://molecular-example-lab.example.edu/')).toBe(false);
    expect(isPersonProfileOrDirectoryUrl('https://example-scholar.example.com/')).toBe(false);
    expect(isPersonProfileOrDirectoryUrl('https://centers.example.edu/genomics/')).toBe(false);
  });

  it('ignores non-http and malformed values', () => {
    expect(isPersonProfileOrDirectoryUrl('mailto:someone@example.org')).toBe(false);
    expect(isPersonProfileOrDirectoryUrl('not a url')).toBe(false);
    expect(isPersonProfileOrDirectoryUrl(undefined)).toBe(false);
    expect(isPersonProfileOrDirectoryUrl(42)).toBe(false);
  });
});

describe('sourceUrlToResearchHomeWebsiteUrl', () => {
  it('accepts external personal sites and specific lab microsites', () => {
    expect(sourceUrlToResearchHomeWebsiteUrl('https://example-computing-lab.example.org/')).toBe(
      'https://example-computing-lab.example.org/',
    );
    expect(sourceUrlToResearchHomeWebsiteUrl('https://examplelab.example.edu')).toBe(
      'https://examplelab.example.edu/',
    );
  });

  it('rejects profile, directory, opportunity, and content source URLs', () => {
    expect(
      sourceUrlToResearchHomeWebsiteUrl('https://medicine.example.edu/profile/jordan-example/'),
    ).toBe('');
    expect(
      sourceUrlToResearchHomeWebsiteUrl(
        'https://engineering.example.edu/research-and-faculty/faculty-directory/jordan-example/',
      ),
    ).toBe('');
    expect(
      sourceUrlToResearchHomeWebsiteUrl('https://cancer.example.edu/research/membership/directory'),
    ).toBe('');
    expect(
      sourceUrlToResearchHomeWebsiteUrl(
        'https://psychology.example.edu/diversity/research-opportunities-undergraduates',
      ),
    ).toBe('');
    expect(sourceUrlToResearchHomeWebsiteUrl('https://news.example.edu/story/2026/award/')).toBe(
      '',
    );
  });

  it('rejects grant and identifier hosts', () => {
    expect(sourceUrlToResearchHomeWebsiteUrl('https://reporter.nih.gov/project/1')).toBe('');
    expect(sourceUrlToResearchHomeWebsiteUrl('https://api.nsf.gov/services/v1/awards.json')).toBe(
      '',
    );
  });

  it('rejects directory, index, and paginated listing source URLs', () => {
    expect(
      sourceUrlToResearchHomeWebsiteUrl(
        'https://medicine.example.edu/about/a-to-z-index/lab-websites',
      ),
    ).toBe('');
    expect(sourceUrlToResearchHomeWebsiteUrl('https://physics.example.edu/people?page=8')).toBe('');
    expect(sourceUrlToResearchHomeWebsiteUrl('https://physics.example.edu/mcdb/faculty/')).toBe('');
  });
});
