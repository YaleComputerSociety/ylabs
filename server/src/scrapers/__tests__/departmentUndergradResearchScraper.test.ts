import { describe, expect, it, vi } from 'vitest';

import {
  DEPARTMENT_UNDERGRAD_RESEARCH_SOURCE,
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
