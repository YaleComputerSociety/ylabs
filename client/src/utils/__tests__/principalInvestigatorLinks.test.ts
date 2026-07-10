import { describe, expect, it } from 'vitest';

import {
  principalInvestigatorLinkFromMemberUser,
  principalInvestigatorLinkFromResearchEntity,
} from '../principalInvestigatorLinks';

describe('principal investigator profile links', () => {
  it('uses verified official profile URLs for member profile links', () => {
    expect(
      principalInvestigatorLinkFromMemberUser({
        netid: 'ab123',
        email: 'fixture.advisor@yale.edu',
        profileUrls: {
          official: 'https://medicine.yale.edu/profile/fixture-scholar/',
        },
      }),
    ).toEqual({
      href: 'https://medicine.yale.edu/profile/fixture-scholar/',
      external: true,
    });
  });

  it('does not create public member links from internal identifiers', () => {
    expect(principalInvestigatorLinkFromMemberUser({ netid: 'ab123' })).toBeUndefined();
    expect(
      principalInvestigatorLinkFromMemberUser({ email: 'fixture.advisor@yale.edu' }),
    ).toBeUndefined();
    expect(
      principalInvestigatorLinkFromMemberUser({ publicKey: 'fixture-scholar-pi' }),
    ).toBeUndefined();
  });

  it('uses explicit internal profile paths when no official profile URL exists', () => {
    expect(
      principalInvestigatorLinkFromMemberUser({
        internalProfilePath: '/profile/fx1001',
        profileUrls: {
          orcid: 'https://orcid.org/0000-0000-0000-0000',
        },
      }),
    ).toEqual({
      href: '/profile/fx1001',
      external: false,
    });
  });

  it('does not treat generic Yale faculty category pages as official profile URLs', () => {
    expect(
      principalInvestigatorLinkFromMemberUser({
        internalProfilePath: '/profile/fx1001',
        websiteUrl: 'https://example.yale.edu/people/faculty/primary',
      }),
    ).toEqual({
      href: '/profile/fx1001',
      external: false,
    });
  });

  it('prefers internal profile paths over safe public websites when no official profile URL exists', () => {
    expect(
      principalInvestigatorLinkFromMemberUser({
        website: 'https://fixture-scholar.example.test/',
        internalProfilePath: '/profile/fx1001',
        profileUrls: {
          orcid: 'https://orcid.org/0000-0000-0000-0000',
        },
      }),
    ).toEqual({
      href: '/profile/fx1001',
      external: false,
    });
  });

  it('ignores unsafe website fallbacks before using internal profile paths', () => {
    expect(
      principalInvestigatorLinkFromMemberUser({
        website: 'javascript:alert(1)',
        internal_profile_path: '/profile/fx1001',
      }),
    ).toEqual({
      href: '/profile/fx1001',
      external: false,
    });
  });

  it('prefers official profile URLs over internal profile paths', () => {
    expect(
      principalInvestigatorLinkFromMemberUser({
        internalProfilePath: '/profile/fx1001',
        profileUrls: {
          official: 'https://medicine.yale.edu/profile/fixture-scholar/',
        },
      }),
    ).toEqual({
      href: 'https://medicine.yale.edu/profile/fixture-scholar/',
      external: true,
    });
  });

  it('prefers official profile URLs over website fallbacks', () => {
    expect(
      principalInvestigatorLinkFromMemberUser({
        website: 'https://fixture-scholar.example.test/',
        internalProfilePath: '/profile/fx1001',
        profileUrls: {
          official: 'https://medicine.yale.edu/profile/fixture-scholar/',
        },
      }),
    ).toEqual({
      href: 'https://medicine.yale.edu/profile/fixture-scholar/',
      external: true,
    });
  });

  it('prefers internal profile paths over non-official websites', () => {
    expect(
      principalInvestigatorLinkFromMemberUser({
        internalProfilePath: '/profile/fx1001',
        websiteUrl: 'https://example.test/fixture-lab',
      }),
    ).toEqual({
      href: '/profile/fx1001',
      external: false,
    });
  });

  it('uses official profile URLs attached to research entity source fields', () => {
    expect(
      principalInvestigatorLinkFromResearchEntity({
        sourceUrls: ['https://medicine.yale.edu/profile/fixture-scholar/'],
      }),
    ).toEqual({
      href: 'https://medicine.yale.edu/profile/fixture-scholar/',
      external: true,
    });
    expect(
      principalInvestigatorLinkFromResearchEntity({ contactEmail: 'fixture.advisor@yale.edu' }),
    ).toBeUndefined();
  });
});
