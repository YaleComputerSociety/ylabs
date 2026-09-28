import { describe, expect, it } from 'vitest';
import {
  extractRosterMemberIdentityEvidence,
  isYaleHostedUrl,
  parseRosterMemberIdentityEvidence,
} from '../rosterMemberIdentityEvidence';

const PAGE_URL = 'https://fixture.yale.edu/center/profile/avery-synthetic/';
const MEMBER = 'Avery Synthetic';

const page = (head: string, body: string) =>
  `<html><head>${head}</head><body>${body}</body></html>`;

describe('extractRosterMemberIdentityEvidence (#3802)', () => {
  it("reads the page's canonical link and the Yale person pages it links", () => {
    const evidence = extractRosterMemberIdentityEvidence(
      page(
        '<link rel="canonical" href="https://fixture.yale.edu/profile/avery-synthetic/">',
        '<a href="https://dept.yale.edu/people/avery-synthetic">Department page</a>' +
          '<a href="/center/events">Events</a>' +
          '<a href="https://elsewhere.example.org/people/avery-synthetic">Off Yale</a>',
      ),
      PAGE_URL,
      MEMBER,
    );
    expect(evidence.linkedProfileUrls).toEqual([
      PAGE_URL,
      'https://fixture.yale.edu/profile/avery-synthetic/',
      'https://dept.yale.edu/people/avery-synthetic',
    ]);
  });

  it("keeps only the member's own Yale email and never reads one from body text", () => {
    const evidence = extractRosterMemberIdentityEvidence(
      page(
        '',
        '<a href="mailto:avery.synthetic@yale.edu">Email</a>' +
          '<a href="mailto:center.contact@yale.edu">Office</a>' +
          '<a href="mailto:avery.synthetic@example.org">Personal</a>' +
          '<p>Contact blair.synthetic2@yale.edu or avery.synthetic2@yale.edu</p>',
      ),
      PAGE_URL,
      MEMBER,
    );
    expect(evidence.emails).toEqual(['avery.synthetic@yale.edu']);
  });

  it('reads a netid only where the Person metadata labels it one', () => {
    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'Person',
      name: MEMBER,
      email: 'avery.synthetic@yale.edu',
      identifier: [
        { '@type': 'PropertyValue', propertyID: 'NetID', value: 'AS123' },
        { '@type': 'PropertyValue', propertyID: 'ORCID', value: '0000-0000-0000-0000' },
      ],
    };
    const evidence = extractRosterMemberIdentityEvidence(
      page(`<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`, ''),
      PAGE_URL,
      MEMBER,
    );
    expect(evidence.netids).toEqual(['as123']);
    expect(evidence.emails).toEqual(['avery.synthetic@yale.edu']);
  });

  it('treats only Yale hosts as profile pages worth following', () => {
    expect(isYaleHostedUrl(PAGE_URL)).toBe(true);
    expect(isYaleHostedUrl('https://yale.edu.example.org/profile/x')).toBe(false);
    expect(isYaleHostedUrl('mailto:avery.synthetic@yale.edu')).toBe(false);
    expect(isYaleHostedUrl(undefined)).toBe(false);
  });
});

describe('parseRosterMemberIdentityEvidence', () => {
  it('drops off-Yale links, non-Yale emails and malformed netids', () => {
    expect(
      parseRosterMemberIdentityEvidence({
        pageUrl: PAGE_URL,
        linkedProfileUrls: [PAGE_URL, 'https://elsewhere.example.org/p'],
        emails: ['Avery.Synthetic@yale.edu', 'avery@example.org'],
        netids: ['as123', 'not a netid'],
      }),
    ).toEqual({
      pageUrl: PAGE_URL,
      linkedProfileUrls: [PAGE_URL],
      emails: ['avery.synthetic@yale.edu'],
      netids: ['as123'],
    });
  });

  it('reads evidence that states nothing as no evidence', () => {
    expect(
      parseRosterMemberIdentityEvidence({
        pageUrl: PAGE_URL,
        linkedProfileUrls: [],
        emails: [],
        netids: [],
      }),
    ).toBeNull();
    expect(parseRosterMemberIdentityEvidence('not evidence')).toBeNull();
  });
});
