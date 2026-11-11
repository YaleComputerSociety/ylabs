import { describe, expect, it, vi } from 'vitest';

import {
  extractOfficialProfileIdentity,
  identityToUserObservations,
  OfficialProfilePiBackfillScraper,
  profileIdentityAgreesWithUser,
} from '../sources/officialProfilePiBackfillScraper';
import { localPartNamesASubjectRole } from '../utils/officialProfileSubjectEmail';
import type { ObservationInput, ScraperContext } from '../types';

const SUBJECT = { fname: 'Avery', lname: 'Example', name: 'Avery Example' };
const subjectEntity = (netid: string) => ({
  _id: `user-${netid}`,
  netid,
  ...SUBJECT,
  displayName: SUBJECT.name,
  slug: 'avery-example',
});

const ysmUrl = 'https://medicine.yale.edu/profile/avery-example/';
const somUrl = 'https://som.yale.edu/faculty-research/faculty-directory/avery-example/';
const centerUrl = 'https://macmillan.yale.edu/africa/person/avery-example/';

const ysmFooter = `
  <footer class="footer">
    <nav class="footer-secondary-links-list">
      <a class="footer-secondary-links-list__link" href="mailto:fixture.webmaster@yale.edu">Webmaster</a>
    </nav>
  </footer>`;

const ysmPage = ({
  title = 'Professor of Medicine',
  personEmail,
  extraGraph = '',
  coAuthorEmail = '',
  adminEmail = '',
  url = ysmUrl,
  canonical = url,
  visibleContact = true,
}: {
  title?: string;
  personEmail?: string;
  extraGraph?: string;
  coAuthorEmail?: string;
  adminEmail?: string;
  url?: string;
  canonical?: string;
  visibleContact?: boolean;
}) => `
  <html>
    <head>
      <link rel="canonical" href="${canonical}">
      <script type="application/ld+json">{"@context":"https://schema.org","@graph":[
        {"@type":"ProfilePage","@id":"${url}#page","url":"${url}"},
        {"@type":"Person","@id":"${url}","name":"${SUBJECT.name}","url":"${url}",
          ${personEmail ? `"email":"${personEmail}",` : ''}
          "jobTitle":["${title}"],"affiliation":[{"@type":"Organization","name":"Department of Medicine"}]}
        ${extraGraph}
      ]}</script>
    </head>
    <body>
      <main class="page-container">
        <article class="profile-details">
          <header>
            <h1 class="profile-details-header-info__name">${SUBJECT.name}</h1>
            <span class="profile-details-header-info__title">${title}</span>
          </header>
          <section class="profile-details-co-authors-glance" aria-label="Paged coauthors list">
            <a href="https://medicine.yale.edu/profile/casey-fixture/">Casey Fixture</a>
            ${coAuthorEmail ? `<a href="mailto:${coAuthorEmail}">${coAuthorEmail}</a>` : ''}
          </section>
          <section id="get-in-touch-details-section">
            ${
              personEmail && visibleContact
                ? `<div class="profile-details-get-in-touch-section-contact-list__item-container"><a href="mailto:${personEmail}">${personEmail}</a></div>`
                : ''
            }
            ${
              adminEmail
                ? `<div class="profile-details-administrative-support-card"><h4>Hadley Fixture</h4><a href="mailto:${adminEmail}">${adminEmail}</a></div>`
                : ''
            }
          </section>
        </article>
      </main>
      ${ysmFooter}
    </body>
  </html>`;

const drupalPersonPage = ({
  url,
  subjectEmail,
  pressEmail = 'jamie.fixture@yale.edu',
  orgJsonLd = false,
  title = 'Professor of Economics',
}: {
  url: string;
  subjectEmail?: string;
  pressEmail?: string;
  orgJsonLd?: boolean;
  title?: string;
}) => `
  <html>
    <head>
      <link rel="canonical" href="${url}">
      ${
        orgJsonLd
          ? `<script type="application/ld+json">{"@context":"https://schema.org","@graph":[
              {"@type":"EducationalOrganization","@id":"https://macmillan.yale.edu","name":"Example Center for Area Studies at Yale"},
              {"@type":"WebSite","@id":"https://macmillan.yale.edu/","name":"Example Center for Area Studies at Yale"}]}</script>`
          : ''
      }
    </head>
    <body>
      <main class="site-main">
        <article class="node node--person">
          <header class="node__header">
            <h1 class="node__heading">${SUBJECT.name}</h1>
            ${title ? `<div class="node__titles"><div class="node__title">${title}</div></div>` : ''}
          </header>
          <div class="layout__region-one">
            <div class="node__contact">
              <ul class="node__contact-list">
                ${subjectEmail ? `<li class="node__contact-list-item"><a href="mailto:${subjectEmail}">${subjectEmail}</a></li>` : ''}
              </ul>
            </div>
          </div>
        </article>
        <aside class="node node--faculty">
          <div class="media-contact">
            <span class="media-contact__title">Jamie Fixture, Media Relations</span>
            <span class="media-contact__email"><a href="mailto:${pressEmail}">${pressEmail}</a></span>
          </div>
        </aside>
      </main>
      <footer><a href="mailto:fixture.webmaster@yale.edu">Webmaster</a></footer>
    </body>
  </html>`;

const identityOf = (html: string, url: string, options = {}) =>
  extractOfficialProfileIdentity(html, url, subjectEntity('fixture501'), {
    requireEmail: false,
    ...options,
  });

function visibleRun(html: string, url: string, netid = 'fixture501') {
  const emitted: ObservationInput[] = [];
  const visibleUser = { ...subjectEntity(netid), email: '', websiteUrl: url };
  const scraper = new OfficialProfilePiBackfillScraper(
    vi.fn(async () => html),
    vi.fn(async () => []),
    vi.fn(async () => null),
    vi.fn(async () => [visibleUser]),
    vi.fn(async () => []),
    vi.fn(async () => []),
    0,
  );
  const ctx: ScraperContext = {
    scrapeRunId: 'run-5669',
    sourceId: 'source-1',
    sourceName: 'official-profile-pi-backfill',
    sourceWeight: 0.95,
    options: {
      dryRun: true,
      useCache: false,
      release: false,
      only: ['visible-profile-bio-backfill'],
    },
    emit: vi.fn(async (obs: ObservationInput | ObservationInput[]) => {
      emitted.push(...(Array.isArray(obs) ? obs : [obs]));
    }),
    log: vi.fn(),
  };
  return scraper.run(ctx).then(() => emitted);
}

const emailsOf = (emitted: ObservationInput[]) =>
  emitted.filter((observation) => observation.field === 'email').map((o) => o.value);

async function expectRunTwiceIdentical(html: string, url: string, expected: string[]) {
  const first = await visibleRun(html, url);
  const second = await visibleRun(html, url);
  expect(emailsOf(first)).toEqual(expected);
  expect(second.filter((o) => o.field === 'email')).toEqual(
    first.filter((o) => o.field === 'email'),
  );
}

describe('the profile subject email read from more page shapes (#5669)', () => {
  describe("an address the page's own Person node states that is not shaped like the name", () => {
    const html = ysmPage({ personEmail: 'fixture.kestrel@yale.edu' });

    it('is read as the subject email', () => {
      expect(identityOf(html, ysmUrl)?.email).toBe('fixture.kestrel@yale.edu');
    });

    it("never reads a co-author's or an administrative contact's address instead", () => {
      const withoutSubject = ysmPage({
        coAuthorEmail: 'casey.fixture@yale.edu',
        adminEmail: 'hadley.fixture@yale.edu',
      });
      expect(identityOf(withoutSubject, ysmUrl)?.email).toBe('');
      const withSubject = ysmPage({
        personEmail: 'fixture.kestrel@yale.edu',
        coAuthorEmail: 'casey.fixture@yale.edu',
        adminEmail: 'hadley.fixture@yale.edu',
      });
      expect(identityOf(withSubject, ysmUrl)?.email).toBe('fixture.kestrel@yale.edu');
    });

    it('is read from the Person node when the page renders no visible contact', () => {
      const structuredOnly = ysmPage({
        personEmail: 'fixture.kestrel@yale.edu',
        visibleContact: false,
      });
      expect(identityOf(structuredOnly, ysmUrl)?.email).toBe('fixture.kestrel@yale.edu');
    });

    it('re-derives the same single observation on a second run', async () => {
      await expectRunTwiceIdentical(html, ysmUrl, ['fixture.kestrel@yale.edu']);
    });
  });

  describe("an outside address the page's own Person node states", () => {
    const html = ysmPage({ personEmail: 'avery.example@example.org' });

    it('is read as the subject email', () => {
      expect(identityOf(html, ysmUrl)?.email).toBe('avery.example@example.org');
    });

    it('does not contradict the Yale address expected for the lead', () => {
      const identity = identityOf(html, ysmUrl, {
        expectedPeople: [{ ...SUBJECT, email: 'avery.example@yale.edu' }],
      });
      expect(identity?.displayName).toBe(SUBJECT.name);
    });

    it('does not refuse a candidate researcher whose own address is a Yale one', () => {
      const identity = identityOf(html, ysmUrl)!;
      expect(
        profileIdentityAgreesWithUser(identity, {
          ...SUBJECT,
          netid: 'fixture501',
          email: 'avery.example@yale.edu',
        }),
      ).toBe(true);
      expect(
        profileIdentityAgreesWithUser(identity, {
          fname: 'Casey',
          lname: 'Fixture',
          netid: 'fixture502',
          email: 'casey.fixture@yale.edu',
        }),
      ).toBe(false);
    });

    it("never reads another Person node's address or a role mailbox", () => {
      const colleagueNode = `,{"@type":"Person","name":"Casey Fixture","email":"casey.fixture@example.org"}`;
      expect(identityOf(ysmPage({ extraGraph: colleagueNode }), ysmUrl)?.email).toBe('');
      expect(identityOf(ysmPage({ personEmail: 'admissions@example.org' }), ysmUrl)?.email).toBe(
        '',
      );
    });

    it("never reads a netid-shaped address from another Person node's structured data", async () => {
      const colleagueNode = `,{"@type":"Person","name":"Casey Fixture","email":"cf4321@yale.edu"}`;
      const html = ysmPage({ extraGraph: colleagueNode });
      expect(identityOf(html, ysmUrl)?.email).toBe('');
      expect(emailsOf(await visibleRun(html, ysmUrl))).toEqual([]);
    });

    it("never reads a co-author's netid-shaped mailto link when the subject states none", async () => {
      const html = ysmPage({ coAuthorEmail: 'cf4321@yale.edu' });
      expect(identityOf(html, ysmUrl)?.email).toBe('');
      expect(emailsOf(await visibleRun(html, ysmUrl))).toEqual([]);
    });

    it('re-derives the same single observation on a second run', async () => {
      await expectRunTwiceIdentical(html, ysmUrl, ['avery.example@example.org']);
    });
  });

  describe("an address in the person node's own contact field", () => {
    const html = drupalPersonPage({ url: somUrl, subjectEmail: 'fixture.kestrel@yale.edu' });

    it('is read as the subject email', () => {
      expect(identityOf(html, somUrl)?.email).toBe('fixture.kestrel@yale.edu');
    });

    it("never reads the press contact's address beside it", () => {
      expect(identityOf(drupalPersonPage({ url: somUrl }), somUrl)?.email).toBe('');
    });

    it('reads nothing when the contact field lists two addresses not shaped like the name', () => {
      const twoAddresses = drupalPersonPage({
        url: somUrl,
        subjectEmail: 'fixture.kestrel@yale.edu',
      }).replace(
        '</ul>',
        '<li class="node__contact-list-item"><a href="mailto:fixture.heron@yale.edu">fixture.heron@yale.edu</a></li></ul>',
      );
      expect(identityOf(twoAddresses, somUrl)?.email).toBe('');
    });

    it('re-derives the same single observation on a second run', async () => {
      await expectRunTwiceIdentical(html, somUrl, ['fixture.kestrel@yale.edu']);
    });
  });

  describe('a page whose only structured data names the hosting organization', () => {
    const html = drupalPersonPage({
      url: centerUrl,
      subjectEmail: 'avery.example@yale.edu',
      orgJsonLd: true,
    });

    it("names the person from the page heading, not the organization's name", () => {
      const identity = identityOf(html, centerUrl);
      expect(identity?.displayName).toBe(SUBJECT.name);
      expect(identity?.email).toBe('avery.example@yale.edu');
    });

    it("never reads the press contact's address on the same page", () => {
      expect(
        identityOf(drupalPersonPage({ url: centerUrl, orgJsonLd: true }), centerUrl)?.email,
      ).toBe('');
    });

    it('re-derives the same single observation on a second read', () => {
      const observe = () =>
        identityToUserObservations(identityOf(html, centerUrl)!, { netid: 'fixture501' }).filter(
          (o) => o.field === 'email',
        );
      expect(observe().map((o) => o.value)).toEqual(['avery.example@yale.edu']);
      expect(observe()).toEqual(observe());
    });
  });

  describe('a page without an admissible title', () => {
    const html = ysmPage({
      title: 'Senior Administrative Assistant',
      personEmail: 'avery.example@yale.edu',
    });

    it('records only the address in the visible-profile email read', async () => {
      const emitted = await visibleRun(html, ysmUrl);
      expect(emitted.filter((o) => o.entityType === 'user')).toEqual([
        expect.objectContaining({
          entityKey: 'netid:fixture501',
          field: 'email',
          value: 'avery.example@yale.edu',
          sourceUrl: ysmUrl,
        }),
      ]);
    });

    it('stays no identity anywhere else, so no title, role or bio follows from it', () => {
      expect(identityOf(html, ysmUrl)).toBeNull();
    });

    it("never records a co-author's address when the subject states none", async () => {
      const withoutSubject = ysmPage({
        title: 'Senior Administrative Assistant',
        coAuthorEmail: 'casey.fixture@yale.edu',
        adminEmail: 'hadley.fixture@yale.edu',
      });
      expect(emailsOf(await visibleRun(withoutSubject, ysmUrl))).toEqual([]);
    });

    it("never records a co-author's netid-shaped address when the subject states none", async () => {
      const withoutSubject = ysmPage({
        title: 'Senior Administrative Assistant',
        coAuthorEmail: 'cf4321@yale.edu',
      });
      expect(emailsOf(await visibleRun(withoutSubject, ysmUrl))).toEqual([]);
    });

    it('emits only the email from an email-only identity', () => {
      const identity = identityOf(html, ysmUrl, { emailOnlyWithoutAdmissibleTitle: true });
      expect(identity?.emailOnly).toBe(true);
      expect(
        identityToUserObservations(identity!, { netid: 'fixture501' }).map((o) => o.field),
      ).toEqual(['email']);
    });

    it('re-derives the same single observation on a second run', async () => {
      await expectRunTwiceIdentical(html, ysmUrl, ['avery.example@yale.edu']);
    });
  });

  describe('a canonical link that differs from the fetched profile only in letter case', () => {
    const fetched = 'https://medicine.yale.edu/profile/abc501/';
    const html = ysmPage({
      url: fetched,
      canonical: 'https://medicine.yale.edu/profile/ABC501/',
      personEmail: 'avery.example@example.org',
    });
    const entity = { ...subjectEntity('abc501') };

    it('is read as the same page', () => {
      expect(
        extractOfficialProfileIdentity(html, fetched, entity, { requireEmail: false })?.email,
      ).toBe('avery.example@example.org');
    });

    it('still refuses a canonical link to a different profile', () => {
      const other = ysmPage({
        url: fetched,
        canonical: 'https://medicine.yale.edu/profile/def502/',
        personEmail: 'avery.example@example.org',
      });
      expect(extractOfficialProfileIdentity(other, fetched, entity, { requireEmail: false })).toBe(
        null,
      );
    });

    it('re-derives the same single observation on a second read', () => {
      const observe = () =>
        identityToUserObservations(
          extractOfficialProfileIdentity(html, fetched, entity, { requireEmail: false })!,
          { netid: 'abc501' },
        ).filter((o) => o.field === 'email');
      expect(observe().map((o) => o.value)).toEqual(['avery.example@example.org']);
      expect(observe()).toEqual(observe());
    });
  });
});

describe("a role or shared mailbox inside the profile subject's own node (#5714)", () => {
  const officeMailbox = 'chairfixmed7@yale.edu';
  const html = ysmPage({ personEmail: officeMailbox });

  it('refuses a role word fused to a unit code in the Person node and contact card', () => {
    expect(identityOf(html, ysmUrl)?.email).toBe('');
  });

  it('refuses lab and program mailboxes named by a whole local-part token', () => {
    for (const personEmail of [
      'fixture.lab@yale.edu',
      'fixture-labs@yale.edu',
      'program.fixture@yale.edu',
      'officefixture@example.org',
      'deptfixture7@yale.edu',
    ]) {
      expect(identityOf(ysmPage({ personEmail }), ysmUrl)?.email).toBe('');
    }
  });

  it('still backs a personal address stated in the same shape', () => {
    const personal = ysmPage({ personEmail: 'fixture.kestrel@yale.edu' });
    expect(identityOf(personal, ysmUrl)?.email).toBe('fixture.kestrel@yale.edu');
  });

  it('never refuses a role word embedded inside a longer name-like token', () => {
    for (const personEmail of [
      'glabfixture7@yale.edu',
      'kinfo.fixture@yale.edu',
      'adeptfixture7@yale.edu',
      'fixturelabs7.k@yale.edu',
      'fixture.programmer@example.org',
    ]) {
      expect(identityOf(ysmPage({ personEmail }), ysmUrl)?.email).toBe(personEmail.toLowerCase());
    }
  });

  it("never refuses an address that carries the subject's own name after a role-like prefix", () => {
    expect(localPartNamesASubjectRole('chairfixturez', 'Kim Chairfixturez')).toBe(false);
    expect(localPartNamesASubjectRole('labfixture.k', 'Kim Labfixture')).toBe(false);
    expect(localPartNamesASubjectRole('infofixture', 'Infofixture Kim')).toBe(false);
    expect(localPartNamesASubjectRole('chairfixturez', 'Avery Example')).toBe(true);
  });

  it('never lets a short given name hidden inside the role word admit the office mailbox', () => {
    expect(localPartNamesASubjectRole('chairfixmed7', 'Hai Example')).toBe(true);
    expect(localPartNamesASubjectRole('adminfixmed7', 'Min Example')).toBe(true);
    expect(localPartNamesASubjectRole('programfix7', 'Ram Example')).toBe(true);
    expect(localPartNamesASubjectRole('departmentfix7', 'Art Example')).toBe(true);
  });

  it('never lets a short given name hidden inside the unit code admit the office mailbox', () => {
    expect(localPartNamesASubjectRole('chairpathology', 'Pat Example')).toBe(true);
    expect(localPartNamesASubjectRole('deptgenetics', 'Gene Example')).toBe(true);
    expect(localPartNamesASubjectRole('chairfixmed', 'Kim Fixmed')).toBe(true);
  });

  it('never treats a netid-shaped local part as a role word', () => {
    expect(localPartNamesASubjectRole('lab42', 'Avery Example')).toBe(false);
    expect(localPartNamesASubjectRole('info7', 'Avery Example')).toBe(false);
  });

  it('emits no email observation on either of two runs', async () => {
    await expectRunTwiceIdentical(html, ysmUrl, []);
  });
});
