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

describe('extractRosterMemberIdentityEvidence reads only the page subject (#5592)', () => {
  const PAGE = 'https://medicine.yale.edu/profile/avery-synthetic/';
  const ysmProfileWithWidgets = `<html><head><link rel="canonical" href="${PAGE}"></head><body>
    <main><article class="profile-details">
      <header class="profile-details-header"><h1>Avery Synthetic, MD</h1>
        <a href="https://medicine.yale.edu/profile/avery-synthetic/">Avery Synthetic</a>
        <a href="https://medicine.yale.edu/lab/synthetic/">Lab Website</a></header>
      <section class="profile-details-content-section" id="get-in-touch-administrative-support">
        <div class="profile-list"><ul><li class="profile-list__item">
          <a href="https://medicine.yale.edu/profile/blair-fixture/">Blair Fixture</a></li></ul></div></section>
      <article class="card"><div class="achievement-activity-card__related-items-container"><ul>
        <li class="achievement-activity-card__related-item"><a href="https://medicine.yale.edu/profile/casey-coauthor/">Casey Coauthor</a></li>
        <li class="achievement-activity-card__related-item"><a href="https://medicine.yale.edu/profile/dana-coauthor/">A study of synthetic outcomes</a></li>
      </ul></div></article>
      <footer class="profile-details-footer"><a href="https://medicine.yale.edu/profile/edit/">Profile</a></footer>
    </article></main>
    <footer class="footer"><nav><a href="https://medicine.yale.edu/profile/footer-person/">Profile</a></nav></footer>
  </body></html>`;

  it('keeps the subject own profile and generic-labelled links, never co-author, admin or footer links', () => {
    const evidence = extractRosterMemberIdentityEvidence(
      ysmProfileWithWidgets,
      PAGE,
      'Avery Synthetic',
    );
    expect(evidence.linkedProfileUrls).toContain(
      'https://medicine.yale.edu/profile/avery-synthetic/',
    );
    for (const other of [
      'blair-fixture',
      'casey-coauthor',
      'dana-coauthor',
      'footer-person',
      'profile/edit',
    ]) {
      expect(evidence.linkedProfileUrls.some((url) => url.includes(other))).toBe(false);
    }
  });

  it('keeps a center person page "Website" link to the subject departmental profile', () => {
    const page = 'https://center.yale.edu/people/avery-synthetic';
    const html = `<html><body><main><h1>Avery Synthetic</h1>
      <div class="contact"><a href="https://medicine.yale.edu/profile/avery-synthetic/">Website</a></div>
      <aside><h3>Related people</h3><a href="https://medicine.yale.edu/profile/blair-fixture/">Website</a></aside>
    </main></body></html>`;
    const evidence = extractRosterMemberIdentityEvidence(html, page, 'Avery Synthetic');
    expect(evidence.linkedProfileUrls).toEqual([
      page,
      'https://medicine.yale.edu/profile/avery-synthetic/',
    ]);
  });

  it('reads Person metadata and netids only from the node naming the subject', () => {
    const page = 'https://center.yale.edu/people/grid';
    const html = `<html><head><script type="application/ld+json">${JSON.stringify([
      {
        '@type': 'Person',
        name: 'Avery Synthetic',
        sameAs: 'https://medicine.yale.edu/profile/avery-synthetic/',
        identifier: { '@type': 'PropertyValue', propertyID: 'netid', value: 'as1111' },
      },
      {
        '@type': 'Person',
        name: 'Blair Fixture',
        sameAs: 'https://medicine.yale.edu/profile/blair-fixture/',
        identifier: { '@type': 'PropertyValue', propertyID: 'netid', value: 'bf2222' },
      },
    ])}</script></head><body></body></html>`;
    const evidence = extractRosterMemberIdentityEvidence(html, page, 'Avery Synthetic');
    expect(evidence.linkedProfileUrls).toContain(
      'https://medicine.yale.edu/profile/avery-synthetic/',
    );
    expect(evidence.linkedProfileUrls.some((url) => url.includes('blair-fixture'))).toBe(false);
    expect(evidence.netids).toEqual(['as1111']);
  });

  it('gives the same evidence on a second read of the same page', () => {
    const first = extractRosterMemberIdentityEvidence(
      ysmProfileWithWidgets,
      PAGE,
      'Avery Synthetic',
    );
    expect(
      extractRosterMemberIdentityEvidence(ysmProfileWithWidgets, PAGE, 'Avery Synthetic'),
    ).toEqual(first);
  });
});
