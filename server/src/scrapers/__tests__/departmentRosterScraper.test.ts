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
  viewsTableRowExtractor,
  directoryListingCardExtractor,
  nodePersonCardExtractor,
  profileBelongsToRosterPerson,
  fieldCollectionPersonExtractor,
  facultyThumbnailExtractor,
  profileGridItemExtractor,
  nodeTeaserFacultyExtractor,
  jacksonProfileComponentExtractor,
  lawPersonListingExtractor,
  nursingFacultyExtractor,
  referenceCardExtractor,
  scrollingListModuleExtractor,
  jacksonPersonCardExtractor,
  ysphDirectoryExtractor,
  csJsRenderedStub,
  csRenderedExtractor,
  csFacultyDataExtractor,
  chemEnvFacultyExtractor,
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
import { isYaleOfficialProfileUrl } from '../../scripts/backfillResearcherOfficialProfileLinksCore';

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

const MBB_VIEWS_ROW_HTML = `
<html><body>
  <div class="views-row">
    <div class="views-field views-field-picture">
      <div class="field-content picture">
        <a href="https://medicine.yale.edu/profile/avery-sloan-fixture/">
          <img src="https://mbb.yale.edu/sites/default/files/styles/people_directory_image/public/pictures/sloan-fixture.jpg" alt="Avery Sloan's picture" />
        </a>
      </div>
    </div>
    <div class="views-field views-field-name">
      <h4 class="field-content name">
        <a href="https://medicine.yale.edu/profile/avery-sloan-fixture/" class="username">Avery Sloan, MD, PhD</a>
      </h4>
    </div>
    <div class="views-field views-field-field-title">
      <div class="field-content position">Professor of Molecular Biophysics and Biochemistry</div>
    </div>
    <div class="views-field views-field-mail">
      <span class="field-content">
        <a href="mailto:avery.sloan@yale.edu">avery.sloan@yale.edu</a>
      </span>
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

const YSPH_DIRECTORY_HTML = `
<html><body>
  <section class="generic-anchored-list" aria-label="Faculty Directory by Name list of links">
    <div class="categorized-list-item">
      <h2 class="categorized-list-item__title" id="A">A</h2>
      <div class="categorized-list-item__inner-list">
        <ul class="link-items-list">
          <li class="link-items-list__item" data-columns="4"><div><a href="/profile/jordan-alvarez-fixture/" tabindex="0" class="hyperlink">Alvarez, Jordan</a></div></li>
          <li class="link-items-list__item" data-columns="4"><div><a href="/profile/priya-anand-fixture/" tabindex="0" class="hyperlink">Anand, Priya</a></div></li>
        </ul>
      </div>
    </div>
    <div class="categorized-list-item">
      <h2 class="categorized-list-item__title" id="B">B</h2>
      <div class="categorized-list-item__inner-list">
        <ul class="link-items-list">
          <li class="link-items-list__item" data-columns="4"><div><a href="/profile/morgan-brooks-fixture/" tabindex="0" class="hyperlink">Brooks, Morgan</a></div></li>
        </ul>
      </div>
    </div>
  </section>
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
    expect(isLikelyPersonSpecificYaleEmail('sage.mismatch@yale.edu', 'Jordan Mismatch')).toBe(
      false,
    );
    expect(isLikelyPersonSpecificYaleEmail('drew.match@yale.edu', 'Dana Mismatch')).toBe(false);
    expect(isLikelyPersonSpecificYaleEmail('sky.mismatch@yale.edu', 'Different Person')).toBe(
      false,
    );
    expect(isLikelyPersonSpecificYaleEmail('ysm.editor@yale.edu', 'Cameron Profile')).toBe(false);
  });
});

describe('normalizeName', () => {
  it('strips trailing Ph.D. credentials', () => {
    expect(normalizeName('Riley Roster, Ph.D.')).toBe('Riley Roster');
    expect(normalizeName('Jane Doe, M.D.')).toBe('Jane Doe');
  });
  it('strips stacked trailing credentials', () => {
    expect(normalizeName('Avery Sloan, MD, PhD')).toBe('Avery Sloan');
    expect(normalizeName('Riley Roster, M.D., Ph.D., M.P.H.')).toBe('Riley Roster');
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

  it('stores the unwrapped target when a lab website href is an Outlook safelinks wrapper', () => {
    const html = `
      <html><body>
        <div class="directory-listing-card">
          <div class="directory-listing-card__content">
            <h3 class="directory-listing-card__heading">
              <a class="directory-listing-card__heading-link" href="/profile/morgan-roster">
                Morgan Roster
              </a>
            </h3>
            <div class="directory-listing-card__subheading">Assistant Professor</div>
            <a class="directory-listing-card__link" href="mailto:morgan.roster@yale.edu">Email</a>
            <a class="directory-listing-card__link" href="https://nam12.safelinks.protection.outlook.com/?url=http%3A%2F%2Fwww.morganroster.com%2F&data=05%7C01%7C&sdata=abc&reserved=0">Lab Website</a>
          </div>
        </div>
      </body></html>
    `;
    const out = mcdbExtractor(html, { pageUrl: 'https://mcdb.yale.edu/people/faculty' });
    expect(out[0]).toMatchObject({
      name: 'Morgan Roster',
      email: 'morgan.roster@yale.edu',
      labUrl: 'http://www.morganroster.com/',
    });
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

describe('Wright Laboratory lab-site profile coverage', () => {
  const WRIGHT_LAB_HTML = `
    <html><body>
      <ul class="directory-listing-cards">
        <li class="directory-listing-card">
          <div class="directory-listing-card__content">
            <div class="directory-listing-card__overline"><div>Physics</div></div>
            <h3 class="directory-listing-card__heading">
              <a class="directory-listing-card__heading-link" href="/profile/robin-roster">
                Robin Roster
              </a>
            </h3>
            <div class="directory-listing-card__subheading">
              <div>Assistant Professor of Physics</div>
            </div>
          </div>
        </li>
        <li class="directory-listing-card">
          <div class="directory-listing-card__content">
            <div class="directory-listing-card__overline"><div>Physics</div></div>
            <h3 class="directory-listing-card__heading">
              <a class="directory-listing-card__heading-link" href="/profile/sky-sample">
                Sky Sample
              </a>
            </h3>
            <div class="directory-listing-card__subheading">
              <div>Professor of Physics</div>
            </div>
          </div>
        </li>
      </ul>
    </body></html>
  `;

  it('extracts wlab.yale.edu/profile/<slug> official-profile URLs from the primary-faculty cards', () => {
    const out = mcdbExtractor(WRIGHT_LAB_HTML, {
      pageUrl: 'https://wlab.yale.edu/people/faculty/primary-faculty',
    });

    expect(out).toEqual([
      {
        name: 'Robin Roster',
        profileUrl: 'https://wlab.yale.edu/profile/robin-roster',
        title: 'Assistant Professor of Physics',
        email: undefined,
        labUrl: undefined,
        bio: undefined,
      },
      {
        name: 'Sky Sample',
        profileUrl: 'https://wlab.yale.edu/profile/sky-sample',
        title: 'Professor of Physics',
        email: undefined,
        labUrl: undefined,
        bio: undefined,
      },
    ]);
  });

  it('captures wlab profile URLs that count as official Yale profile sources', () => {
    const out = mcdbExtractor(WRIGHT_LAB_HTML, {
      pageUrl: 'https://wlab.yale.edu/people/faculty/primary-faculty',
    });

    for (const entry of out) {
      expect(isYaleOfficialProfileUrl(entry.profileUrl)).toBe(true);
    }
  });

  it('registers the Wright Laboratory config as official-profile-only', () => {
    const configsByKey = new Map(DEFAULT_DEPT_CONFIGS.map((config) => [config.deptKey, config]));
    expect(configsByKey.get('wright-lab')).toMatchObject({
      deptName: 'Physics',
      schoolName: 'Yale Faculty of Arts and Sciences',
      url: 'https://wlab.yale.edu/people/faculty/primary-faculty',
      extractor: mcdbExtractor,
      emitPersonalResearchEntities: false,
      officialProfileOnly: true,
    });
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

    expect(out[0].topics).toEqual(['Condensed Matter Physics', 'Theorist', 'Quantum criticality']);
    expect(out[0].topics).not.toContain('Condensed Matter PhysicsTheoristQuantum criticality');
  });

  it('drops a full prose paragraph instead of comma-splitting it into fake topic fragments', () => {
    const html = `
      <html><body>
        <table class="views-table">
          <tbody>
            <tr>
              <td class="views-field views-field-name">
                <a href="/people/casey-jordan" class="username">Casey Jordan</a><br />
                Professor of Physics<br />
                <a href="mailto:casey.jordan@yale.edu">casey.jordan@yale.edu</a>
              </td>
              <td class="views-field views-field-field-field-of-study">
                Condensed Matter Physics<p><em>Theorist</em><p><small><div>Stochastic processes, asymptotic analysis and other approaches and methods from modern applied mathematics and physics, along with numerical simulations to probe a broad range of problems including the microscopic theory of melting, the mechanisms underlying cosmogony, climate dynamics, information theory and turbulence.</div></small>
              </td>
            </tr>
          </tbody>
        </table>
      </body></html>
    `;

    const out = psychExtractor(html, { pageUrl: 'https://physics.yale.edu/people/faculty' });

    expect(out[0].topics).toEqual(['Condensed Matter Physics', 'Theorist']);
    expect(out[0].topics).not.toContain('the mechanisms underlying cosmogony');
    expect(out[0].topics).not.toContain('climate dynamics');
    expect(out[0].topics).not.toContain('information theory and turbulence.');
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
  it('falls back to a plain .views-field-mail mailto for MBB-style rows linking medicine.yale.edu profiles', () => {
    const out = viewsRowPersonExtractor(MBB_VIEWS_ROW_HTML, {
      pageUrl: 'https://mbb.yale.edu/people/faculty',
    });

    expect(out).toEqual([
      {
        name: 'Avery Sloan, MD, PhD',
        profileUrl: 'https://medicine.yale.edu/profile/avery-sloan-fixture/',
        title: 'Professor of Molecular Biophysics and Biochemistry',
        email: 'avery.sloan@yale.edu',
        imageUrl:
          'https://mbb.yale.edu/sites/default/files/styles/people_directory_image/public/pictures/sloan-fixture.jpg',
      },
    ]);
  });

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

describe('fieldCollectionPersonExtractor', () => {
  it('extracts YIBS field-collection affiliates with linked and plain-text names', () => {
    const html = `
      <div class="field-collection-item-field-person-info">
        <div class="field field-name-field-person-photo"><img src="/img/robin-fixture.jpg" alt="Robin Fixture"></div>
        <div class="field field-name-field-person-description"><div class="field-items"><div class="field-item even">
          <h3><a href="https://environment.yale.edu/profile/robin-fixture" target="_blank">Robin Fixture</a></h3>
          <p><em>Professor of Ecology,</em> Yale School of the Environment</p>
        </div></div></div>
      </div>
      <div class="field-collection-item-field-person-info">
        <div class="field field-name-field-person-description"><div class="field-items"><div class="field-item even">
          <h3>Casey Fixture</h3><p><em>Lecturer</em></p>
        </div></div></div>
      </div>`;
    expect(
      fieldCollectionPersonExtractor(html, {
        pageUrl: 'https://yibs.yale.edu/people/faculty-affiliates',
      }),
    ).toEqual([
      {
        name: 'Robin Fixture',
        profileUrl: 'https://environment.yale.edu/profile/robin-fixture',
        title: 'Professor of Ecology',
        imageUrl: 'https://yibs.yale.edu/img/robin-fixture.jpg',
      },
      {
        name: 'Casey Fixture',
        title: 'Lecturer',
      },
    ]);
  });
});

describe('facultyThumbnailExtractor', () => {
  it('emits a slug placeholder name plus profile URL for headshot-only cards', () => {
    const html = `
      <div class="faculty-member-thumbnail">
        <a class="blank-link" href="/faculty/1001-robin-fixture">
          <div class="faculty-member-thumbnail__image"><img src="/img/robin.jpg"></div>
        </a>
      </div>
      <div class="faculty-member-thumbnail">
        <a class="blank-link" href="/faculty/1002-quinn-example-fixture"><img src="/img/quinn.jpg"></a>
      </div>
      <div class="faculty-member-thumbnail">
        <a class="blank-link" href="/about/leadership">Not a faculty link</a>
      </div>`;
    expect(
      facultyThumbnailExtractor(html, { pageUrl: 'https://www.architecture.yale.edu/faculty' }),
    ).toEqual([
      {
        name: 'Robin Fixture',
        namePlaceholder: true,
        profileUrl: 'https://www.architecture.yale.edu/faculty/1001-robin-fixture',
        imageUrl: 'https://www.architecture.yale.edu/img/robin.jpg',
      },
      {
        name: 'Quinn Example Fixture',
        namePlaceholder: true,
        profileUrl: 'https://www.architecture.yale.edu/faculty/1002-quinn-example-fixture',
        imageUrl: 'https://www.architecture.yale.edu/img/quinn.jpg',
      },
    ]);
  });

  it('is wired to the paginated Architecture faculty grid so the whole roster is walked', () => {
    const architecture = DEFAULT_DEPT_CONFIGS.find((c) => c.deptKey === 'architecture');
    expect(architecture).toBeDefined();
    expect(architecture?.url).toBe('https://www.architecture.yale.edu/faculty');
    expect(architecture?.schoolName).toBe('Yale School of Architecture');
    expect(architecture?.extractor).toBe(facultyThumbnailExtractor);
    expect(architecture?.paginated).toBe(true);
  });
});

describe('nodePersonCardExtractor', () => {
  it('extracts rendered School of Music person cards from about attr and image alt', () => {
    const html = `
      <article about="/people/robin-fixture" class="node node--type-person node--view-mode-card">
        <div class="top"><div class="field field--name-field-profile-image field__item">
          <img srcset="/img/robin-fixture.jpg 1x" src="/img/robin-fixture.jpg" alt="Robin Fixture"></div></div>
        <div class="paragraph--type--title-affiliation">Professor in the Practice of Cello</div>
      </article>`;
    expect(
      nodePersonCardExtractor(html, { pageUrl: 'https://music.yale.edu/meet-our-faculty' }),
    ).toEqual([
      {
        name: 'Robin Fixture',
        profileUrl: 'https://music.yale.edu/people/robin-fixture',
        title: 'Professor in the Practice of Cello',
        imageUrl: 'https://music.yale.edu/img/robin-fixture.jpg',
      },
    ]);
  });

  it('falls back to the /people/<slug> name when the image alt is absent', () => {
    const html = `
      <article about="/people/robin-fixture" class="node node--type-person node--view-mode-card">
        <div class="top"><div class="field field--name-field-profile-image field__item">
          <img srcset="/img/robin-fixture.jpg 1x" src="/img/robin-fixture.jpg"></div></div>
        <div class="paragraph--type--title-affiliation">Professor in the Practice of Cello</div>
      </article>`;
    expect(
      nodePersonCardExtractor(html, { pageUrl: 'https://music.yale.edu/meet-our-faculty' }),
    ).toEqual([
      {
        name: 'Robin Fixture',
        profileUrl: 'https://music.yale.edu/people/robin-fixture',
        title: 'Professor in the Practice of Cello',
        imageUrl: 'https://music.yale.edu/img/robin-fixture.jpg',
      },
    ]);
  });
});

describe('directoryListingCardExtractor', () => {
  const DIRECTORY_LISTING_CARD_HTML = `
    <ul>
      <li class="directory-listing-card">
        <div class="directory-listing-card__content">
          <h3 class="directory-listing-card__heading">
            <a class="directory-listing-card__heading-link" href="/profile/robin-fixture">Robin Fixture</a>
          </h3>
          <div class="directory-listing-card__subheading"><div>Professor of Philosophy</div></div>
          <a class="directory-listing-card__link" href="mailto:robin.fixture@yale.edu">Email</a>
          <div class="directory-listing-card__phone"><div>+1 203 555-0100</div></div>
        </div>
        <div class="directory-listing-card__image">
          <img srcset="/sites/default/files/robin-fixture.jpg?itok=abc 150w, /sites/default/files/robin-fixture-2x.jpg?itok=def 300w">
        </div>
      </li>
    </ul>`;

  it('extracts directory-listing-card faculty with profile, title, email, and image', () => {
    const out = directoryListingCardExtractor(DIRECTORY_LISTING_CARD_HTML, {
      pageUrl: 'https://philosophy.yale.edu/faculty',
    });

    expect(out).toEqual([
      {
        name: 'Robin Fixture',
        profileUrl: 'https://philosophy.yale.edu/profile/robin-fixture',
        title: 'Professor of Philosophy',
        email: 'robin.fixture@yale.edu',
        imageUrl: 'https://philosophy.yale.edu/sites/default/files/robin-fixture.jpg?itok=abc',
      },
    ]);
  });
});

describe('referenceCardExtractor', () => {
  const REFERENCE_CARD_HTML = `
    <ul class="card-collection__cards">
      <li class="reference-card">
        <div class="reference-card__content">
          <h3 class="reference-card__heading">
            <a class="reference-card__heading-link reference-card__heading-link--with-icon" data-link-type="external" href="https://robinfixturelab.yale.edu/">Robin Fixture, PhD</a>
          </h3>
          <div class="reference-card__subheading"><div>Director, Yale Systems Biology Institute; Professor of Cell Biology</div></div>
          <div class="reference-card__snippet"></div>
        </div>
        <div class="reference-card__image">
          <a class="reference-card__image-link" href="https://robinfixturelab.yale.edu/">
            <img src="/sites/default/files/styles/1_1_300_/public/robin-fixture.png?itok=def" srcset="/sites/default/files/styles/1_1_150/public/robin-fixture.png?itok=abc 150w" />
          </a>
        </div>
      </li>
      <li class="reference-card">
        <div class="reference-card__content">
          <h3 class="reference-card__heading">
            <a class="reference-card__heading-link" href="/profile/jordan-fixture-phd">Jordan Fixture, PhD</a>
          </h3>
          <div class="reference-card__subheading"><div>Professor of Molecular Biophysics</div></div>
        </div>
      </li>
      <li class="reference-card">
        <div class="reference-card__content">
          <h3 class="reference-card__heading">
            <a class="reference-card__heading-link reference-card__heading-link--with-icon" data-link-type="external" href="https://medicine.yale.edu/profile/casey-fixture/">Casey Fixture, PhD</a>
          </h3>
          <div class="reference-card__subheading"><div>Professor of Immunobiology</div></div>
        </div>
      </li>
    </ul>`;

  it('extracts West Campus reference-card faculty, stripping credentials and citing the individual destination', () => {
    const out = referenceCardExtractor(REFERENCE_CARD_HTML, {
      pageUrl: 'https://westcampus.yale.edu/about-us/faculty',
    });

    expect(out).toEqual([
      {
        name: 'Robin Fixture',
        profileUrl: 'https://robinfixturelab.yale.edu/',
        title: 'Director, Yale Systems Biology Institute; Professor of Cell Biology',
        labUrl: 'https://robinfixturelab.yale.edu/',
        imageUrl:
          'https://westcampus.yale.edu/sites/default/files/styles/1_1_300_/public/robin-fixture.png?itok=def',
      },
      {
        name: 'Jordan Fixture',
        profileUrl: 'https://westcampus.yale.edu/profile/jordan-fixture-phd',
        title: 'Professor of Molecular Biophysics',
      },
      {
        name: 'Casey Fixture',
        profileUrl: 'https://medicine.yale.edu/profile/casey-fixture/',
        title: 'Professor of Immunobiology',
      },
    ]);
  });

  it('never treats an on-site or off-site profile page as a lab website', () => {
    const out = referenceCardExtractor(REFERENCE_CARD_HTML, {
      pageUrl: 'https://westcampus.yale.edu/about-us/faculty',
    });

    expect(out[0].labUrl).toBe('https://robinfixturelab.yale.edu/');
    expect(out[1].labUrl).toBeUndefined();
    expect(out[2].labUrl).toBeUndefined();
  });

  it('is wired to the West Campus school-wide directory', () => {
    const westCampus = DEFAULT_DEPT_CONFIGS.find((c) => c.deptKey === 'west-campus');
    expect(westCampus).toBeDefined();
    expect(westCampus?.url).toBe('https://westcampus.yale.edu/about-us/faculty');
    expect(westCampus?.schoolName).toBe('Yale West Campus');
    expect(westCampus?.extractor).toBe(referenceCardExtractor);
    expect(westCampus?.paginated).toBeFalsy();
  });
});

describe('scrollingListModuleExtractor', () => {
  const SCROLLING_LIST_MODULE_HTML = `
    <div class="scrolling-list-module">
      <h4 class="scrolling-list-module__title">Academic Leadership</h4>
      <ul class="scrolling-list-module__list">
        <li class="scrolling-list-module__list-item">
          <a href="/RobinFixture">Robin Fixture</a>, Dean; Professor of Painting
        </li>
      </ul>
    </div>
    <div class="scrolling-list-module">
      <h4 class="scrolling-list-module__title">painting / printmaking</h4>
      <ul class="scrolling-list-module__list">
        <li class="scrolling-list-module__list-item">
          <strong>Full-Time Faculty</strong>
        </li>
        <li class="scrolling-list-module__list-item">
          <a href="/RobinFixture">Robin Fixture</a>, Dean
        </li>
        <li class="scrolling-list-module__list-item">
          <a href="https://jordanfixture.example/">Jordan Fixture</a>, Professor
        </li>
      </ul>
    </div>
    <div class="scrolling-list-module">
      <h4 class="scrolling-list-module__title">Administration and Staff</h4>
      <ul class="scrolling-list-module__list">
        <li class="scrolling-list-module__list-item">
          <a href="/CaseyFixture">Casey Fixture</a>, Office Manager
        </li>
      </ul>
    </div>`;

  it('extracts scrolling-list-module faculty, dedupes across sections, and skips Administration and Staff', () => {
    const out = scrollingListModuleExtractor(SCROLLING_LIST_MODULE_HTML, {
      pageUrl: 'https://art.example.invalid/about/people/faculty-and-staff',
    });

    expect(out).toEqual([
      {
        name: 'Robin Fixture',
        profileUrl: 'https://art.example.invalid/RobinFixture',
        title: 'Dean; Professor of Painting',
        labUrl: undefined,
      },
      {
        name: 'Jordan Fixture',
        profileUrl: 'https://jordanfixture.example/',
        title: 'Professor',
        labUrl: 'https://jordanfixture.example/',
      },
    ]);
  });

  it('is wired to the Yale School of Art directory', () => {
    const art = DEFAULT_DEPT_CONFIGS.find((c) => c.deptKey === 'art');
    expect(art).toBeDefined();
    expect(art?.url).toBe('https://www.art.yale.edu/about/people/faculty-and-staff');
    expect(art?.schoolName).toBe('Yale School of Art');
    expect(art?.extractor).toBe(scrollingListModuleExtractor);
    expect(art?.paginated).toBeFalsy();
  });
});

describe('viewsTableRowExtractor', () => {
  const VIEWS_TABLE_HTML = `
    <table>
      <thead><tr><th class="views-field views-field-name"></th></tr></thead>
      <tbody>
        <tr>
          <td class="views-field views-field-picture"><a href="/people/casey-fixture"><img src="/sites/casey-fixture.jpg"></a></td>
          <td class="views-field views-field-name"><a href="/people/casey-fixture" class="username">Casey Fixture</a></td>
          <td class="views-field views-field-field-title">Sterling Professor of English</td>
        </tr>
      </tbody>
    </table>`;

  it('extracts table-rendered Drupal views rows and skips the empty header row', () => {
    const out = viewsTableRowExtractor(VIEWS_TABLE_HTML, {
      pageUrl: 'https://english.yale.edu/people/ladder-faculty',
    });

    expect(out).toEqual([
      {
        name: 'Casey Fixture',
        profileUrl: 'https://english.yale.edu/people/casey-fixture',
        title: 'Sterling Professor of English',
        imageUrl: 'https://english.yale.edu/sites/casey-fixture.jpg',
      },
    ]);
  });
});

describe('profileGridItemExtractor', () => {
  it('extracts YSM profile-grid-item cards, choosing the longest title', () => {
    const html = `
      <div class="profile-grid-item">
        <a href="#"><div><span class="profile-grid-item__name--link">Robin Fixture, PhD</span></div></a>
        <div class="profile-grid-item__title-container"><p class="profile-grid-item__title">Director</p></div>
        <div class="profile-grid-item__title-container"><p class="profile-grid-item__title">Professor of Cell Biology; Director, Stem Cell Center</p></div>
        <div class="profile-grid-item__link-details-container"><a href="/stemcell/profile/robin-fixture/">View Full Profile</a></div>
        <div class="profile-grid-item__thumbnail-container"><img src="/img/robin-fixture.jpg"></div>
      </div>`;
    expect(
      profileGridItemExtractor(html, {
        pageUrl: 'https://medicine.yale.edu/stemcell/people/listing/',
      }),
    ).toEqual([
      {
        name: 'Robin Fixture',
        profileUrl: 'https://medicine.yale.edu/stemcell/profile/robin-fixture/',
        title: 'Professor of Cell Biology; Director, Stem Cell Center',
        imageUrl: 'https://medicine.yale.edu/img/robin-fixture.jpg',
      },
    ]);
  });

  it('cites the department-hosted profile URL for a basic-science department card', () => {
    const html = `
      <div class="profile-grid-item">
        <a href="#"><div><span class="profile-grid-item__name--link">Alex Sample, PhD</span></div></a>
        <div class="profile-grid-item__title-container"><p class="profile-grid-item__title">Professor of Genetics</p></div>
        <div class="profile-grid-item__link-details-container"><a href="/genetics/profile/alex-sample/">View Full Profile</a></div>
      </div>`;
    expect(
      profileGridItemExtractor(html, {
        pageUrl: 'https://medicine.yale.edu/genetics/people/',
      }),
    ).toEqual([
      {
        name: 'Alex Sample',
        profileUrl: 'https://medicine.yale.edu/genetics/profile/alex-sample/',
        title: 'Professor of Genetics',
      },
    ]);
  });
});

describe('YSM basic-science department roster configs (#1629)', () => {
  const configsByKey = new Map(DEFAULT_DEPT_CONFIGS.map((config) => [config.deptKey, config]));

  const expectedYsmBasicScienceConfigs: Array<{ deptKey: string; deptName: string; url: string }> =
    [
      {
        deptKey: 'ysm-cell-biology',
        deptName: 'Cell Biology',
        url: 'https://medicine.yale.edu/cellbio/people/',
      },
      {
        deptKey: 'ysm-immunobiology',
        deptName: 'Immunobiology',
        url: 'https://medicine.yale.edu/immuno/people/',
      },
      {
        deptKey: 'ysm-pharmacology',
        deptName: 'Pharmacology',
        url: 'https://medicine.yale.edu/pharm/people/',
      },
      {
        deptKey: 'ysm-genetics',
        deptName: 'Genetics',
        url: 'https://medicine.yale.edu/genetics/people/',
      },
      {
        deptKey: 'ysm-cellular-molecular-physiology',
        deptName: 'Cellular & Molecular Physiology',
        url: 'https://medicine.yale.edu/physiology/faculty/',
      },
      {
        deptKey: 'ysm-microbial-pathogenesis',
        deptName: 'Microbial Pathogenesis',
        url: 'https://medicine.yale.edu/micropath/people/primary-faculty/',
      },
      {
        deptKey: 'ysm-microbial-pathogenesis-research',
        deptName: 'Microbial Pathogenesis',
        url: 'https://medicine.yale.edu/micropath/people/research-faculty/',
      },
      {
        deptKey: 'ysm-comparative-medicine',
        deptName: 'Comparative Medicine',
        url: 'https://medicine.yale.edu/compmed/people/',
      },
      {
        deptKey: 'ysm-pathology',
        deptName: 'Pathology',
        url: 'https://medicine.yale.edu/pathology/people/',
      },
      {
        deptKey: 'ysm-neuroscience',
        deptName: 'Neuroscience',
        url: 'https://medicine.yale.edu/neuroscience/people/',
      },
      {
        deptKey: 'ysm-biomedical-informatics-data-science',
        deptName: 'Biomedical Informatics & Data Science',
        url: 'https://medicine.yale.edu/biomedical-informatics-data-science/people/',
      },
    ];

  it.each(expectedYsmBasicScienceConfigs)(
    'wires $deptKey as an official-profile-only profile-grid-item roster',
    ({ deptKey, deptName, url }) => {
      expect(configsByKey.get(deptKey)).toMatchObject({
        deptName,
        schoolName: 'Yale School of Medicine',
        url,
        extractor: profileGridItemExtractor,
        officialProfileOnly: true,
        paginated: false,
      });
    },
  );
});

describe('nodeTeaserFacultyExtractor', () => {
  it('extracts SOM node-teaser--faculty rows', () => {
    const html = `
      <article class="node-teaser node-teaser--faculty node-teaser--row">
        <div class="node-teaser__image"><img src="/img/casey-fixture.jpg"></div>
        <header><h3 class="node-teaser__heading"><a href="/faculty-research/faculty-directory/casey-fixture">Casey Fixture</a></h3>
        <div class="node-teaser__job-title">Professor of Economics</div></header>
      </article>`;
    expect(
      nodeTeaserFacultyExtractor(html, {
        pageUrl: 'https://som.yale.edu/faculty-research/faculty-directory',
      }),
    ).toEqual([
      {
        name: 'Casey Fixture',
        profileUrl: 'https://som.yale.edu/faculty-research/faculty-directory/casey-fixture',
        title: 'Professor of Economics',
        imageUrl: 'https://som.yale.edu/img/casey-fixture.jpg',
      },
    ]);
  });

  it('crawls each School of Management discipline as its own department (#1377)', () => {
    const somConfigs = DEFAULT_DEPT_CONFIGS.filter(
      (config) => config.schoolName === 'Yale School of Management',
    );
    expect(somConfigs.map((config) => config.deptName).sort()).toEqual([
      'Accounting',
      'Economics',
      'Finance',
      'Marketing',
      'Operations',
      'Organizational Behavior',
    ]);
    for (const config of somConfigs) {
      expect(config.extractor).toBe(nodeTeaserFacultyExtractor);
      expect(config.url).toMatch(
        /^https:\/\/som\.yale\.edu\/faculty-research\/faculty-directory\/[a-z-]+$/,
      );
    }
    expect(DEFAULT_DEPT_CONFIGS.some((config) => config.deptName === 'Management')).toBe(false);
  });
});

describe('jacksonProfileComponentExtractor', () => {
  it('extracts Jackson profile--component cards', () => {
    const html = `
      <article class="profile profile--component profile__item">
        <div class="profile__media"><figure><img src="/img/jordan-fixture.jpg"></figure></div>
        <div class="profile__content"><h3><a href="/directory/jordan-fixture">Jordan Fixture</a></h3>
          <ul class="profile-positions"><li>Associate Professor of Political Science</li></ul></div>
      </article>`;
    expect(
      jacksonProfileComponentExtractor(html, {
        pageUrl: 'https://jackson.yale.edu/faculty-research/professors-global-affairs',
      }),
    ).toEqual([
      {
        name: 'Jordan Fixture',
        profileUrl: 'https://jackson.yale.edu/directory/jordan-fixture',
        title: 'Associate Professor of Political Science',
        imageUrl: 'https://jackson.yale.edu/img/jordan-fixture.jpg',
      },
    ]);
  });
});

describe('lawPersonListingExtractor', () => {
  it('extracts Law node--type-person listing cards', () => {
    const html = `
      <div class="views-row"><article class="node node--type-person node--view-mode-filtered-listing">
        <h3 class="style-fancy"><a href="/emery-fixture"><span class="field field--name-title">Emery Fixture</span></a></h3>
        <div class="field field--name-field-title">Sterling Professor of Law</div>
      </article></div>`;
    expect(
      lawPersonListingExtractor(html, { pageUrl: 'https://law.yale.edu/faculty?type=faculty' }),
    ).toEqual([
      {
        name: 'Emery Fixture',
        profileUrl: 'https://law.yale.edu/emery-fixture',
        title: 'Sterling Professor of Law',
      },
    ]);
  });

  it('is wired to the paginated Law faculty directory so the whole roster is walked', () => {
    const law = DEFAULT_DEPT_CONFIGS.find((c) => c.deptKey === 'law');
    expect(law).toBeDefined();
    expect(law?.url).toBe('https://law.yale.edu/faculty?type=faculty');
    expect(law?.schoolName).toBe('Yale Law School');
    expect(law?.extractor).toBe(lawPersonListingExtractor);
    expect(law?.paginated).toBe(true);
  });
});

describe('nursingFacultyExtractor', () => {
  it('extracts Nursing faculty-directory nodes', () => {
    const html = `
      <div class="views-row"><div class="node-faculty-directory">
        <a class="group-faculty-link-wrapper" href="/faculty-research/faculty-directory/quinn-fixture-phd-rn">
          <div class="field-name-faculty-firstname-lastname"><div class="field-items"><h2 class="field-item"><span>Quinn Fixture</span></h2></div></div>
        </a>
      </div></div>`;
    expect(
      nursingFacultyExtractor(html, {
        pageUrl: 'https://nursing.yale.edu/faculty-research/faculty-directory',
      }),
    ).toEqual([
      {
        name: 'Quinn Fixture',
        profileUrl:
          'https://nursing.yale.edu/faculty-research/faculty-directory/quinn-fixture-phd-rn',
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

describe('ysphDirectoryExtractor', () => {
  it('extracts "Last, First" A-Z directory entries and reorders to "First Last"', () => {
    const out = ysphDirectoryExtractor(YSPH_DIRECTORY_HTML, {
      pageUrl: 'https://ysph.yale.edu/school-of-public-health-faculty/directory-name/',
    });

    expect(out).toEqual([
      {
        name: 'Jordan Alvarez',
        profileUrl: 'https://ysph.yale.edu/profile/jordan-alvarez-fixture/',
      },
      {
        name: 'Priya Anand',
        profileUrl: 'https://ysph.yale.edu/profile/priya-anand-fixture/',
      },
      {
        name: 'Morgan Brooks',
        profileUrl: 'https://ysph.yale.edu/profile/morgan-brooks-fixture/',
      },
    ]);
  });

  it('ignores entries with no name text', () => {
    const html = `
      <section class="generic-anchored-list">
        <ul class="link-items-list">
          <li class="link-items-list__item"><div><a href="/profile/empty-fixture/" class="hyperlink"></a></div></li>
        </ul>
      </section>
    `;
    const out = ysphDirectoryExtractor(html, { pageUrl: 'https://ysph.yale.edu/x' });
    expect(out).toEqual([]);
  });

  it('ignores generic list links outside the directory section', () => {
    const html = `
      <footer>
        <ul class="link-items-list">
          <li class="link-items-list__item"><div><a href="/about-us/" class="hyperlink">About Us</a></div></li>
        </ul>
      </footer>
      <section class="generic-anchored-list">
        <ul class="link-items-list">
          <li class="link-items-list__item"><div><a href="/give/" class="hyperlink">Give Now</a></div></li>
        </ul>
      </section>
    `;
    const out = ysphDirectoryExtractor(html, { pageUrl: 'https://ysph.yale.edu/x' });
    expect(out).toEqual([]);
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

describe('chemEnvFacultyExtractor', () => {
  const html = `
    <div class="stories">
      <a class="block stories-item py-2 !no-underline" target="_self" href="/research-and-faculty/faculty-directory/eric-i-altman">
        <picture><img class="img-fluid" src="/application/files/thumbnails/eric-altman.webp" /></picture>
        <span class="text-black pt-4 block"> </span>
        <h3 class="!pb-0 block text-brand-blue">
           Eric Altman  <em class="fa fa-arrow-right text-light-blue"></em>
        </h3>
        <span class="text-black block font-bold">Roberto C. Goizueta Professor</span>
      </a>
      <a class="block stories-item py-2 !no-underline" target="_blank" href="https://environment.yale.edu/directory/faculty/yuan-yao">
        <h3 class="!pb-0 block text-brand-blue">
           Yuan Yao  <em class="fa fa-arrow-right text-light-blue"></em>
        </h3>
        <span class="text-black block font-bold">Professor</span>
      </a>
    </div>
  `;

  it('extracts name, title, profile URL, and image from static stories-item cards', () => {
    const out = chemEnvFacultyExtractor(html, {
      pageUrl:
        'https://engineering.yale.edu/academic-study/departments/chemical-and-environmental-engineering/faculty',
    });

    expect(out).toEqual([
      {
        name: 'Eric Altman',
        profileUrl:
          'https://engineering.yale.edu/research-and-faculty/faculty-directory/eric-i-altman',
        title: 'Roberto C. Goizueta Professor',
        imageUrl: 'https://engineering.yale.edu/application/files/thumbnails/eric-altman.webp',
      },
      {
        name: 'Yuan Yao',
        profileUrl: 'https://environment.yale.edu/directory/faculty/yuan-yao',
        title: 'Professor',
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
      url: 'https://jackson.yale.edu/faculty-research/lecturers-visiting-faculty',
      extractor: jacksonProfileComponentExtractor,
      emitPersonalResearchEntities: false,
    });
    expect(configsByKey.get('tdps')).toMatchObject({
      deptName: 'Theater, Dance, and Performance Studies',
      url: 'https://tdps.yale.edu/people',
      extractor: mcdbExtractor,
      emitPersonalResearchEntities: false,
    });
    expect(configsByKey.get('yibs')).toMatchObject({
      deptName: 'Biospheric Studies',
      url: 'https://yibs.yale.edu/people/faculty-affiliates',
      extractor: fieldCollectionPersonExtractor,
      officialProfileOnly: true,
      affiliatesOnly: true,
    });
    expect(configsByKey.get('physics')).toMatchObject({
      deptName: 'Physics',
      url: 'https://physics.yale.edu/people/faculty',
      extractor: mcdbExtractor,
    });
    expect(configsByKey.get('ysm-ophthalmology')).toMatchObject({
      deptName: 'Ophthalmology & Visual Science',
      url: 'https://medicine.yale.edu/eyes/people/',
      extractor: profileGridItemExtractor,
      officialProfileOnly: true,
    });
    expect(configsByKey.get('ysm-radiology-biomedical-imaging')).toMatchObject({
      deptName: 'Radiology & Biomedical Imaging',
      url: 'https://medicine.yale.edu/radiology-biomedical-imaging/faculty-and-staff/clinical-faculty-by-section/',
      extractor: profileGridItemExtractor,
      officialProfileOnly: true,
    });
    expect(configsByKey.get('ysm-surgery')).toMatchObject({
      deptName: 'Surgery',
      url: 'https://medicine.yale.edu/surgery/directory/',
      extractor: ysphDirectoryExtractor,
      officialProfileOnly: true,
    });
    expect(configsByKey.get('ysm-internal-medicine')).toMatchObject({
      deptName: 'Internal Medicine',
      url: 'https://medicine.yale.edu/internal-medicine/people/faculty/',
      extractor: ysphDirectoryExtractor,
      officialProfileOnly: true,
    });
    expect(configsByKey.get('ysph-social-behavioral-sciences')).toMatchObject({
      deptName: 'Social & Behavioral Sciences',
      url: 'https://ysph.yale.edu/school-of-public-health-faculty/social-behavioral-sciences/',
      extractor: profileGridItemExtractor,
      officialProfileOnly: true,
    });
    expect(configsByKey.get('applied-mathematics')).toMatchObject({
      deptName: 'Applied Mathematics',
      url: 'https://applied.math.yale.edu/people/faculty',
      extractor: viewsTableRowExtractor,
    });
    expect(configsByKey.get('history-science-medicine-public-health')).toMatchObject({
      deptName: 'History of Science, Medicine & Public Health',
      url: 'https://hshm.yale.edu/people/faculty',
      extractor: viewsTableRowExtractor,
    });
    expect(configsByKey.get('judaic-studies')).toMatchObject({
      deptName: 'Judaic Studies',
      url: 'https://judaicstudies.yale.edu/people',
      extractor: mcdbExtractor,
    });
    expect(configsByKey.get('council-east-asian-studies')).toMatchObject({
      deptName: 'Council on East Asian Studies',
      url: 'https://macmillan.yale.edu/eastasia/people',
      extractor: econExtractor,
      affiliatesOnly: true,
    });
    expect(configsByKey.get('ysph-public-health-modeling')).toMatchObject({
      deptName: 'Public Health Modeling',
      extractor: profileGridItemExtractor,
      affiliatesOnly: true,
    });
  });

  it('flags a configured source that fetches but yields zero faculty as a breakage', async () => {
    const emptyExtractor = vi.fn((): FacultyEntry[] => []);
    const htmlFetcher = vi.fn(async () => '<html><body><main>migrated</main></body></html>');
    const configs: DeptConfig[] = [
      {
        deptKey: 'physics',
        deptName: 'Physics',
        schoolName: 'Yale Faculty of Arts and Sciences',
        url: 'https://physics.yale.edu/people/faculty',
        paginated: false,
        extractor: emptyExtractor,
      },
    ];
    const scraper = new DepartmentRosterScraper(configs, null, htmlFetcher);
    const { ctx } = makeContext();
    const logs: string[] = [];
    ctx.log = (message: string) => logs.push(message);
    const result = await scraper.run(ctx);

    expect(result.notes).toContain('physics=empty');
    expect(
      logs.some((l) => /WARNING:.*yielded no faculty/.test(l) && l.includes('physics(empty)')),
    ).toBe(true);
  });

  it('emits official-profile person observations without minting a lab entity when officialProfileOnly is set', async () => {
    const cannedExtractor = vi.fn((): FacultyEntry[] => [
      {
        name: 'Robin Roster',
        profileUrl: 'https://wlab.yale.edu/profile/robin-roster',
        title: 'Assistant Professor of Physics',
        labUrl: 'https://roster-lab.example.org',
      },
    ]);
    const htmlFetcher = vi.fn(async () => '<html><body></body></html>');
    const configs: DeptConfig[] = [
      {
        deptKey: 'wright-lab',
        deptName: 'Physics',
        schoolName: 'Yale Faculty of Arts and Sciences',
        url: 'https://wlab.yale.edu/people/faculty/primary-faculty',
        paginated: false,
        extractor: cannedExtractor,
        emitPersonalResearchEntities: false,
        officialProfileOnly: true,
      },
    ];
    const scraper = new DepartmentRosterScraper(configs, null, htmlFetcher);
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);

    expect(result.entitiesObserved).toBe(1);

    const entityObs = emitted.filter((o) => o.entityType === 'researchEntity');
    expect(entityObs).toHaveLength(0);

    const profileObs = emitted.find((o) => o.entityType === 'user' && o.field === 'profileUrls');
    expect(profileObs?.value).toEqual({
      departmental: 'https://wlab.yale.edu/profile/robin-roster',
    });
    expect(emitted.find((o) => o.field === 'primaryDepartment')?.value).toBe('Physics');
  });

  // #2437: `isOfficialYaleUrl` only checks the HOST, so any *.yale.edu page the
  // roster markup links reaches the enrichment fetch. medicine.yale.edu/about/
  // declares the DEAN; #2385 attributed four departmental sites to one dean that
  // way. `title` is the observable enrichment field here: when the guard refuses,
  // nothing from the page is merged, but the citation the roster asserted is kept.
  it("refuses a foreign page's enrichment and still keeps the citation", async () => {
    const cannedExtractor = vi.fn((): FacultyEntry[] => [
      { name: 'Robin Roster', profileUrl: 'https://medicine.yale.edu/about/' },
    ]);
    const htmlFetcher = vi.fn(
      async () =>
        '<html><head><meta property="og:title" content="Nancy Brown" /></head>' +
        '<body><main><h1>Nancy Brown</h1><p class="professional-title">Dean of the School of Medicine</p></main></body></html>',
    );
    const configs: DeptConfig[] = [
      {
        deptKey: 'deanery',
        deptName: 'Internal Medicine',
        schoolName: 'Yale School of Medicine',
        url: 'https://medicine.yale.edu/people/faculty',
        paginated: false,
        extractor: cannedExtractor,
        emitPersonalResearchEntities: false,
        officialProfileOnly: true,
      },
    ];
    const scraper = new DepartmentRosterScraper(configs, null, htmlFetcher);
    const { ctx, emitted } = makeContext();
    await scraper.run(ctx);

    expect(emitted.find((o) => o.field === 'lname')?.value).toBe('Roster');
    expect(emitted.find((o) => o.field === 'title')).toBeUndefined();
    expect(emitted.find((o) => o.field === 'profileUrls')?.value).toEqual({
      departmental: 'https://medicine.yale.edu/about/',
    });
  });

  it('never fetches a shared roster page as an individual profile', async () => {
    const cannedExtractor = vi.fn((): FacultyEntry[] => [
      { name: 'Robin Roster', profileUrl: 'https://medicine.yale.edu/people/faculty' },
    ]);
    const htmlFetcher = vi.fn(async (_url: string) => '<html><body></body></html>');
    const configs: DeptConfig[] = [
      {
        deptKey: 'roster-loop',
        deptName: 'Pediatrics',
        schoolName: 'Yale School of Medicine',
        url: 'https://medicine.example.invalid/people/faculty',
        paginated: false,
        extractor: cannedExtractor,
        emitPersonalResearchEntities: false,
        officialProfileOnly: true,
      },
    ];
    const scraper = new DepartmentRosterScraper(configs, null, htmlFetcher);
    const { ctx } = makeContext();
    await scraper.run(ctx);

    const fetched = htmlFetcher.mock.calls.map(([requestedUrl]) => requestedUrl);
    expect(fetched).not.toContain('https://medicine.yale.edu/people/faculty');
  });

  it('suppresses department claims for an affiliates-only institute roster', async () => {
    const cannedExtractor = vi.fn((): FacultyEntry[] => [
      {
        name: 'Robin Roster',
        profileUrl: 'https://environment.yale.edu/profile/robin-roster',
        title: 'Professor of Ecology',
        labUrl: 'https://roster-lab.example.org',
      },
    ]);
    const htmlFetcher = vi.fn(async () => '<html><body></body></html>');
    const configs: DeptConfig[] = [
      {
        deptKey: 'yibs',
        deptName: 'Biospheric Studies',
        schoolName: 'Yale Institute for Biospheric Studies',
        url: 'https://yibs.yale.edu/people/faculty-affiliates',
        paginated: false,
        extractor: cannedExtractor,
        officialProfileOnly: true,
        affiliatesOnly: true,
      },
    ];
    const scraper = new DepartmentRosterScraper(configs, null, htmlFetcher);
    const { ctx, emitted } = makeContext();
    await scraper.run(ctx);

    expect(emitted.find((o) => o.field === 'primaryDepartment')).toBeUndefined();
    expect(emitted.find((o) => o.field === 'departments')).toBeUndefined();
    expect(emitted.find((o) => o.field === 'userType')?.value).toBe('faculty');
  });

  it('suppresses department claims on a derived research entity for an affiliates-only roster', async () => {
    const cannedExtractor = vi.fn((): FacultyEntry[] => [
      {
        name: 'Robin Roster',
        labUrl: 'https://roster-lab.example.org',
      },
    ]);
    const htmlFetcher = vi.fn(async () => '<html><body></body></html>');
    const configs: DeptConfig[] = [
      {
        deptKey: 'yibs',
        deptName: 'Biospheric Studies',
        schoolName: 'Yale Institute for Biospheric Studies',
        url: 'https://yibs.yale.edu/people/faculty-affiliates',
        paginated: false,
        extractor: cannedExtractor,
        affiliatesOnly: true,
      },
    ];
    const scraper = new DepartmentRosterScraper(configs, null, htmlFetcher);
    const { ctx, emitted } = makeContext();
    await scraper.run(ctx);

    const entityObs = emitted.filter((o) => o.entityType === 'researchEntity');
    expect(entityObs.length).toBeGreaterThan(0);
    expect(entityObs.find((o) => o.field === 'departments')).toBeUndefined();
    expect(entityObs.find((o) => o.field === 'school')?.value).toBe(
      'Yale Institute for Biospheric Studies',
    );
  });

  it('skips JS-rendered depts and only invokes extractors for matching only-filter', async () => {
    const cannedExtractor = vi.fn((): FacultyEntry[] => [
      { name: 'Test Faculty', email: 'tf123@yale.edu', labUrl: 'https://tflab.example.org' },
    ]);
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
    const cannedExtractor = vi.fn((): FacultyEntry[] => [
      {
        name: 'Jordan Mismatch',
        email: 'sage.mismatch@yale.edu',
        labUrl: 'https://gendronlab.yale.edu',
      },
    ]);
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

  describe('lab-less research homes (School of Art / School of Architecture coverage)', () => {
    const ART_PROSE =
      'Draws on archival photography and installation to study how public monuments encode civic memory, ' +
      'combining fieldwork in New Haven with archival research on nineteenth-century commemorative practice.';

    const runWithEntries = async (
      entries: FacultyEntry[],
      dept: Partial<DeptConfig> = {},
    ): Promise<ObservationInput[]> => {
      const configs: DeptConfig[] = [
        {
          deptKey: 'art',
          deptName: 'Art',
          schoolName: 'Yale School of Art',
          url: 'https://www.art.yale.edu/about/people/faculty-and-staff',
          paginated: false,
          extractor: vi.fn((): FacultyEntry[] => entries),
          ...dept,
        },
      ];
      const axios = (await import('axios')).default;
      const getSpy = vi.spyOn(axios, 'get').mockResolvedValue({ data: '<html></html>' } as any);
      const scraper = new DepartmentRosterScraper(configs);
      const { ctx, emitted } = makeContext();
      await scraper.run(ctx);
      getSpy.mockRestore();
      return emitted;
    };

    it('mints a faculty research area from official profile prose when no lab website exists', async () => {
      const emitted = await runWithEntries([
        {
          name: 'Alexandra Example',
          profileUrl: 'https://www.art.yale.edu/AlexandraExample',
          title: 'Assistant Professor',
          researchHomeDescription: ART_PROSE,
        },
      ]);

      const entityObs = emitted.filter((o) => o.entityType === 'researchEntity');
      expect(entityObs.length).toBeGreaterThan(0);
      expect(entityObs.find((o) => o.field === 'entityType')?.value).toBe('FACULTY_RESEARCH_AREA');
      expect(entityObs.find((o) => o.field === 'kind')?.value).toBe('individual');
      expect(entityObs.find((o) => o.field === 'name')?.value).toBe(
        'Alexandra Example Faculty Research',
      );
      expect(entityObs.find((o) => o.field === 'school')?.value).toBe('Yale School of Art');
      expect(entityObs.some((o) => o.field === 'websiteUrl')).toBe(false);
      expect(entityObs.find((o) => o.field === 'fullDescription')?.value).toBe(ART_PROSE);
      expect(entityObs.find((o) => o.field === 'inferredPiUserKey')?.value).toBe(
        'dept:art:alexandra-example',
      );
    });

    it('cites the person own official profile rather than the shared roster listing', async () => {
      const emitted = await runWithEntries([
        {
          name: 'Alexandra Example',
          profileUrl: 'https://www.art.yale.edu/AlexandraExample',
          researchHomeDescription: ART_PROSE,
        },
      ]);

      const entityObs = emitted.filter((o) => o.entityType === 'researchEntity');
      expect(entityObs.find((o) => o.field === 'sourceUrls')?.value).toEqual([
        'https://www.art.yale.edu/AlexandraExample',
      ]);
      for (const observation of entityObs) {
        expect(observation.sourceUrl).toBe('https://www.art.yale.edu/AlexandraExample');
      }
    });

    it('mints a faculty research area from roster research interests alone', async () => {
      const emitted = await runWithEntries([
        {
          name: 'Bruno Interests',
          profileUrl: 'https://www.architecture.yale.edu/faculty/bruno-interests',
          researchInterests: ['Urban History', 'Building Technology'],
        },
      ]);

      const entityObs = emitted.filter((o) => o.entityType === 'researchEntity');
      expect(entityObs.find((o) => o.field === 'entityType')?.value).toBe('FACULTY_RESEARCH_AREA');
      expect(entityObs.find((o) => o.field === 'researchAreas')?.value).toEqual([
        'Urban History',
        'Building Technology',
      ]);
    });

    it('mints nothing for a bare roster row with no research evidence', async () => {
      const emitted = await runWithEntries([
        {
          name: 'Casey Bare',
          profileUrl: 'https://www.art.yale.edu/CaseyBare',
          title: 'Critic',
        },
      ]);

      expect(emitted.filter((o) => o.entityType === 'researchEntity')).toEqual([]);
      expect(emitted.some((o) => o.entityType === 'user')).toBe(true);
    });

    it('refuses to mint when the only citable page is a shared roster listing root', async () => {
      const emitted = await runWithEntries([
        {
          name: 'Dana Listing',
          profileUrl: 'https://www.architecture.yale.edu/faculty',
          researchHomeDescription: ART_PROSE,
        },
      ]);

      expect(emitted.filter((o) => o.entityType === 'researchEntity')).toEqual([]);
    });

    it('refuses to mint when the roster only exposed a slug placeholder for the name', async () => {
      const emitted = await runWithEntries([
        {
          name: 'dana-placeholder',
          namePlaceholder: true,
          profileUrl: 'https://www.architecture.yale.edu/faculty/dana-placeholder',
          researchHomeDescription: ART_PROSE,
        },
      ]);

      expect(emitted.filter((o) => o.entityType === 'researchEntity')).toEqual([]);
    });

    it('keeps suppressing lab-less research homes on broad people rosters', async () => {
      const emitted = await runWithEntries(
        [
          {
            name: 'Erin Broad',
            profileUrl: 'https://tdps.yale.edu/profile/erin-broad',
            researchHomeDescription: ART_PROSE,
          },
        ],
        {
          deptKey: 'tdps',
          deptName: 'Theater, Dance, and Performance Studies',
          schoolName: 'FAS',
          emitPersonalResearchEntities: false,
        },
      );

      expect(emitted.filter((o) => o.entityType === 'researchEntity')).toEqual([]);
    });

    it('still prefers an explicit lab website over the lab-less path', async () => {
      const emitted = await runWithEntries([
        {
          name: 'Fern Labowner',
          profileUrl: 'https://www.art.yale.edu/FernLabowner',
          labUrl: 'https://fernlab.example.org/',
          researchHomeDescription: ART_PROSE,
        },
      ]);

      const entityObs = emitted.filter((o) => o.entityType === 'researchEntity');
      expect(entityObs.find((o) => o.field === 'entityType')?.value).toBe('LAB');
      expect(entityObs.find((o) => o.field === 'websiteUrl')?.value).toBe(
        'https://fernlab.example.org/',
      );
      expect(entityObs.find((o) => o.field === 'sourceUrls')?.value).toEqual([
        'https://www.art.yale.edu/FernLabowner',
        'https://www.art.yale.edu/about/people/faculty-and-staff',
        'https://fernlab.example.org/',
      ]);
    });
  });

  it('models personal research websites as faculty research areas rather than labs', async () => {
    const cannedExtractor = vi.fn((): FacultyEntry[] => [
      {
        name: 'Abraham Silberschatz',
        profileUrl:
          'https://engineering.yale.edu/research-and-faculty/faculty-directory/avery-database-fixture',
        labUrl: 'https://codex.cs.yale.edu/avi/',
      },
    ]);
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
    expect(entityObs.find((o) => o.field === 'entityType')?.value).toBe('FACULTY_RESEARCH_AREA');
    expect(entityObs.find((o) => o.field === 'websiteUrl')?.value).toBe(
      'https://codex.cs.yale.edu/avi/',
    );

    getSpy.mockRestore();
  });

  it('can suppress generic personal-site research entities for broad people rosters', async () => {
    const cannedExtractor = vi.fn((): FacultyEntry[] => [
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
    ]);
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
    const cannedExtractor = vi.fn((): FacultyEntry[] => [
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
    ]);
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
    expect(entityObs.find((o) => o.field === 'shortDescription')).toBeUndefined();

    getSpy.mockRestore();
  });

  it('preserves casing on hyphenated/slashed/mixed-case topic labels in roster topic descriptions (#1722)', async () => {
    const cannedExtractor = vi.fn((): FacultyEntry[] => [
      {
        name: 'Casey Topic',
        email: 'casey.topic@yale.edu',
        labUrl: 'https://www.eng.yale.edu/caseylab/',
        topics: [
          'Large-Scale Structure',
          'NMR/MRI',
          'Structure+Formation',
          'Non-Hodgkin Lymphoma',
          'SARS-CoV-2',
        ],
        researchInterests: [
          'Large-Scale Structure',
          'NMR/MRI',
          'Structure+Formation',
          'Non-Hodgkin Lymphoma',
          'SARS-CoV-2',
        ],
      },
    ]);
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
    expect(entityObs.find((o) => o.field === 'fullDescription')?.value).toBe(
      'Studies Large-Scale structure, including NMR/MRI, Structure+Formation, Non-Hodgkin lymphoma, and SARS-CoV-2.',
    );

    getSpy.mockRestore();
  });

  it('drops a page section heading ("Selected Presentations and Articles for a General Audience") from roster topics instead of treating it as a research area (#1678)', async () => {
    const cannedExtractor = vi.fn((): FacultyEntry[] => [
      {
        name: 'Avery Faculty',
        email: 'avery.faculty@yale.edu',
        labUrl: 'https://hep.yale.edu/people/faculty/avery-faculty/research',
        topics: [
          'Particle Physics',
          'ATLAS',
          'Selected Presentations and Articles for a General Audience',
        ],
        researchInterests: [
          'Particle Physics',
          'ATLAS',
          'Selected Presentations and Articles for a General Audience',
        ],
      },
    ]);
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
      'Particle Physics',
      'ATLAS',
    ]);
    expect(entityObs.find((o) => o.field === 'fullDescription')?.value).toBe(
      'Studies particle physics, including ATLAS.',
    );

    getSpy.mockRestore();
  });

  it('rejects a grounded short description that is only an appointment, not research', async () => {
    const cannedExtractor = vi.fn((): FacultyEntry[] => [
      {
        name: 'Reagan Statute',
        email: 'reagan.roster@yale.edu',
        labUrl: 'http://www.reaganstatute.example/',
        researchHomeDescription:
          'Reagan Statute is the Example Distinguished Professor at Yale Law School. Reagan holds a secondary appointment as Professor, Yale Child Study Center.',
        researchHomeShortDescription:
          'Reagan holds a secondary appointment as Professor, Yale Child Study Center.',
      },
    ]);
    const configs: DeptConfig[] = [
      {
        deptKey: 'law',
        deptName: 'Law',
        schoolName: 'Yale Law School',
        url: 'https://example.invalid/law',
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
    expect(entityObs.find((o) => o.field === 'shortDescription')).toBeUndefined();

    getSpy.mockRestore();
  });

  it('rejects a grounded full description that is entirely a CV of prior degrees', async () => {
    const cannedExtractor = vi.fn((): FacultyEntry[] => [
      {
        name: 'Gary Roster',
        email: 'gary.roster@yale.edu',
        labUrl: 'http://www.garyroster.example/',
        researchHomeDescription:
          "In the field of economics, he received master's degrees at the University of Rochester and Cleveland State University before completing his PhD.",
        researchHomeShortDescription:
          "In the field of economics, he received master's degrees at the University of Rochester and Cleveland State University before completing his PhD.",
      },
    ]);
    const configs: DeptConfig[] = [
      {
        deptKey: 'som',
        deptName: 'Management',
        schoolName: 'Yale School of Management',
        url: 'https://example.invalid/som',
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
    expect(entityObs.find((o) => o.field === 'fullDescription')).toBeUndefined();
    expect(entityObs.find((o) => o.field === 'shortDescription')).toBeUndefined();

    getSpy.mockRestore();
  });

  it('keeps a grounded description that describes actual research, not just an appointment', async () => {
    const cannedExtractor = vi.fn((): FacultyEntry[] => [
      {
        name: 'Robin Roster',
        email: 'robin.roster@yale.edu',
        labUrl: 'https://roster-lab.example.org',
        researchHomeDescription:
          'Robin Roster studies contract theory and the economics of regulation, with a focus on how information asymmetries shape financial-market design.',
        researchHomeShortDescription:
          'Studies contract theory and the economics of regulation, with a focus on information asymmetries in financial-market design.',
      },
    ]);
    const configs: DeptConfig[] = [
      {
        deptKey: 'econ',
        deptName: 'Economics',
        schoolName: 'FAS',
        url: 'https://example.invalid/econ',
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
    expect(entityObs.find((o) => o.field === 'fullDescription')?.value).toBe(
      'Robin Roster studies contract theory and the economics of regulation, with a focus on how information asymmetries shape financial-market design.',
    );
    expect(entityObs.find((o) => o.field === 'shortDescription')?.value).toBe(
      'Studies contract theory and the economics of regulation, with a focus on information asymmetries in financial-market design.',
    );

    getSpy.mockRestore();
  });

  it('drops section-header chrome from roster topics and ranks the one-liner below extracted descriptions', async () => {
    const cannedExtractor = vi.fn((): FacultyEntry[] => [
      {
        name: 'Sawyer Roster',
        email: 'sawyer.roster@yale.edu',
        labUrl: 'https://campuspress.yale.edu/sawyerlab/',
        topics: [
          'Condensed Matter Physics',
          'Research Areas:',
          'Research Interests',
          'Topics',
          'Topics:',
          'Fields of Interest',
          'Research Interests:',
        ],
        researchInterests: [
          'Condensed Matter Physics',
          'Research Areas:',
          'Research Interests',
          'Topics',
          'Topics:',
          'Fields of Interest',
          'Research Interests:',
        ],
      },
    ]);
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
    ]);
    const fullDescription = entityObs.find((o) => o.field === 'fullDescription');
    expect(fullDescription?.value).toBe('Studies condensed matter physics.');
    expect(fullDescription?.value).not.toContain('research areas');
    expect(fullDescription?.value).not.toContain(':');
    expect(fullDescription?.confidenceOverride).toBe(0.5);

    getSpy.mockRestore();
  });

  it('prefers grounded official-profile prose over the synthesized topic one-liner', async () => {
    const profileHtml = `
      <html><head>
        <link rel="canonical" href="https://physics.yale.edu/people/alex-smith" />
      </head><body>
        <main>
          <p>Alex Smith is a professor of physics at Yale University. Smith studies the quantum dynamics of ultracold atomic gases and develops methods for simulating strongly correlated many-body quantum systems.</p>
        </main>
      </body></html>
    `;
    const htmlFetcher = vi.fn(async (url: string) => {
      if (url === 'https://physics.yale.edu/people/alex-smith') return profileHtml;
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
          {
            name: 'Alex Smith',
            profileUrl: 'https://physics.yale.edu/people/alex-smith',
            labUrl: 'https://smithlab.yale.edu/',
            topics: ['Quantum Physics', 'Cold Atoms'],
            researchInterests: ['Quantum Physics', 'Cold Atoms'],
          },
        ],
      },
    ];

    const scraper = new DepartmentRosterScraper(configs, null, htmlFetcher);
    const { ctx, emitted } = makeContext();
    await scraper.run(ctx);

    const entityObs = emitted.filter((o) => o.entityType === 'researchEntity');
    const fullDescription = entityObs.find((o) => o.field === 'fullDescription');
    expect(fullDescription?.value).toContain(
      'Smith studies the quantum dynamics of ultracold atomic gases',
    );
    expect(fullDescription?.value).not.toContain('Studies quantum physics');
    expect(fullDescription?.confidenceOverride).toBe(0.55);
    expect(entityObs.find((o) => o.field === 'researchAreas')?.value).toEqual([
      'Quantum Physics',
      'Cold Atoms',
    ]);
    expect(entityObs.find((o) => o.field === 'shortDescription')?.confidenceOverride).toBe(0.55);
  });

  it('grounds a research-home description from the profile even when the roster has no topics', async () => {
    const profileHtml = `
      <html><head>
        <link rel="canonical" href="https://mcdb.yale.edu/profile/nora-fixture" />
      </head><body>
        <main>
          <p>Nora Fixture is an assistant professor of molecular biology at Yale. Her research examines how long noncoding RNAs regulate gene expression during tumor progression in human cancers.</p>
        </main>
      </body></html>
    `;
    const htmlFetcher = vi.fn(async (url: string) => {
      if (url === 'https://mcdb.yale.edu/profile/nora-fixture') return profileHtml;
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
            profileUrl: 'https://mcdb.yale.edu/profile/nora-fixture',
            labUrl: 'https://fixturelab.yale.edu/',
          },
        ],
      },
    ];

    const scraper = new DepartmentRosterScraper(configs, null, htmlFetcher);
    const { ctx, emitted } = makeContext();
    await scraper.run(ctx);

    const entityObs = emitted.filter((o) => o.entityType === 'researchEntity');
    const fullDescription = entityObs.find((o) => o.field === 'fullDescription');
    expect(fullDescription?.value).toContain(
      'examines how long noncoding RNAs regulate gene expression',
    );
    expect(fullDescription?.confidenceOverride).toBe(0.55);
  });

  it('fails closed to the synthesized one-liner when the profile has no research prose', async () => {
    const profileHtml = `
      <html><head>
        <link rel="canonical" href="https://physics.yale.edu/people/pat-chrome" />
      </head><body>
        <nav><a href="/">Home</a><a href="/people">People</a><a href="/about">About</a></nav>
        <main>
          <p>Contact us to schedule a visit.</p>
        </main>
      </body></html>
    `;
    const htmlFetcher = vi.fn(async (url: string) => {
      if (url === 'https://physics.yale.edu/people/pat-chrome') return profileHtml;
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
          {
            name: 'Pat Chrome',
            profileUrl: 'https://physics.yale.edu/people/pat-chrome',
            labUrl: 'https://chromelab.yale.edu/',
            topics: ['Condensed Matter Physics'],
            researchInterests: ['Condensed Matter Physics'],
          },
        ],
      },
    ];

    const scraper = new DepartmentRosterScraper(configs, null, htmlFetcher);
    const { ctx, emitted } = makeContext();
    await scraper.run(ctx);

    const entityObs = emitted.filter((o) => o.entityType === 'researchEntity');
    const fullDescription = entityObs.find((o) => o.field === 'fullDescription');
    expect(fullDescription?.value).toBe('Studies condensed matter physics.');
    expect(fullDescription?.confidenceOverride).toBe(0.5);
    expect(entityObs.find((o) => o.field === 'shortDescription')).toBeUndefined();
  });

  it('keeps the slug placeholder name when the profile title is a generic section title', async () => {
    const profileUrl = 'https://www.architecture.yale.edu/faculty/1001-robin-fixture-vane';
    const profileHtml = `
      <html><head>
        <meta property="og:title" content="Faculty - Yale School of Architecture" />
        <link rel="canonical" href="${profileUrl}" />
      </head><body><main><p>Directory listing.</p></main></body></html>
    `;
    const htmlFetcher = vi.fn(async (url: string) => {
      if (url === profileUrl) return profileHtml;
      return '<html><body>listing</body></html>';
    });
    const configs: DeptConfig[] = [
      {
        deptKey: 'architecture',
        deptName: 'Architecture',
        schoolName: 'Yale School of Architecture',
        url: 'https://www.architecture.yale.edu/faculty',
        paginated: false,
        extractor: () => [{ name: 'Robin Fixture Vane', namePlaceholder: true, profileUrl }],
      },
    ];

    const scraper = new DepartmentRosterScraper(configs, null, htmlFetcher);
    const { ctx, emitted } = makeContext();
    await scraper.run(ctx);

    const userObs = emitted.filter((o) => o.entityType === 'user');
    expect(userObs.find((o) => o.field === 'fname')?.value).toBe('Robin Fixture');
    expect(userObs.find((o) => o.field === 'lname')?.value).toBe('Vane');
  });

  it('overwrites the slug placeholder with a person-shaped profile title, restoring hyphens', async () => {
    const profileUrl = 'https://www.architecture.yale.edu/faculty/1001-robin-fixture-vane';
    const profileHtml = `
      <html><head>
        <meta property="og:title" content="Robin Fixture-Vane - Yale School of Architecture" />
        <link rel="canonical" href="${profileUrl}" />
      </head><body><main><p>Bio.</p></main></body></html>
    `;
    const htmlFetcher = vi.fn(async (url: string) => {
      if (url === profileUrl) return profileHtml;
      return '<html><body>listing</body></html>';
    });
    const configs: DeptConfig[] = [
      {
        deptKey: 'architecture',
        deptName: 'Architecture',
        schoolName: 'Yale School of Architecture',
        url: 'https://www.architecture.yale.edu/faculty',
        paginated: false,
        extractor: () => [{ name: 'Robin Fixture Vane', namePlaceholder: true, profileUrl }],
      },
    ];

    const scraper = new DepartmentRosterScraper(configs, null, htmlFetcher);
    const { ctx, emitted } = makeContext();
    await scraper.run(ctx);

    const userObs = emitted.filter((o) => o.entityType === 'user');
    expect(userObs.find((o) => o.field === 'fname')?.value).toBe('Robin');
    expect(userObs.find((o) => o.field === 'lname')?.value).toBe('Fixture-Vane');
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
    expect(userObs.find((o) => o.field === 'website')?.value).toBe('https://lovelacelab.yale.edu/');
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
    expect(userObs.find((o) => o.field === 'officialProfilePublications')).toBeUndefined();
    expect(userObs.find((o) => o.field === 'googleScholarId')).toBeUndefined();
    expect(userObs.find((o) => o.field === 'profileUrls')?.value).not.toHaveProperty(
      'googleScholar',
    );

    const labObs = emitted.filter((o) => o.entityType === 'researchEntity');
    expect(labObs.find((o) => o.field === 'websiteUrl')?.value).toBe(
      'https://lovelacelab.yale.edu/',
    );
    expect(labObs.find((o) => o.field === 'inferredPiUserKey')?.value).toBe('netid:ada.lovelace');
  });

  it('preserves Scholar discovery without mirroring Engineering publications', async () => {
    const htmlFetcher = vi.fn(async (url: string) => {
      if (
        url === 'https://engineering.yale.edu/research-and-faculty/faculty-directory/lane-network'
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
      emitted.find((o) => o.entityType === 'user' && o.field === 'scholarCandidateProfileUrls')
        ?.value,
    ).toEqual(['http://scholar.google.gr/citations?user=9qtgcZ8AAAAJ']);
    expect(
      emitted.find((o) => o.entityType === 'user' && o.field === 'officialProfilePublications'),
    ).toBeUndefined();
  });

  it('does not follow publication-list pages or emit publication observations', async () => {
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

    expect(htmlFetcher).not.toHaveBeenCalledWith(
      'https://www.cs.yale.edu/homes/abhishek/',
      false,
      'dept-faculty-roster',
    );
    expect(
      emitted.find((o) => o.entityType === 'user' && o.field === 'officialProfilePublications'),
    ).toBeUndefined();
    expect(emitted.find((o) => o.entityType === 'user' && o.field === 'website')?.value).toBe(
      'https://www.cs.yale.edu/homes/abhishek/',
    );
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
      'https://economics.yale.edu/people/lee-economics',
      'https://economics.yale.edu/people',
      'https://campuspress.yale.edu/leahboustan/',
    ]);
  });

  it("never adopts another institution's faculty profile linked from a Yale profile (#2512)", async () => {
    const profileHtml = `
      <html><head>
        <link rel="canonical" href="https://economics.yale.edu/people/sample-economist" />
      </head><body>
        <main>
          <h1>Sample Economist</h1>
          <div class="person-title">Professor of Economics</div>
          <a href="mailto:sample.economist@yale.edu">sample.economist@yale.edu</a>
          <div class="node__website-link">
            <a href="https://econ.example-university.edu/profile/sample-economist">Personal website</a>
          </div>
        </main>
      </body></html>
    `;
    const htmlFetcher = vi.fn(async (url: string) => {
      if (url === 'https://economics.yale.edu/people/sample-economist') return profileHtml;
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
            name: 'Sample Economist',
            profileUrl: 'https://economics.yale.edu/people/sample-economist',
          },
        ],
      },
    ];

    const scraper = new DepartmentRosterScraper(configs, null, htmlFetcher);
    const { ctx, emitted } = makeContext();
    await scraper.run(ctx);

    expect(emitted.find((o) => o.entityType === 'user' && o.field === 'website')).toBeUndefined();
    expect(
      emitted.find((o) => o.entityType === 'researchEntity' && o.field === 'websiteUrl'),
    ).toBeUndefined();
    expect(
      emitted.find((o) => o.entityType === 'user' && o.field === 'profileUrls')?.value,
    ).toEqual({ departmental: 'https://economics.yale.edu/people/sample-economist' });
  });

  it("never adopts another institution's nested faculty-directory profile from a roster row (#2512)", async () => {
    const htmlFetcher = vi.fn(async () => '<html><body>listing</body></html>');
    const configs: DeptConfig[] = [
      {
        deptKey: 'econ',
        deptName: 'Economics',
        schoolName: 'FAS',
        url: 'https://economics.yale.edu/people',
        paginated: false,
        extractor: () => [
          {
            name: 'Sample Economist',
            profileUrl: 'https://economics.yale.edu/people/sample-economist',
            labUrl:
              'https://www.business.example-university.edu/faculty/directory/sample_economist.aspx',
          },
        ],
      },
    ];

    const scraper = new DepartmentRosterScraper(configs, null, htmlFetcher);
    const { ctx, emitted } = makeContext();
    await scraper.run(ctx);

    expect(emitted.find((o) => o.entityType === 'user' && o.field === 'website')).toBeUndefined();
    expect(
      emitted.find((o) => o.entityType === 'researchEntity' && o.field === 'websiteUrl'),
    ).toBeUndefined();
  });

  it('still adopts a genuine off-Yale lab site supplied by a roster row', async () => {
    const htmlFetcher = vi.fn(async () => '<html><body>listing</body></html>');
    const configs: DeptConfig[] = [
      {
        deptKey: 'econ',
        deptName: 'Economics',
        schoolName: 'FAS',
        url: 'https://economics.yale.edu/people',
        paginated: false,
        extractor: () => [
          {
            name: 'Sample Economist',
            profileUrl: 'https://economics.yale.edu/people/sample-economist',
            labUrl: 'https://sample-economist-lab.example.test/',
          },
        ],
      },
    ];

    const scraper = new DepartmentRosterScraper(configs, null, htmlFetcher);
    const { ctx, emitted } = makeContext();
    await scraper.run(ctx);

    expect(emitted.find((o) => o.entityType === 'user' && o.field === 'website')?.value).toBe(
      'https://sample-economist-lab.example.test/',
    );
    expect(
      emitted.find((o) => o.entityType === 'researchEntity' && o.field === 'websiteUrl')?.value,
    ).toBe('https://sample-economist-lab.example.test/');
  });

  it('registers the first Math/Physics/Statistics/Astronomy roster batch', () => {
    expect(DEFAULT_DEPT_CONFIGS.map((config) => config.deptKey)).toEqual(
      expect.arrayContaining(['math', 'physics', 'statistics', 'astronomy']),
    );
  });

  it('registers all remaining SEAS engineering department rosters (#640)', () => {
    const configsByKey = new Map(DEFAULT_DEPT_CONFIGS.map((config) => [config.deptKey, config]));

    expect(DEFAULT_DEPT_CONFIGS.map((config) => config.deptKey)).toEqual(
      expect.arrayContaining([
        'applied-physics',
        'biomedical-engineering',
        'chemical-environmental-engineering',
        'electrical-computer-engineering',
        'mechanical-engineering',
        'materials-science',
      ]),
    );

    for (const deptKey of [
      'applied-physics',
      'biomedical-engineering',
      'electrical-computer-engineering',
      'mechanical-engineering',
      'materials-science',
    ]) {
      const config = configsByKey.get(deptKey);
      expect(config?.schoolName).toBe('Yale School of Engineering & Applied Science');
      expect(config?.dataUrl).toMatch(/\/load_faculty\/\d+$/);
      expect(config?.dataExtractor).toBe(csFacultyDataExtractor);
      expect(config?.jsRenderedSkip).toBe(true);
    }

    const chemEnv = configsByKey.get('chemical-environmental-engineering');
    expect(chemEnv?.schoolName).toBe('Yale School of Engineering & Applied Science');
    expect(chemEnv?.extractor).toBe(chemEnvFacultyExtractor);
    expect(chemEnv?.dataUrl).toBeUndefined();
  });

  it('collapses cross-listed MEMS faculty into one synthetic user entity across both sub-rosters', async () => {
    const meng = vi.fn((): FacultyEntry[] => [{ name: 'Jamie Meng-Matsci' }]);
    const matsci = vi.fn((): FacultyEntry[] => [{ name: 'Jamie Meng-Matsci' }]);
    const configs: DeptConfig[] = [
      {
        deptKey: 'mechanical-engineering',
        deptName: 'Mechanical Engineering & Materials Science',
        schoolName: 'Yale School of Engineering & Applied Science',
        url: 'https://example.invalid/mechanical-engineering',
        paginated: false,
        extractor: meng,
      },
      {
        deptKey: 'materials-science',
        deptName: 'Mechanical Engineering & Materials Science',
        schoolName: 'Yale School of Engineering & Applied Science',
        url: 'https://example.invalid/materials-science',
        paginated: false,
        extractor: matsci,
      },
    ];
    const axios = (await import('axios')).default;
    const getSpy = vi.spyOn(axios, 'get').mockResolvedValue({ data: '<html></html>' } as any);

    const scraper = new DepartmentRosterScraper(configs);
    const { ctx, emitted } = makeContext();
    await scraper.run(ctx);

    const userKeys = new Set(
      emitted.filter((o) => o.entityType === 'user').map((o) => o.entityKey),
    );
    expect([...userKeys]).toEqual(['dept:meng-matsci:jamie-meng-matsci']);

    getSpy.mockRestore();
  });

  it('collapses cross-listed MEMS faculty with an off-site lab into one research entity across both sub-rosters', async () => {
    const meng = vi.fn((): FacultyEntry[] => [
      { name: 'Jamie Meng-Matsci', labUrl: 'https://jamielab.example.org' },
    ]);
    const matsci = vi.fn((): FacultyEntry[] => [
      { name: 'Jamie Meng-Matsci', labUrl: 'https://jamielab.example.org' },
    ]);
    const configs: DeptConfig[] = [
      {
        deptKey: 'mechanical-engineering',
        deptName: 'Mechanical Engineering & Materials Science',
        schoolName: 'Yale School of Engineering & Applied Science',
        url: 'https://example.invalid/mechanical-engineering',
        paginated: false,
        extractor: meng,
      },
      {
        deptKey: 'materials-science',
        deptName: 'Mechanical Engineering & Materials Science',
        schoolName: 'Yale School of Engineering & Applied Science',
        url: 'https://example.invalid/materials-science',
        paginated: false,
        extractor: matsci,
      },
    ];
    const axios = (await import('axios')).default;
    const getSpy = vi.spyOn(axios, 'get').mockResolvedValue({ data: '<html></html>' } as any);

    const scraper = new DepartmentRosterScraper(configs);
    const { ctx, emitted } = makeContext();
    await scraper.run(ctx);

    const researchEntityKeys = new Set(
      emitted.filter((o) => o.entityType === 'researchEntity').map((o) => o.entityKey),
    );
    expect([...researchEntityKeys]).toEqual(['dept-meng-matsci-jamie-meng-matsci']);

    getSpy.mockRestore();
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
    expect(
      emitted.filter((o) => o.entityType === 'researchEntity' && o.field === 'websiteUrl'),
    ).toHaveLength(1);
  });

  it('does not derive publication observations from official profile bios', async () => {
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
      emitted.find((o) => o.entityType === 'user' && o.field === 'officialProfilePublications'),
    ).toBeUndefined();
    expect(emitted.find((o) => o.entityType === 'user' && o.field === 'bio')).toBeDefined();
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
    const htmlFetcher = vi.fn(
      async () => `
      <html><head><link rel="canonical" href="/faculty/grace-hopper" /></head>
      <body><a href="https://hoppersystems.yale.edu">Research Group Website</a></body></html>
    `,
    );
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
    const rosterHealth = emitted.filter((o) => o.entityType === 'departmentRosterHealth');
    expect(emitted.filter((o) => o.entityType !== 'departmentRosterHealth')).toEqual([]);
    expect(rosterHealth).toHaveLength(1);
    expect(rosterHealth[0].value).toMatchObject({
      deptKey: 'cs',
      status: 'rendered-unavailable',
      complete: false,
      discoveredCount: 0,
    });
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

describe('profileBelongsToRosterPerson (#2437)', () => {
  it('accepts a profile whose declared name shares a surname with the roster row', () => {
    expect(
      profileBelongsToRosterPerson({
        rosterName: 'Robin Roster',
        profileUrl: 'https://medicine.yale.edu/profile/robin-roster/',
        profileDeclaredName: 'Robin Roster, MD',
      }),
    ).toBe(true);
  });

  // The dean case from #2385: a real Yale person on a real *.yale.edu page that
  // is not this row's profile. Host-level checks cannot tell these apart.
  it('refuses a page that declares a different real person', () => {
    expect(
      profileBelongsToRosterPerson({
        rosterName: 'Robin Roster',
        profileUrl: 'https://medicine.yale.edu/about/',
        profileDeclaredName: 'Nancy Brown',
      }),
    ).toBe(false);
  });

  // A colleague who merely shares a GIVEN name is the same wrong-subject merge as
  // the dean page: the roster row's own surname has to be on the page.
  it('refuses a page whose declared name shares only a given name', () => {
    expect(
      profileBelongsToRosterPerson({
        rosterName: 'Nancy Ruddle',
        profileUrl: 'https://medicine.yale.edu/about/',
        profileDeclaredName: 'Nancy Brown',
      }),
    ).toBe(false);
  });

  // An accent-rendering difference between the roster row and the profile page is
  // still the same person, so folding keeps legitimate enrichment.
  it('accepts a declared name that differs from the roster row only by accents', () => {
    expect(
      profileBelongsToRosterPerson({
        rosterName: 'Jose Martinez',
        profileUrl: 'https://medicine.yale.edu/profile/jm88/',
        profileDeclaredName: 'José Martínez',
      }),
    ).toBe(true);
  });

  // The namePlaceholder path is the ONE case where a wrong fetch RENAMES the row
  // rather than only gap-filling it, because mergeProfileEnrichment adopts the
  // fetched name when the roster row is a slug placeholder. A slug placeholder
  // still carries the person's tokens, so the guard can still judge it.
  it('refuses a foreign page for a slug-placeholder roster row', () => {
    expect(
      profileBelongsToRosterPerson({
        rosterName: 'robin-roster',
        profileUrl: 'https://medicine.yale.edu/about/',
        profileDeclaredName: 'Nancy Brown',
      }),
    ).toBe(false);
  });

  it('accepts a slug-placeholder row whose own profile declares the same person', () => {
    expect(
      profileBelongsToRosterPerson({
        rosterName: 'robin-roster',
        profileUrl: 'https://architecture.yale.edu/faculty/123-robin-roster',
        profileDeclaredName: 'Robin Roster',
      }),
    ).toBe(true);
  });

  // Falls back to the URL leaf only when the page declares no usable name, so an
  // opaque-slug profile is not refused merely for being opaque.
  it('falls back to the URL leaf when the page declares no name', () => {
    expect(
      profileBelongsToRosterPerson({
        rosterName: 'Robin Roster',
        profileUrl: 'https://ling.yale.edu/people/robin-roster',
        profileDeclaredName: undefined,
      }),
    ).toBe(true);
    expect(
      profileBelongsToRosterPerson({
        rosterName: 'Robin Roster',
        profileUrl: 'https://medicine.yale.edu/about/',
        profileDeclaredName: undefined,
      }),
    ).toBe(false);
  });

  // An OPAQUE leaf is absence of evidence, not evidence of another subject. On
  // Development 22 of 3,804 official profile links are netid or concatenated
  // surname slugs belonging to exactly the person named, so refusing them would
  // drop good enrichment for no safety gain.
  it('allows an opaque netid or concatenated-surname slug', () => {
    for (const opaque of [
      'https://medicine.yale.edu/profile/pf93/',
      'https://medicine.yale.edu/profile/SED7/',
      'https://medicine.yale.edu/profile/maria-rodriguezmartinez/',
    ]) {
      expect(
        profileBelongsToRosterPerson({
          rosterName: 'Peter Fonagy',
          profileUrl: opaque,
          profileDeclaredName: undefined,
        }),
      ).toBe(true);
    }
  });

  // A SECTION leaf is positive evidence the page is not one person's profile.
  it('refuses a section or landing-page leaf when no name is declared', () => {
    for (const section of [
      'https://medicine.yale.edu/about/',
      'https://medicine.yale.edu/about/leadership/',
      'https://wanglab.yale.edu/welcome',
      'https://konezny.sites.yale.edu/welcome',
    ]) {
      expect(
        profileBelongsToRosterPerson({
          rosterName: 'Robin Roster',
          profileUrl: section,
          profileDeclaredName: undefined,
        }),
      ).toBe(false);
    }
  });

  // A department or section landing page names nobody and is not person-scoped, so
  // it cannot be enumerated as a section word - the URL shape has to carry it.
  it('refuses a department landing page whose leaf is not a known section word', () => {
    for (const landing of [
      'https://medicine.yale.edu/psychiatry/',
      'https://medicine.yale.edu/specialties/vascular/',
      'https://medicine.yale.edu/education/',
    ]) {
      expect(
        profileBelongsToRosterPerson({
          rosterName: 'Robin Roster',
          profileUrl: landing,
          profileDeclaredName: undefined,
        }),
      ).toBe(false);
    }
  });

  // A personal Yale site is named by its host label, not its path.
  it('accepts a personal site whose host label names the roster person', () => {
    expect(
      profileBelongsToRosterPerson({
        rosterName: 'Paul Konezny',
        profileUrl: 'https://konezny.sites.yale.edu/',
        profileDeclaredName: undefined,
      }),
    ).toBe(true);
  });

  it('refuses when the roster row carries no usable identity tokens', () => {
    expect(
      profileBelongsToRosterPerson({
        rosterName: '',
        profileUrl: 'https://medicine.yale.edu/profile/robin-roster/',
        profileDeclaredName: 'Robin Roster',
      }),
    ).toBe(false);
  });
});
