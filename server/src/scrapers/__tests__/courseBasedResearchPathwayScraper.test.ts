import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  COURSE_BASED_RESEARCH_PATHWAY_SOURCE,
  CourseBasedResearchPathwayScraper,
  DEFAULT_COURSE_BASED_RESEARCH_PATHWAY_PAGES,
  courseBasedResearchPathwayRecordsToObservations,
  isCatalogOrCourseSearchIndexRootUrl,
  parseCourseBasedResearchPathwayPage,
} from '../sources/courseBasedResearchPathwayScraper';
import type { ObservationInput, ScraperContext } from '../types';

const readCoursePathwayFixture = (name: string): string =>
  readFileSync(join(__dirname, 'fixtures', 'course-based-research', name), 'utf8');

const FABRICATED_EVIDENCE_FIELDS = [
  'undergradAccessEvidence',
  'acceptingUndergrads',
  'undergradEvidenceQuote',
  'contactName',
  'contactEmail',
  'contactRole',
  'joinPageUrl',
  'postedOpportunityTitle',
  'applicationUrl',
  'deadline',
];

const PSYCHOLOGY_HTML = `
<main>
  <nav>
    <a href="/people/faculty">Faculty</a>
    <a href="/undergraduate/senior-requirement-information">Senior Requirement Information</a>
  </nav>
  <h1>What is a Directed Research Course?</h1>
  <p>The PSYC department offers several different kinds of independent research courses for credit. We offer a full credit directed research course (PSYC 4925), and a half credit directed research course (PSYC 4950). These courses are graded pass/fail. In addition, we offer a full credit senior essay course.</p>
  <p>Note that all of these courses require filling out an online tutorial survey form that is generally due seven days before the end of the add/drop period.</p>
  <p>Accessibility at Yale Privacy policy Copyright Yale University All rights reserved</p>
</main>
`;

const HISTORY_HTML = `
<main>
  <nav><a href="/undergraduate">Undergraduate</a></nav>
  <h1>Senior Essay</h1>
  <p>History is more than past events; it is also the discipline of historical inquiry, using the collection and careful evaluation of evidence and the written presentation of reasonable conclusions.</p>
  <p>Seniors receive course credit for satisfactory completion of their departmental essays by enrolling in HIST 4995, 4996, or 4997. They must also complete a library research workshop for the senior essay.</p>
  <p>Contact us: dus.example@yale.edu, Phone: (203) 000-0000</p>
  <p>Copyright Yale University. Privacy policy.</p>
</main>
`;

const ENGLISH_HTML = `
<main>
  <h1>Senior Essay</h1>
  <p>In the English Department, as in other departments, the Senior Essay consists of an extended research and writing project undertaken with the guidance of a faculty advisor.</p>
  <p>You will be expected to consult frequently with your advisor throughout the semester, both about your research and about the substance of your developing argument.</p>
  <p>In the term before you intend to write your essay, you must hand in to the DUS office a completed proposal form for ENGL 4100 or 4101 and a prospectus describing your topic.</p>
</main>
`;

const NO_EVIDENCE_HTML = `
<main>
  <h1>Department Overview</h1>
  <p>The department offers a broad liberal-arts curriculum and welcomes students from across the college.</p>
  <p>Our alumni pursue careers in industry, government, and the arts.</p>
</main>
`;

const CATALOG_INDEX_ROOT_HTML = `
<main>
  <h1>Yale College Programs of Study</h1>
  <p>Browse all subjects of instruction, including directed research and senior essay courses across every department.</p>
</main>
`;

function buildContext(
  scraper: CourseBasedResearchPathwayScraper,
  emitted: ObservationInput[],
  options: Partial<ScraperContext['options']> = {},
): ScraperContext {
  return {
    scrapeRunId: 'run-1',
    sourceId: 'source-1',
    sourceName: scraper.name,
    sourceWeight: 0.75,
    options: { dryRun: true, useCache: false, release: false, limit: 10, ...options },
    emit: async (obs) => {
      emitted.push(...(Array.isArray(obs) ? obs : [obs]));
    },
    log: vi.fn(),
  };
}

const psychologyConfig = DEFAULT_COURSE_BASED_RESEARCH_PATHWAY_PAGES.find(
  (page) => page.key === 'psychology-directed-research',
)!;
const historyConfig = DEFAULT_COURSE_BASED_RESEARCH_PATHWAY_PAGES.find(
  (page) => page.key === 'history-senior-essay',
)!;
const englishConfig = DEFAULT_COURSE_BASED_RESEARCH_PATHWAY_PAGES.find(
  (page) => page.key === 'english-senior-essay',
)!;

describe('courseBasedResearchPathwayScraper', () => {
  it('pilots the canonical directed-research, senior-essay, and senior-research departments', () => {
    expect(psychologyConfig).toMatchObject({
      url: 'https://psychology.yale.edu/what-directed-research-course',
      department: 'Psychology',
      school: 'Yale Faculty of Arts and Sciences',
    });
    expect(historyConfig).toMatchObject({
      url: 'https://history.yale.edu/undergraduate/senior-essay',
      department: 'History',
    });
    expect(englishConfig).toMatchObject({
      url: 'https://english.yale.edu/undergraduate/senior-essay',
      department: 'English',
    });
  });

  it('mints a COURSE_SEQUENCE research home from the Psychology directed-research page', () => {
    const records = parseCourseBasedResearchPathwayPage(PSYCHOLOGY_HTML, psychologyConfig);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      entityKey: 'course-based-research-psychology-directed-research',
      name: 'Psychology Directed Research Courses',
      entityType: 'COURSE_SEQUENCE',
      kind: 'program',
      department: 'Psychology',
      school: 'Yale Faculty of Arts and Sciences',
      sourceUrl: 'https://psychology.yale.edu/what-directed-research-course',
    });
    expect(records[0].fullDescription).toContain('directed research course');
    expect(records[0].fullDescription).toMatch(/^A for-credit, course-based research pathway in Psychology\./);
    expect(records[0].fullDescription).not.toMatch(/Copyright|Privacy policy|Accessibility at Yale/);
  });

  it('parses the History senior-essay page and fails closed on contact data', () => {
    const records = parseCourseBasedResearchPathwayPage(HISTORY_HTML, historyConfig);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      entityKey: 'course-based-research-history-senior-essay',
      name: 'History Senior Essay',
      entityType: 'COURSE_SEQUENCE',
      department: 'History',
    });
    expect(records[0].fullDescription).toContain('course credit');
    expect(records[0].fullDescription).not.toContain('@yale.edu');
    expect(records[0].fullDescription).not.toMatch(/\(203\)/);
    expect(JSON.stringify(records[0])).not.toContain('dus.example@yale.edu');
  });

  it('parses the English senior-essay pathway as a for-credit course sequence', () => {
    const records = parseCourseBasedResearchPathwayPage(ENGLISH_HTML, englishConfig);

    expect(records).toHaveLength(1);
    expect(records[0].entityType).toBe('COURSE_SEQUENCE');
    expect(records[0].fullDescription).toMatch(/senior essay|research and writing project/i);
  });

  it('emits the for-credit access fact but no opening, application, or contact evidence', () => {
    const [record] = parseCourseBasedResearchPathwayPage(PSYCHOLOGY_HTML, psychologyConfig);
    const observations = courseBasedResearchPathwayRecordsToObservations([record]);
    const fields = observations.map((observation) => observation.field);

    expect(fields).toEqual(
      expect.arrayContaining([
        'slug',
        'name',
        'kind',
        'entityType',
        'school',
        'departments',
        'websiteUrl',
        'sourceUrls',
        'fullDescription',
        'shortDescription',
        'offersIndependentStudy',
      ]),
    );
    expect(fields).not.toEqual(expect.arrayContaining(FABRICATED_EVIDENCE_FIELDS));

    const offersObs = observations.find(
      (observation) => observation.field === 'offersIndependentStudy',
    );
    expect(offersObs?.value).toBe(true);
    expect(offersObs?.sourceUrl).toBe(psychologyConfig.url);

    const entityTypeObs = observations.find((observation) => observation.field === 'entityType');
    expect(entityTypeObs?.value).toBe('COURSE_SEQUENCE');
    const sourceUrlsObs = observations.find((observation) => observation.field === 'sourceUrls');
    expect(sourceUrlsObs?.value).toEqual(['https://psychology.yale.edu/what-directed-research-course']);
    expect(observations.every((observation) => observation.sourceUrl === psychologyConfig.url)).toBe(true);
  });

  it('fails closed when a page has no course-based research evidence', () => {
    expect(
      parseCourseBasedResearchPathwayPage(NO_EVIDENCE_HTML, psychologyConfig),
    ).toEqual([]);
  });

  it('never cites a catalog or course-search index root', () => {
    expect(isCatalogOrCourseSearchIndexRootUrl('https://catalog.yale.edu/ycps')).toBe(true);
    expect(isCatalogOrCourseSearchIndexRootUrl('https://catalog.yale.edu/ycps/')).toBe(true);
    expect(isCatalogOrCourseSearchIndexRootUrl('https://courses.yale.edu/')).toBe(true);
    expect(
      isCatalogOrCourseSearchIndexRootUrl('https://psychology.yale.edu/what-directed-research-course'),
    ).toBe(false);
    expect(
      isCatalogOrCourseSearchIndexRootUrl(
        'https://catalog.yale.edu/ycps/subjects-of-instruction/molecular-cellular-developmental-biology',
      ),
    ).toBe(false);

    const indexRootConfig = {
      key: 'ycps-index',
      url: 'https://catalog.yale.edu/ycps',
      name: 'Yale College Programs of Study',
      department: 'Yale College',
      school: 'Yale College',
    };
    expect(parseCourseBasedResearchPathwayPage(CATALOG_INDEX_ROOT_HTML, indexRootConfig)).toEqual([]);
    expect(
      courseBasedResearchPathwayRecordsToObservations([
        {
          entityKey: 'course-based-research-ycps-index',
          name: 'Yale College Programs of Study',
          entityType: 'COURSE_SEQUENCE',
          kind: 'program',
          department: 'Yale College',
          school: 'Yale College',
          sourceUrl: 'https://catalog.yale.edu/ycps',
          fullDescription: 'A for-credit, course-based research pathway in Yale College.',
          shortDescription: 'A for-credit Yale College research pathway.',
        },
      ]),
    ).toEqual([]);
  });

  it('runs selected configured pages and honors only filters', async () => {
    const scraper = new CourseBasedResearchPathwayScraper({
      pageConfigs: [
        { ...psychologyConfig, url: 'https://psychology.yale.edu/what-directed-research-course' },
        { ...historyConfig },
      ],
      fetchHtml: async (url) => (url.includes('psychology') ? PSYCHOLOGY_HTML : HISTORY_HTML),
    });
    const emitted: ObservationInput[] = [];

    const result = await scraper.run(
      buildContext(scraper, emitted, { only: ['psychology-directed-research'] }),
    );

    expect(result.entitiesObserved).toBe(1);
    expect(result.observationCount).toBe(emitted.length);
    expect(new Set(emitted.map((obs) => obs.sourceUrl))).toEqual(
      new Set(['https://psychology.yale.edu/what-directed-research-course']),
    );
    expect(scraper.name).toBe(COURSE_BASED_RESEARCH_PATHWAY_SOURCE);
  });

  it('rejects unsafe runtime bounds before fetching pages', async () => {
    for (const [option, message] of [
      [{ offset: 9007199254740992 }, /--offset must be a safe non-negative integer/],
      [{ limit: 9007199254740992 }, /--limit must be a safe positive integer/],
    ] as const) {
      const fetchHtml = vi.fn(async () => PSYCHOLOGY_HTML);
      const scraper = new CourseBasedResearchPathwayScraper({
        pageConfigs: [psychologyConfig],
        fetchHtml,
      });
      const emitted: ObservationInput[] = [];

      await expect(scraper.run(buildContext(scraper, emitted, option as any))).rejects.toThrow(
        message,
      );
      expect(fetchHtml).not.toHaveBeenCalled();
      expect(emitted).toEqual([]);
    }
  });
});

const BROADENED_FIXTURE_KEYS = [
  'mcdb-senior-research',
  'mbb-senior-requirement',
  'chemistry-independent-research',
  'astronomy-senior-project',
  'economics-senior-essay',
  'american-studies-senior-essay',
  'wgss-senior-essay',
  'linguistics-senior-essay',
  'hshm-senior-project',
  'statistics-data-science-senior-essay',
] as const;

describe('courseBasedResearchPathwayScraper broadened corpus', () => {
  it('expands well beyond the three-department pilot', () => {
    const keys = DEFAULT_COURSE_BASED_RESEARCH_PATHWAY_PAGES.map((page) => page.key);
    expect(keys).toEqual(expect.arrayContaining(['psychology-directed-research', ...BROADENED_FIXTURE_KEYS]));
    expect(DEFAULT_COURSE_BASED_RESEARCH_PATHWAY_PAGES.length).toBeGreaterThanOrEqual(13);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(DEFAULT_COURSE_BASED_RESEARCH_PATHWAY_PAGES.map((page) => page.url)).size).toBe(
      keys.length,
    );
  });

  it('cites each department’s own course page, never a catalog or course-search index root', () => {
    for (const page of DEFAULT_COURSE_BASED_RESEARCH_PATHWAY_PAGES) {
      const url = new URL(page.url);
      expect(url.protocol).toBe('https:');
      expect(url.hostname.endsWith('.yale.edu')).toBe(true);
      expect(isCatalogOrCourseSearchIndexRootUrl(page.url)).toBe(false);
      expect(url.hostname).not.toMatch(/^(?:catalog|courses)\.yale\.edu$/);
      expect(page.name.trim().length).toBeGreaterThan(0);
      expect(page.department.trim().length).toBeGreaterThan(0);
    }
  });

  const fixtureConfigs = BROADENED_FIXTURE_KEYS.map((key) => ({
    key,
    config: DEFAULT_COURSE_BASED_RESEARCH_PATHWAY_PAGES.find((page) => page.key === key)!,
  }));

  it('has a live-HTML fixture and config row for every broadened department', () => {
    for (const { key, config } of fixtureConfigs) {
      expect(config, `missing config row for ${key}`).toBeTruthy();
      expect(
        existsSync(join(__dirname, 'fixtures', 'course-based-research', `${key}.html`)),
        `missing fixture for ${key}`,
      ).toBe(true);
    }
  });

  for (const { key, config } of fixtureConfigs) {
    describe(`${key}`, () => {
      const html = readCoursePathwayFixture(`${key}.html`);
      const records = parseCourseBasedResearchPathwayPage(html, config);

      it('mints exactly one COURSE_SEQUENCE research home with the owning department', () => {
        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({
          entityKey: `course-based-research-${key}`,
          name: config.name,
          entityType: 'COURSE_SEQUENCE',
          kind: 'program',
          department: config.department,
          school: config.school,
          sourceUrl: config.url,
        });
      });

      it('produces a source-backed description free of chrome and contact data', () => {
        const { fullDescription, shortDescription } = records[0];
        expect(fullDescription).toMatch(
          new RegExp(`^A for-credit, course-based research pathway in ${escapeRegExp(config.department)}\\.`),
        );
        expect(fullDescription.length).toBeGreaterThan(
          `A for-credit, course-based research pathway in ${config.department}.`.length,
        );
        expect(shortDescription.length).toBeGreaterThan(0);
        for (const text of [fullDescription, shortDescription]) {
          expect(text).not.toMatch(/@[a-z0-9.-]+\.(?:edu|com|org)/i);
          expect(text).not.toMatch(/\(?\b\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/);
          expect(text).not.toMatch(/Copyright|Privacy policy|Accessibility at Yale|Skip to main content/i);
          expect(text).not.toMatch(/https?:\/\//);
        }
      });

      it('emits discovery-only observations that cite the department page and fabricate no access data', () => {
        const observations = courseBasedResearchPathwayRecordsToObservations(records);
        const fields = observations.map((observation) => observation.field);
        expect(fields).toEqual(
          expect.arrayContaining(['slug', 'name', 'entityType', 'departments', 'sourceUrls']),
        );
        expect(fields).not.toEqual(expect.arrayContaining(FABRICATED_EVIDENCE_FIELDS));
        expect(observations.every((observation) => observation.sourceUrl === config.url)).toBe(true);
        const sourceUrlsObs = observations.find((observation) => observation.field === 'sourceUrls');
        expect(sourceUrlsObs?.value).toEqual([config.url]);
        const entityTypeObs = observations.find((observation) => observation.field === 'entityType');
        expect(entityTypeObs?.value).toBe('COURSE_SEQUENCE');
      });
    });
  }
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
