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
        <a href="/people/samuel-kortum"><span>Samuel Kortum</span></a>
      </div>
      <div class="node-teaser__professional-title">
        <span>Departmental Chair and James Burrows Moffatt Professor of Economics</span>
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
        <a class="directory-listing-card__heading-link" href="/profile/shirin-bahmanyar-phd">
          Shirin Bahmanyar, Ph.D.
        </a>
      </h3>
      <div class="directory-listing-card__subheading">
        <div>Associate Professor of Molecular, Cellular &amp; Developmental Biology with Tenure</div>
      </div>
      <a class="directory-listing-card__link" href="mailto:shirin.bahmanyar@yale.edu">Email</a>
      <a class="directory-listing-card__link" href="https://bahmanyarlab.yale.edu">Lab Website</a>
    </div>
  </div>
  <div class="directory-listing-card">
    <div class="directory-listing-card__content">
      <h3 class="directory-listing-card__heading">
        <a class="directory-listing-card__heading-link" href="/profile/ronald-breaker-phd">
          Ronald Breaker, Ph.D.
        </a>
      </h3>
      <div class="directory-listing-card__subheading">
        <div>Sterling Professor of MCDB</div>
      </div>
      <a class="directory-listing-card__link" href="mailto:ronald.breaker@yale.edu">Email</a>
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
          <a href="/people/woo-kyoung-ahn" class="username">Woo-kyoung Ahn</a>
        </td>
        <td class="views-field views-field-field-phone">203-432-9626</td>
        <td class="views-field views-field-mail">
          <a href="mailto:woo-kyoung.ahn@yale.edu">woo-kyoung.ahn@yale.edu</a>
        </td>
        <td class="views-field views-field-field-office">100 College St.</td>
        <td class="views-field views-field-edit-node"></td>
      </tr>
      <tr class="even">
        <td class="views-field views-field-name">
          <a href="/people/john-bargh">John Bargh</a>
        </td>
        <td class="views-field views-field-field-phone">203-432-1111</td>
        <td class="views-field views-field-mail">
          <a href="mailto:john.bargh@yale.edu">john.bargh@yale.edu</a>
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
          <a href="/people/woo-kyoung-ahn"><img alt="Woo-kyoung Ahn's picture" /></a>
        </td>
        <td class="views-field views-field-name">
          <a href="/people/woo-kyoung-ahn" title="View user profile." class="username">Woo-kyoung Ahn</a><br />
          John Hay Whitney Professor of Psychology<br />
          100 College St.<br />
          <a href="mailto:woo-kyoung.ahn@yale.edu">woo-kyoung.ahn@yale.edu</a><br />
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
              <a href="/people/hector-arce"><img alt="Hector Arce's picture" /></a>
            </span>
          </div>
          <div class="views-field views-field-name">
            <span class="field-content">Hector Arce</span>
          </div>
          <div class="views-field views-field-field-title">
            <div class="field-content">Professor of Astronomy</div>
          </div>
          <div class="views-field views-field-mail">
            <span class="field-content">
              <a href="mailto:hector.arce@yale.edu">hector.arce@yale.edu</a>
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
    expect(netidFromEmail('woo-kyoung.ahn@yale.edu')).toBe('woo-kyoung.ahn');
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

describe('normalizeName', () => {
  it('strips trailing Ph.D. credentials', () => {
    expect(normalizeName('Ronald Breaker, Ph.D.')).toBe('Ronald Breaker');
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
      title: 'Departmental Chair and James Burrows Moffatt Professor of Economics',
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
});

describe('mcdbExtractor', () => {
  it('extracts cards with name, title, email, optional lab URL', () => {
    const out = mcdbExtractor(MCDB_HTML, { pageUrl: 'https://mcdb.yale.edu/people/faculty' });
    expect(out).toHaveLength(2); // empty card skipped
    expect(out[0]).toMatchObject({
      name: 'Shirin Bahmanyar, Ph.D.',
      email: 'shirin.bahmanyar@yale.edu',
      labUrl: 'https://bahmanyarlab.yale.edu',
      profileUrl: 'https://mcdb.yale.edu/profile/shirin-bahmanyar-phd',
    });
    expect(out[0].title).toContain('Associate Professor');
    expect(out[1]).toMatchObject({
      name: 'Ronald Breaker, Ph.D.',
      email: 'ronald.breaker@yale.edu',
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
});

describe('psychExtractor', () => {
  it('extracts rows from all views-table sections, skipping empty rows', () => {
    const out = psychExtractor(PSYCH_HTML, {
      pageUrl: 'https://psychology.yale.edu/people/faculty',
    });
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({
      name: 'Woo-kyoung Ahn',
      email: 'woo-kyoung.ahn@yale.edu',
      profileUrl: 'https://psychology.yale.edu/people/woo-kyoung-ahn',
    });
    expect(out[1].name).toBe('John Bargh');
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
        email: 'woo-kyoung.ahn@yale.edu',
        profileUrl: 'https://psychology.yale.edu/people/woo-kyoung-ahn',
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

  it('drops malformed href lab links and strips noisy research-area labels', () => {
    const html = `
      <html><body>
        <table class="views-table">
          <tbody>
            <tr>
              <td class="views-field views-field-name">
                <a href="/people/meng-cheng" class="username">Meng Cheng</a><br />
                Associate Professor of Physics<br />
                <a href="mailto:meng.cheng@yale.edu">meng.cheng@yale.edu</a><br />
                <a href="<a href=">Research Website</a>
              </td>
              <td class="views-field views-field-field-field-of-study">
                Research Areas: Condensed Matter Physics
                <p><em>Theorist</em></p>
                <p><small>Quantum criticality and topological matter projects.</small></p>
                ; Quantum Materials; PhysicsExperimentalist
              </td>
            </tr>
          </tbody>
        </table>
      </body></html>
    `;

    const out = psychExtractor(html, { pageUrl: 'https://physics.yale.edu/people/faculty' });

    expect(out).toEqual([
      {
        name: 'Meng Cheng',
        title: 'Associate Professor of Physics',
        email: 'meng.cheng@yale.edu',
        profileUrl: 'https://physics.yale.edu/people/meng-cheng',
        labUrl: undefined,
        topics: ['Condensed Matter Physics', 'Quantum Materials'],
        researchInterests: ['Condensed Matter Physics', 'Quantum Materials'],
      },
    ]);
  });

  it('supports Astronomy views grid cells with profile picture links and topic fields', () => {
    const out = psychExtractor(ASTRONOMY_GRID_HTML, {
      pageUrl: 'https://astronomy.yale.edu/people/faculty',
    });

    expect(out).toEqual([
      {
        name: 'Hector Arce',
        title: 'Professor of Astronomy',
        email: 'hector.arce@yale.edu',
        profileUrl: 'https://astronomy.yale.edu/people/hector-arce',
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
    expect(labObs.find((o) => o.field === 'websiteUrl')?.value).toBe('https://tflab.example.org/');
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
        <div class="field-name-field-field-of-study">
          <div class="field-label">Research Areas:</div>
          <div class="field-items">
            <div class="field-item">Algebraic Geometry</div>
            <div class="field-item">Topology</div>
          </div>
        </div>
        <a href="https://orcid.org/0000-0002-1825-0097">ORCID</a>
        <a href="https://scholar.google.com/citations?user=adaCandidate">Google Scholar</a>
        <a href="mailto:ada.lovelace@yale.edu">ada.lovelace@yale.edu</a>
        <a href="https://lovelacelab.yale.edu">Lab Website</a>
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
    expect(userObs.find((o) => o.field === 'orcid')?.value).toBe('0000-0002-1825-0097');
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

  it('does not emit lab observations for malformed lab URLs from custom extractors', async () => {
    const configs: DeptConfig[] = [
      {
        deptKey: 'physics',
        deptName: 'Physics',
        schoolName: 'FAS',
        url: 'https://example.invalid/physics',
        paginated: false,
        extractor: () => [
          {
            name: 'Meng Cheng',
            email: 'meng.cheng@yale.edu',
            labUrl: 'https://physics.yale.edu/academics/undergraduate-studies/<a href=',
          },
        ],
      },
    ];
    const htmlFetcher = vi.fn(async () => '<html><body>listing</body></html>');
    const scraper = new DepartmentRosterScraper(configs, null, htmlFetcher);
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);

    expect(result.entitiesObserved).toBe(1);
    expect(emitted.filter((o) => o.entityType === 'researchEntity')).toEqual([]);
    expect(emitted.find((o) => o.entityType === 'user' && o.field === 'website')).toBeUndefined();
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
