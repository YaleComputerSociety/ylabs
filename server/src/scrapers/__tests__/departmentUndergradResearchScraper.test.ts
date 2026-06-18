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
  <h3>Harper Contact</h3>
  <p>Contact: Harper Contact (harper.contact@yale.edu)</p>
  <p>Website: <a href="https://wlab.yale.edu/research/relativistic-heavy-ions">https://wlab.yale.edu/research/relativistic-heavy-ions</a></p>
  <p>The first set of studies are analyses that focus on measurements of matter created when ultra-relativistic heavy-ions are collided.</p>
  <h3>Casey Contact</h3>
  <p>Contact: Casey Contact (casey.contact@yale.edu)</p>
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
  <p>Contact: parker.contact@yale.edu</p>
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

const ANTHROPOLOGY_HTML = `
<main>
  <h1>Undergraduate Research in Anthropology</h1>
  <p>The Department of Anthropology encourages undergraduate students to engage in research in a variety of settings: in their courses, in work as research assistants, and in guided inquiries of their own.</p>
  <p>Some faculty in Anthropology employ undergraduate research assistants in a variety of capacities.</p>
</main>
`;

const EARTH_HTML = `
<main>
  <h1>Resources</h1>
  <h2>Research Opportunities</h2>
  <p>The EPS program strongly encourages undergraduate students to participate in cutting-edge research as early as possible.</p>
  <p>Students are encouraged to take initiative in seeking out potential advisers for research.</p>
</main>
`;

const POLITICAL_SCIENCE_HTML = `
<main>
  <h1>About The Undergraduate Program</h1>
  <p>The Department offers numerous seminars and lecture courses for undergraduates.</p>
  <p>We also offer research opportunities to students in the major, including resources for fieldwork on senior projects.</p>
</main>
`;

const HISTORY_HTML = `
<main>
  <h1>Undergraduate Program</h1>
  <p>History majors make extensive use of Yale's vast library resources and create pioneering original research projects.</p>
  <p>All majors complete advanced research and writing under faculty guidance.</p>
</main>
`;

const NEUROSCIENCE_HTML = `
<main>
  <h1>Research Opportunities</h1>
  <p>We encourage all neuroscience majors to conduct research during the semester and over the summer, whether as part of courses, as a volunteer, or as employment.</p>
  <p>There are more than 100 neuroscientists on campus with whom undergraduates can work in faculty laboratories.</p>
</main>
`;

const MBB_HTML = `
<main>
  <h1>Introduction to the Undergraduate Program</h1>
  <p>The B.S. is designed for students with a strong interest in research and includes an intensive introduction to modern laboratory procedures.</p>
  <p>Undergraduates have opportunities to conduct research in faculty laboratories during their junior and senior years.</p>
</main>
`;

const LINGUISTICS_HTML = `
<main>
  <h1>Linguistics Research Opportunities at Yale</h1>
  <p>Undergraduates have many opportunities to do research in the department with individual faculty or research groups.</p>
  <p>In a lab you receive close mentorship from the lab director, and you may work on projects individually or in groups.</p>
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
      entityKey: 'dept-physics-harper-contact',
      name: 'Harper Contact Lab',
      kind: 'lab',
      entityType: 'LAB',
      websiteUrl: 'https://wlab.yale.edu/research/relativistic-heavy-ions',
      description: expect.stringContaining('The first set of studies'),
      contactName: 'Harper Contact',
      contactEmail: 'harper.contact@yale.edu',
      undergradAccessEvidence: true,
    });
    expect(records[0].description).not.toContain('Contact:');
    expect(records[0].description).not.toContain('Website:');
    expect(records[1].description).toContain('In-lab and remote opportunities');
  });

  it('keeps Physics contact and website chrome out of project descriptions', () => {
    const records = parsePhysicsUndergradResearchPage(
      `
      <main>
        <h1>Undergraduate Research</h1>
        <h2>Active Research in the Yale Physics Department</h2>
        <h3>Morgan Contact</h3>
        <p>Contact: Morgan Contact (<a href="mailto:m.contact@yale.edu">m.contact@yale.edu</a>)</p>
        <p>Website: <a href="<a href=">https://morgan-contact.github.io/</a></p>
        <p>Entanglement entropy and defect in quantum many-body systems</p>
        <p>Phases and phase transitions in open quantum systems.</p>
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

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      entityKey: 'dept-physics-morgan-contact',
      contactEmail: 'm.contact@yale.edu',
      websiteUrl: undefined,
      description:
        'Entanglement entropy and defect in quantum many-body systems Phases and phase transitions in open quantum systems.',
    });
    expect(records[0].description).not.toContain('Contact:');
    expect(records[0].description).not.toContain('Website:');
    expect(records[0].description).not.toContain('m.contact@yale.edu');
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
        contactEmail: 'parker.contact@yale.edu',
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
    expect(fields).not.toContain('joinPageUrl');
  });

  it('includes additional department undergraduate research guidance pages', () => {
    const configsByKey = new Map(
      DEFAULT_DEPARTMENT_UNDERGRAD_RESEARCH_PAGES.map((page) => [page.key, page]),
    );

    expect(configsByKey.get('anthropology')).toMatchObject({
      url: 'https://anthropology.yale.edu/undergraduate-program/undergraduate-research-in-anthropology',
      parser: 'general-guidance',
      department: 'Anthropology',
    });
    expect(configsByKey.get('earth-planetary-sciences')).toMatchObject({
      url: 'https://earth.yale.edu/resources',
      parser: 'general-guidance',
      department: 'Earth and Planetary Sciences',
    });
    expect(configsByKey.get('political-science')).toMatchObject({
      url: 'https://politicalscience.yale.edu/academics/about-undergraduate-program',
      parser: 'general-guidance',
      department: 'Political Science',
    });
    expect(configsByKey.get('history')).toMatchObject({
      url: 'https://history.yale.edu/academics/undergraduate-program',
      parser: 'general-guidance',
      department: 'History',
    });

    const records = [
      ...parseGeneralDepartmentResearchPage(ANTHROPOLOGY_HTML, configsByKey.get('anthropology')!),
      ...parseGeneralDepartmentResearchPage(EARTH_HTML, configsByKey.get('earth-planetary-sciences')!),
      ...parseGeneralDepartmentResearchPage(POLITICAL_SCIENCE_HTML, configsByKey.get('political-science')!),
      ...parseGeneralDepartmentResearchPage(HISTORY_HTML, configsByKey.get('history')!),
    ];

    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityKey: 'department-undergrad-research-anthropology',
          name: 'Anthropology Undergraduate Research',
          sourceUrl:
            'https://anthropology.yale.edu/undergraduate-program/undergraduate-research-in-anthropology',
        }),
        expect.objectContaining({
          entityKey: 'department-undergrad-research-earth-and-planetary-sciences',
          name: 'Earth and Planetary Sciences Research Opportunities',
          sourceUrl: 'https://earth.yale.edu/resources',
        }),
        expect.objectContaining({
          entityKey: 'department-undergrad-research-political-science',
          name: 'Political Science Undergraduate Research Opportunities',
          sourceUrl: 'https://politicalscience.yale.edu/academics/about-undergraduate-program',
        }),
        expect.objectContaining({
          entityKey: 'department-undergrad-research-history',
          name: 'History Undergraduate Research',
          sourceUrl: 'https://history.yale.edu/academics/undergraduate-program',
        }),
      ]),
    );

    const observations = departmentUndergradResearchRecordsToObservations(records);
    expect(observations.map((observation) => observation.field)).not.toEqual(
      expect.arrayContaining(['postedOpportunityTitle', 'applicationUrl', 'deadline']),
    );
  });

  it('covers neuroscience, MB&B, and linguistics research pages as source-backed guidance', () => {
    const configsByKey = new Map(
      DEFAULT_DEPARTMENT_UNDERGRAD_RESEARCH_PAGES.map((page) => [page.key, page]),
    );

    expect(configsByKey.get('neuroscience')).toMatchObject({
      url: 'https://neuroscience.yale.edu/research-opportunities',
      parser: 'general-guidance',
      department: 'Neuroscience',
    });
    expect(configsByKey.get('molecular-biophysics-biochemistry')).toMatchObject({
      url: 'https://mbb.yale.edu/introduction-undergraduate-program',
      parser: 'general-guidance',
      department: 'Molecular Biophysics and Biochemistry',
    });
    expect(configsByKey.get('linguistics')).toMatchObject({
      url: 'https://ling.yale.edu/academics/undergraduate/research-opportunities/linguistics-research-opportunities-yale',
      parser: 'general-guidance',
      department: 'Linguistics',
    });

    const records = [
      ...parseGeneralDepartmentResearchPage(NEUROSCIENCE_HTML, configsByKey.get('neuroscience')!),
      ...parseGeneralDepartmentResearchPage(
        MBB_HTML,
        configsByKey.get('molecular-biophysics-biochemistry')!,
      ),
      ...parseGeneralDepartmentResearchPage(LINGUISTICS_HTML, configsByKey.get('linguistics')!),
    ];

    expect(records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityKey: 'department-undergrad-research-neuroscience',
          name: 'Neuroscience Undergraduate Research Opportunities',
          entityType: 'PROGRAM',
          undergradAccessEvidence: true,
          sourceUrl: 'https://neuroscience.yale.edu/research-opportunities',
        }),
        expect.objectContaining({
          entityKey:
            'department-undergrad-research-molecular-biophysics-and-biochemistry',
          name: 'Molecular Biophysics and Biochemistry Undergraduate Research',
          entityType: 'PROGRAM',
          undergradAccessEvidence: true,
          sourceUrl: 'https://mbb.yale.edu/introduction-undergraduate-program',
        }),
        expect.objectContaining({
          entityKey: 'department-undergrad-research-linguistics',
          name: 'Linguistics Undergraduate Research Opportunities',
          entityType: 'PROGRAM',
          undergradAccessEvidence: true,
          sourceUrl:
            'https://ling.yale.edu/academics/undergraduate/research-opportunities/linguistics-research-opportunities-yale',
        }),
      ]),
    );

    // Guidance pages must not masquerade as posted openings with deadlines/application URLs.
    const observations = departmentUndergradResearchRecordsToObservations(records);
    expect(observations.map((observation) => observation.field)).not.toEqual(
      expect.arrayContaining(['postedOpportunityTitle', 'applicationUrl', 'deadline']),
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

  it('rejects unsafe runtime bounds before fetching department pages', async () => {
    for (const [option, message] of [
      [{ offset: 9007199254740992 }, /--offset must be a safe non-negative integer/],
      [{ limit: 9007199254740992 }, /--limit must be a safe positive integer/],
    ] as const) {
      const fetchHtml = vi.fn(async () => PHYSICS_HTML);
      const scraper = new DepartmentUndergradResearchScraper({
        pageConfigs: [
          {
            key: 'physics',
            url: 'https://physics.yale.edu/undergrad',
            department: 'Physics',
            school: 'Yale Faculty of Arts and Sciences',
            parser: 'physics-project-list',
          },
        ],
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
