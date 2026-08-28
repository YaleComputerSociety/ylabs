import { describe, expect, it, vi } from 'vitest';
import {
  candidateToObservations,
  extractProgramUrlsFromDirectory,
  isExcludedAlreadyCoveredUrl,
  isHealthSciencesSummerProgramUrl,
  parseDeadlineToUtcEndOfDay,
  parseHealthSciencesProgramPage,
  YaleHealthSciencesSummerProgramsScraper,
  YALE_HEALTH_SCIENCES_SUMMER_PROGRAMS_SOURCE,
} from '../sources/yaleHealthSciencesSummerProgramsScraper';
import type { ObservationInput, ScraperContext } from '../types';

const referenceDate = new Date('2026-01-01T00:00:00Z');

const surfUrl = 'https://medicine.yale.edu/biomedsurf/';
const bdsyUrl =
  'https://ysph.yale.edu/school-of-public-health/special-programs/big-data-summer-immersion-at-yale/';
const listingUrl = 'https://ysph.yale.edu/school-of-public-health/special-programs/';

// A biomedical summer program that matches admitted students with a lab mentor
// (no mentor-first requirement), in a <main><article> layout.
const surfHtml = `
  <header><nav>Skip to content Menu</nav></header>
  <main>
    <article>
      <h1>Yale Biomedical Summer Undergraduate Research Fellowship</h1>
      <p>This is a ten-week summer research program for undergraduates. Each student will be matched with the laboratory of a research mentor at the School of Medicine and pursue a research project under the supervision of the research mentor.</p>
      <h2>Eligibility</h2>
      <p>Open to college students, including visiting students from other institutions.</p>
      <h2>How to Apply</h2>
      <p>Applications are now open. Application deadline: February 3, 2026.</p>
      <p>Questions? Contact the program office at fixture-surf@med.example.edu.</p>
      <a href="https://apply.example.org/biomedsurf-2026">Apply here</a>
    </article>
  </main>
`;

// A public-health summer research program in a plain <body><main> layout that
// provides faculty/graduate-student mentors.
const bdsyHtml = `
  <body>
    <main>
      <h1>Big Data Summer Immersion at Yale</h1>
      <p>Undergraduate students work in small groups on mentored summer research projects, supported by a graduate student and a faculty mentor over six weeks.</p>
      <p>Applications are accepted through March 15, 2026.</p>
      <a href="https://forms.gle/fixtureBdsyApplication">Application form</a>
    </main>
  </body>
`;

const listingHtml = `
  <body>
    <main>
      <a href="/school-of-public-health/special-programs/big-data-summer-immersion-at-yale">Big Data Summer Immersion at Yale</a>
      <a href="/school-of-public-health/special-programs/summer-research-experience-environmental-health">Summer Research Experience in Environmental Health</a>
      <a href="/about-school-of-public-health/charitable-opportunities/donors-make-a-difference/positano-scholarship-fund">Positano Scholarship Fund</a>
      <a href="https://medicine.yale.edu/whr/training/">Women's Health Research training</a>
      <a href="https://www.nsf.gov/funding/">NSF funding</a>
    </main>
  </body>
`;

describe('parseHealthSciencesProgramPage', () => {
  it('extracts a matched-mentor biomedical summer program and preserves clean prose', () => {
    const candidate = parseHealthSciencesProgramPage(
      surfHtml,
      surfUrl,
      'Yale School of Medicine - Biomedical Sciences',
      referenceDate,
    );
    expect(candidate).toBeDefined();
    expect(candidate?.title).toBe('Yale Biomedical Summer Undergraduate Research Fellowship');
    expect(candidate?.sourceUrl).toBe(surfUrl);
    expect(candidate?.description).toMatch(/ten-week summer research program/);
    expect(candidate?.deadline?.toISOString()).toBe(
      parseDeadlineToUtcEndOfDay('February 3, 2026', referenceDate)?.toISOString(),
    );
    expect(candidate?.applicationLink).toBe('https://apply.example.org/biomedsurf-2026');
    expect(candidate?.termOfAward).toContain('Summer');
  });

  it('extracts a public-health summer program in a plain body/main layout', () => {
    const candidate = parseHealthSciencesProgramPage(
      bdsyHtml,
      bdsyUrl,
      'Yale School of Public Health - Biostatistics',
      referenceDate,
    );
    expect(candidate).toBeDefined();
    expect(candidate?.title).toBe('Big Data Summer Immersion at Yale');
    expect(candidate?.applicationLink).toBe('https://forms.gle/fixtureBdsyApplication');
    expect(candidate?.isAcceptingApplications).toBe(true);
  });

  it('fails closed on contact: never stores a scraped email raw or emits a contactEmail', () => {
    const candidate = parseHealthSciencesProgramPage(
      surfHtml,
      surfUrl,
      'Yale School of Medicine',
      referenceDate,
    );
    expect(candidate).toBeDefined();
    expect(candidate?.description ?? '').not.toContain('fixture-surf@med.example.edu');
    const observations = candidateToObservations(candidate!);
    expect(observations.some((observation) => observation.field === 'contactEmail')).toBe(false);
  });

  it('rejects a non-Yale source page (source citations must be Yale-owned)', () => {
    const candidate = parseHealthSciencesProgramPage(
      surfHtml,
      'https://example.edu/summer/some-other-school',
      'Other School',
      referenceDate,
    );
    expect(candidate).toBeUndefined();
  });

  it('returns undefined for a page with no undergraduate summer-research signal', () => {
    const candidate = parseHealthSciencesProgramPage(
      '<main><h1>Department Directory</h1><p>Faculty office hours and contact list.</p></main>',
      surfUrl,
      'Yale',
      referenceDate,
    );
    expect(candidate).toBeUndefined();
  });
});

describe('candidateToObservations classification', () => {
  it('classifies a matched-mentor summer program as SUMMER_RESEARCH_PROGRAM / DIRECT_FACULTY_MATCHING', () => {
    const candidate = parseHealthSciencesProgramPage(
      surfHtml,
      surfUrl,
      'Yale School of Medicine',
      referenceDate,
    )!;
    const observations = candidateToObservations(candidate);
    const byField = (field: string) => observations.find((o) => o.field === field)?.value;
    expect(byField('sourceName')).toBe(YALE_HEALTH_SCIENCES_SUMMER_PROGRAMS_SOURCE);
    expect(byField('programCategory')).toBe('SUMMER_RESEARCH_PROGRAM');
    expect(byField('entryMode')).toBe('DIRECT_FACULTY_MATCHING');
    expect(byField('mentorMatching')).toBe(true);
  });
});

describe('directory discovery and de-duplication', () => {
  it('keeps only Yale-owned program-shaped links and drops noise, non-Yale, and already-covered URLs', () => {
    const urls = extractProgramUrlsFromDirectory(listingHtml, listingUrl);
    expect(urls).toEqual([
      'https://ysph.yale.edu/school-of-public-health/special-programs/big-data-summer-immersion-at-yale',
      'https://ysph.yale.edu/school-of-public-health/special-programs/summer-research-experience-environmental-health',
    ]);
  });

  it('excludes the two programs already minted by the fellowships-office source', () => {
    expect(isExcludedAlreadyCoveredUrl('https://medicine.yale.edu/whr/training/')).toBe(true);
    expect(
      isExcludedAlreadyCoveredUrl('https://ycmd.yale.edu/education/summer-undergraduate-internships'),
    ).toBe(true);
    expect(isExcludedAlreadyCoveredUrl(surfUrl)).toBe(false);
  });

  it('rejects donor/scholarship and financial-aid paths from program discovery', () => {
    expect(
      isHealthSciencesSummerProgramUrl(
        'https://ysph.yale.edu/about-school-of-public-health/charitable-opportunities/donors-make-a-difference/positano-scholarship-fund',
      ),
    ).toBe(false);
    expect(
      isHealthSciencesSummerProgramUrl(
        'https://ysph.yale.edu/school-of-public-health/special-programs/big-data-summer-immersion-at-yale',
      ),
    ).toBe(true);
  });
});

describe('YaleHealthSciencesSummerProgramsScraper run', () => {
  function makeContext(emit: (obs: ObservationInput | ObservationInput[]) => Promise<void>) {
    return {
      scrapeRunId: 'run',
      sourceId: 'source',
      sourceName: YALE_HEALTH_SCIENCES_SUMMER_PROGRAMS_SOURCE,
      sourceWeight: 1,
      options: { dryRun: true, useCache: false, release: false },
      emit,
      log: vi.fn(),
    } as unknown as ScraperContext;
  }

  it('emits Yale program observations and never cites a non-Yale or listing URL as a source', async () => {
    const emitted: ObservationInput[] = [];
    const fetchPage = vi.fn(async (url: string) => {
      if (url === listingUrl) return listingHtml;
      if (url.startsWith('https://medicine.yale.edu/biomedsurf')) return surfHtml;
      if (url.includes('big-data-summer-immersion')) return bdsyHtml;
      throw new Error(`unexpected fetch: ${url}`);
    });
    const scraper = new YaleHealthSciencesSummerProgramsScraper({
      programSeeds: [
        { url: surfUrl, hostingOffice: 'Yale School of Medicine' },
      ],
      directoryUrls: [listingUrl],
      fetchPage,
      retryDelay: async () => {},
    });

    const result = await scraper.run(
      makeContext(async (obs) => {
        emitted.push(...(Array.isArray(obs) ? obs : [obs]));
      }),
    );

    expect(result.entitiesObserved).toBeGreaterThanOrEqual(2);
    const sourceUrls = new Set(emitted.map((o) => o.sourceUrl));
    expect(sourceUrls.has(listingUrl)).toBe(false);
    for (const url of sourceUrls) {
      expect(url && new URL(url).hostname.endsWith('yale.edu')).toBe(true);
    }
    expect(fetchPage).toHaveBeenCalledWith(
      'https://ysph.yale.edu/school-of-public-health/special-programs/big-data-summer-immersion-at-yale',
      false,
    );
  });

  it('throws when every program page fails to fetch (fail closed, not silently empty)', async () => {
    const scraper = new YaleHealthSciencesSummerProgramsScraper({
      programSeeds: [{ url: surfUrl, hostingOffice: 'Yale School of Medicine' }],
      directoryUrls: [],
      fetchPage: vi.fn(async () => {
        throw new Error('network down');
      }),
      retryDelay: async () => {},
    });
    await expect(scraper.run(makeContext(async () => {}))).rejects.toThrow(
      /No Yale health-sciences summer program pages could be fetched/,
    );
  });
});
