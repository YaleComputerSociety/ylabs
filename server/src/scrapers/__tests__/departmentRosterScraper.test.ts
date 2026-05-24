/**
 * Unit tests for DepartmentRosterScraper extractors and helpers.
 *
 * The HTML snippets embedded below are minimal but structurally faithful to the
 * live pages — selectors and class names match what the real Drupal/MCDB themes
 * emit. We deliberately do NOT touch the network: the scraper class itself is
 * exercised with an in-memory config whose extractor returns canned rows.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  DepartmentRosterScraper,
  DEFAULT_DEPT_CONFIGS,
  econExtractor,
  mcdbExtractor,
  psychExtractor,
  csJsRenderedStub,
  csRenderedExtractor,
  csFacultyDataExtractor,
  engineeringFacultyDirectoryDataExtractor,
  mergeDepartmentRosterUserObservations,
  profileEnrichmentFromHtml,
  type DeptConfig,
  type FacultyEntry,
} from '../sources/departmentRosterScraper';
import {
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
        <a href="/people/sam-example"><span>Sam Example</span></a>
      </div>
      <div class="node-teaser__professional-title">
        <span>Departmental Chair and Named Professor of Economics</span>
      </div>
    </article>
    <article class="node-teaser node-teaser--person node-teaser--vertical">
      <div class="node-teaser__heading">
        <a href="/people/blake-example"><span>Blake Example</span></a>
      </div>
      <div class="node-teaser__professional-title">
        <span>Professor of Economics</span>
      </div>
    </article>
    <article class="node-teaser node-teaser--person node-teaser--vertical">
      <div class="node-teaser__heading">
        <a href="/people/casey-example"><span>Casey Example</span></a>
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
        <a class="directory-listing-card__heading-link" href="/profile/morgan-cell-phd">
          Morgan Cell, Ph.D.
        </a>
      </h3>
      <div class="directory-listing-card__subheading">
        <div>Associate Professor of Molecular, Cellular &amp; Developmental Biology with Tenure</div>
      </div>
      <a class="directory-listing-card__link" href="mailto:morgan.cell@yale.edu">Email</a>
      <a class="directory-listing-card__link" href="https://celllab.yale.edu">Lab Website</a>
    </div>
  </div>
  <div class="directory-listing-card">
    <div class="directory-listing-card__content">
      <h3 class="directory-listing-card__heading">
        <a class="directory-listing-card__heading-link" href="/profile/blake-reed-phd">
          Blake Reed, Ph.D.
        </a>
      </h3>
      <div class="directory-listing-card__subheading">
        <div>Senior Professor of MCDB</div>
      </div>
      <a class="directory-listing-card__link" href="mailto:blake.reed@yale.edu">Email</a>
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
          <a href="/people/riley-cognition" class="username">Riley Cognition</a>
        </td>
        <td class="views-field views-field-field-phone">203-432-9626</td>
        <td class="views-field views-field-mail">
          <a href="mailto:riley.cognition@yale.edu">riley.cognition@yale.edu</a>
        </td>
        <td class="views-field views-field-field-office">100 College St.</td>
        <td class="views-field views-field-edit-node"></td>
      </tr>
      <tr class="even">
        <td class="views-field views-field-name">
          <a href="/people/taylor-social">Taylor Social</a>
        </td>
        <td class="views-field views-field-field-phone">203-432-1111</td>
        <td class="views-field views-field-mail">
          <a href="mailto:taylor.social@yale.edu">taylor.social@yale.edu</a>
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
          <a href="/people/fixture-person">Fixture Person</a>
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
          <a href="/people/riley-cognition"><img alt="Riley Cognition's picture" /></a>
        </td>
        <td class="views-field views-field-name">
          <a href="/people/riley-cognition" title="View user profile." class="username">Riley Cognition</a><br />
          Professor of Psychology<br />
          100 College St.<br />
          <a href="mailto:riley.cognition@yale.edu">riley.cognition@yale.edu</a><br />
          Phone: 203-432-9626<br />
          <a href="http://cognitionlab.yale.edu/" target="_blank">Website</a>
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
              <a href="/people/casey-astro"><img alt="Casey Astro's picture" /></a>
            </span>
          </div>
          <div class="views-field views-field-name">
            <span class="field-content">Casey Astro</span>
          </div>
          <div class="views-field views-field-field-title">
            <div class="field-content">Professor of Astronomy</div>
          </div>
          <div class="views-field views-field-mail">
            <span class="field-content">
              <a href="mailto:casey.astro@yale.edu">casey.astro@yale.edu</a>
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

// ---------------------------------------------------------------------------
// Helper tests
// ---------------------------------------------------------------------------

describe('slugify', () => {
  it('lowercases and dash-separates', () => {
    expect(slugify('Sam Example')).toBe('sam-example');
  });
  it('strips diacritics', () => {
    expect(slugify('Béatrice Müller')).toBe('beatrice-muller');
  });
  it("strips possessive 's", () => {
    expect(slugify("Fixture Lab's Team")).toBe('fixture-lab-team');
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
    expect(netidFromEmail('riley.cognition@yale.edu')).toBe('riley.cognition');
  });
  it('strips a mailto: prefix', () => {
    expect(netidFromEmail('mailto:fx123@yale.edu')).toBe('fx123');
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

describe('normalizeName', () => {
  it('strips trailing Ph.D. credentials', () => {
    expect(normalizeName('Blake Reed, Ph.D.')).toBe('Blake Reed');
    expect(normalizeName('Fixture Person, M.D.')).toBe('Fixture Person');
  });
  it('strips leading honorifics', () => {
    expect(normalizeName('Prof. Foo Bar')).toBe('Foo Bar');
    expect(normalizeName('Dr Fixture')).toBe('Fixture');
  });
  it('collapses whitespace', () => {
    expect(normalizeName('  Foo   Bar  ')).toBe('Foo Bar');
  });
  it('returns empty on empty input', () => {
    expect(normalizeName('')).toBe('');
    expect(normalizeName(null)).toBe('');
  });
});

describe('profileEnrichmentFromHtml', () => {
  it('extracts YaleSites CTA lab links from official faculty profiles', async () => {
    const { profileEnrichmentFromHtml } = await import('../sources/departmentRosterScraper');
    const enrichment = profileEnrichmentFromHtml(
      `
      <html>
        <head>
          <link rel="canonical" href="https://mcdb.yale.edu/profile/morgan-example-phd" />
          <meta property="og:email" content="morgan.example@yale.edu" />
        </head>
        <body>
          <main>
            <a
              data-cta-control-type="link"
              data-link-type="external"
              href="https://examplelab.yale.edu/"
              class="cta"
            >
              Example Lab
            </a>
          </main>
        </body>
      </html>
      `,
      'https://mcdb.yale.edu/profile/morgan-example-phd',
    );

    expect(enrichment.labUrl).toBe('https://examplelab.yale.edu/');
  });

  it('does not treat profile link chrome plus address text as a bio', async () => {
    const { profileEnrichmentFromHtml } = await import('../sources/departmentRosterScraper');
    const enrichment = profileEnrichmentFromHtml(
      `
      <html>
        <head>
          <link rel="canonical" href="https://statistics.yale.edu/profile/jordan-example" />
        </head>
        <body>
          <main>
            <p>
              <a href="https://jordan-example.example.org/">Jordan Example’s website(Link is external) (Link opens in new window)</a>
            </p>
            <p>Example HallRoom 101100 Fixture StreetNew Haven, CT 06511</p>
          </main>
        </body>
      </html>
      `,
      'https://statistics.yale.edu/profile/jordan-example',
    );

    expect(enrichment.bio).toBeUndefined();
  });

  it('trims trailing website labels from official profile prose bios', async () => {
    const { profileEnrichmentFromHtml } = await import('../sources/departmentRosterScraper');
    const enrichment = profileEnrichmentFromHtml(
      `
      <html>
        <head>
          <link rel="canonical" href="https://medicine.yale.edu/profile/avery-data/" />
        </head>
        <body>
          <main>
            <div class="profile-body">
              Dr. Avery Data leads a research group applying machine learning methods to big biomedical data.
              His group develops algorithms for discovering hidden structure in high-dimensional data.Website: datalab.example.org
            </div>
          </main>
        </body>
      </html>
      `,
      'https://medicine.yale.edu/profile/avery-data/',
    );

    expect(enrichment.bio).toBe(
      'Dr. Avery Data leads a research group applying machine learning methods to big biomedical data. His group develops algorithms for discovering hidden structure in high-dimensional data.',
    );
  });

  it('repairs missing sentence spacing in official profile bios', async () => {
    const { profileEnrichmentFromHtml } = await import('../sources/departmentRosterScraper');
    const enrichment = profileEnrichmentFromHtml(
      `
      <html>
        <head>
          <script data-schema="ProfilePage" type="application/ld+json">
            {
              "@type": "ProfilePage",
              "mainEntity": {
                "@type": "Person",
                "description": "Prior to joining Yale, Dr. Example trained at a research center.Dr. Example studies climate and health."
              }
            }
          </script>
        </head>
      </html>
      `,
      'https://medicine.yale.edu/lab/example/profile/example/',
    );

    expect(enrichment.bio).toBe(
      'Prior to joining Yale, Dr. Example trained at a research center. Dr. Example studies climate and health.',
    );
  });
});

describe('splitName', () => {
  it('splits two-word name', () => {
    expect(splitName('Sam Example')).toEqual({ first: 'Sam', last: 'Example' });
  });
  it('keeps suffix with last name', () => {
    expect(splitName('Example Person Jr.')).toEqual({ first: 'Example', last: 'Person Jr.' });
  });
  it('handles single-word name', () => {
    expect(splitName('Madonna')).toEqual({ first: 'Madonna', last: '' });
  });
  it('handles three-word name', () => {
    expect(splitName('Fixture Middle Person')).toEqual({ first: 'Fixture Middle', last: 'Person' });
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
      name: 'Sam Example',
      title: 'Departmental Chair and Named Professor of Economics',
      profileUrl: 'https://economics.yale.edu/people/sam-example',
    });
    expect(out[1].name).toBe('Blake Example');
    expect(out[2].name).toBe('Casey Example');
    expect(out[2].title).toBeUndefined();
  });

  it('returns an empty array on a page with no person teasers', () => {
    const out = econExtractor('<html><body><p>Nothing</p></body></html>', {
      pageUrl: 'https://economics.yale.edu/people?page=99',
    });
    expect(out).toEqual([]);
  });
});

describe('mcdbExtractor', () => {
  it('extracts cards with name, title, email, optional lab URL', () => {
    const out = mcdbExtractor(MCDB_HTML, { pageUrl: 'https://mcdb.yale.edu/people/faculty' });
    expect(out).toHaveLength(2); // empty card skipped
    expect(out[0]).toMatchObject({
      name: 'Morgan Cell, Ph.D.',
      email: 'morgan.cell@yale.edu',
      labUrl: 'https://celllab.yale.edu',
      profileUrl: 'https://mcdb.yale.edu/profile/morgan-cell-phd',
    });
    expect(out[0].title).toContain('Associate Professor');
    expect(out[1]).toMatchObject({
      name: 'Blake Reed, Ph.D.',
      email: 'blake.reed@yale.edu',
    });
    expect(out[1].labUrl).toBeUndefined();
  });
});

describe('official Yale profile-card extractor coverage', () => {
  it('supports the Math and Statistics profile-card shape', () => {
    const html = `
      <html><body>
        <div class="directory-listing-card">
          <div class="directory-listing-card__content">
            <h3 class="directory-listing-card__heading">
              <a class="directory-listing-card__heading-link" href="/profile/avery-algebra">
                Avery Algebra
              </a>
            </h3>
            <div class="directory-listing-card__subheading">Professor of Mathematics</div>
            <div class="directory-listing-card__snippet">Algebraic geometry and topology.</div>
            <a class="directory-listing-card__link" href="mailto:avery.algebra@yale.edu">Email</a>
          </div>
        </div>
      </body></html>
    `;

    const out = mcdbExtractor(html, { pageUrl: 'https://math.yale.edu/people/faculty' });

    expect(out).toEqual([
      {
        name: 'Avery Algebra',
        profileUrl: 'https://math.yale.edu/profile/avery-algebra',
        title: 'Professor of Mathematics',
        email: 'avery.algebra@yale.edu',
        labUrl: undefined,
        bio: 'Algebraic geometry and topology.',
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
      name: 'Riley Cognition',
      email: 'riley.cognition@yale.edu',
      profileUrl: 'https://psychology.yale.edu/people/riley-cognition',
    });
    expect(out[1].name).toBe('Taylor Social');
    expect(out[2]).toMatchObject({ name: 'Fixture Person' });
    expect(out[2].email).toBeUndefined();
  });

  it('extracts the current primary-faculty view with embedded email and website links', () => {
    const out = psychExtractor(PSYCH_PRIMARY_HTML, {
      pageUrl: 'https://psychology.yale.edu/people/faculty/primary',
    });

    expect(out).toEqual([
      {
        name: 'Riley Cognition',
        title: 'Professor of Psychology',
        email: 'riley.cognition@yale.edu',
        profileUrl: 'https://psychology.yale.edu/people/riley-cognition',
        labUrl: 'http://cognitionlab.yale.edu/',
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
                <a href="/people/morgan-physics" class="username">Morgan Physics</a><br />
                Professor of Physics<br />
                <a href="mailto:morgan.physics@yale.edu">morgan.physics@yale.edu</a><br />
                <a href="https://physicslab.yale.edu/">Research Website</a>
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
        name: 'Morgan Physics',
        title: 'Professor of Physics',
        email: 'morgan.physics@yale.edu',
        profileUrl: 'https://physics.yale.edu/people/morgan-physics',
        labUrl: 'https://physicslab.yale.edu/',
        topics: ['Condensed Matter', 'Quantum Materials'],
        researchInterests: ['Condensed Matter', 'Quantum Materials'],
      },
    ]);
  });

  it('supports Astronomy views grid cells with profile picture links and topic fields', () => {
    const out = psychExtractor(ASTRONOMY_GRID_HTML, {
      pageUrl: 'https://astronomy.yale.edu/people/faculty',
    });

    expect(out).toEqual([
      {
        name: 'Casey Astro',
        title: 'Professor of Astronomy',
        email: 'casey.astro@yale.edu',
        profileUrl: 'https://astronomy.yale.edu/people/casey-astro',
        labUrl: undefined,
        topics: ['Star Formation and ISM'],
        researchInterests: ['Star Formation and ISM'],
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
          <a href="/faculty/riley-computing">Riley Computing</a>
          <div class="person-title">Professor of Computer Science</div>
          <a href="mailto:riley.computing@yale.edu">Email</a>
        </article>
        <article>
          <a href="/faculty/riley-computing">Riley Computing</a>
        </article>
      </main>
    `;
    const out = csRenderedExtractor(html, { pageUrl: 'https://engineering.yale.edu/cs/faculty' });

    expect(out).toEqual([
      {
        name: 'Riley Computing',
        profileUrl: 'https://engineering.yale.edu/faculty/riley-computing',
        title: 'Professor of Computer Science',
        email: 'riley.computing@yale.edu',
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
                name: 'Riley Computing',
                title: 'Professor',
                fullTitle: 'Professor of Computer Science',
                url: '/academic-study/departments/computer-science/faculty/riley-computing',
              },
              {
                name: 'Avery Data',
                title: 'Assistant Professor',
                fullTitle: 'Assistant Professor of Computer Science',
                url: 'https://www.datalab.example.org/',
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
        name: 'Riley Computing',
        title: 'Professor of Computer Science',
        profileUrl:
          'https://engineering.yale.edu/academic-study/departments/computer-science/faculty/riley-computing',
        labUrl: undefined,
      },
      {
        name: 'Avery Data',
        title: 'Assistant Professor of Computer Science',
        profileUrl: 'https://www.datalab.example.org/',
        labUrl: 'https://www.datalab.example.org/',
      },
    ]);
  });
});

describe('engineeringFacultyDirectoryDataExtractor', () => {
  it('extracts non-CS Engineering faculty and inferred departments from the all-faculty endpoint', () => {
    const out = engineeringFacultyDirectoryDataExtractor(
      {
        pages: {
          letters: {
            A: [
              {
                name: 'Casey Applied',
                fullTitle: 'Named Professor of Applied Physics & Materials Science',
                url: '/research-and-faculty/faculty-directory/casey-applied',
              },
              {
                name: 'Morgan Mechanics',
                fullTitle: 'Named Professor of Mechanical Engineering',
                url: '/research-and-faculty/faculty-directory/morgan-mechanics',
              },
              {
                name: 'Jordan Systems',
                fullTitle: 'Named Professor of Computer Science',
                url: '/research-and-faculty/faculty-directory/jordan-systems',
              },
              {
                name: 'Taylor Circuits',
                fullTitle: 'Assistant Professor of Electrical & Computer Engineering',
                url: '/research-and-faculty/faculty-directory/taylor-circuits',
              },
            ],
          },
        },
      },
      {
        pageUrl:
          'https://engineering.yale.edu/research-and-faculty/faculty-directory/load_faculty/172',
      },
    );

    expect(out).toEqual([
      {
        name: 'Casey Applied',
        title: 'Named Professor of Applied Physics & Materials Science',
        profileUrl: 'https://engineering.yale.edu/research-and-faculty/faculty-directory/casey-applied',
        labUrl: undefined,
        departments: ['Applied Physics', 'Mechanical Engineering & Materials Science'],
      },
      {
        name: 'Morgan Mechanics',
        title: 'Named Professor of Mechanical Engineering',
        profileUrl:
          'https://engineering.yale.edu/research-and-faculty/faculty-directory/morgan-mechanics',
        labUrl: undefined,
        departments: ['Mechanical Engineering & Materials Science'],
      },
      {
        name: 'Taylor Circuits',
        title: 'Assistant Professor of Electrical & Computer Engineering',
        profileUrl:
          'https://engineering.yale.edu/research-and-faculty/faculty-directory/taylor-circuits',
        labUrl: undefined,
        departments: ['Electrical & Computer Engineering'],
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Scraper orchestration test (no network — extractor returns canned rows)
// ---------------------------------------------------------------------------

describe('mergeDepartmentRosterUserObservations', () => {
  it('merges cross-listed faculty user observations before run emission', () => {
    const observations = mergeDepartmentRosterUserObservations([
      {
        entityType: 'user',
        entityKey: 'netid:avery.crosslist',
        field: 'departments',
        value: ['Mathematics'],
        sourceUrl: 'https://math.yale.edu/people/faculty',
      },
      {
        entityType: 'user',
        entityKey: 'netid:avery.crosslist',
        field: 'departments',
        value: ['Statistics & Data Science'],
        sourceUrl: 'https://statistics.yale.edu/people/faculty',
      },
      {
        entityType: 'user',
        entityKey: 'netid:avery.crosslist',
        field: 'primaryDepartment',
        value: 'Mathematics',
        sourceUrl: 'https://math.yale.edu/people/faculty',
      },
      {
        entityType: 'user',
        entityKey: 'netid:avery.crosslist',
        field: 'primaryDepartment',
        value: 'Statistics & Data Science',
        sourceUrl: 'https://statistics.yale.edu/people/faculty',
      },
      {
        entityType: 'user',
        entityKey: 'netid:avery.crosslist',
        field: 'profileUrls',
        value: { departmental: 'https://math.yale.edu/profile/avery-crosslist' },
        sourceUrl: 'https://math.yale.edu/profile/avery-crosslist',
      },
      {
        entityType: 'user',
        entityKey: 'netid:avery.crosslist',
        field: 'profileUrls',
        value: { departmental: 'https://statistics.yale.edu/profile/avery-crosslist' },
        sourceUrl: 'https://statistics.yale.edu/profile/avery-crosslist',
      },
    ]);

    expect(observations.filter((o) => o.field === 'departments')).toHaveLength(1);
    expect(observations.find((o) => o.field === 'departments')?.value).toEqual([
      'Mathematics',
      'Statistics & Data Science',
    ]);
    expect(observations.filter((o) => o.field === 'primaryDepartment')).toHaveLength(1);
    expect(observations.find((o) => o.field === 'profileUrls')?.value).toEqual({
      departmental: 'https://math.yale.edu/profile/avery-crosslist',
      departmental2: 'https://statistics.yale.edu/profile/avery-crosslist',
    });
  });
});

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
  it('skips JS-rendered depts and only invokes extractors for matching only-filter', async () => {
    const cannedExtractor = vi.fn(
      (): FacultyEntry[] => [
        {
          name: 'Test Faculty',
          title: 'Professor of Economics',
          email: 'tf123@yale.edu',
          labUrl: 'https://tflab.example.org',
        },
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
    expect(labObs.find((o) => o.field === 'departments')?.value).toEqual(['Economics']);
    expect(labObs[0].entityKey).toMatch(/^dept-econ-test-faculty/);

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

  it('honors offset before limit across department roster entries', async () => {
    const manyEntries = (count: number): FacultyEntry[] =>
      Array.from({ length: count }, (_v, i) => ({
        name: `Person ${i}`,
        email: `person${i}@yale.edu`,
      }));
    const configs: DeptConfig[] = [
      {
        deptKey: 'econ',
        deptName: 'Economics',
        schoolName: 'FAS',
        url: 'https://example.invalid/econ',
        paginated: false,
        extractor: () => manyEntries(5),
      },
    ];
    const axios = (await import('axios')).default;
    const getSpy = vi.spyOn(axios, 'get').mockResolvedValue({ data: '<html></html>' } as any);

    const scraper = new DepartmentRosterScraper(configs);
    const { ctx, emitted } = makeContext({ offset: 2, limit: 2 });
    await scraper.run(ctx);

    const userKeys = Array.from(
      new Set(emitted.filter((o) => o.entityType === 'user').map((o) => o.entityKey)),
    );
    expect(userKeys).toEqual(['netid:person2', 'netid:person3']);

    getSpy.mockRestore();
  });

  it('emits entry-specific Engineering departments from data endpoint rows', async () => {
    const configs: DeptConfig[] = [
      {
        deptKey: 'seas',
        deptName: 'Yale Engineering',
        schoolName: 'Yale School of Engineering & Applied Science',
        url: 'https://example.invalid/seas',
        paginated: false,
        extractor: () => [
          {
            name: 'Faculty One',
            title: 'Professor of Biomedical Engineering',
            email: 'faculty.one@yale.edu',
            departments: ['Biomedical Engineering'],
          },
        ],
      },
    ];
    const axios = (await import('axios')).default;
    const getSpy = vi.spyOn(axios, 'get').mockResolvedValue({ data: '<html></html>' } as any);
    const scraper = new DepartmentRosterScraper(configs, null, async () => '<html></html>');
    const { ctx, emitted } = makeContext();

    await scraper.run(ctx);

    const userDepartments = emitted.find(
      (o) => o.entityType === 'user' && o.field === 'departments',
    )?.value;
    const userPrimary = emitted.find(
      (o) => o.entityType === 'user' && o.field === 'primaryDepartment',
    )?.value;
    expect(userDepartments).toEqual(['Biomedical Engineering']);
    expect(userPrimary).toBe('Biomedical Engineering');

    getSpy.mockRestore();
  });

  it('counts the limit by unique emitted users and avoids duplicate profile fetches', async () => {
    const configs: DeptConfig[] = [
      {
        deptKey: 'mcdb',
        deptName: 'Molecular, Cellular and Developmental Biology',
        schoolName: 'FAS',
        url: 'https://example.invalid/mcdb',
        paginated: false,
        extractor: () => [
          {
            name: 'Avery Professor',
            title: 'Professor of Molecular Biology',
            email: 'avery.professor@yale.edu',
            profileUrl: 'https://mcdb.yale.edu/profile/avery',
          },
          {
            name: 'Avery Professor',
            title: 'Professor of Molecular Biology',
            email: 'avery.professor@yale.edu',
            profileUrl: 'https://mcdb.yale.edu/profile/avery',
          },
          {
            name: 'Blair Professor',
            title: 'Professor of Molecular Biology',
            email: 'blair.professor@yale.edu',
            profileUrl: 'https://mcdb.yale.edu/profile/blair',
          },
        ],
      },
    ];
    const htmlFetcher = vi.fn(async () => '<html></html>');
    const scraper = new DepartmentRosterScraper(configs, null, htmlFetcher);
    const { ctx, emitted } = makeContext({ limit: 2 });

    await scraper.run(ctx);

    const userKeys = new Set(
      emitted.filter((o) => o.entityType === 'user').map((o) => o.entityKey),
    );
    expect(userKeys).toEqual(new Set(['netid:avery.professor', 'netid:blair.professor']));
    const profileFetchUrls = (htmlFetcher.mock.calls as unknown[][])
      .map((call) => String(call[0] || ''))
      .filter((url) => url.includes('/profile/'));
    expect(profileFetchUrls).toEqual([
      'https://mcdb.yale.edu/profile/avery',
      'https://mcdb.yale.edu/profile/blair',
    ]);
  });

  it('uses synthetic entityKey when no yale email is available', async () => {
    const configs: DeptConfig[] = [
      {
        deptKey: 'psych',
        deptName: 'Psychology',
        schoolName: 'FAS',
        url: 'https://example.invalid/psych',
        paginated: false,
        extractor: () => [{ name: 'Fixture Person' }],
      },
    ];
    const axios = (await import('axios')).default;
    const getSpy = vi.spyOn(axios, 'get').mockResolvedValue({ data: '<html></html>' } as any);

    const scraper = new DepartmentRosterScraper(configs);
    const { ctx, emitted } = makeContext();
    await scraper.run(ctx);

    const userObs = emitted.filter((o) => o.entityType === 'user');
    expect(userObs[0].entityKey).toBe('dept:psych:fixture-person');
    expect(userObs.find((o) => o.field === 'netid')).toBeUndefined();

    getSpy.mockRestore();
  });

  it('does not create lab entities for non-owner roster roles with lab URLs', async () => {
    const configs: DeptConfig[] = [
      {
        deptKey: 'mcdb',
        deptName: 'Molecular, Cellular and Developmental Biology',
        schoolName: 'FAS',
        url: 'https://example.invalid/mcdb',
        paginated: false,
        extractor: () => [
          {
            name: 'Paula Student',
            title: 'PhD Student',
            email: 'paula.student@yale.edu',
            labUrl: 'https://studentlab.example.org',
          },
          {
            name: 'Liam Operations',
            title: 'Lab Manager',
            email: 'liam.operations@yale.edu',
            labUrl: 'https://managerlab.example.org',
          },
          {
            name: 'Avery Assistant',
            title: 'Senior Administrative Assistant',
            email: 'avery.assistant@yale.edu',
            labUrl: 'https://assistantlab.example.org',
          },
          {
            name: 'Priya Postdoc',
            title: 'Postdoctoral Associate',
            email: 'priya.postdoc@yale.edu',
            labUrl: 'https://postdoclab.example.org',
          },
          {
            name: 'Riley Scientist',
            title: 'Research Scientist',
            email: 'riley.scientist@yale.edu',
            labUrl: 'https://scientistlab.example.org',
          },
        ],
      },
    ];
    const axios = (await import('axios')).default;
    const getSpy = vi.spyOn(axios, 'get').mockResolvedValue({ data: '<html></html>' } as any);

    const scraper = new DepartmentRosterScraper(configs);
    const { ctx, emitted } = makeContext();
    await scraper.run(ctx);

    const userObs = emitted.filter((o) => o.entityType === 'user');
    const labObs = emitted.filter((o) => o.entityType === 'researchEntity');
    expect(userObs.length).toBeGreaterThan(0);
    expect(new Set(userObs.map((o) => o.entityKey))).toEqual(
      new Set([
        'netid:paula.student',
        'netid:liam.operations',
        'netid:avery.assistant',
        'netid:priya.postdoc',
        'netid:riley.scientist',
      ]),
    );
    const userTypeFor = (entityKey: string) =>
      userObs.find((o) => o.entityKey === entityKey && o.field === 'userType')?.value;
    expect(userTypeFor('netid:paula.student')).toBe('staff');
    expect(userTypeFor('netid:liam.operations')).toBe('staff');
    expect(userTypeFor('netid:avery.assistant')).toBe('staff');
    expect(userTypeFor('netid:priya.postdoc')).toBe('staff');
    expect(userTypeFor('netid:riley.scientist')).toBe('unknown');
    expect(labObs).toHaveLength(0);
    expect(emitted.some((o) => o.field === 'inferredPiUserKey')).toBe(false);

    getSpy.mockRestore();
  });

  it('does not create lab entities for titleless roster rows with lab URLs', async () => {
    const configs: DeptConfig[] = [
      {
        deptKey: 'mcdb',
        deptName: 'Molecular, Cellular and Developmental Biology',
        schoolName: 'FAS',
        url: 'https://example.invalid/mcdb',
        paginated: false,
        extractor: () => [
          {
            name: 'Taylor Untitled',
            email: 'taylor.untitled@yale.edu',
            labUrl: 'https://untitledlab.example.org',
          },
        ],
      },
    ];
    const axios = (await import('axios')).default;
    const getSpy = vi.spyOn(axios, 'get').mockResolvedValue({ data: '<html></html>' } as any);

    const scraper = new DepartmentRosterScraper(configs);
    const { ctx, emitted } = makeContext();
    await scraper.run(ctx);

    const userObs = emitted.filter((o) => o.entityType === 'user');
    const labObs = emitted.filter((o) => o.entityType === 'researchEntity');
    expect(userObs.find((o) => o.field === 'userType')?.value).toBe('unknown');
    expect(userObs[0].entityKey).toBe('netid:taylor.untitled');
    expect(labObs).toHaveLength(0);
    expect(emitted.some((o) => o.field === 'inferredPiUserKey')).toBe(false);

    getSpy.mockRestore();
  });

  it('still creates lab entities for PI-like roster entries', async () => {
    const configs: DeptConfig[] = [
      {
        deptKey: 'mcdb',
        deptName: 'Molecular, Cellular and Developmental Biology',
        schoolName: 'FAS',
        url: 'https://example.invalid/mcdb',
        paginated: false,
        extractor: () => [
          {
            name: 'Avery Professor',
            title: 'Assistant Professor of Molecular Biology',
            email: 'avery.professor@yale.edu',
            labUrl: 'https://averylab.example.org',
          },
        ],
      },
    ];
    const axios = (await import('axios')).default;
    const getSpy = vi.spyOn(axios, 'get').mockResolvedValue({ data: '<html></html>' } as any);

    const scraper = new DepartmentRosterScraper(configs);
    const { ctx, emitted } = makeContext();
    await scraper.run(ctx);

    const labObs = emitted.filter((o) => o.entityType === 'researchEntity');
    expect(labObs.find((o) => o.field === 'name')?.value).toBe('Avery Professor Lab');
    expect(labObs.find((o) => o.field === 'inferredPiUserKey')?.value).toBe(
      'netid:avery.professor',
    );

    getSpy.mockRestore();
  });

  it('emits non-owner member observations when a non-PI entry names a known PI lab URL', async () => {
    const configs: DeptConfig[] = [
      {
        deptKey: 'mcdb',
        deptName: 'Molecular, Cellular and Developmental Biology',
        schoolName: 'FAS',
        url: 'https://example.invalid/mcdb',
        paginated: false,
        extractor: () => [
          {
            name: 'Avery Professor',
            title: 'Professor of Molecular Biology',
            email: 'avery.professor@yale.edu',
            labUrl: 'https://averylab.example.org',
          },
          {
            name: 'Riley Operations',
            title: 'Lab Manager',
            email: 'riley.operations@yale.edu',
            labUrl: 'https://averylab.example.org',
          },
          {
            name: 'Pat Student',
            title: 'PhD Student',
            email: 'pat.student@yale.edu',
            labUrl: 'https://averylab.example.org',
          },
        ],
      },
    ];
    const htmlFetcher = vi.fn(async () => '<html></html>');
    const scraper = new DepartmentRosterScraper(configs, null, htmlFetcher);
    const { ctx, emitted } = makeContext();

    await scraper.run(ctx);

    const labNames = emitted.filter(
      (o) => o.entityType === 'researchEntity' && o.field === 'name',
    );
    expect(labNames).toEqual([
      expect.objectContaining({
        entityKey: 'dept-mcdb-avery-professor',
        value: 'Avery Professor Lab',
      }),
    ]);

    const memberObs = emitted.filter((o) => o.entityType === 'researchGroupMember');
    expect(memberObs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityKey: 'dept-mcdb-avery-professor:netid:riley.operations',
          field: 'role',
          value: 'staff',
        }),
        expect.objectContaining({
          entityKey: 'dept-mcdb-avery-professor:netid:pat.student',
          field: 'role',
          value: 'grad-student',
        }),
      ]),
    );

    const fieldsFor = (entityKey: string) =>
      new Map(
        memberObs
          .filter((o) => o.entityKey === entityKey)
          .map((o) => [o.field, o.value]),
      );
    expect(fieldsFor('dept-mcdb-avery-professor:netid:riley.operations')).toEqual(
      new Map<string, unknown>([
        ['researchEntityKey', 'dept-mcdb-avery-professor'],
        ['userEntityKey', 'netid:riley.operations'],
        ['name', 'Riley Operations'],
        ['role', 'staff'],
        ['isCurrentMember', true],
        ['email', 'riley.operations@yale.edu'],
        ['title', 'Lab Manager'],
      ]),
    );
    expect(fieldsFor('dept-mcdb-avery-professor:netid:pat.student')).toEqual(
      new Map<string, unknown>([
        ['researchEntityKey', 'dept-mcdb-avery-professor'],
        ['userEntityKey', 'netid:pat.student'],
        ['name', 'Pat Student'],
        ['role', 'grad-student'],
        ['isCurrentMember', true],
        ['email', 'pat.student@yale.edu'],
        ['title', 'PhD Student'],
      ]),
    );
    expect(
      memberObs.some((o) => o.entityKey === 'dept-mcdb-avery-professor:netid:avery.professor'),
    ).toBe(false);
  });

  it('normalizes lab URLs before attaching non-owner member observations', async () => {
    const configs: DeptConfig[] = [
      {
        deptKey: 'mcdb',
        deptName: 'Molecular, Cellular and Developmental Biology',
        schoolName: 'FAS',
        url: 'https://example.invalid/mcdb',
        paginated: false,
        extractor: () => [
          {
            name: 'Avery Professor',
            title: 'Professor of Molecular Biology',
            email: 'avery.professor@yale.edu',
            labUrl: 'https://averylab.example.org/',
          },
          {
            name: 'Riley Operations',
            title: 'Lab Manager',
            email: 'riley.operations@yale.edu',
            labUrl: 'https://averylab.example.org',
          },
        ],
      },
    ];
    const htmlFetcher = vi.fn(async () => '<html></html>');
    const scraper = new DepartmentRosterScraper(configs, null, htmlFetcher);
    const { ctx, emitted } = makeContext();

    await scraper.run(ctx);

    const memberObs = emitted.filter((o) => o.entityType === 'researchGroupMember');
    expect(memberObs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityKey: 'dept-mcdb-avery-professor:netid:riley.operations',
          field: 'researchEntityKey',
          value: 'dept-mcdb-avery-professor',
        }),
      ]),
    );
  });

  it('follows official profile pages for canonical profile URLs and lab websites', async () => {
    const profileHtml = `
      <html><head>
        <link rel="canonical" href="/people/avery-algebra" />
      </head><body>
        <div class="person-title">Associate Professor of Applied Mathematics</div>
        <div class="profile-body">Avery works on computation, algebraic geometry, and foundations of mathematical modeling.</div>
        <div class="research-interests">Algebraic Geometry, Topology</div>
        <a href="https://orcid.org/0000-0000-0000-001X">ORCID</a>
        <a href="https://scholar.google.com/citations?user=averyCandidate">Google Scholar</a>
        <a href="mailto:avery.algebra@yale.edu">avery.algebra@yale.edu</a>
        <a href="https://algebralab.yale.edu">Lab Website</a>
        <img class="profile-photo" src="/sites/default/files/avery-algebra.jpg" alt="Avery Algebra" />
      </body></html>
    `;
    const htmlFetcher = vi.fn(async (url: string) => {
      if (url === 'https://math.yale.edu/people/avery-algebra') return profileHtml;
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
            name: 'Avery Algebra',
            profileUrl: 'https://math.yale.edu/people/avery-algebra',
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
      'https://math.yale.edu/people/avery-algebra',
      false,
      'dept-faculty-roster',
    );
    expect(result.entitiesObserved).toBe(2);

    const userObs = emitted.filter((o) => o.entityType === 'user');
    expect(userObs[0].entityKey).toBe('netid:avery.algebra');
    expect(userObs.find((o) => o.field === 'profileUrls')?.value).toEqual({
      departmental: 'https://math.yale.edu/people/avery-algebra',
    });
    expect(userObs.find((o) => o.field === 'title')?.value).toBe(
      'Associate Professor of Applied Mathematics',
    );
    expect(userObs.find((o) => o.field === 'website')?.value).toBe(
      'https://algebralab.yale.edu/',
    );
    expect(userObs.find((o) => o.field === 'imageUrl')?.value).toBe(
      'https://math.yale.edu/sites/default/files/avery-algebra.jpg',
    );
    expect(userObs.find((o) => o.field === 'orcid')?.value).toBe('0000-0000-0000-001X');
    expect(userObs.find((o) => o.field === 'bio')?.sourceUrl).toBe(
      'https://math.yale.edu/people/avery-algebra',
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
      'https://scholar.google.com/citations?user=averyCandidate',
    ]);
    expect(userObs.find((o) => o.field === 'googleScholarId')).toBeUndefined();
    expect(userObs.find((o) => o.field === 'profileUrls')?.value).not.toHaveProperty(
      'googleScholar',
    );

    const labObs = emitted.filter((o) => o.entityType === 'researchEntity');
    expect(labObs.find((o) => o.field === 'websiteUrl')?.value).toBe(
      'https://algebralab.yale.edu/',
    );
    expect(labObs.find((o) => o.field === 'description')).toBeUndefined();
    expect(labObs.find((o) => o.field === 'fullDescription')).toBeUndefined();
    expect(labObs.find((o) => o.field === 'shortDescription')).toBeUndefined();
    expect(labObs.find((o) => o.field === 'researchAreas')?.value).toEqual([
      'Algebraic Geometry',
      'Topology',
    ]);
    expect(labObs.find((o) => o.field === 'sourceUrls')?.value).toEqual([
      'https://math.yale.edu/people/faculty',
      'https://math.yale.edu/people/avery-algebra',
      'https://algebralab.yale.edu/',
    ]);
    expect(labObs.find((o) => o.field === 'inferredPiUserKey')?.value).toBe(
      'netid:avery.algebra',
    );
  });

  it('classifies personal faculty homepages as faculty research instead of labs', async () => {
    const profileHtml = `
      <html><body>
        <div class="person-title">Named Professor of Computer Science</div>
        <div class="profile-body">Jordan works on distributed algorithms and population protocols.</div>
        <a href="https://www.cs.yale.edu/homes/jordan-systems/">Personal Homepage</a>
      </body></html>
    `;
    const htmlFetcher = vi.fn(async (url: string) => {
      if (url === 'https://engineering.yale.edu/research-and-faculty/faculty-directory/jordan-systems') {
        return profileHtml;
      }
      return '<html><body>listing</body></html>';
    });
    const configs: DeptConfig[] = [
      {
        deptKey: 'cs',
        deptName: 'Computer Science',
        schoolName: 'Yale School of Engineering & Applied Science',
        url: 'https://engineering.yale.edu/academic-study/departments/computer-science/faculty',
        extractor: () => [
          {
            name: 'Jordan Systems',
            profileUrl:
              'https://engineering.yale.edu/research-and-faculty/faculty-directory/jordan-systems',
          },
        ],
      },
    ];

    const scraper = new DepartmentRosterScraper(configs, null, htmlFetcher);
    const { ctx, emitted } = makeContext();

    await scraper.run(ctx);

    const entityObs = emitted.filter((o) => o.entityType === 'researchEntity');
    expect(entityObs.find((o) => o.field === 'slug')?.value).toBe('dept-cs-jordan-systems');
    expect(entityObs.find((o) => o.field === 'name')?.value).toBe('Jordan Systems — Research');
    expect(entityObs.find((o) => o.field === 'kind')?.value).toBe('individual');
    expect(entityObs.find((o) => o.field === 'entityType')?.value).toBe(
      'INDIVIDUAL_RESEARCH',
    );
    expect(entityObs.find((o) => o.field === 'websiteUrl')?.value).toBe(
      'https://www.cs.yale.edu/homes/jordan-systems/',
    );
  });

  it('sanitizes profile research terms before emitting user observations', async () => {
    const configs: DeptConfig[] = [
      {
        deptKey: 'physics',
        deptName: 'Physics',
        schoolName: 'FAS',
        url: 'https://physics.yale.edu/people/faculty',
        extractor: () => [
          {
            name: 'Avery Research',
            email: 'avery.research@yale.edu',
            title: 'Eugene Higgins Professor of Physics',
            researchInterests: [
              'Research Areas: My research interests include electric dipole moment and Casimir effect.',
              'as opposed to a single heart',
              'they often have multiple pumps driving the flow',
              'immunologists in their similarity to tissue transplantation and pregnancy',
              'although the results are applied to issues of basic evolution',
              'and phylogenies',
              'Teaching Interests: My main teaching interests lie in Experimental Physics',
              'Quantum Mechanics (PHYS 441)',
            ],
            topics: [
              'Atomic and Subatomic Physics Research',
              'Teaching Interests: My main teaching interests lie in Experimental Physics',
              'Physics of the Earth and Environment (PHYS 342)',
            ],
          },
        ],
      },
    ];
    const scraper = new DepartmentRosterScraper(configs);
    const { ctx, emitted } = makeContext();

    await scraper.run(ctx);

    const userObs = emitted.filter((o) => o.entityType === 'user');
    expect(userObs.find((o) => o.field === 'researchInterests')?.value).toEqual([
      'electric dipole moment',
      'Casimir effect',
      'phylogenies',
    ]);
    expect(userObs.find((o) => o.field === 'topics')?.value).toEqual([
      'Atomic and Subatomic Physics Research',
    ]);
  });

  it('does not treat unlabeled ORCID-shaped page text as a user ORCID', async () => {
    const profileHtml = `
      <html><body>
        <div class="person-title">Lector of Spanish</div>
        <div class="profile-body">Riley works in applied linguistics and language pedagogy.</div>
        <section class="publication-widget">
          <a href="https://doi.org/10.1000/example">Publication identifier 0000-0000-0000-0028</a>
        </section>
      </body></html>
    `;
    const htmlFetcher = vi.fn(async (url: string) => {
      if (url === 'https://span-port.yale.edu/people/riley-language') return profileHtml;
      return '<html><body>listing</body></html>';
    });
    const configs: DeptConfig[] = [
      {
        deptKey: 'span-port',
        deptName: 'Spanish and Portuguese',
        schoolName: 'FAS',
        url: 'https://span-port.yale.edu/people',
        paginated: false,
        extractor: () => [
          {
            name: 'Riley Language',
            profileUrl: 'https://span-port.yale.edu/people/riley-language',
          },
        ],
      },
    ];

    const scraper = new DepartmentRosterScraper(configs, null, htmlFetcher);
    const { ctx, emitted } = makeContext();

    await scraper.run(ctx);

    const userObs = emitted.filter((o) => o.entityType === 'user');
    expect(userObs.find((o) => o.field === 'orcid')).toBeUndefined();
  });

  it('extracts MCDB profile prose without treating navigation links as lab websites', async () => {
    const mcdbProfileHtml = `
      <html><head>
        <link rel="canonical" href="https://mcdb.yale.edu/profile/fixture-plant-phd" />
        <meta property="og:image" content="https://mcdb.yale.edu/sites/default/files/fixture-plant.jpg" />
        <meta property="og:email" content="mcdb.synthetic@yale.edu" />
      </head><body>
        <nav>
          <a href="https://glassshop.yale.edu/">Scientific Glassblowing Lab</a>
        </nav>
        <main class="main-content">
          <div class="profile-meta">
            <div class="profile-meta__title-line">Professor of Molecular, Cellular and Developmental Biology</div>
            <div class="profile-meta__subtitle-line">Director of Undergraduate Studies</div>
          </div>
          <div class="text-field">
            <div class="text">
              <p>Prof. Fixture studied at Example University. His synthetic research program has focused on the molecular genetics of maize, rice and grasses, including contributions to the understanding of transposable elements, functional genomics and plant development.</p>
              <p>The lab combines genetics, genomics, and molecular biology to study plant development across fixture systems.</p>
            </div>
          </div>
          <section>
            <h2>Contact Info</h2>
            <span>mcdb.synthetic@yale.edu</span>
            <p>Administrative Support:</p>
            <a href="mailto:admin.support@yale.edu">Admin Support</a>
          </section>
        </main>
      </body></html>
    `;
    const htmlFetcher = vi.fn(async (url: string) => {
      if (url === 'https://mcdb.yale.edu/profile/fixture-plant-phd') return mcdbProfileHtml;
      return '<html><body>listing</body></html>';
    });
    const configs: DeptConfig[] = [
      {
        deptKey: 'mcdb',
        deptName: 'Molecular, Cellular and Developmental Biology',
        schoolName: 'Yale Faculty of Arts and Sciences',
        url: 'https://mcdb.yale.edu/people/faculty',
        paginated: false,
        extractor: () => [
          {
            name: 'Fixture Plant, Ph.D.',
            profileUrl: 'https://mcdb.yale.edu/profile/fixture-plant-phd',
            bio: 'Director of Undergraduate Studies',
          },
        ],
      },
    ];

    const scraper = new DepartmentRosterScraper(configs, null, htmlFetcher);
    const { ctx, emitted } = makeContext();

    await scraper.run(ctx);

    const userObs = emitted.filter((o) => o.entityType === 'user');
    expect(userObs.find((o) => o.field === 'email')?.value).toBe('mcdb.synthetic@yale.edu');
    expect(userObs.find((o) => o.field === 'bio')?.value).toContain(
      'synthetic research program has focused on the molecular genetics',
    );
    expect(userObs.find((o) => o.field === 'bio')?.value).toContain(
      'The lab combines genetics, genomics, and molecular biology',
    );
    expect(userObs.find((o) => o.field === 'website')).toBeUndefined();
    expect(userObs.find((o) => o.field === 'researchInterests')?.value).toEqual([
      'molecular genetics of maize, rice and grasses',
      'transposable elements',
      'functional genomics',
      'plant development',
    ]);
  });

  it('does not treat unrelated Yale service links as MCDB lab websites', async () => {
    const mcdbProfileHtml = `
      <html><head>
        <link rel="canonical" href="https://mcdb.yale.edu/profile/fixture-plant-phd" />
        <meta property="og:email" content="fixture.plant@yale.edu" />
      </head><body>
        <main>
          <h1>Fixture Plant</h1>
          <p>The fixture research program studies plant genomics.</p>
          <section>
            <h2>Research Resources</h2>
            <a href="https://glassshop.yale.edu/">Scientific Glassblowing Lab</a>
          </section>
        </main>
      </body></html>
    `;
    const htmlFetcher = vi.fn(async (url: string) => {
      if (url === 'https://mcdb.yale.edu/profile/fixture-plant-phd') return mcdbProfileHtml;
      return '<html><body>listing</body></html>';
    });
    const configs: DeptConfig[] = [
      {
        deptKey: 'mcdb',
        deptName: 'Molecular, Cellular and Developmental Biology',
        schoolName: 'Yale Faculty of Arts and Sciences',
        url: 'https://mcdb.yale.edu/people/faculty',
        paginated: false,
        extractor: () => [
          {
            name: 'Fixture Plant, Ph.D.',
            profileUrl: 'https://mcdb.yale.edu/profile/fixture-plant-phd',
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

  it('uses linked official profile pages instead of generic Yale chrome or placeholder images', async () => {
    const econProfileHtml = `
      <html><head>
        <link rel="canonical" href="/people/fixture-markets" />
      </head><body>
        <a href="https://www.yale.edu/" title="Yale University website">Yale University</a>
        <a href="https://economics.yale.edu/" aria-label="Yale Department of Economics homepage">Yale Department of Economics</a>
        <h1>Fixture Markets</h1>
        <div class="node-teaser__professional-title">Professor of Management</div>
        <a href="mailto:fixture.markets@yale.edu">fixture.markets@yale.edu</a>
        <a href="http://som.yale.edu/fixture-markets">Website</a>
        <img src="/sites/default/files/styles/social_media/public/2022-09/no-image-available.png" alt="no portrait image available" />
      </body></html>
    `;
    const somProfileHtml = `
      <html><head>
        <link rel="canonical" href="/faculty-research/faculty-directory/fixture-markets" />
        <meta property="og:image" content="/sites/default/files/fixture-markets.jpg" />
      </head><body>
        <h1>Fixture G. Markets</h1>
        <div class="person-title">Professor of Finance</div>
        <main>
          <p>Fixture G. Markets conducts research on synthetic market behavior, investment models, portfolio methods, and valuation.</p>
        </main>
      </body></html>
    `;
    const htmlFetcher = vi.fn(async (url: string) => {
      if (url === 'https://economics.yale.edu/people/faculty') return '<html><body>listing</body></html>';
      if (url === 'https://economics.yale.edu/people/fixture-markets') return econProfileHtml;
      if (url === 'https://som.yale.edu/fixture-markets') {
        return somProfileHtml;
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    const configs: DeptConfig[] = [
      {
        deptKey: 'econ',
        deptName: 'Economics',
        schoolName: 'FAS',
        url: 'https://economics.yale.edu/people/faculty',
        paginated: false,
        extractor: () => [
          {
            name: 'Fixture Markets',
            profileUrl: 'https://economics.yale.edu/people/fixture-markets',
            title: 'Professor of Management',
          },
        ],
      },
    ];

    const scraper = new DepartmentRosterScraper(configs, null, htmlFetcher);
    const { ctx, emitted } = makeContext();

    await scraper.run(ctx);

    const userObs = emitted.filter((o) => o.entityType === 'user');
    expect(userObs.find((o) => o.field === 'website')?.value).toBe(
      'https://som.yale.edu/faculty-research/faculty-directory/fixture-markets',
    );
    expect(userObs.find((o) => o.field === 'imageUrl')?.value).toBe(
      'https://som.yale.edu/sites/default/files/fixture-markets.jpg',
    );
    expect(userObs.find((o) => o.field === 'bio')?.value).toContain(
      'Markets conducts research on synthetic market behavior',
    );
    expect(userObs.find((o) => o.field === 'imageUrl')?.value).not.toContain(
      'no-image-available',
    );

    const labObs = emitted.filter((o) => o.entityType === 'researchEntity');
    expect(labObs.find((o) => o.field === 'websiteUrl')?.value).toBe(
      'https://som.yale.edu/faculty-research/faculty-directory/fixture-markets',
    );
    expect(labObs.find((o) => o.field === 'sourceUrls')?.value).toEqual([
      'https://economics.yale.edu/people/faculty',
      'https://economics.yale.edu/people/fixture-markets',
      'https://som.yale.edu/faculty-research/faculty-directory/fixture-markets',
    ]);
  });

  it('prefers visible headshot images over social-share metadata crops', () => {
    const enrichment = profileEnrichmentFromHtml(
      `
      <html>
        <head>
          <link rel="canonical" href="https://economics.yale.edu/people/fixture-person-d" />
          <meta property="og:title" content="Fixture Person D" />
          <meta property="og:image" content="/sites/default/files/styles/social_media/public/2023-03/Fixture-Person-D.jpg?h=fixture&amp;itok=social" />
        </head>
        <body>
          <main>
            <h1>Fixture Person D</h1>
            <aside class="node__headshot">
              <figure class="media media--image media--headshot">
                <picture>
                  <source srcset="/sites/default/files/styles/headshot/public/2023-03/Fixture-Person-D.jpg?h=fixture&amp;itok=headshot 1x, /sites/default/files/styles/headshot_x2/public/2023-03/Fixture-Person-D.jpg?h=fixture&amp;itok=headshot2x 2x" />
                  <img src="/sites/default/files/styles/headshot/public/2023-03/Fixture-Person-D.jpg?h=fixture&amp;itok=headshot" alt="Fixture Person D" />
                </picture>
              </figure>
            </aside>
          </main>
        </body>
      </html>
    `,
      'https://economics.yale.edu/people/fixture-person-d',
    );

    expect(enrichment.imageUrl).toBe(
      'https://economics.yale.edu/sites/default/files/styles/headshot/public/2023-03/Fixture-Person-D.jpg?h=fixture&itok=headshot',
    );
  });

  it('does not extract profile link chrome as research interests', async () => {
    const htmlFetcher = vi.fn(async (url: string) => {
      if (url === 'https://medicine.yale.edu/profile/casey-splice/') {
        return `
          <html><body>
            <div class="profile-body">Dr. Splice studies RNA splicing in pancreatic and lung cancers.</div>
            <div class="research-interests">
              ORCID0000-0000-0000-001X
              <a href="https://orcid.org/0000-0000-0000-001X">0000-0000-0000-001X</a>
              <a href="https://streamlinehq.com">Lab Whisk Cup Streamline Icon: https://streamlinehq.com</a>
              <a href="https://medicine.yale.edu/lab/splice-lab/">Splice LabView Lab Website</a>
              <a>View Lab Website</a>
              <a>Pancreatic Neoplasms10 YSM ResearchersView Related Publication</a>
              <a>10 YSM Researchers</a>
              <a>View Related Publication</a>
            </div>
          </body></html>
        `;
      }
      return '<html><body>listing</body></html>';
    });
    const configs: DeptConfig[] = [
      {
        deptKey: 'medicine-test',
        deptName: 'Medicine Test',
        schoolName: 'Yale School of Medicine',
        url: 'https://medicine.yale.edu/test/faculty',
        paginated: false,
        extractor: () => [
          {
            name: 'Casey Splice',
            profileUrl: 'https://medicine.yale.edu/profile/casey-splice/',
          },
        ],
      },
    ];

    const scraper = new DepartmentRosterScraper(configs, null, htmlFetcher);
    const { ctx, emitted } = makeContext();

    await scraper.run(ctx);

    const userObs = emitted.filter((o) => o.entityType === 'user');
    expect(userObs.find((o) => o.field === 'researchInterests')).toBeUndefined();
    expect(userObs.find((o) => o.field === 'topics')).toBeUndefined();
  });

  it('registers the first Math/Physics/Statistics/Astronomy/EEB roster batch', () => {
    expect(DEFAULT_DEPT_CONFIGS.map((config) => config.deptKey)).toEqual(
      expect.arrayContaining(['math', 'physics', 'statistics', 'astronomy', 'eeb']),
    );
  });

  it('extracts EEB profile research areas into bio and research interests', async () => {
    const htmlFetcher = vi.fn(async (url: string) => {
      if (url === 'https://eeb.yale.edu/people/faculty') {
        return `
          <html><body>
            <table class="views-table">
              <tbody>
                <tr>
                  <td class="views-field views-field-picture">
                    <a href="/people/faculty/jordan-ecology"><img src="/sites/default/files/ecology.jpg" /></a>
                  </td>
                  <td class="views-field views-field-name">
                    <a href="/people/faculty/jordan-ecology" class="username">Jordan Ecology</a><br />
                    Professor of Ecology and Evolutionary Biology; Professor of Environmental Studies<br />
                    <a href="mailto:jordan.ecology@yale.edu">jordan.ecology@yale.edu</a><br />
                    <a href="http://ecologylab.yale.edu/">Website</a><br />
                    Research Interests: Macroecology; community ecology; biogeography.
                  </td>
                </tr>
              </tbody>
            </table>
          </body></html>
        `;
      }
      if (url === 'https://eeb.yale.edu/people/faculty/jordan-ecology') {
        return `
          <html><body>
            <div class="profile">
              <img src="/sites/default/files/styles/people_thumbnail/public/pictures/picture-21.jpg" />
              <div class="field field-name-field-title">
                <div class="field-item">Professor of Ecology and Evolutionary Biology; Professor of Environmental Studies</div>
              </div>
              <div class="field field-name-field-faculty-interests">
                <div class="field-label">Research Areas:&nbsp;</div>
                <div class="field-item">
                  Our work combines biogeography, community ecology, macroecology, global change ecology, and conservation.
                </div>
              </div>
            </div>
          </body></html>
        `;
      }
      return '<html><body></body></html>';
    });
    const configs: DeptConfig[] = [
      {
        deptKey: 'eeb',
        deptName: 'Ecology & Evolutionary Biology',
        schoolName: 'Yale Faculty of Arts and Sciences',
        url: 'https://eeb.yale.edu/people/faculty',
        paginated: false,
        extractor: psychExtractor,
      },
    ];
    const scraper = new DepartmentRosterScraper(configs, null, htmlFetcher);
    const { ctx, emitted } = makeContext({ dryRun: false });

    await scraper.run(ctx);

    const userObs = emitted.filter((o) => o.entityType === 'user');
    expect(userObs.find((o) => o.field === 'bio')?.value).toContain(
      'Our work combines biogeography',
    );
    expect(userObs.find((o) => o.field === 'researchInterests')?.value).toEqual(
      expect.arrayContaining(['community ecology', 'macroecology', 'global change ecology']),
    );
  });

  it('dedupes repeated official profile rows after enrichment', async () => {
    const htmlFetcher = vi.fn(async (url: string) => {
      if (url === 'https://physics.yale.edu/people/morgan-physics') {
        return `
          <html><head><meta property="og:url" content="https://physics.yale.edu/people/morgan-physics" /></head>
          <body>
            <div class="person-title">Professor of Physics</div>
            <a href="mailto:morgan.physics@yale.edu">Email</a>
            <a href="https://physicslab.yale.edu">Personal Website</a>
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
          { name: 'Morgan Physics', profileUrl: 'https://physics.yale.edu/people/morgan-physics' },
          { name: 'Morgan Physics', profileUrl: 'https://physics.yale.edu/people/morgan-physics' },
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

  it('extracts Physics Biographical Sketch bios from official profile pages', async () => {
    const physicsProfileUrl = 'https://physics.yale.edu/people/casey-sky';
    const htmlFetcher = vi.fn(async (url: string) => {
      if (url === physicsProfileUrl) {
        return `
          <html>
            <head><meta property="og:url" content="${physicsProfileUrl}" /></head>
            <body>
              <a href="mailto:casey.sky@yale.edu">Email</a>
              <div class="field field-name-field-title">
                <div class="field-item">Associate Professor of Physics</div>
              </div>
              <div class="field field-name-field-bio">
                <div class="field-label">Biographical Sketch:&nbsp;</div>
                <div class="field-item">
                  Casey Sky is an Assistant Professor of Physics at Yale University. She received her PhD in Physics from Example University for work on synthetic sky-survey instrumentation. Her work spans hardware, software, and analysis for radio astronomy through current fixture observatory projects.
                </div>
              </div>
            </body>
          </html>
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
          {
            name: 'Casey Sky',
            profileUrl: physicsProfileUrl,
          },
        ],
      },
    ];

    const scraper = new DepartmentRosterScraper(configs, null, htmlFetcher);
    const { ctx, emitted } = makeContext();
    await scraper.run(ctx);

    const userObs = emitted.filter((o) => o.entityType === 'user');
    expect(userObs[0].entityKey).toBe('netid:casey.sky');
    expect(userObs.find((o) => o.field === 'profileUrls')?.value).toEqual({
      departmental: physicsProfileUrl,
    });
    expect(userObs.find((o) => o.field === 'bio')?.value).toContain(
      'Casey Sky is an Assistant Professor of Physics at Yale University.',
    );
  });

  it('uses an injected rendered fetcher for JS-rendered depts while keeping parsing local', async () => {
    const stubExtractor = vi.fn((): FacultyEntry[] => {
      throw new Error('should not use the Cheerio stub for rendered pages');
    });
    const renderedExtractor = vi.fn((): FacultyEntry[] => [
      {
        name: 'Riley Computing',
        email: 'riley.computing@yale.edu',
        profileUrl: 'https://engineering.yale.edu/faculty/riley-computing',
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
      <html><head><link rel="canonical" href="/faculty/riley-computing" /></head>
      <body>
        <div class="person-title">Professor of Computer Science</div>
        <a href="https://computingsystems.yale.edu">Research Group Website</a>
      </body></html>
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
      'https://engineering.yale.edu/faculty/riley-computing',
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
      'https://computingsystems.yale.edu/',
    );

    getSpy.mockRestore();
  });

  it('uses the CS component data endpoint before falling back to rendered fetching', async () => {
    const renderedFetcher = vi.fn();
    const dataExtractor = vi.fn((): FacultyEntry[] => [
      {
        name: 'Riley Computing',
        title: 'Professor of Computer Science',
        profileUrl: 'https://engineering.yale.edu/faculty/riley-computing',
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
