import { describe, expect, it } from 'vitest';
import {
  centerAffiliationPageObservations,
  extractCenterAffiliationsFromPage,
  listedPersonName,
  profileUrlAgreesWithName,
  readListedLabLead,
} from '../utils/centerAffiliationPageExtractor';
import {
  RELATIONSHIP_TARGET_LEAD_NAME_FIELD,
  RELATIONSHIP_TARGET_WEBSITE_URL_FIELD,
} from '../centerRelationshipTarget';

const PAGE_URL = 'https://example.yale.edu/centers/quillfeather-center/';

const page = (body: string): string =>
  `<html><head><title>Quillfeather Center</title></head><body>
    <header><nav><a href="/profile/nav-person/">Nolan Navbar</a></nav></header>
    <main>${body}</main>
    <footer><a href="/people/footer-person">Fiona Footer</a></footer>
  </body></html>`;

const read = (body: string) =>
  extractCenterAffiliationsFromPage({ html: page(body), pageUrl: PAGE_URL });
const names = (body: string) => read(body).people.map((person) => person.name);

const profileCard = (name: string, href: string, ...titles: string[]) => `
  <article class="profile-grid-item" aria-label="${name}'s Profile">
    <a class="profile-grid-item__link-details" href="${href}"><span class="profile-grid-item__name">${name}</span></a>
    ${titles.map((title) => `<p class="profile-grid-item__title">${title}</p>`).join('')}
  </article>`;

describe('extractCenterAffiliationsFromPage', () => {
  it('lists a YSM profile grid under a faculty heading, strips credentials and links the profile', () => {
    const result = read(`
      <section class="organization-member-listing"><h2>Faculty</h2>
        ${profileCard('Avery Q. Quillfeather, MD, FACP', '/center/profile/avery-quillfeather/', 'Director', 'Professor of Imaginary Medicine')}
        ${profileCard('Bram Tindlewick, PhD, MPH', '/center/profile/bram-tindlewick/', 'Associate Professor')}
      </section>`);

    expect(result.outcome).toBe('listed');
    expect(result.people).toEqual([
      {
        name: 'Avery Q. Quillfeather',
        personSlug: 'avery-q-quillfeather',
        profileUrl: 'https://example.yale.edu/center/profile/avery-quillfeather/',
        title: 'Director; Professor of Imaginary Medicine',
        sectionLabel: 'Faculty',
        structure: 'profile-grid',
      },
      {
        name: 'Bram Tindlewick',
        personSlug: 'bram-tindlewick',
        profileUrl: 'https://example.yale.edu/center/profile/bram-tindlewick/',
        title: 'Associate Professor',
        sectionLabel: 'Faculty',
        structure: 'profile-grid',
      },
    ]);
  });

  it('is deterministic: the same page always yields the same read', () => {
    const body = `<h2>Members</h2>${profileCard('Corin Ashgrove', '/center/profile/corin-ashgrove/')}`;
    expect(read(body)).toEqual(read(body));
  });

  it('flips a surname-first directory link and never reads site chrome', () => {
    const result = read(`
      <h2>Affiliated Faculty</h2>
      <ul>
        <li><a class="hyperlink" href="/center/profile/delphine-marrowby/">Marrowby, Delphine (Del) R.</a></li>
        <li><a class="hyperlink" href="/center/profile/ezra-pellingham/">Pellingham, Ezra</a></li>
      </ul>`);

    expect(result.people.map((person) => [person.name, person.personSlug])).toEqual([
      ['Delphine R. Marrowby', 'delphine-r-marrowby'],
      ['Ezra Pellingham', 'ezra-pellingham'],
    ]);
  });

  it('reads core contacts and leaves related offerings and publications out', () => {
    const result = read(`
      <div class="info-box__primary-contact"><h3>Fenna Hollowmere, PhD</h3><span>Director</span></div>
      <section class="contact-section"><h2>Contacts</h2>
        <div class="contact-section__listing-item">
          <div class="contact-title"><h3 class="h6">Faculty Director</h3></div>
          <div class="contact-section__primary-contact">
            <span class="contact-section__primary-contact__name">Gideon Larchmont</span>
            <span>Professor of Invented Engineering</span>
          </div>
        </div>
        <div class="contact-section__listing-item">
          <div class="contact-title"><h3 class="h6">Financial Analyst</h3></div>
          <div class="contact-section__primary-contact">
            <span class="contact-section__primary-contact__name">Hollis Brackenridge</span>
          </div>
        </div>
      </section>
      <section class="related-offerings"><h2>Related offerings</h2>
        <div class="cores-card"><h2><a href="/cores/other">Other Core</a></h2>
          <div class="card__content__contact"><h3>Ilsa Thornbury</h3><span>Director</span></div></div>
      </section>
      <section><h2>Recent publications</h2>
        <ol><li>Juniper K, Wexford L, et al. A study. J Imag. 2024.</li></ol>
      </section>`);

    expect(result.people.map((person) => [person.name, person.title])).toEqual([
      ['Fenna Hollowmere', 'Director'],
      ['Gideon Larchmont', 'Faculty Director; Professor of Invented Engineering'],
    ]);
    expect(result.refusals['administrative-title']).toBe(1);
    expect(result.refusals['non-member-section']).toBeGreaterThan(0);
  });

  it('does not assert people named by news cards or news headlines', () => {
    expect(
      names(`
        <h2>Latest News</h2>
        <ul><li class="reference-card"><h3 class="reference-card__heading">
          <a class="reference-card__heading-link" href="/news/award">Kestrel Mayhew</a></h3>
          <div class="reference-card__overline"><time datetime="2026-01-01">January 1, 2026</time></div>
        </li></ul>
        <ul><li class="reference-card"><h3 class="reference-card__heading">
          <a class="reference-card__heading-link" href="/news/x">Kestrel Mayhew named Fellow of the Society</a></h3>
        </li></ul>`),
    ).toEqual([]);
  });

  it('lists member labs and the investigators a lab card names', () => {
    const result = read(`
      <div class="custom-card-collection"><h2 class="custom-card-collection__heading">Meet the labs of the center</h2>
        <ul>
          <li class="custom-card"><h2 class="custom-card__heading"><a class="custom-card__heading-link" href="/lumen-lab">Lumen Lab</a></h2></li>
        </ul>
      </div>
      <ul>
        <li class="reference-card"><h3 class="reference-card__heading"><a class="reference-card__heading-link" href="https://example.yale.edu/glossary-project">Invented Glossary Project</a></h3>
          <div class="reference-card__snippet"><p>Marisol Venn and Odette Crane</p></div></li>
      </ul>`);

    expect(result.labs).toEqual([
      {
        name: 'Lumen Lab',
        url: 'https://example.yale.edu/lumen-lab',
        sectionLabel: 'Meet the labs of the center',
        structure: 'custom-card',
      },
    ]);
    expect(result.people.map((person) => person.name)).toEqual(['Marisol Venn', 'Odette Crane']);
  });

  it('counts a name that only prose states rather than asserting it', () => {
    const result = read(`
      <h1>Quillfeather Center</h1>
      <p>The Quillfeather Center was founded in 2011 with a gift from Percival Oakhurst and is directed by
        <a href="/people/rowan-sedgefield">Rowan Sedgefield</a>, who leads a program of invented research across many departments.</p>
      <p>Its members study invented questions in imaginary fields and meet weekly to share early results with students.</p>`);

    expect(result.people).toEqual([]);
    expect(result.outcome).toBe('prose-only');
    expect(result.refusals['prose-mention']).toBe(1);
  });

  it('reads a short name-and-role line as a listing', () => {
    expect(
      names('<p>Saffron Wilde, Director</p><p>Tobias Fernhill, Associate Director</p>'),
    ).toEqual(['Saffron Wilde', 'Tobias Fernhill']);
  });

  it('refuses one name linked to two different profiles', () => {
    const result = read(`
      <h2>Members</h2>
      ${profileCard('Ulric Penhallow', '/center/profile/ulric-penhallow/')}
      ${profileCard('Ulric Penhallow', '/center/profile/ulric-penhallow-2/')}`);

    expect(result.people).toEqual([]);
    expect(result.refusals['conflicting-profile-urls']).toBe(1);
  });

  it('refuses one profile shared by two different names but folds a middle-initial variant', () => {
    const shared = read(`
      <h2>Members</h2>
      ${profileCard('Vesna Quarrington', '/center/profile/vesna-quarrington/')}
      ${profileCard('Wendell Ashby', '/center/profile/vesna-quarrington/')}`);
    expect(shared.people).toEqual([]);
    expect(shared.refusals['shared-profile-url']).toBe(2);

    const variant = read(`
      <h2>Members</h2>
      ${profileCard('Xenia Hartwell', '/center/profile/xenia-hartwell/')}
      ${profileCard('Xenia M. Hartwell', '/center/profile/xenia-hartwell/')}`);
    expect(variant.people.map((person) => person.name)).toEqual(['Xenia M. Hartwell']);
  });

  it('refuses a profile link whose path names somebody else', () => {
    const result = read(`
      <h2>Faculty</h2>
      <ul><li><a href="/people/yardley-brook">Zara Ellingwood</a></li></ul>`);

    expect(result.people).toEqual([]);
    expect(result.refusals['name-disagrees-with-profile-url']).toBe(1);
  });

  it('leaves student, staff and advisory sections out', () => {
    expect(
      names(`
        <h2>Graduate Students</h2><ul><li>Amos Whitlock</li></ul>
        <h2>Staff</h2><ul><li>Beatrix Hale, Program Coordinator</li></ul>
        <h2>External Advisory Board</h2><ul><li>Cyrus Penrose, Example University</li></ul>
        <h2>Faculty and Staff</h2><ul><li>Dorian Fairweather, Professor of Example Studies</li></ul>`),
    ).toEqual(['Dorian Fairweather']);
  });

  it('leaves an advisory committee or scientific advisory board out, by owner decision', () => {
    expect(
      names(`
        <h2>Scientific Advisory Board</h2>
        ${profileCard('Gwendolyn Ashcombe', '/center/profile/gwendolyn-ashcombe/', 'Professor of Example Studies')}
        <h2>Advisory Committee</h2><ul><li>Horatio Penwarden, Professor of Example Studies</li></ul>
        <h2>Faculty</h2>${profileCard('Imre Calloway', '/center/profile/imre-calloway/')}`),
    ).toEqual(['Imre Calloway']);
  });

  it('reads a paragraph that lists one linked person per line as a directory', () => {
    const result = read(`
      <h2>Additional contacts</h2>
      <h3>Imaging sciences</h3>
      <p><a href="https://example.yale.edu/profile/juno-ashgrove/">Juno Ashgrove, PhD,</a> Professor of Invented Imaging and of Example Engineering; Department Chair, Example Engineering<br>
      <a href="https://example.yale.edu/profile/kit-marchbank/">Kit Marchbank, PhD,</a> Professor of Example Informatics and Data Science, and Invented Imaging; Associate Director of Example Data Sciences, Example Imaging Institute; Director of the Example Software Certificate Program, Department of Example Informatics</p>`);

    expect(result.people.map((person) => [person.name, person.structure])).toEqual([
      ['Juno Ashgrove', 'profile-link'],
      ['Kit Marchbank', 'profile-link'],
    ]);
  });

  it('still counts a linked name that opens a prose sentence rather than a listing line', () => {
    const result = read(`
      <p><a href="/people/lark-penrose">Lark Penrose</a> joined the center in 2019 and has since built a program of invented research across many departments.<br>
      <a href="/people/milan-ostrow">Milan Ostrow</a>, a professor of example studies, said the program will grow to include several new invented fields next year.</p>`);

    expect(result.people).toEqual([]);
    expect(result.refusals['prose-mention']).toBe(2);
  });

  it('reads a one-sentence contact line whose email names the person', () => {
    const result = read(`
      <h2>Scheduling</h2>
      <p>For scheduling on the 7T system, contact <a href="mailto:milo.harrowgate1@yale.edu">Milo Harrowgate</a>.</p>
      <p>The widget moved to another core last year. Please contact <a href="mailto:nadia.brisbane2@yale.edu">Nadia Brisbane</a> for details.</p>
      <p>For billing questions, contact <a href="mailto:widget-billing3@yale.edu">Orrin Thackeray</a>.</p>
      <ul><li><a href="mailto:pia.loxley4@yale.edu">Pia Loxley</a>, Financial Assistant; contact for invoices</li></ul>`);

    expect(result.people.map((person) => [person.name, person.structure])).toEqual([
      ['Milo Harrowgate', 'contact-line'],
    ]);
  });

  it('reads a founder the core page says still directs it', () => {
    const result = read(`
      <h2>Our history</h2>
      <p>The widget resource had its beginnings in 1980 in the Department of Example Studies.</p>
      <p>Dr. Quentin R. Ashdown founded the Widget Lab, then called the Example Facility. He is still director of the resulting and evolving Widget Lab.</p>
      <p>Rosalind Fenwright established the Gadget Annex in 1990, which closed in 2001.</p>`);

    expect(result.people.map((person) => [person.name, person.structure])).toEqual([
      ['Quentin R. Ashdown', 'founder-statement'],
    ]);
  });

  it('does not let a heading outside a sidebar widget suppress the widget', () => {
    expect(
      names(`
        <div class="callout"><h2>Make a Gift to the Center</h2><a href="/give">Give</a></div>
        <section class="profile-contact-widget" aria-label="Director">
          <h2>Director</h2>
          <a class="profile-contact-widget-content__link-details" href="/center/profile/elowen-strand/">
            <div class="profile-contact-widget-content__name">Elowen Strand, MD</div></a>
        </section>`),
    ).toEqual(['Elowen Strand']);
  });

  it('does not read an organization-named card as a person', () => {
    const result = read(`
      <h2>Members</h2>
      <ul><li class="reference-card"><h3 class="reference-card__heading">
        <a class="reference-card__heading-link" href="/initiative">Invented Data Science Initiative</a></h3></li></ul>`);

    expect(result.people).toEqual([]);
    expect(result.refusals['not-a-person-name']).toBe(1);
  });
});

describe('listedPersonName', () => {
  it('normalizes credentials, honorifics and surname-first order', () => {
    expect(listedPersonName('Dr. Felix Underhill, PhD')).toBe('Felix Underhill');
    expect(listedPersonName('Underhill, Felix')).toBe('Felix Underhill');
    expect(listedPersonName('Felix Underhill, MBBS, PsyD')).toBe('Felix Underhill');
  });
});

describe('profileUrlAgreesWithName', () => {
  it('needs the surname in the profile path, or a netid path', () => {
    expect(
      profileUrlAgreesWithName('https://example.yale.edu/people/greta-moss', 'Greta Moss'),
    ).toBe(true);
    expect(profileUrlAgreesWithName('https://example.yale.edu/people/abc123/', 'Greta Moss')).toBe(
      true,
    );
    expect(
      profileUrlAgreesWithName('https://example.yale.edu/people/hal-other', 'Greta Moss'),
    ).toBe(false);
    expect(profileUrlAgreesWithName('https://example.yale.edu/about', 'Greta Moss')).toBe(false);
  });
});

describe('readListedLabLead', () => {
  const LAB_URL = 'https://example.yale.edu/thornbury-landing-page';
  const labPage = (heading: string, profileHref: string) => `
    <html><body><main><h1>Lab Landing Page</h1><h2>${heading}</h2>
      <p>We are an invented biology lab.</p>
      <a href="${profileHref}">Thornbury Biography</a></main></body></html>`;

  it('names the head a lab page heading and its profile link agree on', () => {
    expect(
      readListedLabLead({
        html: labPage('Ilsa Thornbury Lab', 'https://medicine.yale.edu/profile/ilsa-thornbury/'),
        pageUrl: LAB_URL,
        labName: 'Thornbury Lab',
      }),
    ).toEqual({
      name: 'Ilsa Thornbury',
      profileUrl: 'https://medicine.yale.edu/profile/ilsa-thornbury/',
    });
  });

  it('names nobody without a profile link, or when the heading names another surname', () => {
    expect(
      readListedLabLead({
        html: labPage('Ilsa Thornbury Lab', 'https://thornburylab.example.org/'),
        pageUrl: LAB_URL,
        labName: 'Thornbury Lab',
      }),
    ).toBeUndefined();
    expect(
      readListedLabLead({
        html: labPage('Jasper Wyndham Lab', 'https://medicine.yale.edu/profile/jasper-wyndham/'),
        pageUrl: LAB_URL,
        labName: 'Thornbury Lab',
      }),
    ).toBeUndefined();
  });
});

describe('centerAffiliationPageObservations', () => {
  it('carries the head a listed lab page names beside the lab card', () => {
    const observations = centerAffiliationPageObservations(
      {
        outcome: 'listed',
        people: [],
        labs: [
          {
            name: 'Thornbury Lab',
            url: 'https://example.yale.edu/thornbury-landing-page',
            sectionLabel: 'Meet the labs',
            structure: 'custom-card',
            lead: {
              name: 'Ilsa Thornbury',
              profileUrl: 'https://medicine.yale.edu/profile/ilsa-thornbury/',
            },
          },
        ],
        refusals: read('').refusals,
        proseCharacterCount: 0,
      },
      { centerEntityKey: 'center-quillfeather', sourceUrl: PAGE_URL },
    );
    expect(
      Object.fromEntries(observations.map((observation) => [observation.field, observation.value])),
    ).toMatchObject({
      targetEntityKey: 'listed-lab-thornbury-lab',
      [RELATIONSHIP_TARGET_WEBSITE_URL_FIELD]: 'https://example.yale.edu/thornbury-landing-page',
      [RELATIONSHIP_TARGET_LEAD_NAME_FIELD]: 'Ilsa Thornbury',
    });
  });

  it('emits relationship observations keyed by the center with the listed profile as the target site', () => {
    const result = read(
      `<h2>Faculty</h2>${profileCard('Imogen Thistlewood', '/center/profile/imogen-thistlewood/')}`,
    );
    const observations = centerAffiliationPageObservations(result, {
      centerEntityKey: 'center-quillfeather',
      sourceUrl: PAGE_URL,
    });

    const relationshipKey =
      'center-quillfeather:faculty-research-area-imogen-thistlewood:MEMBER_RESEARCH_AREA';
    expect(observations.every((observation) => observation.entityKey === relationshipKey)).toBe(
      true,
    );
    expect(
      observations.every((observation) => observation.entityType === 'researchEntityRelationship'),
    ).toBe(true);
    expect(
      Object.fromEntries(observations.map((observation) => [observation.field, observation.value])),
    ).toMatchObject({
      sourceEntityKey: 'center-quillfeather',
      targetEntityKey: 'faculty-research-area-imogen-thistlewood',
      relationshipType: 'MEMBER_RESEARCH_AREA',
      [RELATIONSHIP_TARGET_WEBSITE_URL_FIELD]:
        'https://example.yale.edu/center/profile/imogen-thistlewood/',
    });
    expect(
      centerAffiliationPageObservations(result, { centerEntityKey: '', sourceUrl: PAGE_URL }),
    ).toEqual([]);
  });
});
