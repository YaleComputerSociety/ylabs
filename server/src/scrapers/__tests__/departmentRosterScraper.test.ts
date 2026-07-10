/**
 * Unit tests for DepartmentRosterScraper extractors and helpers.
 *
 * The HTML snippets embedded below are minimal but structurally faithful to the
 * live pages — selectors and class names match what the real Drupal/MCDB themes
 * emit. We deliberately do NOT touch the network: the scraper class itself is
 * exercised with an in-memory config whose extractor returns canned rows.
 */
import { describe, it, expect, vi } from 'vitest';

// The scraper SSRF-guards every dept URL with a real DNS resolution; tests use
// synthetic hostnames (example.invalid) and must stay offline, so the guard is
// reduced to URL parsing here.
vi.mock('../../utils/ssrfGuard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/ssrfGuard')>()),
  assertPublicHttpUrl: vi.fn(async (rawUrl: string) => new URL(rawUrl)),
}));

import {
  DepartmentRosterScraper,
  DEFAULT_DEPT_CONFIGS,
  econExtractor,
  mcdbExtractor,
  psychExtractor,
  viewsRowPersonExtractor,
  jacksonPersonCardExtractor,
  csJsRenderedStub,
  csRenderedExtractor,
  csFacultyDataExtractor,
  type DeptConfig,
  type FacultyEntry,
} from '../sources/departmentRosterScraper';
import {
  isLikelyPersonSpecificYaleEmail,
  netidFromEmail,
  normalizeName,
  slugify,
  splitName,
} from '../utils/scraperHelpers';
import type { ScraperContext, ObservationInput } from '../types';

// ---------------------------------------------------------------------------
// Helper sample HTML
// ---------------------------------------------------------------------------

const ECON_HTML = `
<html><body>
  <main>
    <article class="node-teaser node-teaser--person node-teaser--vertical">
      <div class="node-teaser__heading">
        <a href="/people/samuel-kortum"><span>Samuel Kortum</span></a>
      </div>
      <div class="node-teaser__professional-title">
        <span>Departmental Chair and Robin Burrows Moffatt Professor of Economics</span>
      </div>
    </article>
    <article class="node-teaser node-teaser--person node-teaser--vertical">
      <div class="node-teaser__heading">
        <a href="/people/jason-abaluck"><span>Jason Abaluck</span></a>
      </div>
      <div class="node-teaser__professional-title">
        <span>Professor of Economics</span>
      </div>
    </article>
    <article class="node-teaser node-teaser--person node-teaser--vertical">
      <div class="node-teaser__heading">
        <a href="/people/laura-adler"><span>Laura Adler</span></a>
      </div>
    </article>
    <article class="node-teaser node-teaser--news">
      <div class="node-teaser__heading"><a href="/news/123"><span>Some news item</span></a></div>
    </article>
  </main>
</body></html>
`;

const MCDB_HTML = `
<html><body>
  <div class="directory-listing-card">
    <div class="directory-listing-card__content">
      <h3 class="directory-listing-card__heading">
        <a class="directory-listing-card__heading-link" href="/profile/shannon-roster-phd">
          Shannon Roster, Ph.D.
        </a>
      </h3>
      <div class="directory-listing-card__subheading">
        <div>Associate Professor of Molecular, Cellular &amp; Developmental Biology with Tenure</div>
      </div>
      <a class="directory-listing-card__link" href="mailto:shannon.roster@yale.edu">Email</a>
      <a class="directory-listing-card__link" href="https://bahmanyarlab.yale.edu">Lab Website</a>
    </div>
  </div>
  <div class="directory-listing-card">
    <div class="directory-listing-card__content">
      <h3 class="directory-listing-card__heading">
        <a class="directory-listing-card__heading-link" href="/profile/riley-roster-phd">
          Riley Roster, Ph.D.
        </a>
      </h3>
      <div class="directory-listing-card__subheading">
        <div>Sterling Professor of MCDB</div>
      </div>
      <a class="directory-listing-card__link" href="mailto:riley.roster@yale.edu">Email</a>
    </div>
  </div>
  <div class="directory-listing-card">
    <div class="directory-listing-card__content">
      <h3 class="directory-listing-card__heading">
        <a class="directory-listing-card__heading-link" href="/profile/hadley-roster">
          Hadley Roster, M.D.
        </a>
      </h3>
      <div class="directory-listing-card__subheading">
        <div>Professor of Molecular, Cellular &amp; Developmental Biology</div>
      </div>
      <a class="directory-listing-card__link" href="mailto:hadley.roster@yale.edu">Email</a>
      <a class="directory-listing-card__link" href="https://medicine.yale.edu/about/a-to-z-index/atoz/lab-websites/">Lab Website</a>
    </div>
  </div>
  <div class="directory-listing-card">
    <div class="directory-listing-card__content">
      <h3 class="directory-listing-card__heading">
        <a class="directory-listing-card__heading-link" href="/profile/empty"></a>
      </h3>
    </div>
  </div>
</body></html>
`;

const PSYCH_HTML = `
<html><body>
  <table class="views-table cols-5">
    <caption>Primary Faculty</caption>
    <thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Office</th><th></th></tr></thead>
    <tbody>
      <tr class="odd views-row-first">
        <td class="views-field views-field-name">
          <a href="/people/wynn-roster" class="username">Woo-kyoung Ahn</a>
        </td>
        <td class="views-field views-field-field-phone">203-432-9626</td>
        <td class="views-field views-field-mail">
          <a href="mailto:wynn.roster@yale.edu">wynn.roster@yale.edu</a>
        </td>
        <td class="views-field views-field-field-office">100 College St.</td>
        <td class="views-field views-field-edit-node"></td>
      </tr>
      <tr class="even">
        <td class="views-field views-field-name">
          <a href="/people/jordan-roster">Jordan Roster</a>
        </td>
        <td class="views-field views-field-field-phone">203-432-1111</td>
        <td class="views-field views-field-mail">
          <a href="mailto:jordan.roster@yale.edu">jordan.roster@yale.edu</a>
        </td>
        <td class="views-field views-field-field-office">2 Hillhouse</td>
        <td></td>
      </tr>
      <tr class="odd">
        <td class="views-field views-field-name"></td>
        <td>—</td><td></td><td></td><td></td>
      </tr>
    </tbody>
  </table>
  <table class="views-table cols-5">
    <caption>Lecturers</caption>
    <thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Office</th><th></th></tr></thead>
    <tbody>
      <tr>
        <td class="views-field views-field-name">
          <a href="/people/jane-doe">Jane Doe</a>
        </td>
        <td class="views-field views-field-field-phone"></td>
        <td class="views-field views-field-mail"></td>
        <td class="views-field views-field-field-office"></td>
        <td></td>
      </tr>
    </tbody>
  </table>
</body></html>
`;

const PSYCH_PRIMARY_HTML = `
<html><body>
  <table class="views-table cols-0">
    <tbody>
      <tr class="odd views-row-first">
        <td class="views-field views-field-picture">
          <a href="/people/wynn-roster">
            <img src="/sites/default/files/styles/people_thumbnail/public/pictures/ahn.jpg" alt="Woo-kyoung Ahn's picture" />
          </a>
        </td>
        <td class="views-field views-field-name">
          <a href="/people/wynn-roster" title="View user profile." class="username">Woo-kyoung Ahn</a><br />
          John Hay Whitney Professor of Psychology<br />
          100 College St.<br />
          <a href="mailto:wynn.roster@yale.edu">wynn.roster@yale.edu</a><br />
          Phone: 203-432-9626<br />
          <a href="http://ahnthinkinglab.yale.edu/" target="_blank">Website</a>
        </td>
      </tr>
    </tbody>
  </table>
</body></html>
`;

const ASTRONOMY_GRID_HTML = `
<html><body>
  <table class="views-view-grid cols-1">
    <tbody>
      <tr>
        <td class="col-1 col-first">
          <div class="views-field views-field-picture">
            <span class="field-content">
              <a href="/people/harper-astro"><img alt="Harper Astro's picture" /></a>
            </span>
          </div>
          <div class="views-field views-field-name">
            <span class="field-content">Harper Astro</span>
          </div>
          <div class="views-field views-field-field-title">
            <div class="field-content">Professor of Astronomy</div>
          </div>
          <div class="views-field views-field-mail">
            <span class="field-content">
              <a href="mailto:harper.astro@yale.edu">harper.astro@yale.edu</a>
            </span>
          </div>
          <div class="views-field views-field-field-term-reference">
            <div class="field-content">Star Formation and ISM</div>
          </div>
        </td>
      </tr>
    </tbody>
  </table>
</body></html>
`;

const ERM_VIEWS_ROW_HTML = `
<html><body>
  <div class="views-row">
    <div class="views-field views-field-picture">
      <div class="field-content picture">
        <a href="/people/avery-rivera-fixture">
          <img src="https://erm.yale.edu/sites/default/files/styles/people_directory_image/public/pictures/avery-fixture.jpg" alt="Avery Rivera's picture" />
        </a>
      </div>
    </div>
    <div class="views-field views-field-name">
      <h4 class="field-content name">
        <a href="/people/avery-rivera-fixture" class="username">Avery Rivera</a>
      </h4>
    </div>
    <div class="views-field views-field-field-title">
      <div class="field-content position">Director of Undergraduate Studies (ER&amp;M) and Professor of Women's, Gender, and Sexuality Studies</div>
    </div>
    <div class="views-field views-field-field-email">
      <div class="field-content">
        <span id="email-placeholder"></span>
        <script type="text/javascript">
          document.getElementById('email-placeholder').innerHTML = '<a href="&#109;&#97;&#105;&#108;&#116;&#111;&#58;&#97;&#118;&#101;&#114;&#121;&#46;&#114;&#105;&#118;&#101;&#114;&#97;&#64;&#121;&#97;&#108;&#101;&#46;&#101;&#100;&#117;">&#97;&#118;&#101;&#114;&#121;&#46;&#114;&#105;&#118;&#101;&#114;&#97;&#64;&#121;&#97;&#108;&#101;&#46;&#101;&#100;&#117;</a>';
        </script>
      </div>
    </div>
  </div>
  <div class="views-row">
    <div class="views-field views-field-name">
      <h4 class="field-content name"><a href="/people/jordan-winter-fixture">Jordan Winter</a></h4>
    </div>
    <div class="views-field views-field-field-title">
      <p class="field-content position">Professor of Women's, Gender, and Sexuality Studies and of Ethnicity, Race, and Migration</p>
    </div>
  </div>
</body></html>
`;

const MACMILLAN_PERSON_HTML = `
<html><body>
  <article class="node-teaser node-teaser--person node-teaser--image-size-sm">
    <header class="node-teaser__header">
      <div class="node-teaser__groups">Council on African Studies</div>
      <div class="node-teaser__heading">
        <a href="/africa/person/oluseye-adesola"><span>Oluseye Adesola</span></a>
      </div>
      <div class="node-teaser__title">
        Senior Lector II in Yoruba &amp; African Studies, Council on African Studies
      </div>
    </header>
    <div class="node-teaser__content">
      <div class="node-teaser__image">
        <img loading="lazy" alt="Oluseye Adesola" data-src="/sites/default/files/styles/square_320/public/2024-09/Oluseye%20Adesola.jpg" />
      </div>
    </div>
  </article>
</body></html>
`;

const TDPS_DIRECTORY_CARD_HTML = `
<html><body>
  <ul class="card-collection__cards">
    <li class="directory-listing-card">
      <div class="directory-listing-card__content">
        <h3 class="directory-listing-card__heading">
          <a class="directory-listing-card__heading-link" href="/profile/deb-margolin">
            Deb Margolin
          </a>
        </h3>
        <div class="directory-listing-card__subheading">
          <div>Professor in the Practice</div>
        </div>
        <a class="directory-listing-card__link" href="mailto:devon.roster@yale.edu">Email</a>
      </div>
      <div class="directory-listing-card__image">
        <img src="/sites/default/files/styles/1_1_300_/public/2024-06/deb.png" alt="Deb Margolin Headshot" />
      </div>
    </li>
  </ul>
</body></html>
`;

const JACKSON_PERSON_CARD_HTML = `
<html><body>
  <div class="page-item page-item-person page-item-person-staff-faculty">
    <div class="page-item-image">
      <img class="center-block img-responsive" src="https://jackson.yale.edu/wp-content/uploads/2026/05/Eric-Braverman.jpg" alt="Emery Roster Thumbnail" />
    </div>
    <div class="page-item-content">
      <div class="page-item-person-name">
        <div class="page-item-person-name-inner">Emery Roster</div>
      </div>
      <div class="page-item-person-bio">
        <div class="page-item-person-bio-title">Lecturer</div>
        <div class="page-item-bio-links">
          <span class="page-item-bio-link">
            <a class="more" href="mailto:emery.roster@yale.edu">Email</a>
          </span>
          <div class="page-item-person-bio-link hidden-xs">
            <a class="more" href="https://jackson.yale.edu/person/emery-roster/">View Bio</a>
          </div>
        </div>
      </div>
    </div>
  </div>
</body></html>
`;

// ---------------------------------------------------------------------------
// Helper tests
// ---------------------------------------------------------------------------

describe('slugify', () => {
  it('lowercases and dash-separates', () => {
    expect(slugify('Samuel Kortum')).toBe('samuel-kortum');
  });
  it('strips diacritics', () => {
    expect(slugify('Béatrice Müller')).toBe('beatrice-muller');
  });
  it("strips possessive 's", () => {
    expect(slugify("Abujarad's Lab")).toBe('abujarad-lab');
  });
  it('handles ampersand and punctuation', () => {
    expect(slugify('Foo & Bar, Inc.')).toBe('foo-and-bar-inc');
  });
  it('returns empty string on empty input', () => {
    expect(slugify('')).toBe('');
  });
});

describe('netidFromEmail', () => {
  it('extracts the local part from a yale.edu address', () => {
    expect(netidFromEmail('wynn.roster@yale.edu')).toBe('wynn.roster');
  });
  it('strips a mailto: prefix', () => {
    expect(netidFromEmail('mailto:abc123@yale.edu')).toBe('abc123');
  });
  it('strips a +tag suffix', () => {
    expect(netidFromEmail('netid+lists@yale.edu')).toBe('netid');
  });
  it('returns null for non-yale addresses', () => {
    expect(netidFromEmail('foo@gmail.com')).toBeNull();
    expect(netidFromEmail('foo@stanford.edu')).toBeNull();
  });
  it('returns null for malformed input', () => {
    expect(netidFromEmail('')).toBeNull();
    expect(netidFromEmail(null)).toBeNull();
    expect(netidFromEmail('not-an-email')).toBeNull();
  });
});

describe('isLikelyPersonSpecificYaleEmail', () => {
  it('accepts netid-shaped Yale emails even when the local-part is not name-shaped', () => {
    expect(isLikelyPersonSpecificYaleEmail('jmg257@yale.edu', 'Jordan Mismatch')).toBe(true);
    expect(isLikelyPersonSpecificYaleEmail('yy259@yale.edu', 'Yarden Match')).toBe(true);
  });

  it('accepts name-shaped local-parts that match the visible person name', () => {
    expect(isLikelyPersonSpecificYaleEmail('drew.match@yale.edu', 'Drew Match')).toBe(true);
    expect(isLikelyPersonSpecificYaleEmail('yarden.match@yale.edu', 'Yarden Match')).toBe(true);
    expect(isLikelyPersonSpecificYaleEmail('ari.match@yale.edu', 'Ari Match')).toBe(true);
  });

  it('rejects contact or other-person Yale emails near a faculty name', () => {
    expect(isLikelyPersonSpecificYaleEmail('sage.mismatch@yale.edu', 'Jordan Mismatch')).toBe(false);
    expect(isLikelyPersonSpecificYaleEmail('drew.match@yale.edu', 'Dana Mismatch')).toBe(false);
    expect(isLikelyPersonSpecificYaleEmail('sky.mismatch@yale.edu', 'Different Person')).toBe(false);
    expect(isLikelyPersonSpecificYaleEmail('ysm.editor@yale.edu', 'Cameron Profile')).toBe(false);
  });
});

describe('normalizeName', () => {
  it('strips trailing Ph.D. credentials', () => {
    expect(normalizeName('Riley Roster, Ph.D.')).toBe('Riley Roster');
    expect(normalizeName('Jane Doe, M.D.')).toBe('Jane Doe');
  });
  it('strips leading honorifics', () => {
    expect(normalizeName('Prof. Foo Bar')).toBe('Foo Bar');
    expect(normalizeName('Dr Jane')).toBe('Jane');
  });
  it('collapses whitespace', () => {
    expect(normalizeName('  Foo   Bar  ')).toBe('Foo Bar');
  });
  it('returns empty on empty input', () => {
    expect(normalizeName('')).toBe('');
    expect(normalizeName(null)).toBe('');
  });
});

describe('splitName', () => {
  it('splits two-word name', () => {
    expect(splitName('Samuel Kortum')).toEqual({ first: 'Samuel', last: 'Kortum' });
  });
  it('keeps suffix with last name', () => {
    expect(splitName('John Doe Jr.')).toEqual({ first: 'John', last: 'Doe Jr.' });
  });
  it('handles single-word name', () => {
    expect(splitName('Madonna')).toEqual({ first: 'Madonna', last: '' });
  });
  it('handles three-word name', () => {
    expect(splitName('Mary Jane Smith')).toEqual({ first: 'Mary Jane', last: 'Smith' });
  });
});

// ---------------------------------------------------------------------------
// Per-department extractor tests
// ---------------------------------------------------------------------------

describe('econExtractor', () => {
  it('extracts faculty cards and ignores unrelated articles', () => {
    const out = econExtractor(ECON_HTML, { pageUrl: 'https://economics.yale.edu/people' });
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({
      name: 'Samuel Kortum',
      title: 'Departmental Chair and Robin Burrows Moffatt Professor of Economics',
      profileUrl: 'https://economics.yale.edu/people/samuel-kortum',
    });
    expect(out[1].name).toBe('Jason Abaluck');
    expect(out[2].name).toBe('Laura Adler');
    expect(out[2].title).toBeUndefined();
  });

  it('returns an empty array on a page with no person teasers', () => {
    const out = econExtractor('<html><body><p>Nothing</p></body></html>', {
      pageUrl: 'https://economics.yale.edu/people?page=99',
    });
    expect(out).toEqual([]);
  });

  it('supports MacMillan person cards with node-teaser titles and lazy images', () => {
    const out = econExtractor(MACMILLAN_PERSON_HTML, {
      pageUrl: 'https://macmillan.yale.edu/africa/people',
    });

    expect(out).toEqual([
      {
        name: 'Oluseye Adesola',
        profileUrl: 'https://macmillan.yale.edu/africa/person/oluseye-adesola',
        title: 'Senior Lector II in Yoruba & African Studies, Council on African Studies',
        imageUrl:
          'https://macmillan.yale.edu/sites/default/files/styles/square_320/public/2024-09/Oluseye%20Adesola.jpg',
      },
    ]);
  });
});

describe('mcdbExtractor', () => {
  it('extracts cards with name, title, email, optional lab URL', () => {
    const out = mcdbExtractor(MCDB_HTML, { pageUrl: 'https://mcdb.yale.edu/people/faculty' });
    expect(out).toHaveLength(3); // empty card skipped
    expect(out[0]).toMatchObject({
      name: 'Shannon Roster, Ph.D.',
      email: 'shannon.roster@yale.edu',
      labUrl: 'https://bahmanyarlab.yale.edu',
      profileUrl: 'https://mcdb.yale.edu/profile/shannon-roster-phd',
    });
    expect(out[0].title).toContain('Associate Professor');
    expect(out[1]).toMatchObject({
      name: 'Riley Roster, Ph.D.',
      email: 'riley.roster@yale.edu',
    });
    expect(out[1].labUrl).toBeUndefined();
    expect(out[2]).toMatchObject({
      name: 'Hadley Roster, M.D.',
      email: 'hadley.roster@yale.edu',
      profileUrl: 'https://mcdb.yale.edu/profile/hadley-roster',
    });
    expect(out[2].labUrl).toBeUndefined();
  });
});

describe('official Yale profile-card extractor coverage', () => {
  it('supports the Math and Statistics profile-card shape', () => {
    const html = `
      <html><body>
        <div class="directory-listing-card">
          <div class="directory-listing-card__content">
            <h3 class="directory-listing-card__heading">
              <a class="directory-listing-card__heading-link" href="/profile/ada-lovelace">
                Ada Lovelace
              </a>
            </h3>
            <div class="directory-listing-card__subheading">Professor of Mathematics</div>
            <div class="directory-listing-card__snippet">Algebraic geometry and topology.</div>
            <a class="directory-listing-card__link" href="mailto:ada.lovelace@yale.edu">Email</a>
          </div>
        </div>
      </body></html>
    `;

    const out = mcdbExtractor(html, { pageUrl: 'https://math.yale.edu/people/faculty' });

    expect(out).toEqual([
      {
        name: 'Ada Lovelace',
        profileUrl: 'https://math.yale.edu/profile/ada-lovelace',
        title: 'Professor of Mathematics',
        email: 'ada.lovelace@yale.edu',
        labUrl: undefined,
        bio: 'Algebraic geometry and topology.',
      },
    ]);
  });

  it('supports TDPS directory-listing cards with profile image URLs', () => {
    const out = mcdbExtractor(TDPS_DIRECTORY_CARD_HTML, {
      pageUrl: 'https://tdps.yale.edu/people',
    });

    expect(out).toEqual([
      {
        name: 'Deb Margolin',
        profileUrl: 'https://tdps.yale.edu/profile/deb-margolin',
        title: 'Professor in the Practice',
        email: 'devon.roster@yale.edu',
        labUrl: undefined,
        bio: undefined,
        imageUrl:
          'https://tdps.yale.edu/sites/default/files/styles/1_1_300_/public/2024-06/deb.png',
      },
    ]);
  });
});

describe('psychExtractor', () => {
  it('extracts rows from all views-table sections, skipping empty rows', () => {
    const out = psychExtractor(PSYCH_HTML, {
      pageUrl: 'https://psychology.yale.edu/people/faculty',
    });
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({
      name: 'Woo-kyoung Ahn',
      email: 'wynn.roster@yale.edu',
      profileUrl: 'https://psychology.yale.edu/people/wynn-roster',
    });
    expect(out[1].name).toBe('Jordan Roster');
    expect(out[2]).toMatchObject({ name: 'Jane Doe' });
    expect(out[2].email).toBeUndefined();
  });

  it('extracts the current primary-faculty view with embedded email and website links', () => {
    const out = psychExtractor(PSYCH_PRIMARY_HTML, {
      pageUrl: 'https://psychology.yale.edu/people/faculty/primary',
    });

    expect(out).toEqual([
      {
        name: 'Woo-kyoung Ahn',
        title: 'John Hay Whitney Professor of Psychology',
        email: 'wynn.roster@yale.edu',
        profileUrl: 'https://psychology.yale.edu/people/wynn-roster',
        imageUrl:
          'https://psychology.yale.edu/sites/default/files/styles/people_thumbnail/public/pictures/ahn.jpg',
        labUrl: 'http://ahnthinkinglab.yale.edu/',
      },
    ]);
  });

  it('supports Physics and Astronomy views-table rows with field-of-study topics', () => {
    const html = `
      <html><body>
        <table class="views-table">
          <tbody>
            <tr>
              <td class="views-field views-field-name">
                <a href="/people/marie-curie" class="username">Marie Curie</a><br />
                Professor of Physics<br />
                <a href="mailto:marie.curie@yale.edu">marie.curie@yale.edu</a><br />
                <a href="https://curielab.yale.edu/">Research Website</a>
              </td>
              <td class="views-field views-field-field-field-of-study">
                Condensed Matter; Quantum Materials
              </td>
            </tr>
          </tbody>
        </table>
      </body></html>
    `;

    const out = psychExtractor(html, { pageUrl: 'https://physics.yale.edu/people/faculty' });

    expect(out).toEqual([
      {
        name: 'Marie Curie',
        title: 'Professor of Physics',
        email: 'marie.curie@yale.edu',
        profileUrl: 'https://physics.yale.edu/people/marie-curie',
        labUrl: 'https://curielab.yale.edu/',
        topics: ['Condensed Matter', 'Quantum Materials'],
        researchInterests: ['Condensed Matter', 'Quantum Materials'],
      },
    ]);
  });

  it('splits adjacent Physics field-of-study taxonomy links without concatenating labels', () => {
    const html = `
      <html><body>
        <table class="views-table">
          <tbody>
            <tr>
              <td class="views-field views-field-name">
                <a href="/people/morgan-contact" class="username">Morgan Contact</a><br />
                Associate Professor<br />
                <a href="mailto:m.contact@yale.edu">m.contact@yale.edu</a>
              </td>
              <td class="views-field views-field-field-field-of-study">
                <a href="/research/condensed-matter-physics">Condensed Matter Physics</a><a href="/taxonomy/theorist">Theorist</a><a href="/taxonomy/quantum-criticality">Quantum criticality</a>
              </td>
            </tr>
          </tbody>
        </table>
      </body></html>
    `;

    const out = psychExtractor(html, { pageUrl: 'https://physics.yale.edu/people/faculty' });

    expect(out[0].topics).toEqual([
      'Condensed Matter Physics',
      'Theorist',
      'Quantum criticality',
    ]);
    expect(out[0].topics).not.toContain('Condensed Matter PhysicsTheoristQuantum criticality');
  });

  it('supports Astronomy views grid cells with profile picture links and topic fields', () => {
    const out = psychExtractor(ASTRONOMY_GRID_HTML, {
      pageUrl: 'https://astronomy.yale.edu/people/faculty',
    });

    expect(out).toEqual([
      {
        name: 'Harper Astro',
        title: 'Professor of Astronomy',
        email: 'harper.astro@yale.edu',
        profileUrl: 'https://astronomy.yale.edu/people/harper-astro',
        labUrl: undefined,
        topics: ['Star Formation and ISM'],
        researchInterests: ['Star Formation and ISM'],
      },
    ]);
  });
});

describe('viewsRowPersonExtractor', () => {
  it('extracts old Drupal views-row faculty rows with obfuscated Yale email addresses', () => {
    const out = viewsRowPersonExtractor(ERM_VIEWS_ROW_HTML, {
      pageUrl: 'https://erm.yale.edu/people/faculty',
    });

    expect(out).toEqual([
      {
        name: 'Avery Rivera',
        profileUrl: 'https://erm.yale.edu/people/avery-rivera-fixture',
        title:
          "Director of Undergraduate Studies (ER&M) and Professor of Women's, Gender, and Sexuality Studies",
        email: 'avery.rivera@yale.edu',
        imageUrl:
          'https://erm.yale.edu/sites/default/files/styles/people_directory_image/public/pictures/avery-fixture.jpg',
      },
      {
        name: 'Jordan Winter',
        profileUrl: 'https://erm.yale.edu/people/jordan-winter-fixture',
        title:
          "Professor of Women's, Gender, and Sexuality Studies and of Ethnicity, Race, and Migration",
      },
    ]);
  });
});

describe('jacksonPersonCardExtractor', () => {
  it('extracts Jackson person cards with email, bio URL, title, and image', () => {
    const out = jacksonPersonCardExtractor(JACKSON_PERSON_CARD_HTML, {
      pageUrl: 'https://jackson.yale.edu/about/meet-us/faculty/lecturers/',
    });

    expect(out).toEqual([
      {
        name: 'Emery Roster',
        profileUrl: 'https://jackson.yale.edu/person/emery-roster/',
        title: 'Lecturer',
        email: 'emery.roster@yale.edu',
        imageUrl: 'https://jackson.yale.edu/wp-content/uploads/2026/05/Eric-Braverman.jpg',
      },
    ]);
  });
});

describe('csJsRenderedStub', () => {
  it('throws to signal the page needs a headless browser', () => {
    expect(() => csJsRenderedStub('<html></html>', { pageUrl: 'x' })).toThrow(/JS-rendered/);
  });
});

describe('csRenderedExtractor', () => {
  it('extracts hydrated profile links once with official profile URLs', () => {
    const html = `
      <main>
        <article>
          <a href="/faculty/grace-hopper">Grace Hopper</a>
          <div class="person-title">Professor of Computer Science</div>
          <a href="mailto:grace.hopper@yale.edu">Email</a>
        </article>
        <article>
          <a href="/faculty/grace-hopper">Grace Hopper</a>
        </article>
      </main>
    `;
    const out = csRenderedExtractor(html, { pageUrl: 'https://engineering.yale.edu/cs/faculty' });

    expect(out).toEqual([
      {
        name: 'Grace Hopper',
        profileUrl: 'https://engineering.yale.edu/faculty/grace-hopper',
        title: 'Professor of Computer Science',
        email: 'grace.hopper@yale.edu',
      },
    ]);
  });
});

describe('csFacultyDataExtractor', () => {
  it('extracts the client-rendered faculty endpoint payload', () => {
    const out = csFacultyDataExtractor(
      {
        pages: {
          3: {
            name: 'Primary Faculty',
            facultyMembers: [
              {
                name: 'Grace Hopper',
                title: 'Professor',
                fullTitle: 'Professor of Computer Science',
                url: '/academic-study/departments/computer-science/faculty/grace-hopper',
              },
              {
                name: 'David Van Dijk',
                title: 'Assistant Professor',
                fullTitle: 'Assistant Professor of Computer Science',
                url: 'https://www.vandijklab.org/',
              },
            ],
          },
        },
      },
      {
        pageUrl:
          'https://engineering.yale.edu/academic-study/departments/computer-science/faculty/load_faculty/4841',
      },
    );

    expect(out).toEqual([
      {
        name: 'Grace Hopper',
        title: 'Professor of Computer Science',
        profileUrl:
          'https://engineering.yale.edu/academic-study/departments/computer-science/faculty/grace-hopper',
        labUrl: undefined,
      },
      {
        name: 'David Van Dijk',
        title: 'Assistant Professor of Computer Science',
        profileUrl: 'https://www.vandijklab.org/',
        labUrl: 'https://www.vandijklab.org/',
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Scraper orchestration test (no network — extractor returns canned rows)
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<ScraperContext['options']> = {}) {
  const emitted: ObservationInput[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'test-run',
    sourceId: 'test-source',
    sourceName: 'dept-faculty-roster',
    sourceWeight: 0.7,
    options: {
      dryRun: true,
      useCache: false,
      release: false,
      ...overrides,
    },
    emit: async (obs) => {
      if (Array.isArray(obs)) emitted.push(...obs);
      else emitted.push(obs);
    },
    log: () => {},
  };
  return { ctx, emitted };
}

describe('DepartmentRosterScraper.run', () => {
  it('rejects unsafe runtime limits before fetching department pages', async () => {
    const htmlFetcher = vi.fn(async () => ECON_HTML);
    const configs: DeptConfig[] = [
      {
        deptKey: 'economics',
        deptName: 'Economics',
        schoolName: 'Yale Faculty of Arts and Sciences',
        url: 'https://economics.yale.edu/people/faculty',
        extractor: econExtractor,
      },
    ];
    const scraper = new DepartmentRosterScraper(configs, null, htmlFetcher);
    const { ctx } = makeContext({ limit: 9007199254740992 });

    await expect(scraper.run(ctx)).rejects.toThrow(/--limit must be a safe positive integer/);

    expect(htmlFetcher).not.toHaveBeenCalled();
  });

  it('bundles the expanded official roster config set', () => {
    const configsByKey = new Map(DEFAULT_DEPT_CONFIGS.map((config) => [config.deptKey, config]));

    expect(configsByKey.get('political-science')).toMatchObject({
      deptName: 'Political Science',
      url: 'https://politicalscience.yale.edu/people/faculty',
      paginated: true,
      extractor: psychExtractor,
    });
    expect(configsByKey.get('history')).toMatchObject({
      deptName: 'History',
      url: 'https://history.yale.edu/people/faculty',
      paginated: true,
      extractor: psychExtractor,
    });
    expect(configsByKey.get('american-studies')).toMatchObject({
      deptName: 'American Studies',
      url: 'https://americanstudies.yale.edu/people/faculty',
      extractor: psychExtractor,
    });
    expect(configsByKey.get('african-studies')).toMatchObject({
      deptName: 'African Studies',
      url: 'https://macmillan.yale.edu/africa/people',
      extractor: econExtractor,
      emitPersonalResearchEntities: false,
    });
    expect(configsByKey.get('music')).toMatchObject({
      deptName: 'Music',
      url: 'https://yalemusic.yale.edu/people/faculty',
      extractor: psychExtractor,
    });
    expect(configsByKey.get('history-art')).toMatchObject({
      deptName: 'History of Art',
      url: 'https://arthistory.yale.edu/people/faculty',
      extractor: viewsRowPersonExtractor,
    });
    expect(configsByKey.get('anthropology')).toMatchObject({
      deptName: 'Anthropology',
      url: 'https://anthropology.yale.edu/people/faculty',
      extractor: mcdbExtractor,
    });
    expect(configsByKey.get('earth-planetary-sciences')).toMatchObject({
      deptName: 'Earth and Planetary Sciences',
      url: 'https://earth.yale.edu/faculty',
      extractor: mcdbExtractor,
    });
    expect(configsByKey.get('erm')).toMatchObject({
      deptName: 'Ethnicity, Race, and Migration',
      url: 'https://erm.yale.edu/people/faculty',
      extractor: viewsRowPersonExtractor,
    });
    expect(configsByKey.get('wgss')).toMatchObject({
      deptName: "Women's, Gender, and Sexuality Studies",
      url: 'https://wgss.yale.edu/people/faculty',
      extractor: viewsRowPersonExtractor,
    });
    expect(configsByKey.get('global-affairs')).toMatchObject({
      deptName: 'Global Affairs',
      url: 'https://jackson.yale.edu/about/meet-us/faculty/lecturers/',
      extractor: jacksonPersonCardExtractor,
      emitPersonalResearchEntities: false,
    });
    expect(configsByKey.get('tdps')).toMatchObject({
      deptName: 'Theater, Dance, and Performance Studies',
      url: 'https://tdps.yale.edu/people',
      extractor: mcdbExtractor,
      emitPersonalResearchEntities: false,
    });
  });

  it('skips JS-rendered depts and only invokes extractors for matching only-filter', async () => {
    const cannedExtractor = vi.fn(
      (): FacultyEntry[] => [
        { name: 'Test Faculty', email: 'tf123@yale.edu', labUrl: 'https://tflab.example.org' },
      ],
    );
    const stubExtractor = vi.fn((): FacultyEntry[] => []);
    const configs: DeptConfig[] = [
      {
        deptKey: 'econ',
        deptName: 'Economics',
        schoolName: 'FAS',
        url: 'https://example.invalid/econ',
        paginated: false,
        extractor: cannedExtractor,
      },
      {
        deptKey: 'cs',
        deptName: 'Computer Science',
        schoolName: 'SEAS',
        url: 'https://example.invalid/cs',
        paginated: false,
        extractor: stubExtractor,
        jsRenderedSkip: true,
      },
    ];
    // Stub fetchHtml indirectly: monkey-patch axios via vi.spyOn.
    const axios = (await import('axios')).default;
    const getSpy = vi.spyOn(axios, 'get').mockResolvedValue({ data: '<html></html>' } as any);

    const scraper = new DepartmentRosterScraper(configs);
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);

    expect(stubExtractor).not.toHaveBeenCalled();
    expect(cannedExtractor).toHaveBeenCalledTimes(1);
    expect(result.entitiesObserved).toBe(2); // 1 user + 1 lab
    expect(result.notes).toContain('econ=1');
    expect(result.notes).toContain('cs=js-rendered-skip');
    expect(result.fetchMetrics?.summary.total).toBe(0);

    // user observations include netid and email
    const userObs = emitted.filter((o) => o.entityType === 'user');
    expect(userObs.find((o) => o.field === 'netid')?.value).toBe('tf123');
    expect(userObs.find((o) => o.field === 'email')?.value).toBe('tf123@yale.edu');
    expect(userObs.find((o) => o.field === 'fname')?.value).toBe('Test');
    expect(userObs.find((o) => o.field === 'lname')?.value).toBe('Faculty');
    expect(userObs.find((o) => o.field === 'primaryDepartment')?.value).toBe('Economics');
    // entityKey uses netid: prefix when an @yale.edu email is present
    expect(userObs[0].entityKey).toBe('netid:tf123');

    // lab observations
    const labObs = emitted.filter((o) => o.entityType === 'researchEntity');
    expect(labObs.find((o) => o.field === 'websiteUrl')?.value).toBe('https://tflab.example.org');
    expect(labObs.find((o) => o.field === 'kind')?.value).toBe('lab');
    expect(labObs.find((o) => o.field === 'entityType')?.value).toBe('LAB');
    expect(labObs.find((o) => o.field === 'departments')?.value).toEqual(['Economics']);
    expect(labObs[0].entityKey).toMatch(/^dept-econ-test-faculty/);

    getSpy.mockRestore();
  });

  it('does not derive identity email observations from another person contact on a roster card', async () => {
    const cannedExtractor = vi.fn(
      (): FacultyEntry[] => [
        {
          name: 'Jordan Mismatch',
          email: 'sage.mismatch@yale.edu',
          labUrl: 'https://gendronlab.yale.edu',
        },
      ],
    );
    const configs: DeptConfig[] = [
      {
        deptKey: 'mcdb',
        deptName: 'Molecular, Cellular and Developmental Biology',
        schoolName: 'FAS',
        url: 'https://example.invalid/mcdb',
        paginated: false,
        extractor: cannedExtractor,
      },
    ];
    const axios = (await import('axios')).default;
    const getSpy = vi.spyOn(axios, 'get').mockResolvedValue({ data: '<html></html>' } as any);

    const scraper = new DepartmentRosterScraper(configs);
    const { ctx, emitted } = makeContext();
    await scraper.run(ctx);

    const userObs = emitted.filter((o) => o.entityType === 'user');
    expect(userObs.some((o) => o.field === 'netid')).toBe(false);
    expect(userObs.some((o) => o.field === 'email')).toBe(false);
    expect(userObs.find((o) => o.field === 'fname')?.value).toBe('Jordan');
    expect(userObs.find((o) => o.field === 'lname')?.value).toBe('Mismatch');
    expect(userObs[0].entityKey).toBe('dept:mcdb:jordan-mismatch');

    getSpy.mockRestore();
  });

  it('models personal research websites as faculty research areas rather than labs', async () => {
    const cannedExtractor = vi.fn(
      (): FacultyEntry[] => [
        {
          name: 'Abraham Silberschatz',
          profileUrl: 'https://engineering.yale.edu/research-and-faculty/faculty-directory/avery-database-fixture',
          labUrl: 'https://codex.cs.yale.edu/avi/',
        },
      ],
    );
    const configs: DeptConfig[] = [
      {
        deptKey: 'cs',
        deptName: 'Computer Science',
        schoolName: 'SEAS',
        url: 'https://example.invalid/cs',
        paginated: false,
        extractor: cannedExtractor,
      },
    ];
    const axios = (await import('axios')).default;
    const getSpy = vi.spyOn(axios, 'get').mockResolvedValue({ data: '<html></html>' } as any);

    const scraper = new DepartmentRosterScraper(configs);
    const { ctx, emitted } = makeContext();
    await scraper.run(ctx);

    const entityObs = emitted.filter((o) => o.entityType === 'researchEntity');
    expect(entityObs.find((o) => o.field === 'name')?.value).toBe(
      'Abraham Silberschatz Faculty Research',
    );
    expect(entityObs.find((o) => o.field === 'kind')?.value).toBe('individual');
    expect(entityObs.find((o) => o.field === 'entityType')?.value).toBe(
      'FACULTY_RESEARCH_AREA',
    );
    expect(entityObs.find((o) => o.field === 'websiteUrl')?.value).toBe(
      'https://codex.cs.yale.edu/avi/',
    );

    getSpy.mockRestore();
  });

  it('can suppress generic personal-site research entities for broad people rosters', async () => {
    const cannedExtractor = vi.fn(
      (): FacultyEntry[] => [
        {
          name: 'Deb Margolin',
          email: 'devon.roster@yale.edu',
          profileUrl: 'https://tdps.yale.edu/profile/deb-margolin',
          labUrl: 'https://www.debmargolin.com/',
        },
        {
          name: 'Research Lab Owner',
          email: 'research.owner@yale.edu',
          labUrl: 'https://researchlab.yale.edu/',
        },
      ],
    );
    const configs: DeptConfig[] = [
      {
        deptKey: 'tdps',
        deptName: 'Theater, Dance, and Performance Studies',
        schoolName: 'FAS',
        url: 'https://example.invalid/tdps',
        paginated: false,
        extractor: cannedExtractor,
        emitPersonalResearchEntities: false,
      },
    ];
    const axios = (await import('axios')).default;
    const getSpy = vi.spyOn(axios, 'get').mockResolvedValue({ data: '<html></html>' } as any);

    const scraper = new DepartmentRosterScraper(configs);
    const { ctx, emitted } = makeContext();
    await scraper.run(ctx);

    const entityObs = emitted.filter((o) => o.entityType === 'researchEntity');
    expect(entityObs.find((o) => o.field === 'name')?.value).toBe('Research Lab Owner Lab');
    expect(entityObs.some((o) => o.value === 'Deb Margolin Faculty Research')).toBe(false);
    expect(entityObs.find((o) => o.field === 'websiteUrl')?.value).toBe(
      'https://researchlab.yale.edu/',
    );

    getSpy.mockRestore();
  });

  it('emits conservative source-backed descriptions from roster topic fields', async () => {
    const cannedExtractor = vi.fn(
      (): FacultyEntry[] => [
        {
          name: 'Hayden Material',
          email: 'hayden.material@yale.edu',
          labUrl: 'https://www.eng.yale.edu/caolab/',
          topics: [
            'Condensed Matter Physics',
            'Experimentalist',
            'Coherent control of light transport and absorption',
            'Random lasers',
          ],
          researchInterests: [
            'Condensed Matter Physics',
            'Experimentalist',
            'Coherent control of light transport and absorption',
            'Random lasers',
          ],
        },
      ],
    );
    const configs: DeptConfig[] = [
      {
        deptKey: 'physics',
        deptName: 'Physics',
        schoolName: 'FAS',
        url: 'https://example.invalid/physics',
        paginated: false,
        extractor: cannedExtractor,
      },
    ];
    const axios = (await import('axios')).default;
    const getSpy = vi.spyOn(axios, 'get').mockResolvedValue({ data: '<html></html>' } as any);

    const scraper = new DepartmentRosterScraper(configs);
    const { ctx, emitted } = makeContext();
    await scraper.run(ctx);

    const entityObs = emitted.filter((o) => o.entityType === 'researchEntity');
    expect(entityObs.find((o) => o.field === 'researchAreas')?.value).toEqual([
      'Condensed Matter Physics',
      'Experimentalist',
      'Coherent control of light transport and absorption',
      'Random lasers',
    ]);
    expect(entityObs.find((o) => o.field === 'fullDescription')?.value).toBe(
      'Studies condensed matter physics, including coherent control of light transport and absorption, and random lasers.',
    );
    expect(entityObs.find((o) => o.field === 'shortDescription')?.value).toBe(
      'Studies condensed matter physics, including coherent control of light transport and absorption, and random lasers.',
    );

    getSpy.mockRestore();
  });

  it('honors the limit option across departments', async () => {
    const manyEntries = (count: number): FacultyEntry[] =>
      Array.from({ length: count }, (_v, i) => ({ name: `Person ${i}` }));
    const configs: DeptConfig[] = [
      {
        deptKey: 'econ',
        deptName: 'Economics',
        schoolName: 'FAS',
        url: 'https://example.invalid/econ',
        paginated: false,
        extractor: () => manyEntries(5),
      },
      {
        deptKey: 'mcdb',
        deptName: 'MCDB',
        schoolName: 'FAS',
        url: 'https://example.invalid/mcdb',
        paginated: false,
        extractor: () => manyEntries(5),
      },
    ];
    const axios = (await import('axios')).default;
    const getSpy = vi.spyOn(axios, 'get').mockResolvedValue({ data: '<html></html>' } as any);

    const scraper = new DepartmentRosterScraper(configs);
    const { ctx, emitted } = makeContext({ limit: 3 });
    await scraper.run(ctx);

    const userKeys = new Set(
      emitted.filter((o) => o.entityType === 'user').map((o) => o.entityKey),
    );
    expect(userKeys.size).toBe(3); // limit caps total

    getSpy.mockRestore();
  });

  it('uses synthetic entityKey when no yale email is available', async () => {
    const configs: DeptConfig[] = [
      {
        deptKey: 'psych',
        deptName: 'Psychology',
        schoolName: 'FAS',
        url: 'https://example.invalid/psych',
        paginated: false,
        extractor: () => [{ name: 'Jane Doe' }],
      },
    ];
    const axios = (await import('axios')).default;
    const getSpy = vi.spyOn(axios, 'get').mockResolvedValue({ data: '<html></html>' } as any);

    const scraper = new DepartmentRosterScraper(configs);
    const { ctx, emitted } = makeContext();
    await scraper.run(ctx);

    const userObs = emitted.filter((o) => o.entityType === 'user');
    expect(userObs[0].entityKey).toBe('dept:psych:jane-doe');
    expect(userObs.find((o) => o.field === 'netid')).toBeUndefined();

    getSpy.mockRestore();
  });

  it('follows official profile pages for canonical profile URLs and lab websites', async () => {
    const profileHtml = `
      <html><head>
        <link rel="canonical" href="/people/ada-lovelace" />
      </head><body>
        <div class="person-title">Associate Professor of Applied Mathematics</div>
        <div class="profile-body">Ada works on computation, algebraic geometry, and foundations of mathematical modeling.</div>
        <div class="research-interests"><a href="/topics/algebraic-geometry">Algebraic Geometry</a><a href="/topics/topology">Topology</a></div>
        <a href="https://orcid.org/0000-0000-0000-0001">ORCID</a>
        <a href="https://scholar.google.com/citations?user=adaCandidate">Google Scholar</a>
        <a href="mailto:ada.lovelace@yale.edu">ada.lovelace@yale.edu</a>
        <a href="https://lovelacelab.yale.edu">Lab Website</a>
        <h2>Selected Publications</h2>
        <ul>
          <li><em>Persons, Roles and Minds</em>. Stanford University Press, 2001.</li>
          <li><a href="/publications/stone"><em>The Stone in Late Imperial China</em></a>, 2009.</li>
        </ul>
      </body></html>
    `;
    const htmlFetcher = vi.fn(async (url: string) => {
      if (url === 'https://math.yale.edu/people/ada-lovelace') return profileHtml;
      return '<html><body>listing</body></html>';
    });
    const configs: DeptConfig[] = [
      {
        deptKey: 'math',
        deptName: 'Mathematics',
        schoolName: 'FAS',
        url: 'https://math.yale.edu/people/faculty',
        paginated: false,
        extractor: () => [
          {
            name: 'Ada Lovelace',
            profileUrl: 'https://math.yale.edu/people/ada-lovelace',
          },
        ],
      },
    ];

    const scraper = new DepartmentRosterScraper(configs, null, htmlFetcher);
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);

    expect(htmlFetcher).toHaveBeenCalledWith(
      'https://math.yale.edu/people/faculty',
      false,
      'dept-faculty-roster',
    );
    expect(htmlFetcher).toHaveBeenCalledWith(
      'https://math.yale.edu/people/ada-lovelace',
      false,
      'dept-faculty-roster',
    );
    expect(result.entitiesObserved).toBe(2);

    const userObs = emitted.filter((o) => o.entityType === 'user');
    expect(userObs[0].entityKey).toBe('netid:ada.lovelace');
    expect(userObs.find((o) => o.field === 'profileUrls')?.value).toEqual({
      departmental: 'https://math.yale.edu/people/ada-lovelace',
    });
    expect(userObs.find((o) => o.field === 'title')?.value).toBe(
      'Associate Professor of Applied Mathematics',
    );
    expect(userObs.find((o) => o.field === 'website')?.value).toBe(
      'https://lovelacelab.yale.edu/',
    );
    expect(userObs.find((o) => o.field === 'orcid')?.value).toBe('0000-0000-0000-0001');
    expect(userObs.find((o) => o.field === 'bio')?.sourceUrl).toBe(
      'https://math.yale.edu/people/ada-lovelace',
    );
    expect(userObs.find((o) => o.field === 'researchInterests')?.value).toEqual([
      'Algebraic Geometry',
      'Topology',
    ]);
    expect(userObs.find((o) => o.field === 'topics')?.value).toEqual([
      'Algebraic Geometry',
      'Topology',
    ]);
    expect(userObs.find((o) => o.field === 'scholarCandidateProfileUrls')?.value).toEqual([
      'https://scholar.google.com/citations?user=adaCandidate',
    ]);
    expect(userObs.find((o) => o.field === 'officialProfilePublications')?.value).toEqual([
      expect.objectContaining({
        title: 'Persons, Roles and Minds',
        year: 2001,
        sourceUrl: 'https://math.yale.edu/people/ada-lovelace',
      }),
      expect.objectContaining({
        title: 'The Stone in Late Imperial China',
        year: 2009,
        url: 'https://math.yale.edu/publications/stone',
        sourceUrl: 'https://math.yale.edu/people/ada-lovelace',
      }),
    ]);
    expect(userObs.find((o) => o.field === 'googleScholarId')).toBeUndefined();
    expect(userObs.find((o) => o.field === 'profileUrls')?.value).not.toHaveProperty(
      'googleScholar',
    );

    const labObs = emitted.filter((o) => o.entityType === 'researchEntity');
    expect(labObs.find((o) => o.field === 'websiteUrl')?.value).toBe(
      'https://lovelacelab.yale.edu/',
    );
    expect(labObs.find((o) => o.field === 'inferredPiUserKey')?.value).toBe(
      'netid:ada.lovelace',
    );
  });

  it('extracts selected publications from Engineering profile grid columns', async () => {
    const htmlFetcher = vi.fn(async (url: string) => {
      if (
        url ===
        'https://engineering.yale.edu/research-and-faculty/faculty-directory/lane-network'
      ) {
        return `
          <html><head>
            <link rel="canonical" href="https://engineering.yale.edu/research-and-faculty/faculty-directory/lane-network" />
          </head><body>
            <a href="mailto:lane.network@yale.edu">Email</a>
            <div class="py-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div class="col-span-1 mb-2 lg:mb-0">
                <h3>Selected Publications</h3>
              </div>
              <div class="col-span-1 lg:col-span-2">
                <p><a href="http://scholar.google.gr/citations?user=9qtgcZ8AAAAJ">Complete publication list from Google Scholar</a></p>
                <ul>
                  <li>G. Iosifidis, L. Gao, J. Huang, L. Tassiulas, "A Double Auction Mechanism for Mobile Data Offloading Markets", <em>IEEE/ACM Transactions on Networking</em>, 2015.</li>
                  <li>I. Koutsopoulos, L. Tassiulas, L. Gkatzikis, "Client-server games and their equilibria in peer-to-peer networks", in <em>Computer Networks</em>, vol. 67, pp. 201-218, 2014.</li>
                </ul>
              </div>
            </div>
          </body></html>
        `;
      }
      return '<html><body>listing</body></html>';
    });
    const configs: DeptConfig[] = [
      {
        deptKey: 'cs',
        deptName: 'Computer Science',
        schoolName: 'SEAS',
        url: 'https://engineering.yale.edu/academic-study/departments/computer-science/faculty',
        paginated: false,
        extractor: () => [
          {
            name: 'Lane Network',
            profileUrl:
              'https://engineering.yale.edu/research-and-faculty/faculty-directory/lane-network',
          },
        ],
      },
    ];

    const scraper = new DepartmentRosterScraper(configs, null, htmlFetcher);
    const { ctx, emitted } = makeContext();
    await scraper.run(ctx);

    expect(
      emitted.find((o) => o.entityType === 'user' && o.field === 'officialProfilePublications')
        ?.value,
    ).toEqual([
      expect.objectContaining({
        title: 'A Double Auction Mechanism for Mobile Data Offloading Markets',
        year: 2015,
        venue: 'IEEE/ACM Transactions on Networking',
        sourceUrl:
          'https://engineering.yale.edu/research-and-faculty/faculty-directory/lane-network',
      }),
      expect.objectContaining({
        title: 'Client-server games and their equilibria in peer-to-peer networks',
        year: 2014,
        venue: 'Computer Networks',
        sourceUrl:
          'https://engineering.yale.edu/research-and-faculty/faculty-directory/lane-network',
      }),
    ]);
  });

  it('follows official profile publication-list website links for featured publications', async () => {
    const htmlFetcher = vi.fn(async (url: string) => {
      if (
        url ===
        'https://engineering.yale.edu/research-and-faculty/faculty-directory/avi-systems-fixture'
      ) {
        return `
          <html><head>
            <link rel="canonical" href="https://engineering.yale.edu/research-and-faculty/faculty-directory/avi-systems-fixture" />
          </head><body>
            <a href="mailto:abhishek@cs.yale.edu">Email</a>
            <a href="https://www.cs.yale.edu/homes/abhishek/">Website: Research Website</a>
            <h3>Selected Publications</h3>
            <p>For a list of selected publications, <a href="https://www.cs.yale.edu/homes/abhishek/">visit my website</a>.</p>
          </body></html>
        `;
      }
      if (url === 'https://www.cs.yale.edu/homes/abhishek/') {
        return `
          <html><body>
            <font color="blue"><strong>Selected Publications</strong></font>
            <br><br>
            <li>
              <div>
                <a class="btn" href="/papers/fiduciary-ai.pdf">PDF</a>
                <div class="p-desc"><b>Fiduciary AI for the Future of Brain-Technology Interactions</b><br>Embedding fiduciary duties directly into BCI-integrated brain foundation models</div>
              </div>
            </li>
            <li>
              <div>
                <a class="btn" href="/papers/scalable-far-memory.pdf">PDF</a>
                <div class="p-desc"><b>Scalable Far Memory: Balancing Faults and Evictions, SOSP'25</b><br>Optimizations to improve scaling of data movement to far memory</div>
              </div>
            </li>
            <h2>Textbooks</h2>
            <ul><li>Architectural and Operating System Support for Virtual Memory</li></ul>
          </body></html>
        `;
      }
      return '<html><body>listing</body></html>';
    });
    const configs: DeptConfig[] = [
      {
        deptKey: 'cs',
        deptName: 'Computer Science',
        schoolName: 'SEAS',
        url: 'https://engineering.yale.edu/academic-study/departments/computer-science/faculty',
        paginated: false,
        extractor: () => [
          {
            name: 'Avi Systems',
            profileUrl:
              'https://engineering.yale.edu/research-and-faculty/faculty-directory/avi-systems-fixture',
          },
        ],
      },
    ];

    const scraper = new DepartmentRosterScraper(configs, null, htmlFetcher);
    const { ctx, emitted } = makeContext();
    await scraper.run(ctx);

    expect(htmlFetcher).toHaveBeenCalledWith(
      'https://www.cs.yale.edu/homes/abhishek/',
      false,
      'dept-faculty-roster',
    );
    expect(
      emitted.find((o) => o.entityType === 'user' && o.field === 'officialProfilePublications')
        ?.value,
    ).toEqual([
      expect.objectContaining({
        title: 'Fiduciary AI for the Future of Brain-Technology Interactions',
        url: 'https://www.cs.yale.edu/papers/fiduciary-ai.pdf',
        sourceUrl: 'https://www.cs.yale.edu/homes/abhishek/',
      }),
      expect.objectContaining({
        title: "Scalable Far Memory: Balancing Faults and Evictions, SOSP'25",
        url: 'https://www.cs.yale.edu/papers/scalable-far-memory.pdf',
        sourceUrl: 'https://www.cs.yale.edu/homes/abhishek/',
      }),
    ]);
    expect(JSON.stringify(emitted)).not.toContain('For a list of selected publications');
  });

  it('prefers Yale Medicine Biography text over patient card and research overview copy', async () => {
    const profileHtml = `
      <html><head>
        <link rel="canonical" href="https://medicine.yale.edu/profile/mika-imaging/" />
      </head><body>
        <main>
          <section>
            <h3>Are You a Patient?</h3>
            <p>View this doctor's clinical profile on the Yale Medicine website for information about services and appointments.</p>
          </section>
          <h2>About</h2>
          <p>Copy Link</p>
          <h3>Titles</h3>
          <p>Professor</p>
          <h3>Biography</h3>
          <p>Morgan M. Fixture, MD, studied medicine at Necker Enfants Malades School of Medicine and earned his medical degree from the University of Paris in 1991.</p>
          <p>The goal of the Cardiovascular Fixture Imaging Laboratory is to develop novel in vivo imaging approaches.</p>
          <p>Last Updated on April 07, 2025.</p>
          <h3>Appointments</h3>
          <p>Cardiovascular Medicine</p>
          <h2>Research</h2>
          <h3>Overview</h3>
          <p>Despite remarkable recent progress in molecular and vascular biology research, little has been achieved in adapting traditional imaging modalities.</p>
          <a href="mailto:mika.imaging@yale.edu">mika.imaging@yale.edu</a>
        </main>
      </body></html>
    `;
    const htmlFetcher = vi.fn(async (url: string) => {
      if (url === 'https://medicine.yale.edu/profile/mika-imaging/') return profileHtml;
      return '<html><body>listing</body></html>';
    });
    const configs: DeptConfig[] = [
      {
        deptKey: 'ysm',
        deptName: 'Yale School of Medicine',
        schoolName: 'YSM',
        url: 'https://medicine.yale.edu/faculty',
        paginated: false,
        extractor: () => [
          {
            name: 'Mika Imaging',
            profileUrl: 'https://medicine.yale.edu/profile/mika-imaging/',
          },
        ],
      },
    ];

    const scraper = new DepartmentRosterScraper(configs, null, htmlFetcher);
    const { ctx, emitted } = makeContext();
    await scraper.run(ctx);

    const bio = emitted.find((o) => o.entityType === 'user' && o.field === 'bio')?.value;
    expect(bio).toContain('Morgan M. Fixture, MD, studied medicine');
    expect(bio).toContain('Cardiovascular Fixture Imaging Laboratory');
    expect(bio).not.toContain("View this doctor's clinical profile");
    expect(bio).not.toContain('Despite remarkable recent progress');
    expect(bio).not.toContain('Last Updated');
  });

  it('keeps adjacent official profile paragraphs together when no Biography heading exists', async () => {
    const profileHtml = `
      <html><head>
        <link rel="canonical" href="https://mcdb.yale.edu/profile/nora-fixture-phd" />
      </head><body>
        <main>
          <div class="text">
            <p>Originally from Fixture City, Nora Fixture graduated with an Sc.B. in Biochemistry from Example University in 2002.</p>
            <p>Nora Fixture is currently an assistant professor in the Department of Molecular, Cellular and Developmental Biology at Yale University and studies long noncoding RNAs in cancer.</p>
          </div>
        </main>
      </body></html>
    `;
    const htmlFetcher = vi.fn(async (url: string) => {
      if (url === 'https://mcdb.yale.edu/profile/nora-fixture-phd') return profileHtml;
      return '<html><body>listing</body></html>';
    });
    const configs: DeptConfig[] = [
      {
        deptKey: 'mcdb',
        deptName: 'Molecular, Cellular and Developmental Biology',
        schoolName: 'FAS',
        url: 'https://mcdb.yale.edu/people/faculty',
        paginated: false,
        extractor: () => [
          {
            name: 'Nora Fixture',
            profileUrl: 'https://mcdb.yale.edu/profile/nora-fixture-phd',
          },
        ],
      },
    ];

    const scraper = new DepartmentRosterScraper(configs, null, htmlFetcher);
    const { ctx, emitted } = makeContext();
    await scraper.run(ctx);

    const bio = emitted.find((o) => o.entityType === 'user' && o.field === 'bio')?.value;
    expect(bio).toContain('Originally from Fixture City');
    expect(bio).toContain('currently an assistant professor');
    expect(String(bio)).toBe(
      'Originally from Fixture City, Nora Fixture graduated with an Sc.B. in Biochemistry from Example University in 2002. Nora Fixture is currently an assistant professor in the Department of Molecular, Cellular and Developmental Biology at Yale University and studies long noncoding RNAs in cancer.',
    );
  });

  it('ignores site chrome homepage links when enriching official profile websites', async () => {
    const profileHtml = `
      <html><head>
        <link rel="canonical" href="https://economics.yale.edu/people/lee-economics" />
      </head><body>
        <header class="site-header">
          <a href="https://yale.edu" aria-label="Yale University homepage">Yale University</a>
          <a href="/" aria-label="Yale Department of Economics homepage">Yale Department of Economics</a>
        </header>
        <main>
          <div class="person-title">Professor of Economics</div>
          <a href="mailto:lee.economics@yale.edu">lee.economics@yale.edu</a>
          <div class="node__website-link">
            <a href="https://campuspress.yale.edu/leahboustan/">Website</a>
          </div>
        </main>
      </body></html>
    `;
    const htmlFetcher = vi.fn(async (url: string) => {
      if (url === 'https://economics.yale.edu/people/lee-economics') return profileHtml;
      return '<html><body>listing</body></html>';
    });
    const configs: DeptConfig[] = [
      {
        deptKey: 'econ',
        deptName: 'Economics',
        schoolName: 'FAS',
        url: 'https://economics.yale.edu/people',
        paginated: false,
        extractor: () => [
          {
            name: 'Lee Economics',
            profileUrl: 'https://economics.yale.edu/people/lee-economics',
          },
        ],
      },
    ];

    const scraper = new DepartmentRosterScraper(configs, null, htmlFetcher);
    const { ctx, emitted } = makeContext();
    await scraper.run(ctx);

    const userObs = emitted.filter((o) => o.entityType === 'user');
    expect(userObs.find((o) => o.field === 'website')?.value).toBe(
      'https://campuspress.yale.edu/leahboustan/',
    );

    const entityObs = emitted.filter((o) => o.entityType === 'researchEntity');
    expect(entityObs.find((o) => o.field === 'websiteUrl')?.value).toBe(
      'https://campuspress.yale.edu/leahboustan/',
    );
    expect(entityObs.find((o) => o.field === 'sourceUrls')?.value).toEqual([
      'https://economics.yale.edu/people',
      'https://campuspress.yale.edu/leahboustan/',
    ]);
  });

  it('registers the first Math/Physics/Statistics/Astronomy roster batch', () => {
    expect(DEFAULT_DEPT_CONFIGS.map((config) => config.deptKey)).toEqual(
      expect.arrayContaining(['math', 'physics', 'statistics', 'astronomy']),
    );
  });

  it('dedupes repeated official profile rows after enrichment', async () => {
    const htmlFetcher = vi.fn(async (url: string) => {
      if (url === 'https://physics.yale.edu/people/marie-curie') {
        return `
          <html><head><meta property="og:url" content="https://physics.yale.edu/people/marie-curie" /></head>
          <body>
            <a href="mailto:marie.curie@yale.edu">Email</a>
            <a href="https://curielab.yale.edu">Personal Website</a>
          </body></html>
        `;
      }
      return '<html><body>listing</body></html>';
    });
    const configs: DeptConfig[] = [
      {
        deptKey: 'physics',
        deptName: 'Physics',
        schoolName: 'FAS',
        url: 'https://physics.yale.edu/people/faculty',
        paginated: false,
        extractor: () => [
          { name: 'Marie Curie', profileUrl: 'https://physics.yale.edu/people/marie-curie' },
          { name: 'Marie Curie', profileUrl: 'https://physics.yale.edu/people/marie-curie' },
        ],
      },
    ];

    const scraper = new DepartmentRosterScraper(configs, null, htmlFetcher);
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);

    expect(result.entitiesObserved).toBe(2);
    expect(emitted.filter((o) => o.entityType === 'user' && o.field === 'userType')).toHaveLength(
      1,
    );
    expect(emitted.filter((o) => o.entityType === 'researchEntity' && o.field === 'websiteUrl'))
      .toHaveLength(1);
  });

  it('extracts year-backed major publications embedded in official profile bios', async () => {
    const htmlFetcher = vi.fn(async (url: string) => {
      if (url === 'https://eall.yale.edu/people/taylor-literature') {
        return `
          <html><head><link rel="canonical" href="/people/taylor-literature" /></head>
          <body>
            <a href="mailto:taylor.literature@yale.edu">Email</a>
            <div class="field-name-field-bio">
              My research focuses on late imperial literature. Major publications include
              Persons, Roles and Minds (Stanford, 2001), Accidental Incest, Filial Cannibalism,
              and Other Peculiar Encounters in Late Imperial Chinese Literature
              (Harvard East Asian Monographs, 2009), a book-length chapter on late Ming literary
              culture, and a co-edited volume. Please see my CV for more current publications.
            </div>
          </body></html>
        `;
      }
      return '<html><body>listing</body></html>';
    });
    const configs: DeptConfig[] = [
      {
        deptKey: 'eall',
        deptName: 'East Asian Languages & Literatures',
        schoolName: 'FAS',
        url: 'https://eall.yale.edu/people/professors',
        paginated: false,
        extractor: () => [
          {
            name: 'Taylor Literature',
            profileUrl: 'https://eall.yale.edu/people/taylor-literature',
          },
        ],
      },
    ];

    const scraper = new DepartmentRosterScraper(configs, null, htmlFetcher);
    const { ctx, emitted } = makeContext();
    await scraper.run(ctx);

    expect(
      emitted.find((o) => o.entityType === 'user' && o.field === 'officialProfilePublications')
        ?.value,
    ).toEqual([
      expect.objectContaining({
        title: 'Persons, Roles and Minds',
        year: 2001,
        venue: 'Stanford',
        sourceUrl: 'https://eall.yale.edu/people/taylor-literature',
      }),
      expect.objectContaining({
        title:
          'Accidental Incest, Filial Cannibalism, and Other Peculiar Encounters in Late Imperial Chinese Literature',
        year: 2009,
        venue: 'Harvard East Asian Monographs',
        sourceUrl: 'https://eall.yale.edu/people/taylor-literature',
      }),
    ]);
  });

  it('uses an injected rendered fetcher for JS-rendered depts while keeping parsing local', async () => {
    const stubExtractor = vi.fn((): FacultyEntry[] => {
      throw new Error('should not use the Cheerio stub for rendered pages');
    });
    const renderedExtractor = vi.fn((): FacultyEntry[] => [
      {
        name: 'Grace Hopper',
        email: 'grace.hopper@yale.edu',
        profileUrl: 'https://engineering.yale.edu/faculty/grace-hopper',
      },
    ]);
    const configs: DeptConfig[] = [
      {
        deptKey: 'cs',
        deptName: 'Computer Science',
        schoolName: 'SEAS',
        url: 'https://example.invalid/cs',
        paginated: false,
        extractor: stubExtractor,
        renderedExtractor,
        renderWaitSelector: 'main',
        jsRenderedSkip: true,
      },
    ];
    const renderedFetcher = vi.fn().mockResolvedValue({
      html: '<html><body>hydrated faculty cards</body></html>',
      url: 'https://example.invalid/cs#rendered',
      fetchMode: 'scrapling',
    });
    const htmlFetcher = vi.fn(async () => `
      <html><head><link rel="canonical" href="/faculty/grace-hopper" /></head>
      <body><a href="https://hoppersystems.yale.edu">Research Group Website</a></body></html>
    `);
    const axios = (await import('axios')).default;
    const getSpy = vi.spyOn(axios, 'get');

    const scraper = new DepartmentRosterScraper(configs, renderedFetcher, htmlFetcher);
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);

    expect(renderedFetcher).toHaveBeenCalledWith({
      url: 'https://example.invalid/cs',
      waitSelector: 'main',
      timeoutMs: 30000,
    });
    expect(renderedExtractor).toHaveBeenCalledWith(
      '<html><body>hydrated faculty cards</body></html>',
      { pageUrl: 'https://example.invalid/cs#rendered' },
    );
    expect(htmlFetcher).toHaveBeenCalledWith(
      'https://engineering.yale.edu/faculty/grace-hopper',
      false,
      'dept-faculty-roster',
    );
    expect(stubExtractor).not.toHaveBeenCalled();
    expect(getSpy).not.toHaveBeenCalled();
    expect(result.entitiesObserved).toBe(2);
    expect(result.notes).toContain('cs=1');
    expect(emitted.find((o) => o.field === 'primaryDepartment')?.value).toBe('Computer Science');
    expect(emitted[0].sourceUrl).toBe('https://example.invalid/cs#rendered');
    expect(emitted.find((o) => o.field === 'websiteUrl')?.value).toBe(
      'https://hoppersystems.yale.edu/',
    );

    getSpy.mockRestore();
  });

  it('uses the CS component data endpoint before falling back to rendered fetching', async () => {
    const renderedFetcher = vi.fn();
    const dataExtractor = vi.fn((): FacultyEntry[] => [
      {
        name: 'Grace Hopper',
        title: 'Professor of Computer Science',
        profileUrl: 'https://engineering.yale.edu/faculty/grace-hopper',
      },
    ]);
    const configs: DeptConfig[] = [
      {
        deptKey: 'cs',
        deptName: 'Computer Science',
        schoolName: 'SEAS',
        url: 'https://example.invalid/cs',
        paginated: false,
        extractor: vi.fn((): FacultyEntry[] => []),
        dataUrl: 'https://example.invalid/cs/faculty-data',
        dataRequest: { template: 'department', maxpages: '0' },
        dataExtractor,
        renderedExtractor: vi.fn((): FacultyEntry[] => []),
        jsRenderedSkip: true,
      },
    ];
    const htmlFetcher = vi.fn(async () => '<html><body>profile</body></html>');
    const axios = (await import('axios')).default;
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValue({
      data: { pages: { 1: { facultyMembers: [] } } },
    } as any);

    const scraper = new DepartmentRosterScraper(configs, renderedFetcher, htmlFetcher);
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);

    expect(postSpy).toHaveBeenCalledWith(
      'https://example.invalid/cs/faculty-data',
      expect.any(URLSearchParams),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Content-Type': 'application/x-www-form-urlencoded',
        }),
      }),
    );
    expect(dataExtractor).toHaveBeenCalledWith(
      { pages: { 1: { facultyMembers: [] } } },
      { pageUrl: 'https://example.invalid/cs/faculty-data' },
    );
    expect(renderedFetcher).not.toHaveBeenCalled();
    expect(result.entitiesObserved).toBe(1);
    expect(result.notes).toContain('cs=1');
    expect(emitted.find((o) => o.field === 'primaryDepartment')?.value).toBe('Computer Science');

    postSpy.mockRestore();
  });

  it('skips JS-rendered depts when the injected rendered page fetcher returns null', async () => {
    const renderedExtractor = vi.fn((): FacultyEntry[] => [{ name: 'Unexpected Faculty' }]);
    const configs: DeptConfig[] = [
      {
        deptKey: 'cs',
        deptName: 'Computer Science',
        schoolName: 'SEAS',
        url: 'https://example.invalid/cs',
        paginated: false,
        extractor: vi.fn((): FacultyEntry[] => []),
        renderedExtractor,
        jsRenderedSkip: true,
      },
    ];
    const renderedFetcher = vi.fn().mockResolvedValue(null);

    const scraper = new DepartmentRosterScraper(configs, renderedFetcher);
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);

    expect(renderedFetcher).toHaveBeenCalledWith({
      url: 'https://example.invalid/cs',
      waitSelector: undefined,
      timeoutMs: 30000,
    });
    expect(renderedExtractor).not.toHaveBeenCalled();
    expect(emitted).toEqual([]);
    expect(result.entitiesObserved).toBe(0);
    expect(result.notes).toContain('cs=rendered-unavailable');
  });

  it('only-filter skips depts not in the list', async () => {
    const econExt = vi.fn((): FacultyEntry[] => [{ name: 'Econ Person' }]);
    const psychExt = vi.fn((): FacultyEntry[] => [{ name: 'Psych Person' }]);
    const configs: DeptConfig[] = [
      {
        deptKey: 'econ',
        deptName: 'Economics',
        schoolName: 'FAS',
        url: 'https://example.invalid/econ',
        paginated: false,
        extractor: econExt,
      },
      {
        deptKey: 'psych',
        deptName: 'Psychology',
        schoolName: 'FAS',
        url: 'https://example.invalid/psych',
        paginated: false,
        extractor: psychExt,
      },
    ];
    const axios = (await import('axios')).default;
    const getSpy = vi.spyOn(axios, 'get').mockResolvedValue({ data: '<html></html>' } as any);

    const scraper = new DepartmentRosterScraper(configs);
    const { ctx } = makeContext({ only: ['psych'] });
    await scraper.run(ctx);

    expect(econExt).not.toHaveBeenCalled();
    expect(psychExt).toHaveBeenCalledTimes(1);

    getSpy.mockRestore();
  });
});
