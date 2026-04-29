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
  econExtractor,
  mcdbExtractor,
  psychExtractor,
  csJsRenderedStub,
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
});

describe('csJsRenderedStub', () => {
  it('throws to signal the page needs a headless browser', () => {
    expect(() => csJsRenderedStub('<html></html>', { pageUrl: 'x' })).toThrow(/JS-rendered/);
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

    // user observations include netid and email
    const userObs = emitted.filter((o) => o.entityType === 'user');
    expect(userObs.find((o) => o.field === 'netid')?.value).toBe('tf123');
    expect(userObs.find((o) => o.field === 'email')?.value).toBe('tf123@yale.edu');
    expect(userObs.find((o) => o.field === 'fname')?.value).toBe('Test');
    expect(userObs.find((o) => o.field === 'lname')?.value).toBe('Faculty');
    expect(userObs.find((o) => o.field === 'primary_department')?.value).toBe('Economics');
    // entityKey uses netid: prefix when an @yale.edu email is present
    expect(userObs[0].entityKey).toBe('netid:tf123');

    // lab observations
    const labObs = emitted.filter((o) => o.entityType === 'researchGroup');
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
