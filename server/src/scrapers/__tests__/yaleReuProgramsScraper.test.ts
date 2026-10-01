import { describe, expect, it, vi } from 'vitest';
import { classificationFromObservedFacts } from '../fellowshipClassificationDerivation';
import {
  candidateToObservations,
  extractYaleSiteUrlsFromNsfDirectory,
  parseReuProgramPage,
  YaleReuProgramsScraper,
  YALE_REU_PROGRAMS_SOURCE,
} from '../sources/yaleReuProgramsScraper';
import type { ObservationInput, ScraperContext } from '../types';

const referenceDate = new Date('2026-01-01T00:00:00Z');

const astronomyUrl =
  'https://astronomy.yale.edu/undergraduate-program/research/fixture-astronomy-reu';
const mathUrl = 'https://sumry.yale.edu/';
const nsfDirectoryUrl = 'https://www.nsf.gov/crssprgm/reu/reu_search.jsp';

// An NSF-REU-terminology page whose prose requires securing a mentor first.
const astronomyReuHtml = `
  <header><nav>Skip to content Menu</nav></header>
  <main>
    <article>
      <h1>Fixture Astronomy Research Experiences for Undergraduates (REU)</h1>
      <p>This NSF REU is a ten-week summer research program in astrophysics. Students of any nationality, including visiting students from other institutions, are welcome to apply.</p>
      <h2>Eligibility</h2>
      <p>Open to sophomores and juniors majoring in physics or astronomy.</p>
      <h2>How to Apply</h2>
      <p>Applicants must identify a Yale faculty mentor before applying. Application deadline: February 6, 2026.</p>
      <p>Questions? Contact the program office at fixture-reu@astro.example.edu.</p>
      <a href="https://app.smarterselect.com/programs/999-fixture">Apply here</a>
    </article>
  </main>
`;

// A summer research program with no "REU" terminology whose program admits
// students and matches them with mentors (no mentor-first requirement).
const mathSummerHtml = `
  <body>
    <main>
      <h1>Summer Undergraduate Math Research at Yale</h1>
      <p>SUMRY is a nine-week summer program of original mathematics research. The program is open to students from any institution and admitted students are matched with a faculty mentor.</p>
      <p>Applications are now open. Deadline: March 1, 2026.</p>
      <a href="https://forms.gle/fixtureApplicationForm">Application form for 2026</a>
    </main>
  </body>
`;

const nsfDirectoryHtml = `
  <html><body>
    <a href="https://astronomy.yale.edu/undergraduate-program/research/fixture-astronomy-reu">Yale University REU Site in Astronomy</a>
    <a href="https://example.edu/reu/some-other-school">Other School REU Site</a>
    <a href="https://www.nsf.gov/funding/">NSF funding</a>
  </body></html>
`;

describe('parseReuProgramPage', () => {
  it('extracts an NSF REU page and preserves clean prose', () => {
    const candidate = parseReuProgramPage(
      astronomyReuHtml,
      astronomyUrl,
      'Yale Department of Astronomy',
      referenceDate,
    );
    expect(candidate).toBeDefined();
    expect(candidate?.title).toBe(
      'Fixture Astronomy Research Experiences for Undergraduates (REU)',
    );
    expect(candidate?.sourceUrl).toBe(astronomyUrl);
    expect(candidate?.description).toMatch(/ten-week summer research program in astrophysics/);
    expect(candidate?.competitionType).toBe('NSF REU (Research Experiences for Undergraduates)');
    expect(candidate?.deadline?.toISOString()).toBe('2026-02-07T04:59:59.999Z');
    expect(candidate?.applicationLink).toBe('https://app.smarterselect.com/programs/999-fixture');
    expect(candidate?.termOfAward).toContain('Summer');
  });

  it('extracts a summer research program that does not use the REU acronym', () => {
    const candidate = parseReuProgramPage(
      mathSummerHtml,
      mathUrl,
      'Yale Mathematics',
      referenceDate,
    );
    expect(candidate).toBeDefined();
    expect(candidate?.title).toBe('Summer Undergraduate Math Research at Yale');
    expect(candidate?.competitionType).toBe('Summer Undergraduate Research Program');
    expect(candidate?.applicationLink).toBe('https://forms.gle/fixtureApplicationForm');
    expect(candidate?.isAcceptingApplications).toBe(true);
  });

  it('fails closed on contact: never stores a scraped email raw or emits a contactEmail', () => {
    const candidate = parseReuProgramPage(
      astronomyReuHtml,
      astronomyUrl,
      'Yale Department of Astronomy',
      referenceDate,
    );
    expect(candidate).toBeDefined();
    expect(candidate?.description ?? '').not.toContain('fixture-reu@astro.example.edu');
    const observations = candidateToObservations(candidate!);
    expect(observations.some((observation) => observation.field === 'contactEmail')).toBe(false);
  });

  it('rejects a non-Yale source page (source citations must be Yale-owned)', () => {
    const candidate = parseReuProgramPage(
      astronomyReuHtml.replace(astronomyUrl, ''),
      'https://example.edu/reu/some-other-school',
      'Other School',
      referenceDate,
    );
    expect(candidate).toBeUndefined();
  });

  it('keeps an application-form link from a sidebar callout and drops sidebar admissions links', () => {
    const html = `
      <body>
        <main>
          <h1>Fixture Summer Research Program</h1>
          <p>A ten-week summer research program where undergraduate students from any institution join a Yale research group.</p>
          <aside>
            <a href="https://admissions.yale.edu/apply">Apply to Yale</a>
            <a href="https://forms.gle/fixtureSidebarForm">Application Form for 2026</a>
          </aside>
        </main>
        <nav><a href="https://forms.gle/fixtureNavForm">Apply</a></nav>
      </body>
    `;
    const candidate = parseReuProgramPage(html, mathUrl, 'Yale', referenceDate);
    expect(candidate?.applicationLink).toBe('https://forms.gle/fixtureSidebarForm');
    expect(candidate?.links.map((link) => link.url)).toEqual([
      'https://forms.gle/fixtureSidebarForm',
    ]);
  });

  it('reads an application-form link from a sidebar that sits outside the main content', () => {
    const html = `
      <body>
        <main>
          <h1>Fixture Summer Research Program</h1>
          <p>A ten-week summer research program where undergraduate students from any institution join a Yale research group.</p>
        </main>
        <div class="region-sidebar"><aside><a href="https://redcap.med.yale.edu/surveys/?s=FIXTURE">Request an Application</a></aside></div>
      </body>
    `;
    const candidate = parseReuProgramPage(html, mathUrl, 'Yale', referenceDate);
    expect(candidate?.applicationLink).toBe('https://redcap.med.yale.edu/surveys/?s=FIXTURE');
  });

  it('describes the program from its prose when the page body carries an FAQ pointer', () => {
    const html = `
      <body>
        <main>
          <h1>Fixture Summer Research Program</h1>
          <p>Spend the summer at Yale working as a researcher alongside faculty on an original undergraduate research project.</p>
          <p>Admitted students receive a stipend and housing for the ten-week summer program.</p>
          <p>Have more questions? Check out our FAQs!</p>
        </main>
      </body>
    `;
    const candidate = parseReuProgramPage(html, mathUrl, 'Yale', referenceDate);
    expect(candidate?.description).toMatch(/original undergraduate research project/);
    expect(candidate?.description).not.toMatch(/FAQ/);
  });

  it('titles a center subpage by its own heading rather than the site-name logo heading', () => {
    const html = `
      <body>
        <div id="header"><h1><a href="https://fixture-center.yale.edu"><strong>Yale</strong> Fixture Center</a></h1></div>
        <h1 class="title">Summer Undergraduate Research in Fixture Sciences</h1>
        <p>An eight-week summer research program that places undergraduate students in Yale research groups.</p>
      </body>
    `;
    const candidate = parseReuProgramPage(
      html,
      'https://fixture-center.yale.edu/summer',
      'Yale',
      referenceDate,
    );
    expect(candidate?.title).toBe('Summer Undergraduate Research in Fixture Sciences');
  });

  it('keeps the site-name heading on a single-program site whose page heading is generic', () => {
    const html = `
      <body>
        <h1 class="site-name"><a href="/">Fixture Summer Math Research at Yale</a></h1>
        <main>
          <h1 class="title">Welcome</h1>
          <p>A summer research program in mathematics open to undergraduate students from any institution.</p>
        </main>
      </body>
    `;
    const candidate = parseReuProgramPage(html, mathUrl, 'Yale', referenceDate);
    expect(candidate?.title).toBe('Fixture Summer Math Research at Yale');
  });

  it('returns undefined for a page with no summer-research or REU signal', () => {
    const candidate = parseReuProgramPage(
      '<main><h1>Department Directory</h1><p>Faculty office hours and contact list.</p></main>',
      astronomyUrl,
      'Yale',
      referenceDate,
    );
    expect(candidate).toBeUndefined();
  });
});

describe('classification derived from the observed facts', () => {
  it('classifies an REU that requires securing a mentor first as SECURE_MENTOR_THEN_APPLY', () => {
    const candidate = parseReuProgramPage(
      astronomyReuHtml,
      astronomyUrl,
      'Yale Department of Astronomy',
      referenceDate,
    )!;
    const observations = candidateToObservations(candidate);
    expect(observations.map((o) => o.field)).not.toContain('programCategory');
    expect(classificationFromObservedFacts(observations)).toMatchObject({
      programCategory: 'SUMMER_RESEARCH_PROGRAM',
      entryMode: 'SECURE_MENTOR_THEN_APPLY',
      requiresMentorBeforeApply: true,
    });
  });

  it('classifies a program that matches admitted students with mentors as DIRECT_FACULTY_MATCHING', () => {
    const candidate = parseReuProgramPage(
      mathSummerHtml,
      mathUrl,
      'Yale Mathematics',
      referenceDate,
    )!;
    const observations = candidateToObservations(candidate);
    expect(observations.map((o) => o.field)).not.toContain('entryMode');
    expect(classificationFromObservedFacts(observations)).toMatchObject({
      programCategory: 'SUMMER_RESEARCH_PROGRAM',
      entryMode: 'DIRECT_FACULTY_MATCHING',
      mentorMatching: true,
    });
  });
});

describe('extractYaleSiteUrlsFromNsfDirectory', () => {
  it('keeps only Yale-owned REU/summer-research links from the NSF directory', () => {
    const urls = extractYaleSiteUrlsFromNsfDirectory(nsfDirectoryHtml, nsfDirectoryUrl);
    expect(urls).toEqual([
      'https://astronomy.yale.edu/undergraduate-program/research/fixture-astronomy-reu',
    ]);
  });
});

describe('YaleReuProgramsScraper run', () => {
  function makeContext(emit: (obs: ObservationInput | ObservationInput[]) => Promise<void>) {
    return {
      scrapeRunId: 'run',
      sourceId: 'source',
      sourceName: YALE_REU_PROGRAMS_SOURCE,
      sourceWeight: 1,
      options: { dryRun: true, useCache: false, release: false },
      emit,
      log: vi.fn(),
    } as unknown as ScraperContext;
  }

  it('emits Yale program observations and never cites the non-Yale NSF directory as a source', async () => {
    const emitted: ObservationInput[] = [];
    const fetchPage = vi.fn(async (url: string) => {
      if (url === nsfDirectoryUrl) return nsfDirectoryHtml;
      if (url.startsWith('https://astronomy.yale.edu/')) return astronomyReuHtml;
      if (url.startsWith('https://sumry.yale.edu/')) return mathSummerHtml;
      throw new Error(`unexpected fetch: ${url}`);
    });
    const scraper = new YaleReuProgramsScraper({
      programSeeds: [{ url: mathUrl, hostingOffice: 'Yale Mathematics' }],
      nsfDirectoryUrls: [nsfDirectoryUrl],
      fetchPage,
      retryDelay: async () => {},
    });

    const result = await scraper.run(
      makeContext(async (obs) => {
        emitted.push(...(Array.isArray(obs) ? obs : [obs]));
      }),
    );

    expect(result.entitiesObserved).toBe(2);
    const sourceUrls = new Set(emitted.map((o) => o.sourceUrl));
    expect(sourceUrls.has(nsfDirectoryUrl)).toBe(false);
    for (const url of sourceUrls) {
      expect(url && new URL(url).hostname.endsWith('yale.edu')).toBe(true);
    }
    // The astronomy page is discovered from the directory, not seeded directly.
    expect(fetchPage).toHaveBeenCalledWith(astronomyUrl, false);
  });

  it('throws when every program page fails to fetch (fail closed, not silently empty)', async () => {
    const scraper = new YaleReuProgramsScraper({
      programSeeds: [{ url: mathUrl, hostingOffice: 'Yale Mathematics' }],
      nsfDirectoryUrls: [],
      fetchPage: vi.fn(async () => {
        throw new Error('network down');
      }),
      retryDelay: async () => {},
    });
    await expect(scraper.run(makeContext(async () => {}))).rejects.toThrow(
      /No Yale REU program pages could be fetched/,
    );
  });
});
