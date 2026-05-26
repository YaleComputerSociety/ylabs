import { describe, expect, it, vi } from 'vitest';

import {
  DEPARTMENT_UNDERGRAD_RESEARCH_SOURCE,
  DEFAULT_DEPARTMENT_UNDERGRAD_RESEARCH_PAGES,
  DepartmentUndergradResearchScraper,
  departmentUndergradResearchRecordsToObservations,
  parseGeneralDepartmentResearchPage,
  parsePhysicsUndergradResearchPage,
  parseStructuredOpportunityPage,
} from '../sources/departmentUndergradResearchScraper';
import type { ObservationInput, ScraperContext } from '../types';

const PHYSICS_HTML = `
<main>
  <h1>Undergraduate Research</h1>
  <h2>Active Research in the Yale Physics Department</h2>
  <h3>Research Opportunities</h3>
  <h3>Helen Caines</h3>
  <p>Contact: Helen Caines (helen.caines@yale.edu)</p>
  <p>Website: <a href="https://wlab.yale.edu/research/relativistic-heavy-ions">https://wlab.yale.edu/research/relativistic-heavy-ions</a></p>
  <p>The first set of studies are analyses that focus on measurements of matter created when ultra-relativistic heavy-ions are collided.</p>
  <h3>Christopher Lynn</h3>
  <p>Contact: Christopher Lynn (christopher.lynn@yale.edu)</p>
  <p>Website: <a href="https://lynnlab.yale.edu/">https://lynnlab.yale.edu/</a></p>
  <p>In-lab and remote opportunities. We are interested in understanding how structure and function emerge in complex living systems.</p>
</main>
`;

const CHEM_HTML = `
<main>
  <h1>Undergraduate Research</h1>
  <p>Students interested in research should contact the faculty member directly via email to explore opportunities.</p>
  <p>The purpose of CHEM 4800 is to provide undergraduate students with hands-on exposure to basic research in the chemical sciences.</p>
</main>
`;

const MCDB_HTML = `
<main>
  <h1>Undergraduate Research Opportunities</h1>
  <h4>Undergraduate Research Associate Program with Yale Pediatric Emergency Medicine</h4>
  <p>The Yale Section of Pediatric Emergency Medicine is recruiting students to join the Undergraduate Research Associate Program.</p>
  <p>Students will gain hands-on experience working on clinical research studies in the Yale New Haven Children's Hospital pediatric emergency department.</p>
  <p>Application link: <a href="https://yalesurvey.ca1.qualtrics.com/jfe/form/SV_fixture">Apply here</a></p>
  <p>Contact: paul.aronson@yale.edu</p>
</main>
`;

const ASTRONOMY_HTML = `
<main>
  <h1>Undergraduate Research</h1>
  <h2>Independent Senior Research Project</h2>
  <p>All majors undertake an independent senior research project under the direct supervision of a faculty member.</p>
  <h2>Summer Research Opportunities</h2>
  <p>Most undergraduate students take advantage of at least one summer to do research, either in an external REU or working closely with faculty at Yale.</p>
</main>
`;

const EEB_HTML = `
<main>
  <h1>Undergraduate Research Opportunities</h1>
  <p>There are many opportunities for students to carry out research in the laboratory of a faculty member.</p>
  <p>All interested students are encouraged to participate in research.</p>
  <p>The choice of a research laboratory should be made in consultation with faculty members and the Director of Undergraduate Studies or the Research Coordinator.</p>
</main>
`;

function buildContext(
  scraper: DepartmentUndergradResearchScraper,
  emitted: ObservationInput[],
  options: Partial<ScraperContext['options']> = {},
): ScraperContext {
  return {
    scrapeRunId: 'run-1',
    sourceId: 'source-1',
    sourceName: scraper.name,
    sourceWeight: 0.8,
    options: { dryRun: true, useCache: false, release: false, limit: 10, ...options },
    emit: async (obs) => {
      emitted.push(...(Array.isArray(obs) ? obs : [obs]));
    },
    log: vi.fn(),
  };
}

describe('departmentUndergradResearchScraper', () => {
  it('parses Physics project rows into source-backed lab access records', () => {
    const records = parsePhysicsUndergradResearchPage(PHYSICS_HTML, {
      key: 'physics',
      url: 'https://physics.yale.edu/academics/undergraduate-studies/undergraduate-research',
      department: 'Physics',
      school: 'Yale Faculty of Arts and Sciences',
      parser: 'physics-project-list',
    });

    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({
      entityKey: 'dept-physics-helen-caines',
      name: 'Helen Caines Lab',
      kind: 'lab',
      entityType: 'LAB',
      websiteUrl: 'https://wlab.yale.edu/research/relativistic-heavy-ions',
      contactName: 'Helen Caines',
      contactEmail: 'helen.caines@yale.edu',
      undergradAccessEvidence: true,
    });
    expect(records[1].description).toContain('In-lab and remote opportunities');
  });

  it('drops malformed encoded anchor fragments from Physics project URLs', () => {
    const records = parsePhysicsUndergradResearchPage(
      `
      <main>
        <h1>Undergraduate Research</h1>
        <h2>Active Research in the Yale Physics Department</h2>
        <h3>Meng Cheng</h3>
        <p>Contact: Meng Cheng (meng.cheng@yale.edu)</p>
        <p>Website: <a href="%3Ca%20href=">broken anchor fragment</a></p>
        <p>Students can work on quantum condensed matter theory research projects.</p>
      </main>
      `,
      {
        key: 'physics',
        url: 'https://physics.yale.edu/academics/undergraduate-studies/undergraduate-research',
        department: 'Physics',
        school: 'Yale Faculty of Arts and Sciences',
        parser: 'physics-project-list',
      },
    );
    const observations = departmentUndergradResearchRecordsToObservations(records);

    expect(records).toHaveLength(1);
    expect(records[0].websiteUrl).toBeUndefined();
    expect(observations.find((observation) => observation.field === 'websiteUrl')?.value).toBe(
      'https://physics.yale.edu/academics/undergraduate-studies/undergraduate-research',
    );
    expect(observations.find((observation) => observation.field === 'sourceUrls')?.value).toEqual([
      'https://physics.yale.edu/academics/undergraduate-studies/undergraduate-research',
    ]);
  });

  it('parses general department guidance without pretending it is a posted opening', () => {
    const records = parseGeneralDepartmentResearchPage(CHEM_HTML, {
      key: 'chemistry',
      url: 'https://chem.yale.edu/academics/undergraduate-chemistry-at-yale/undergraduate-research',
      department: 'Chemistry',
      school: 'Yale Faculty of Arts and Sciences',
      parser: 'general-guidance',
      title: 'Chemistry Undergraduate Research',
    });

    expect(records).toMatchObject([
      {
        entityKey: 'department-undergrad-research-chemistry',
        kind: 'program',
        entityType: 'PROGRAM',
        name: 'Chemistry Undergraduate Research',
        undergradAccessEvidence: true,
        contactRole: 'Faculty member for undergraduate research',
      },
    ]);
    expect(records[0].joinPageUrl).toBeUndefined();
  });

  it('parses structured undergraduate application pages as official application routes', () => {
    const records = parseStructuredOpportunityPage(MCDB_HTML, {
      key: 'mcdb-urap',
      url: 'https://mcdb.yale.edu/undergraduate/undergraduate-research-opportunities',
      department: 'Molecular, Cellular and Developmental Biology',
      school: 'Yale Faculty of Arts and Sciences',
      parser: 'structured-opportunity',
      title: 'Pediatric Emergency Medicine Undergraduate Research Associate Program',
    });

    expect(records).toMatchObject([
      {
        entityKey:
          'department-undergrad-research-pediatric-emergency-medicine-undergraduate-research-associate-program',
        kind: 'program',
        entityType: 'PROGRAM',
        contactEmail: 'paul.aronson@yale.edu',
        joinPageUrl: 'https://yalesurvey.ca1.qualtrics.com/jfe/form/SV_fixture',
      },
    ]);
  });

  it('emits observations that the access materializer can derive pathways from', () => {
    const [record] = parseGeneralDepartmentResearchPage(CHEM_HTML, {
      key: 'chemistry',
      url: 'https://chem.yale.edu/academics/undergraduate-chemistry-at-yale/undergraduate-research',
      department: 'Chemistry',
      school: 'Yale Faculty of Arts and Sciences',
      parser: 'general-guidance',
      title: 'Chemistry Undergraduate Research',
    });
    const observations = departmentUndergradResearchRecordsToObservations([record]);

    expect(observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entityKey: record.entityKey, field: 'acceptingUndergrads', value: true }),
        expect.objectContaining({
          entityKey: record.entityKey,
          field: 'undergradAccessEvidence',
          value: { openToUndergrads: 'yes', evidenceSource: 'department_undergrad_research_page' },
        }),
        expect.objectContaining({ entityKey: record.entityKey, field: 'undergradEvidenceQuote' }),
      ]),
    );
  });

  it('emits general department guidance as entity/access evidence, not posted-opportunity fields', () => {
    const [record] = parseGeneralDepartmentResearchPage(CHEM_HTML, {
      key: 'chemistry',
      url: 'https://chem.yale.edu/academics/undergraduate-chemistry-at-yale/undergraduate-research',
      department: 'Chemistry',
      school: 'Yale Faculty of Arts and Sciences',
      parser: 'general-guidance',
      title: 'Chemistry Undergraduate Research',
    });

    const observations = departmentUndergradResearchRecordsToObservations([record]);
    const fields = observations.map((observation) => observation.field);

    expect(fields).toEqual(
      expect.arrayContaining([
        'name',
        'kind',
        'entityType',
        'departments',
        'sourceUrls',
        'undergradAccessEvidence',
        'undergradEvidenceQuote',
        'contactRole',
      ]),
    );
    expect(fields).not.toEqual(
      expect.arrayContaining([
        'postedOpportunityTitle',
        'opportunityTitle',
        'listingId',
        'deadline',
        'applicationUrl',
        'compensationType',
      ]),
    );
    expect(fields).not.toContain('joinPageUrl');
  });

  it('parses new official guidance configs as source-backed entity/access evidence only', () => {
    const astronomyConfig = DEFAULT_DEPARTMENT_UNDERGRAD_RESEARCH_PAGES.find(
      (page) => page.key === 'astronomy',
    );
    const eebConfig = DEFAULT_DEPARTMENT_UNDERGRAD_RESEARCH_PAGES.find((page) => page.key === 'eeb');

    expect(astronomyConfig).toMatchObject({
      url: 'https://astronomy.yale.edu/academics/undergraduate-program/undergraduate-research',
      parser: 'general-guidance',
    });
    expect(eebConfig).toMatchObject({
      url: 'https://eeb.yale.edu/academics/undergraduate-program/undergraduate-research-opportunities',
      parser: 'general-guidance',
    });

    const records = [
      ...parseGeneralDepartmentResearchPage(ASTRONOMY_HTML, astronomyConfig!),
      ...parseGeneralDepartmentResearchPage(EEB_HTML, eebConfig!),
    ];
    const observations = departmentUndergradResearchRecordsToObservations(records);
    const fields = observations.map((observation) => observation.field);

    expect(records).toMatchObject([
      {
        entityKey: 'department-undergrad-research-astronomy',
        name: 'Astronomy Undergraduate Research',
        kind: 'program',
        entityType: 'PROGRAM',
        sourceUrl: astronomyConfig!.url,
        description: expect.stringContaining('direct supervision of a faculty member'),
        undergradAccessEvidence: true,
      },
      {
        entityKey: 'department-undergrad-research-ecology-and-evolutionary-biology',
        name: 'Ecology and Evolutionary Biology Undergraduate Research Opportunities',
        kind: 'program',
        entityType: 'PROGRAM',
        sourceUrl: eebConfig!.url,
        description: expect.stringContaining('carry out research in the laboratory'),
        undergradAccessEvidence: true,
      },
    ]);
    expect(observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityKey: 'department-undergrad-research-astronomy',
          field: 'fullDescription',
          sourceUrl: astronomyConfig!.url,
          value: expect.stringContaining('undergraduate students'),
        }),
        expect.objectContaining({
          entityKey: 'department-undergrad-research-ecology-and-evolutionary-biology',
          field: 'undergradAccessEvidence',
          sourceUrl: eebConfig!.url,
          value: { openToUndergrads: 'yes', evidenceSource: 'department_undergrad_research_page' },
        }),
      ]),
    );
    expect(fields).not.toEqual(
      expect.arrayContaining([
        'postedOpportunityTitle',
        'opportunityTitle',
        'listingId',
        'deadline',
        'applicationUrl',
        'compensationType',
      ]),
    );
  });

  it('runs selected configured pages and honors only filters', async () => {
    const scraper = new DepartmentUndergradResearchScraper({
      pageConfigs: [
        {
          key: 'physics',
          url: 'https://physics.yale.edu/undergrad',
          department: 'Physics',
          school: 'Yale Faculty of Arts and Sciences',
          parser: 'physics-project-list',
        },
        {
          key: 'chemistry',
          url: 'https://chem.yale.edu/undergrad',
          department: 'Chemistry',
          school: 'Yale Faculty of Arts and Sciences',
          parser: 'general-guidance',
          title: 'Chemistry Undergraduate Research',
        },
      ],
      fetchHtml: async (url) => (url.includes('physics') ? PHYSICS_HTML : CHEM_HTML),
    });
    const emitted: ObservationInput[] = [];

    const result = await scraper.run(buildContext(scraper, emitted, { only: ['physics'] }));

    expect(result.entitiesObserved).toBe(2);
    expect(result.observationCount).toBe(emitted.length);
    expect(new Set(emitted.map((obs) => obs.sourceUrl))).toEqual(
      new Set(['https://physics.yale.edu/undergrad']),
    );
    expect(scraper.name).toBe(DEPARTMENT_UNDERGRAD_RESEARCH_SOURCE);
  });
});
