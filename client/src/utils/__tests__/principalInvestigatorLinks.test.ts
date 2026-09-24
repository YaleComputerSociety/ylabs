import { describe, expect, it } from 'vitest';

import {
  officialProfileUrlFromMemberUser,
  orcidRecordUrlFromMemberUser,
  principalInvestigatorLinkFromResearchEntity,
} from '../principalInvestigatorLinks';

describe('principal investigator profile links', () => {
  it('returns the lead member official profile URL for the open-profile CTA', () => {
    expect(
      officialProfileUrlFromMemberUser({
        profileUrls: {
          official: 'https://medicine.yale.edu/profile/fixture-scholar/',
        },
      }),
    ).toBe('https://medicine.yale.edu/profile/fixture-scholar/');
  });

  it('does not surface a lab website as an open-profile CTA target', () => {
    expect(
      officialProfileUrlFromMemberUser({
        websiteUrl: 'https://medicine.yale.edu/lab/fixture-lab/',
      }),
    ).toBeUndefined();
    expect(officialProfileUrlFromMemberUser(undefined)).toBeUndefined();
    expect(officialProfileUrlFromMemberUser({ netid: 'ab123' })).toBeUndefined();
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

describe('orcidRecordUrlFromMemberUser', () => {
  const ORCID = '0000-0002-1825-0097';

  it('links the server-built record URL', () => {
    expect(
      orcidRecordUrlFromMemberUser({ orcid: ORCID, orcidUrl: `https://orcid.org/${ORCID}` }),
    ).toBe(`https://orcid.org/${ORCID}`);
  });

  it('withholds a link when either half is missing', () => {
    expect(orcidRecordUrlFromMemberUser({ orcid: ORCID })).toBeUndefined();
    expect(
      orcidRecordUrlFromMemberUser({ orcidUrl: `https://orcid.org/${ORCID}` }),
    ).toBeUndefined();
    expect(orcidRecordUrlFromMemberUser(undefined)).toBeUndefined();
  });

  it('refuses a record URL pointed at another host', () => {
    expect(
      orcidRecordUrlFromMemberUser({ orcid: ORCID, orcidUrl: `https://orcid.org.evil/${ORCID}` }),
    ).toBeUndefined();
    expect(
      orcidRecordUrlFromMemberUser({ orcid: ORCID, orcidUrl: `javascript:alert(1)` }),
    ).toBeUndefined();
  });
});
