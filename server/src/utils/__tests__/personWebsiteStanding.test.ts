import { describe, expect, it } from 'vitest';
import {
  PERSON_WEBSITE_STANDING,
  isSamePersonWebsite,
  personWebsiteStanding,
  preferredPersonWebsiteCandidate,
} from '../personWebsiteStanding';

describe('personWebsiteStanding (#5845)', () => {
  it('ranks a profile or directory page below an own website and above nothing', () => {
    expect(personWebsiteStanding('https://medicine.yale.edu/profile/fixture-person/')).toBe(
      PERSON_WEBSITE_STANDING.profileOrDirectoryPage,
    );
    expect(
      personWebsiteStanding(
        'https://seas.yale.edu/faculty-research/faculty-directory/fixture-person',
      ),
    ).toBe(PERSON_WEBSITE_STANDING.profileOrDirectoryPage);
    expect(personWebsiteStanding('https://fixturelab.example.org/')).toBe(
      PERSON_WEBSITE_STANDING.ownWebsite,
    );
    expect(personWebsiteStanding('')).toBe(PERSON_WEBSITE_STANDING.none);
    expect(personWebsiteStanding(undefined)).toBe(PERSON_WEBSITE_STANDING.none);
  });

  it('prefers the first own website over an earlier-ranked profile page', () => {
    const preferred = preferredPersonWebsiteCandidate([
      { value: 'https://medicine.yale.edu/profile/fixture-person/' },
      { value: 'https://fixturelab.example.org/' },
      { value: 'https://otherlab.example.org/' },
    ]);
    expect(preferred?.value).toBe('https://fixturelab.example.org/');
  });
});

describe('isSamePersonWebsite (#5845)', () => {
  it('treats a scheme, www or trailing-slash respelling as the same site', () => {
    expect(
      isSamePersonWebsite('https://fixturelab.example.org/', 'http://fixturelab.example.org'),
    ).toBe(true);
    expect(
      isSamePersonWebsite(
        'https://www.fixturelab.example.org/a',
        'https://fixturelab.example.org/a/',
      ),
    ).toBe(true);
  });

  it('keeps different paths and different query strings distinct', () => {
    expect(
      isSamePersonWebsite('https://fixturelab.example.org/a', 'https://fixturelab.example.org/b'),
    ).toBe(false);
    expect(
      isSamePersonWebsite(
        'https://fixture.example.org/page?id=1',
        'https://fixture.example.org/page?id=2',
      ),
    ).toBe(false);
  });
});
