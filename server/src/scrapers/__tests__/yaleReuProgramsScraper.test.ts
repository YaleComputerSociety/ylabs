import { describe, expect, it, vi } from 'vitest';
import {
  candidateToObservations,
  extractYaleSiteUrlsFromNsfDirectory,
  parseDeadlineToUtcEndOfDay,
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
    expect(candidate?.deadline?.toISOString()).toBe(
      parseDeadlineToUtcEndOfDay('February 6, 2026', referenceDate)?.toISOString(),
    );
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

describe('candidateToObservations classification', () => {
  it('classifies an REU that requires securing a mentor first as SECURE_MENTOR_THEN_APPLY', () => {
    const candidate = parseReuProgramPage(
      astronomyReuHtml,
      astronomyUrl,
      'Yale Department of Astronomy',
      referenceDate,
    )!;
    const observations = candidateToObservations(candidate);
    const byField = (field: string) => observations.find((o) => o.field === field)?.value;
    expect(byField('programCategory')).toBe('SUMMER_RESEARCH_PROGRAM');
    expect(byField('entryMode')).toBe('SECURE_MENTOR_THEN_APPLY');
    expect(byField('requiresMentorBeforeApply')).toBe(true);
  });

  it('classifies a program that matches admitted students with mentors as DIRECT_FACULTY_MATCHING', () => {
    const candidate = parseReuProgramPage(
      mathSummerHtml,
      mathUrl,
      'Yale Mathematics',
      referenceDate,
    )!;
    const observations = candidateToObservations(candidate);
    const byField = (field: string) => observations.find((o) => o.field === field)?.value;
    expect(byField('programCategory')).toBe('SUMMER_RESEARCH_PROGRAM');
    expect(byField('entryMode')).toBe('DIRECT_FACULTY_MATCHING');
    expect(byField('mentorMatching')).toBe(true);
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
