import { describe, expect, it } from 'vitest';
import { profileEnrichmentFromHtml } from '../../sources/departmentRosterScraper';

const SUBJECT = 'Quill Ledgerton';
const SUBJECT_NETID_ADDRESS = 'ql123@yale.edu';
const SUBJECT_NAMED_ADDRESS = 'quill.fixture@yale.edu';
const OFFICE_NETID_ADDRESS = 'bo456@yale.edu';
const OFFICE_NAMED_ADDRESS = 'rowan.fixture@yale.edu';
const ASSISTANT_NETID_ADDRESS = 'as789@yale.edu';

const page = (body: string, bodyClass = ''): string => `<!doctype html>
<html><head>
  <title>${SUBJECT} | Department of Economics</title>
  <meta property="og:title" content="${SUBJECT}" />
</head><body class="${bodyClass}">${body}</body></html>`;

const mailto = (address: string) => `<a href="mailto:${address}">${address}</a>`;

const drupalNodePersonHeader = (subjectContact: string) => `
  <main>
    <article class="node node--person">
      <header class="node__header">
        <div class="node__header-content-wrapper"><div class="node__header-content">
          <h1 class="node__title">${SUBJECT}</h1>
          <dl class="node__contact-info">${subjectContact}</dl>
        </div></div>
      </header>
      <div class="node__body"><p>Studies labour markets.</p></div>
    </article>
  </main>`;

const contactGroup = (value: string) => `
  <div class="node__contact-info-group"><dt>Email</dt><dd class="node__contact-info-value">${value}</dd></div>`;

const businessOfficeSiteFooter = (address: string) => `
  <footer class="site-footer site-footer--economics">
    <div class="site-footer__content"><div class="site-footer__contact-info">
      <span class="site-footer__contact-info-name">Business Office</span>
      <span class="site-footer__contact-info-email">${mailto(address)}</span>
    </div></div>
  </footer>`;

const profileDetailsPage = (contactList: string, footerAddress: string) => `
  <main>
    <section class="profile-details-header"><h1>${SUBJECT}, PhD</h1></section>
    <section><div class="profile-details-section-content">
      <div class="profile-details-section-content__main">
        <section class="profile-details-content-section">
          <h2>Get In Touch</h2>
          <div class="profile-details-content-section__content">${contactList}</div>
        </section>
      </div>
    </div></section>
  </main>
  <div class="footer__secondary-panel-wrapper"><div class="footer__content-container">
    <section class="footer__secondary-panel"><div class="footer__secondary-links">
      <nav class="footer-secondary-links-list"><ul class="footer-secondary-links-list__list">
        <li class="footer-secondary-links-list__list-item">${mailto(footerAddress)}</li>
      </ul></nav>
    </div></section>
  </div></div>`;

const contactListItem = (address: string) =>
  `<div class="profile-details-get-in-touch-section-contact-list__item-container"><div>${mailto(address)}</div></div>`;

const enrichedEmail = (html: string) =>
  profileEnrichmentFromHtml(html, 'https://economics.yale.edu/people/quill-ledgerton').email;

describe('roster profile enrichment reads only the subject own address (#5780)', () => {
  it('reads the subject netid address from the person node contact field', () => {
    const html = page(
      drupalNodePersonHeader(contactGroup(mailto(SUBJECT_NETID_ADDRESS))) +
        businessOfficeSiteFooter(OFFICE_NAMED_ADDRESS),
    );

    expect(enrichedEmail(html)).toBe(SUBJECT_NETID_ADDRESS);
  });

  it('does not read a business office footer address when the subject states none', () => {
    const html = page(
      drupalNodePersonHeader(contactGroup('By appointment')) +
        businessOfficeSiteFooter(OFFICE_NETID_ADDRESS),
    );

    expect(enrichedEmail(html)).toBeUndefined();
  });

  it('reads the subject address from a profile-details contact list and not the footer nav', () => {
    const html = page(
      profileDetailsPage(contactListItem(SUBJECT_NETID_ADDRESS), OFFICE_NETID_ADDRESS),
    );

    expect(enrichedEmail(html)).toBe(SUBJECT_NETID_ADDRESS);
  });

  it('does not read a footer nav address on a profile-details page with no subject address', () => {
    const html = page(profileDetailsPage('<p>No email listed</p>', OFFICE_NETID_ADDRESS));

    expect(enrichedEmail(html)).toBeUndefined();
  });

  it('does not read an administrative support card netid address as the subject', () => {
    const html = page(`
      <main>
        <h1>${SUBJECT}</h1>
        <div class="profile-details-administrative-support">
          <h2>Administrative Support</h2>
          <div class="contact-list__item">${mailto(ASSISTANT_NETID_ADDRESS)}</div>
        </div>
      </main>`);

    expect(enrichedEmail(html)).toBeUndefined();
  });

  it('does not read a netid address printed in body prose outside a contact field', () => {
    const html = page(`
      <main><h1>${SUBJECT}</h1>
        <div class="field-name-field-bio"><p>Questions about the seminar go to ${mailto(OFFICE_NETID_ADDRESS)}.</p></div>
      </main>`);

    expect(enrichedEmail(html)).toBeUndefined();
  });

  it('keeps a named subject address in a Drupal profile sidebar region', () => {
    const html = page(
      `<div class="block-inner clearfix"><div class="content clearfix"><div class="profile">
         <div class="field field-name-field-email"><div class="field-items"><div class="field-item even">${mailto(SUBJECT_NAMED_ADDRESS)}</div></div></div>
       </div></div></div>
       <div id="footer"><p>${mailto(OFFICE_NETID_ADDRESS)}</p></div>`,
      'html not-front one-sidebar sidebar-first',
    );

    expect(enrichedEmail(html)).toBe(SUBJECT_NAMED_ADDRESS);
  });

  it('reads the hero address over a different person card in the page aside', () => {
    const html = page(`
      <div class="node-content"><div class="grid-container"><div class="grid-x grid-margin-x">
        <div class="cell"><div class="flexhero__text"><div class="profile__split-content">
          <h1>${SUBJECT}</h1>
          <div class="profile__info"><p class="email-ellipsis">${mailto(SUBJECT_NAMED_ADDRESS)}</p></div>
        </div></div></div>
        <aside class="cell medium-4"><div class="asider"><div class="profile__info">
          <p class="email-ellipsis">${mailto(OFFICE_NAMED_ADDRESS)}</p>
        </div></div></aside>
      </div></div></div>`);

    expect(enrichedEmail(html)).toBe(SUBJECT_NAMED_ADDRESS);
  });

  it('does not read a netid address from a page aside', () => {
    const html = page(`
      <main><h1>${SUBJECT}</h1><p>Studies labour markets.</p></main>
      <aside class="contact-card"><div class="contact">${mailto(OFFICE_NETID_ADDRESS)}</div></aside>`);

    expect(enrichedEmail(html)).toBeUndefined();
  });

  it('emits nothing when the subject contact field lists two addresses', () => {
    const html = page(
      drupalNodePersonHeader(
        contactGroup(`${mailto(SUBJECT_NETID_ADDRESS)} ${mailto(ASSISTANT_NETID_ADDRESS)}`),
      ),
    );

    expect(enrichedEmail(html)).toBeUndefined();
  });

  it('emits nothing when the page content carries two different named addresses', () => {
    const html = page(`
      <main><h1>${SUBJECT}</h1>
        <div class="contact">${mailto(SUBJECT_NAMED_ADDRESS)}</div>
        <div class="contact">${mailto(OFFICE_NAMED_ADDRESS)}</div>
      </main>`);

    expect(enrichedEmail(html)).toBeUndefined();
  });

  it('reads the same address on a second read of the same page', () => {
    const html = page(
      drupalNodePersonHeader(contactGroup(mailto(SUBJECT_NETID_ADDRESS))) +
        businessOfficeSiteFooter(OFFICE_NETID_ADDRESS),
    );

    expect(enrichedEmail(html)).toBe(SUBJECT_NETID_ADDRESS);
    expect(enrichedEmail(html)).toBe(SUBJECT_NETID_ADDRESS);
  });
});
