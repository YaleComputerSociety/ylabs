import { describe, expect, it } from 'vitest';
import * as cheerio from 'cheerio';
import { syntheticPersonOrcid, withOrcidCheckDigit } from '../../../test/syntheticOrcid';
import {
  ROSTER_MEMBER_IDENTITY_EVIDENCE_EXTRACTOR_VERSION,
  extractRosterMemberIdentityEvidence,
  isYaleHostedUrl,
  parseRosterMemberIdentityEvidence,
  singleStatedOrcid,
  subjectProfileStatesNoOrcid,
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

describe('extractRosterMemberIdentityEvidence ignores colleague cards (#5677)', () => {
  const PAGE = 'https://medicine.yale.edu/profile/avery-synthetic/';
  const card = (slug: string, name: string) => `<article class="profile-grid-item">
      <div class="profile-grid-item__thumbnail-container"><a href="/profile/${slug}/" class="profile-grid-item__link-details" tabindex="-1"></a></div>
      <div class="profile-grid-item__name-container"><a href="/profile/${slug}/" class="profile-grid-item__link-details" tabindex="-1"><span class="profile-grid-item__name profile-grid-item__name--link">${name}</span></a></div>
      <div class="profile-grid-item__link-details-container"><a href="/profile/${slug}/" tabindex="0" class="link">View Full Profile</a></div>
    </article>`;
  const page = (cards: string[]) => `<html><body><main><article class="profile-details">
      <header class="profile-details-header"><h1>Avery Synthetic, MD</h1>
        <a href="https://som.yale.edu/faculty-research/faculty-directory/avery-synthetic">Faculty Profile</a></header>
      <section class="profile-details-content-section"><h2>Co-Authors</h2>
        <div class="profile-grid"><ul class="profile-grid__item-container">${cards
          .map((c) => `<li>${c}</li>`)
          .join('')}</ul></div></section>
    </article></main></body></html>`;

  it('drops every co-author card in a grid and keeps the subject own profile link', () => {
    const evidence = extractRosterMemberIdentityEvidence(
      page([card('casey-coauthor', 'Casey Coauthor'), card('dana-coauthor', 'Dana Coauthor')]),
      PAGE,
      'Avery Synthetic',
    );
    expect(evidence.linkedProfileUrls).toEqual([
      PAGE,
      'https://som.yale.edu/faculty-research/faculty-directory/avery-synthetic',
    ]);
  });

  it('drops a lone co-author card whose generic label is not repeated', () => {
    const evidence = extractRosterMemberIdentityEvidence(
      page([card('casey-coauthor', 'Casey Coauthor')]),
      PAGE,
      'Avery Synthetic',
    );
    expect(evidence.linkedProfileUrls.some((url) => url.includes('casey-coauthor'))).toBe(false);
  });

  it('keeps the subject own card in a grid of colleagues', () => {
    const evidence = extractRosterMemberIdentityEvidence(
      page([
        card('avery-synthetic-2', 'Avery Synthetic'),
        card('casey-coauthor', 'Casey Coauthor'),
      ]),
      'https://center.yale.edu/people/avery',
      'Avery Synthetic',
    );
    expect(evidence.linkedProfileUrls).toContain(
      'https://center.yale.edu/profile/avery-synthetic-2/',
    );
    expect(evidence.linkedProfileUrls.some((url) => url.includes('casey-coauthor'))).toBe(false);
  });

  it('drops a generic label repeated to several pages unless the URL names the member', () => {
    const html = `<html><body><main>
      <div><a href="https://medicine.yale.edu/profile/casey-coauthor/">Profile</a></div>
      <div><a href="https://medicine.yale.edu/profile/dana-coauthor/">Profile</a></div>
      <div><a href="https://medicine.yale.edu/profile/avery-synthetic/">Profile</a></div>
    </main></body></html>`;
    const evidence = extractRosterMemberIdentityEvidence(
      html,
      'https://center.yale.edu/people/avery',
      'Avery Synthetic',
    );
    expect(evidence.linkedProfileUrls).toEqual([
      'https://center.yale.edu/people/avery',
      'https://medicine.yale.edu/profile/avery-synthetic/',
    ]);
  });

  it('drops a generic link to a page that is not one person profile', () => {
    const html = `<html><body><main>
      <a href="https://center.yale.edu/people/">Website</a>
      <a href="https://center.yale.edu/faculty">Website</a>
    </main></body></html>`;
    const evidence = extractRosterMemberIdentityEvidence(
      html,
      'https://center.yale.edu/person/avery',
      'Avery Synthetic',
    );
    expect(evidence.linkedProfileUrls).toEqual(['https://center.yale.edu/person/avery']);
  });
});

describe('extractRosterMemberIdentityEvidence keeps the subject own links (#5677)', () => {
  const PAGE = 'https://center.yale.edu/people/avery-synthetic';

  it('keeps a school-qualified profile label but not one qualified by a name', () => {
    const html = `<html><body><main>
      <a href="https://som.yale.edu/faculty-research/faculty-directory/avery-synthetic">SOM Faculty Profile</a>
      <a href="https://engineering.yale.edu/research-and-faculty/faculty-directory/avery-synthetic">Engineering Faculty Profile</a>
      <a href="https://medicine.yale.edu/profile/casey-coauthor/">Casey Coauthor Profile</a>
    </main></body></html>`;
    expect(
      extractRosterMemberIdentityEvidence(html, PAGE, 'Avery Synthetic').linkedProfileUrls,
    ).toEqual([
      PAGE,
      'https://som.yale.edu/faculty-research/faculty-directory/avery-synthetic',
      'https://engineering.yale.edu/research-and-faculty/faculty-directory/avery-synthetic',
    ]);
  });

  it('keeps a generic own link beside other labels at the same page that name nobody', () => {
    const own = 'https://medicine.yale.edu/profile/a-synthetic/';
    const html = `<html><body><main>
      <a href="${own}">View Full Profile</a>
      <a href="${own}">Learn more</a>
      <a href="${own}">Dr. Synthetic</a>
      <a href="${own}">Advances in Synthetic Research Methods for Center Studies</a>
    </main></body></html>`;
    expect(
      extractRosterMemberIdentityEvidence(html, PAGE, 'Avery Synthetic').linkedProfileUrls,
    ).toEqual([PAGE, own]);
  });

  it('keeps an anchor whose URL spells the member full name whatever its label, even in an aside', () => {
    const html = `<html><body><main>
      <p>For more, click <a href="https://italian.yale.edu/profile/avery-synthetic">here</a>.</p>
      <aside class="orgs-and-programs"><a href="https://history.yale.edu/people/avery-synthetic">Yale Department of History</a>
        <a href="https://history.yale.edu/people/casey-coauthor">Yale Department of History</a></aside>
    </main></body></html>`;
    const urls = extractRosterMemberIdentityEvidence(
      html,
      PAGE,
      'Avery Synthetic',
    ).linkedProfileUrls;
    expect(urls).toContain('https://italian.yale.edu/profile/avery-synthetic');
    expect(urls).toContain('https://history.yale.edu/people/avery-synthetic');
    expect(urls.some((url) => url.includes('casey-coauthor'))).toBe(false);
  });

  it('reads a credentialed or titled roster name as the member name in a URL', () => {
    const html = `<html><body><main>
      <p>For more, click <a href="https://italian.yale.edu/profile/avery-synthetic">here</a>.</p>
    </main></body></html>`;
    for (const listed of [
      'Avery Synthetic, PhD',
      'Dr. Avery Synthetic',
      'Avery B. Synthetic Jr.',
    ]) {
      expect(extractRosterMemberIdentityEvidence(html, PAGE, listed).linkedProfileUrls).toContain(
        'https://italian.yale.edu/profile/avery-synthetic',
      );
    }
  });

  it('drops a colleague card that shares only the member surname', () => {
    const html = `<html><body><main><ul>
      <li><article><a href="/profile/blair-synthetic/"><span>Blair Synthetic</span></a>
        <a href="/profile/blair-synthetic/">View Full Profile</a></article></li>
      <li><article><a href="/profile/casey-coauthor/"><span>Casey Coauthor</span></a>
        <a href="/profile/casey-coauthor/">View Full Profile</a></article></li>
    </ul></main></body></html>`;
    const urls = extractRosterMemberIdentityEvidence(
      html,
      'https://medicine.yale.edu/profile/avery-synthetic/',
      'Avery Synthetic',
    ).linkedProfileUrls;
    expect(urls).toEqual(['https://medicine.yale.edu/profile/avery-synthetic/']);
  });

  it('never reads navigation or footer links, even when the URL names the member', () => {
    const html = `<html><body><nav><a href="https://medicine.yale.edu/profile/avery-synthetic-2/">Avery</a></nav>
      <footer><a href="https://medicine.yale.edu/profile/avery-synthetic-3/">Profile</a></footer></body></html>`;
    expect(
      extractRosterMemberIdentityEvidence(html, PAGE, 'Avery Synthetic').linkedProfileUrls,
    ).toEqual([PAGE]);
  });
});

describe('extractRosterMemberIdentityEvidence keeps own links on every Yale profile shape (#5677)', () => {
  const PAGE = 'https://center.yale.edu/people/avery-synthetic';

  it.each([
    'https://law.yale.edu/avery-synthetic',
    'https://history.yale.edu/directory/avery-synthetic',
    'https://divinity.yale.edu/faculty-and-research/yds-faculty/avery-synthetic',
  ])('keeps a generically labelled own link to %s', (url) => {
    const html = `<html><body><main><a href="${url}">Profile</a></main></body></html>`;
    expect(
      extractRosterMemberIdentityEvidence(html, PAGE, 'Avery Synthetic').linkedProfileUrls,
    ).toEqual([PAGE, url]);
  });
});

describe('extractRosterMemberIdentityEvidence ignores a lone co-author card (#5677)', () => {
  it('drops the only co-author card on a profile, whose name is plain text', () => {
    const page = 'https://medicine.yale.edu/profile/avery-synthetic/';
    const html = `<html><body><main><h1>Avery Synthetic</h1>
      <section class="profile-details-co-authors"><div class="profile-details-co-author">
        <div class="profile-details-co-author__name">Casey Coauthor</div>
        <div class="profile-details-co-author__profile-link-wrapper"><a href="/profile/casey-coauthor/">View Full Profile</a></div>
      </div></section>
    </main></body></html>`;
    expect(
      extractRosterMemberIdentityEvidence(html, page, 'Avery Synthetic').linkedProfileUrls,
    ).toEqual([page]);
  });

  it("keeps the subject's own website link in a contact block", () => {
    const page = 'https://center.yale.edu/person/avery-synthetic';
    const html = `<html><body><main><div class="node__contact-info"><div class="node__website-link">
      <a href="https://history.yale.edu/people/avery-synthetic">Website</a></div></div></main></body></html>`;
    expect(
      extractRosterMemberIdentityEvidence(html, page, 'Avery Synthetic').linkedProfileUrls,
    ).toContain('https://history.yale.edu/people/avery-synthetic');
  });

  it('keeps own links on a page whose wrapper classes only mention collaborators in passing', () => {
    const page = 'https://medicine.yale.edu/profile/avery-synthetic/';
    const html = `<html><body class="path-our-team-collaborators page-node-type-collaborator">
      <main><div class="education-collaboratory-team"><div class="node__contact-info">
      <a href="https://history.yale.edu/people/avery-synthetic">Website</a></div></div></main></body></html>`;
    expect(
      extractRosterMemberIdentityEvidence(html, page, 'Avery Synthetic').linkedProfileUrls,
    ).toContain('https://history.yale.edu/people/avery-synthetic');
  });
});

describe('subject-scoped ORCID (#5932)', () => {
  const SUBJECT_ORCID = syntheticPersonOrcid(1);
  const OTHER_ORCID = syntheticPersonOrcid(2);
  const profile = (subjectSection: string, elsewhere = '') =>
    page(
      '',
      `<main><article class="profile-details"><header><h1>${MEMBER}, PhD</h1></header>` +
        `<div class="profile-details-section-content__sidebar">${subjectSection}</div>` +
        `</article>${elsewhere}</main>`,
    );
  const orcidLink = (orcid: string) => `<a href="https://orcid.org/${orcid}/">ORCID</a>`;

  it("states the subject's ORCID when the subject node states exactly one", () => {
    const evidence = extractRosterMemberIdentityEvidence(
      profile(`<section class="research-section-orcid">${orcidLink(SUBJECT_ORCID)}</section>`),
      PAGE_URL,
      MEMBER,
    );
    expect(evidence.orcid).toBe(SUBJECT_ORCID);
  });

  it("never reads a co-author's ORCID as the subject's", () => {
    const coAuthors = `<div class="co-authors"><a href="/profile/casey-coauthor/">Casey Coauthor</a>${orcidLink(OTHER_ORCID)}</div>`;
    expect(
      extractRosterMemberIdentityEvidence(
        profile(coAuthors, `<aside>${orcidLink(SUBJECT_ORCID)}</aside>`),
        PAGE_URL,
        MEMBER,
      ).orcid,
    ).toBeUndefined();
  });

  it('states no ORCID when the subject node lists more than one', () => {
    const list = `<section class="research-section-orcid-list"><h3>ORCIDs</h3><ul><li>${orcidLink(SUBJECT_ORCID)}</li><li>${orcidLink(OTHER_ORCID)}</li></ul></section>`;
    expect(
      extractRosterMemberIdentityEvidence(profile(list), PAGE_URL, MEMBER).orcid,
    ).toBeUndefined();
  });

  it('states no ORCID on a page whose heading names someone else', () => {
    const html = page(
      '',
      `<main><article><h1>Casey Coauthor</h1>${orcidLink(SUBJECT_ORCID)}</article></main>`,
    );
    expect(extractRosterMemberIdentityEvidence(html, PAGE_URL, MEMBER).orcid).toBeUndefined();
  });

  it('never reads an ORCID from Person metadata outside the subject node', () => {
    const jsonLd = {
      '@type': 'Person',
      name: MEMBER,
      identifier: { '@type': 'PropertyValue', propertyID: 'ORCID', value: SUBJECT_ORCID },
    };
    const evidence = extractRosterMemberIdentityEvidence(
      page(`<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`, ''),
      PAGE_URL,
      MEMBER,
    );
    expect(evidence.orcid).toBeUndefined();
  });

  it('reads an iD the subject node writes out as text', () => {
    expect(
      extractRosterMemberIdentityEvidence(
        profile(`<p>ORCID: ${SUBJECT_ORCID}</p>`),
        PAGE_URL,
        MEMBER,
      ).orcid,
    ).toBe(SUBJECT_ORCID);
  });

  it('states no ORCID when only the page title names the member, since no heading scopes a subject node', () => {
    const titledOnly = (head: string) =>
      `<html><head>${head}</head><body><main><h2>Contact</h2>${orcidLink(SUBJECT_ORCID)}<p>ORCID: ${SUBJECT_ORCID}</p></main></body></html>`;
    for (const head of [
      `<title>${MEMBER} | Synthetic Center</title>`,
      `<meta property="og:title" content="${MEMBER}"><title>${MEMBER}</title>`,
    ]) {
      expect(
        extractRosterMemberIdentityEvidence(titledOnly(head), PAGE_URL, MEMBER).orcid,
      ).toBeUndefined();
    }
  });

  it('still states the ORCID when a heading names the member alongside the same title', () => {
    const html = `<html><head><title>${MEMBER} | Synthetic Center</title></head><body><main><h2>${MEMBER}</h2>${orcidLink(SUBJECT_ORCID)}</main></body></html>`;
    expect(extractRosterMemberIdentityEvidence(html, PAGE_URL, MEMBER).orcid).toBe(SUBJECT_ORCID);
  });

  it.each(['script', 'style', 'noscript', 'template', 'iframe', 'noembed', 'noframes'])(
    'never reads an iD out of a <%s> body inside the subject node',
    (tag) => {
      const unrendered = `<${tag}>{"orcid":"${OTHER_ORCID}"} ${orcidLink(OTHER_ORCID)}</${tag}>`;
      expect(
        extractRosterMemberIdentityEvidence(profile(unrendered), PAGE_URL, MEMBER).orcid,
      ).toBeUndefined();
      expect(
        extractRosterMemberIdentityEvidence(
          profile(unrendered + orcidLink(SUBJECT_ORCID)),
          PAGE_URL,
          MEMBER,
        ).orcid,
      ).toBe(SUBJECT_ORCID);
    },
  );

  it('derives the same subject ORCID when run twice over the same page', () => {
    const html = profile(
      `<noscript>${OTHER_ORCID}</noscript><p>ORCID: ${SUBJECT_ORCID}</p>`,
      `<aside>${orcidLink(OTHER_ORCID)}</aside>`,
    );
    const first = extractRosterMemberIdentityEvidence(html, PAGE_URL, MEMBER);
    const second = extractRosterMemberIdentityEvidence(html, PAGE_URL, MEMBER);
    expect(first.orcid).toBe(SUBJECT_ORCID);
    expect(second).toEqual(first);
  });

  it('keeps an ORCID inside a wrapper whose class only contains a block word mid-token', () => {
    expect(
      extractRosterMemberIdentityEvidence(
        profile(`<div class="wordpress-block compressed">${orcidLink(SUBJECT_ORCID)}</div>`),
        PAGE_URL,
        MEMBER,
      ).orcid,
    ).toBe(SUBJECT_ORCID);
  });

  it('round-trips the ORCID through the parser, and an ORCID alone is evidence', () => {
    const parsed = parseRosterMemberIdentityEvidence({
      pageUrl: PAGE_URL,
      linkedProfileUrls: [],
      emails: [],
      netids: [],
      orcid: `https://orcid.org/${SUBJECT_ORCID}`,
    });
    expect(parsed?.orcid).toBe(SUBJECT_ORCID);
    expect(
      parseRosterMemberIdentityEvidence({ ...parsed, orcid: 'not-an-orcid' })?.orcid,
    ).toBeUndefined();
  });

  it('names an iD from a list only when the list holds exactly one distinct iD', () => {
    expect(singleStatedOrcid([SUBJECT_ORCID, `https://orcid.org/${SUBJECT_ORCID}/`])).toBe(
      SUBJECT_ORCID,
    );
    expect(singleStatedOrcid([SUBJECT_ORCID, OTHER_ORCID])).toBeUndefined();
    expect(singleStatedOrcid([])).toBeUndefined();
  });
});

describe('ROSTER_MEMBER_IDENTITY_EVIDENCE_EXTRACTOR_VERSION (#5677)', () => {
  const PAGE = 'https://center.yale.edu/people/avery-synthetic';
  const PINNED_ORCID = syntheticPersonOrcid(6);
  const NOSCRIPT_ORCID = syntheticPersonOrcid(19);
  const CORPUS: Array<{ html: string; memberName: string }> = [
    {
      memberName: 'Avery Synthetic',
      html: `<html><head><script type="application/ld+json">${JSON.stringify({
        '@type': 'Person',
        name: 'Avery Synthetic',
        email: 'avery.synthetic@yale.edu',
        identifier: [
          { propertyID: 'NetID', value: 'AS123' },
          { propertyID: 'ORCID', value: PINNED_ORCID },
        ],
      })}</script></head><body><main>
        <h1>Avery Synthetic</h1>
        <a href="https://orcid.org/${PINNED_ORCID}">ORCID</a>
        <a href="https://law.yale.edu/avery-synthetic">Profile</a>
        <a href="https://divinity.yale.edu/faculty-and-research/yds-faculty/avery-synthetic">Avery Synthetic</a>
        <a href="mailto:center.contact@yale.edu">Office</a>
        <ul><li><a href="/profile/casey-coauthor/">Casey Coauthor</a>
          <a href="/profile/casey-coauthor/">View Full Profile</a></li></ul>
      </main></body></html>`,
    },
    {
      memberName: 'Elizabeth Synthetic',
      html: `<html><body><main>
        <aside><a href="https://history.yale.edu/people/liz-synthetic">Yale Department of History</a></aside>
        <a href="https://medicine.yale.edu/profile/blair-synthetic/">Blair Synthetic</a>
      </main></body></html>`,
    },
    {
      memberName: 'Avery Synthetic',
      html: `<html><head><title>Avery Synthetic | Synthetic Center</title></head><body><main>
        <h2>Contact</h2><a href="https://orcid.org/${PINNED_ORCID}">ORCID</a>
      </main></body></html>`,
    },
    {
      memberName: 'Avery Synthetic',
      html: `<html><body><main><h1>Avery Synthetic</h1>
        <noscript>${NOSCRIPT_ORCID}</noscript>
        <a href="https://orcid.org/${PINNED_ORCID}">ORCID</a>
      </main></body></html>`,
    },
    {
      memberName: 'Avery Synthetic',
      html: `<html><body><main><h1>Avery Synthetic</h1>
        <div class="year-filter"><span>2025-2024-2023-2022</span></div>
        <p>${NOSCRIPT_ORCID}</p>
      </main></body></html>`,
    },
  ];
  const PINNED = {
    version: 6,
    outputs: [
      {
        pageUrl: PAGE,
        linkedProfileUrls: [
          PAGE,
          'https://law.yale.edu/avery-synthetic',
          'https://divinity.yale.edu/faculty-and-research/yds-faculty/avery-synthetic',
        ],
        emails: ['avery.synthetic@yale.edu'],
        netids: ['as123'],
        orcid: PINNED_ORCID,
      },
      {
        pageUrl: PAGE,
        linkedProfileUrls: [PAGE, 'https://history.yale.edu/people/liz-synthetic'],
        emails: [],
        netids: [],
      },
      { pageUrl: PAGE, linkedProfileUrls: [PAGE], emails: [], netids: [] },
      {
        pageUrl: PAGE,
        linkedProfileUrls: [PAGE],
        emails: [],
        netids: [],
        orcid: PINNED_ORCID,
      },
      { pageUrl: PAGE, linkedProfileUrls: [PAGE], emails: [], netids: [] },
    ],
  };

  it('is bumped whenever the extractor output on the fixture corpus changes', () => {
    const outputs = CORPUS.map(({ html, memberName }) =>
      extractRosterMemberIdentityEvidence(html, PAGE, memberName),
    );
    expect(
      { version: ROSTER_MEMBER_IDENTITY_EVIDENCE_EXTRACTOR_VERSION, outputs },
      'The extractor output changed: bump ROSTER_MEMBER_IDENTITY_EVIDENCE_EXTRACTOR_VERSION so cached evidence from the old extractor is not served, then pin the new version and outputs here.',
    ).toEqual(PINNED);
  });
});

describe('an ORCID is read only from a link or an ORCID label, and only a plausible one (#5991)', () => {
  const SUBJECT_ORCID = syntheticPersonOrcid(11);
  const YEAR_RUN = '2025-2024-2023-2022';
  const OUT_OF_RANGE = withOrcidCheckDigit('000000035000001');
  const profile = (subjectSection: string) =>
    page(
      '',
      `<main><article class="profile-details"><header><h1>${MEMBER}, PhD</h1></header>` +
        `<div class="profile-details-section-content__main">${subjectSection}</div>` +
        `</article></main>`,
    );
  const orcidOf = (section: string) =>
    extractRosterMemberIdentityEvidence(profile(section), PAGE_URL, MEMBER).orcid;
  const statesNoOrcid = (section: string) =>
    subjectProfileStatesNoOrcid(cheerio.load(profile(section)), MEMBER);

  it('reads no ORCID from a year run rendered in the subject node', () => {
    const years = `<div class="filters"><span>${YEAR_RUN}</span></div>`;
    expect(orcidOf(years)).toBeUndefined();
    expect(statesNoOrcid(years)).toBe(true);
  });

  it('reads no ORCID from a bare checksum-valid run with no ORCID label', () => {
    expect(orcidOf(`<p>Grant number ${SUBJECT_ORCID}</p>`)).toBeUndefined();
    expect(orcidOf(`<ul><li>${SUBJECT_ORCID}</li></ul>`)).toBeUndefined();
  });

  it('reads a labelled ORCID in the same text, a preceding label, or an ORCID-classed element', () => {
    expect(orcidOf(`<p>ORCID: ${SUBJECT_ORCID}</p>`)).toBe(SUBJECT_ORCID);
    expect(orcidOf(`<p><strong>ORCID iD</strong> ${SUBJECT_ORCID}</p>`)).toBe(SUBJECT_ORCID);
    expect(orcidOf(`<dl><dt>ORCID</dt><dd>${SUBJECT_ORCID}</dd></dl>`)).toBe(SUBJECT_ORCID);
    expect(orcidOf(`<span class="field--orcid">${SUBJECT_ORCID}</span>`)).toBe(SUBJECT_ORCID);
    expect(statesNoOrcid(`<p>ORCID: ${SUBJECT_ORCID}</p>`)).toBe(false);
  });

  it('reads an orcid.org link', () => {
    const link = `<a href="https://orcid.org/${SUBJECT_ORCID}">Profile</a>`;
    expect(orcidOf(link)).toBe(SUBJECT_ORCID);
    expect(statesNoOrcid(link)).toBe(false);
  });

  it('refuses a labelled or linked value outside the issued range, and claims nothing either way', () => {
    expect(orcidOf(`<p>ORCID: ${OUT_OF_RANGE}</p>`)).toBeUndefined();
    expect(orcidOf(`<a href="https://orcid.org/${OUT_OF_RANGE}">ORCID</a>`)).toBeUndefined();
    expect(orcidOf(`<p>ORCID: ${YEAR_RUN}</p>`)).toBeUndefined();
    expect(statesNoOrcid(`<p>ORCID: ${OUT_OF_RANGE}</p>`)).toBe(false);
  });

  it('keeps the plausible subject iD beside a refused one', () => {
    expect(orcidOf(`<p>ORCID: ${SUBJECT_ORCID}</p><span>${YEAR_RUN}</span>`)).toBe(SUBJECT_ORCID);
    expect(singleStatedOrcid([SUBJECT_ORCID, YEAR_RUN, OUT_OF_RANGE])).toBe(SUBJECT_ORCID);
  });

  it('drops a stored implausible ORCID when evidence is parsed back', () => {
    const parsed = parseRosterMemberIdentityEvidence({
      pageUrl: PAGE_URL,
      linkedProfileUrls: [],
      emails: [],
      netids: [],
      orcid: YEAR_RUN,
    });
    expect(parsed).toBeNull();
  });
});
