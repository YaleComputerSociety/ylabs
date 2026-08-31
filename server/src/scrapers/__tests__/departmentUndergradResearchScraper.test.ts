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
  <p>Undergraduate students in Molecular, Cellular and Developmental Biology are encouraged to pursue independent research in a faculty laboratory.</p>
  <p>Students typically identify a faculty mentor whose research interests align with their own and arrange to join the laboratory for course credit or over the summer.</p>
</main>
`;

const TOBIN_HTML = `
<main>
  <h1>Tobin Undergraduate Research Assistantships</h1>
  <p>The Tobin Research Assistantship program places undergraduate students with faculty in the Economics department to support ongoing research projects.</p>
  <p>Contact: coordinator@yale.edu</p>
  <p>Application link: <a href="https://yalesurvey.ca1.qualtrics.com/jfe/form/SV_synthetic">Apply here</a></p>
</main>
`;

const CLICK_HERE_HTML = `
<main>
  <h1>History Undergraduate Research</h1>
  <p>History majors undertake original research projects under the guidance of a faculty adviser during their senior year.</p>
  <p>Click here for more information.</p>
</main>
`;

const URL_FRAGMENT_HTML = `
<main>
  <h1>Neuroscience Undergraduate Research Opportunities</h1>
  <p>Undergraduate students can join a faculty laboratory and apply through the department at https://forms.gle/AbcSyntheticFormXyz to be matched with a research mentor.</p>
</main>
`;

const LEAKED_HEADING_HTML = `
<main>
  <h1>History Undergraduate Research</h1>
  <p>Undergraduate Program</p>
  <p>History majors make extensive use of library resources and create pioneering original research projects with faculty mentors.</p>
</main>
`;

const SUBJECT_LESS_HTML = `
<main>
  <h1>Molecular Biophysics and Biochemistry Undergraduate Research</h1>
  <p>The B.S. is designed for students with a strong interest in research and includes an intensive introduction to modern laboratory procedures.</p>
  <p>Undergraduates conduct research in faculty laboratories during their junior and senior years under close mentorship.</p>
</main>
`;

const CHROME_ONLY_HTML = `
<main>
  <h1>Chemistry Undergraduate Research</h1>
  <p>Home Academics Calendar</p>
  <p>Click here for more information.</p>
  <p>Copyright Yale University. Privacy policy.</p>
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

const CS_RESEARCH_INTERNSHIP_HTML = `
<html>
  <header>
    <nav>
      <a href="https://admissions.yale.edu/apply">Apply</a>
      <a href="https://engineering.yale.edu/">Yale School of Engineering</a>
    </nav>
  </header>
  <main>
    <h1>Research Internship Program</h1>
    <h2>Computer Science</h2>
    <p>The Computer Science Research Internship Program at Yale provides applicants with a unique opportunity to conduct cutting-edge research with leading researchers in the field.</p>
    <p>We welcome applications from all students that are currently pursuing a bachelor, master or PhD degree in Computer Science or related fields.</p>
    <p><a href="https://docs.google.com/forms/d/e/1FAIpQLSyntheticCsRip/viewform">Apply Now</a></p>
    <h2>FAQs</h2>
    <p>A committee of faculty and staff members review applications regularly and try to match applicants with faculty members.</p>
  </main>
</html>
`;

const SOCIOLOGY_HTML = `
<main>
  <h1>Senior Project</h1>
  <p>The intensive major gives undergraduate students an opportunity to undertake a yearlong program of original research resulting in a contribution to sociological knowledge.</p>
  <p>Students use research methods such as participant observation, in-depth interviewing, and secondary analysis of existing data under faculty guidance.</p>
</main>
`;

const BIOMEDICAL_ENGINEERING_HTML = `
<main>
  <h1>Undergraduate Study</h1>
  <h2>Biomedical Engineering</h2>
  <p>Biomedical Engineering at Yale has exciting opportunities and advanced facilities for undergraduate student research projects.</p>
  <p>Undergraduates have the opportunity to engage in practical, impactful research from day one alongside faculty mentors.</p>
</main>
`;

const BACHELOR_ONLY_NO_RESEARCH_HTML = `
<main>
  <h1>Program Overview</h1>
  <p>The program welcomes applicants pursuing a bachelor degree who are interested in coursework and professional development.</p>
</main>
`;

const RESEARCH_WITHOUT_UNDERGRAD_SIGNAL_HTML = `
<main>
  <h1>Faculty Research</h1>
  <p>Our faculty lead an active portfolio of research projects across the discipline.</p>
</main>
`;

const HUMANITIES_SENIOR_ESSAY_HTML = `
<main>
  <h1>Senior Essay</h1>
  <p>Home Academics Calendar.</p>
  <p>In this department, as in others, the Senior Essay consists of an extended research and writing project undertaken with the guidance of a faculty advisor.</p>
  <p>Interested juniors submit a prospectus to the director of undergraduate studies before beginning the senior essay.</p>
</main>
`;

const QUANT_SENIOR_PROJECT_HTML = `
<main>
  <h1>Senior Project</h1>
  <p>The senior project is an opportunity to apply what you have learned to an independent research project, under the mentorship of a faculty advisor, on a topic of mutual interest.</p>
  <p>Students in the major complete the project during their final year of undergraduate study.</p>
</main>
`;

const ENVIRONMENTAL_STUDIES_HTML = `
<main>
  <h1>The EVST Senior Essay</h1>
  <p>The senior thesis is the culmination of the Environmental Studies major for both BA and BS degree programs, and students produce an original research essay that aligns with their concentration.</p>
  <p>In the senior colloquium EVST 4960, students receive regular guidance about the senior thesis research and writing process from their colloquium instructors and a primary Yale faculty thesis advisor.</p>
</main>
`;

const GLOBAL_AFFAIRS_CAPSTONE_HTML = `
<main>
  <h1>Undergraduate Capstone Faculty</h1>
  <p>In place of a senior thesis, Global Affairs seniors may complete a capstone project, an opportunity unique to the major at Yale.</p>
  <p>Working in small groups and overseen by a Yale faculty member, students complete a public policy project on behalf of a client such as a government agency, not-for-profit, or NGO.</p>
</main>
`;

const HISTORY_OF_ART_SENIOR_ESSAY_HTML = `
<main>
  <h1>Senior Essay</h1>
  <p>Home Undergraduate Senior Essay.</p>
  <p>Majors in the History of Art complete a senior essay, an original research and writing project developed with the guidance of a faculty advisor over the senior year.</p>
  <p>Interested students submit a senior essay proposal to the director of undergraduate studies before the research and writing begins.</p>
</main>
`;

const FILM_MEDIA_SENIOR_REQUIREMENT_HTML = `
<main>
  <h1>The Senior Requirement</h1>
  <p>For the student writing a senior essay in Film and Media Studies, several options are possible.</p>
  <p>The student may do independent research on a yearlong senior essay, submitting a brief prospectus to the director of undergraduate studies for approval and consulting regularly with a faculty adviser.</p>
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
      url: 'https://physics.yale.edu/undergrad',
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
        url: 'https://physics.yale.edu/undergrad',
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
        name: 'Chemistry Undergraduate Research',
        undergradAccessEvidence: true,
        contactRole: 'Faculty member for undergraduate research',
      },
    ]);
    expect(records[0].joinPageUrl).toBeUndefined();
  });

  it('keys the MCDB department page on its own department, not a cross-listed foreign program (#598)', () => {
    const mcdbConfig = DEFAULT_DEPARTMENT_UNDERGRAD_RESEARCH_PAGES.find(
      (page) => page.key === 'mcdb',
    );

    expect(mcdbConfig).toMatchObject({
      url: 'https://mcdb.yale.edu/undergraduate/undergraduate-research-opportunities',
      department: 'Molecular, Cellular and Developmental Biology',
      parser: 'general-guidance',
    });

    const records = parseGeneralDepartmentResearchPage(MCDB_HTML, mcdbConfig!);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      entityKey: 'department-undergrad-research-molecular-cellular-and-developmental-biology',
      name: 'Molecular, Cellular and Developmental Biology Undergraduate Research',
      kind: 'program',
      department: 'Molecular, Cellular and Developmental Biology',
      websiteUrl: 'https://mcdb.yale.edu/undergraduate/undergraduate-research-opportunities',
    });
    expect(records[0].entityKey).not.toContain('pediatric');
    expect(records[0].description).toMatch(
      /^Supports undergraduate research in Molecular, Cellular and Developmental Biology\./,
    );
  });

  it('parses structured undergraduate application pages as official application routes', () => {
    const tobinConfig = DEFAULT_DEPARTMENT_UNDERGRAD_RESEARCH_PAGES.find(
      (page) => page.key === 'economics-tobin-ra',
    );

    expect(tobinConfig).toMatchObject({
      department: 'Economics',
      parser: 'structured-opportunity',
    });

    const records = parseStructuredOpportunityPage(TOBIN_HTML, tobinConfig!);

    expect(records).toMatchObject([
      {
        entityKey: 'department-undergrad-research-tobin-undergraduate-research-assistantships',
        kind: 'program',
        department: 'Economics',
        joinPageUrl: 'https://yalesurvey.ca1.qualtrics.com/jfe/form/SV_synthetic',
        contactEmail: 'coordinator@yale.edu',
        contactRole: 'Program contact for undergraduate research',
      },
    ]);
    expect(records[0].description).toMatch(/^Supports undergraduate research in Economics\./);
    expect(records[0].description).not.toContain('coordinator@');
  });

  it('drops sourceChrome, URL fragments, subject-less fragments, and leaked headings (#598)', () => {
    const historyConfig = DEFAULT_DEPARTMENT_UNDERGRAD_RESEARCH_PAGES.find(
      (page) => page.key === 'history',
    )!;
    const neuroscienceConfig = DEFAULT_DEPARTMENT_UNDERGRAD_RESEARCH_PAGES.find(
      (page) => page.key === 'neuroscience',
    )!;
    const mbbConfig = DEFAULT_DEPARTMENT_UNDERGRAD_RESEARCH_PAGES.find(
      (page) => page.key === 'molecular-biophysics-biochemistry',
    )!;

    const [clickHere] = parseGeneralDepartmentResearchPage(CLICK_HERE_HTML, historyConfig);
    expect(clickHere.description).toContain('History majors undertake original research projects');
    expect(clickHere.description).not.toMatch(/click here/i);
    expect(clickHere.description).not.toMatch(/more information/i);

    const [urlFragment] = parseGeneralDepartmentResearchPage(URL_FRAGMENT_HTML, neuroscienceConfig);
    expect(urlFragment.description).toContain('matched with a research mentor');
    expect(urlFragment.description).not.toContain('forms.gle');
    expect(urlFragment.description).not.toContain('AbcSyntheticFormXyz');
    expect(urlFragment.description).not.toMatch(/https?:\/\//);

    const [leakedHeading] = parseGeneralDepartmentResearchPage(LEAKED_HEADING_HTML, historyConfig);
    expect(leakedHeading.description).toContain(
      'History majors make extensive use of library resources',
    );
    expect(leakedHeading.description).not.toContain('Undergraduate Program History majors');

    const [subjectLess] = parseGeneralDepartmentResearchPage(SUBJECT_LESS_HTML, mbbConfig);
    expect(subjectLess.description).toContain(
      'Undergraduates conduct research in faculty laboratories',
    );
    const subjectLessBody = subjectLess.description
      .replace('Supports undergraduate research in Molecular Biophysics and Biochemistry.', '')
      .trim();
    expect(subjectLessBody).toMatch(/^[A-Z]/);
    expect(subjectLess.description).not.toMatch(/Biochemistry\.\s+is designed/);
  });

  it('fails closed to a minimal subject line instead of dumping raw chrome (#598)', () => {
    const chemistryConfig = DEFAULT_DEPARTMENT_UNDERGRAD_RESEARCH_PAGES.find(
      (page) => page.key === 'chemistry',
    )!;

    const [record] = parseGeneralDepartmentResearchPage(CHROME_ONLY_HTML, chemistryConfig);

    expect(record.description).toBe('Supports undergraduate research in Chemistry.');
    expect(record.description).not.toContain('Home Academics');
    expect(record.description).not.toContain('Copyright');
    expect(record.description).not.toMatch(/click here/i);

    const observations = departmentUndergradResearchRecordsToObservations([record]);
    expect(observations.map((observation) => observation.field)).not.toContain(
      'undergradEvidenceQuote',
    );
  });

  it('emits fellowship observations for a department program page', () => {
    const [record] = parseGeneralDepartmentResearchPage(CHEM_HTML, {
      key: 'chemistry',
      url: 'https://chem.yale.edu/academics/undergraduate-chemistry-at-yale/undergraduate-research',
      department: 'Chemistry',
      school: 'Yale Faculty of Arts and Sciences',
      parser: 'general-guidance',
      title: 'Chemistry Undergraduate Research',
    });
    const observations = departmentUndergradResearchRecordsToObservations([record]);

    expect(observations.every((observation) => observation.entityType === 'fellowship')).toBe(true);
    expect(observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityKey: record.entityKey,
          field: 'sourceKey',
          value: record.entityKey,
        }),
        expect.objectContaining({
          entityKey: record.entityKey,
          field: 'title',
          value: record.name,
        }),
        expect.objectContaining({ entityKey: record.entityKey, field: 'programKind' }),
        expect.objectContaining({ entityKey: record.entityKey, field: 'applicationLink' }),
      ]),
    );
  });

  it('emits general department guidance as a program/fellowship, not posted-opportunity fields', () => {
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
        'sourceKey',
        'sourceName',
        'title',
        'summary',
        'description',
        'programCategory',
        'programKind',
        'applicationLink',
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
    const eebConfig = DEFAULT_DEPARTMENT_UNDERGRAD_RESEARCH_PAGES.find(
      (page) => page.key === 'eeb',
    );

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
        sourceUrl: astronomyConfig!.url,
        description: expect.stringContaining('direct supervision of a faculty member'),
        undergradAccessEvidence: true,
      },
      {
        entityKey: 'department-undergrad-research-ecology-and-evolutionary-biology',
        name: 'Ecology and Evolutionary Biology Undergraduate Research Opportunities',
        kind: 'program',
        sourceUrl: eebConfig!.url,
        description: expect.stringContaining('carry out research in the laboratory'),
        undergradAccessEvidence: true,
      },
    ]);
    expect(observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityKey: 'department-undergrad-research-astronomy',
          entityType: 'fellowship',
          field: 'description',
          sourceUrl: astronomyConfig!.url,
          value: expect.stringContaining('undergraduate students'),
        }),
        expect.objectContaining({
          entityKey: 'department-undergrad-research-ecology-and-evolutionary-biology',
          entityType: 'fellowship',
          field: 'title',
          sourceUrl: eebConfig!.url,
          value: 'Ecology and Evolutionary Biology Undergraduate Research Opportunities',
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
      url: 'https://earth.yale.edu/undergraduate-program',
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
      ...parseGeneralDepartmentResearchPage(
        EARTH_HTML,
        configsByKey.get('earth-planetary-sciences')!,
      ),
      ...parseGeneralDepartmentResearchPage(
        POLITICAL_SCIENCE_HTML,
        configsByKey.get('political-science')!,
      ),
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
          sourceUrl: 'https://earth.yale.edu/undergraduate-program',
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
          undergradAccessEvidence: true,
          sourceUrl: 'https://neuroscience.yale.edu/research-opportunities',
        }),
        expect.objectContaining({
          entityKey: 'department-undergrad-research-molecular-biophysics-and-biochemistry',
          name: 'Molecular Biophysics and Biochemistry Undergraduate Research',
          undergradAccessEvidence: true,
          sourceUrl: 'https://mbb.yale.edu/introduction-undergraduate-program',
        }),
        expect.objectContaining({
          entityKey: 'department-undergrad-research-linguistics',
          name: 'Linguistics Undergraduate Research Opportunities',
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

  it('covers Computer Science research internship as an official application route (#1281)', () => {
    const csConfig = DEFAULT_DEPARTMENT_UNDERGRAD_RESEARCH_PAGES.find(
      (page) => page.key === 'computer-science',
    );

    expect(csConfig).toMatchObject({
      url: 'https://engineering.yale.edu/academic-study/departments/computer-science/undergraduate-study/research-internship-program',
      department: 'Computer Science',
      school: 'Yale School of Engineering & Applied Science',
      parser: 'structured-opportunity',
    });

    const records = parseStructuredOpportunityPage(CS_RESEARCH_INTERNSHIP_HTML, csConfig!);

    expect(records).toMatchObject([
      {
        entityKey: 'department-undergrad-research-computer-science-research-internship-program',
        name: 'Computer Science Research Internship Program',
        kind: 'program',
        department: 'Computer Science',
        joinPageUrl: 'https://docs.google.com/forms/d/e/1FAIpQLSyntheticCsRip/viewform',
      },
    ]);
    expect(records[0].description).toMatch(
      /^Supports undergraduate research in Computer Science\./,
    );

    const observations = departmentUndergradResearchRecordsToObservations(records);
    expect(observations.map((observation) => observation.field)).not.toEqual(
      expect.arrayContaining(['postedOpportunityTitle', 'applicationUrl', 'deadline']),
    );
  });

  it('accepts bachelor-degree undergraduate signals so CS-style pages are not dropped (#1281)', () => {
    const csConfig = DEFAULT_DEPARTMENT_UNDERGRAD_RESEARCH_PAGES.find(
      (page) => page.key === 'computer-science',
    )!;

    expect(parseStructuredOpportunityPage(BACHELOR_ONLY_NO_RESEARCH_HTML, csConfig)).toEqual([]);
    expect(
      parseGeneralDepartmentResearchPage(RESEARCH_WITHOUT_UNDERGRAD_SIGNAL_HTML, csConfig),
    ).toEqual([]);
  });

  it('picks the in-content application form over a global navigation apply link (#1281)', () => {
    const csConfig = DEFAULT_DEPARTMENT_UNDERGRAD_RESEARCH_PAGES.find(
      (page) => page.key === 'computer-science',
    )!;

    const [record] = parseStructuredOpportunityPage(CS_RESEARCH_INTERNSHIP_HTML, csConfig);

    expect(record.joinPageUrl).toBe(
      'https://docs.google.com/forms/d/e/1FAIpQLSyntheticCsRip/viewform',
    );
    expect(record.joinPageUrl).not.toContain('admissions.yale.edu');
  });

  it('covers Sociology and Biomedical Engineering undergraduate research pages (#1281)', () => {
    const configsByKey = new Map(
      DEFAULT_DEPARTMENT_UNDERGRAD_RESEARCH_PAGES.map((page) => [page.key, page]),
    );

    expect(configsByKey.get('sociology')).toMatchObject({
      url: 'https://sociology.yale.edu/undergraduate-program/senior-project',
      parser: 'general-guidance',
      department: 'Sociology',
    });
    expect(configsByKey.get('biomedical-engineering')).toMatchObject({
      url: 'https://engineering.yale.edu/academic-study/departments/biomedical-engineering/undergraduate-study',
      school: 'Yale School of Engineering & Applied Science',
      parser: 'general-guidance',
      department: 'Biomedical Engineering',
    });

    const records = [
      ...parseGeneralDepartmentResearchPage(SOCIOLOGY_HTML, configsByKey.get('sociology')!),
      ...parseGeneralDepartmentResearchPage(
        BIOMEDICAL_ENGINEERING_HTML,
        configsByKey.get('biomedical-engineering')!,
      ),
    ];

    expect(records).toMatchObject([
      {
        entityKey: 'department-undergrad-research-sociology',
        name: 'Sociology Undergraduate Research',
        undergradAccessEvidence: true,
        description: expect.stringContaining('yearlong program of original research'),
      },
      {
        entityKey: 'department-undergrad-research-biomedical-engineering',
        name: 'Biomedical Engineering Undergraduate Research',
        undergradAccessEvidence: true,
        description: expect.stringContaining('undergraduate student research projects'),
      },
    ]);

    const observations = departmentUndergradResearchRecordsToObservations(records);
    expect(observations.map((observation) => observation.field)).not.toEqual(
      expect.arrayContaining([
        'postedOpportunityTitle',
        'applicationUrl',
        'deadline',
        'joinPageUrl',
      ]),
    );
  });

  it('configures Statistics and Data Science and humanities senior-essay departments (#1460)', () => {
    const configsByKey = new Map(
      DEFAULT_DEPARTMENT_UNDERGRAD_RESEARCH_PAGES.map((page) => [page.key, page]),
    );

    expect(configsByKey.get('statistics-and-data-science')).toMatchObject({
      url: 'https://statistics.yale.edu/undergraduates/the-major/49104920-senior-essay',
      parser: 'general-guidance',
      department: 'Statistics and Data Science',
    });
    expect(configsByKey.get('english')).toMatchObject({
      url: 'https://english.yale.edu/undergraduate/senior-essay',
      parser: 'general-guidance',
      department: 'English',
    });
    expect(configsByKey.get('comparative-literature')).toMatchObject({
      parser: 'general-guidance',
      department: 'Comparative Literature',
    });
    expect(configsByKey.get('religious-studies')).toMatchObject({
      parser: 'general-guidance',
      department: 'Religious Studies',
    });
    expect(configsByKey.get('american-studies')).toMatchObject({
      parser: 'general-guidance',
      department: 'American Studies',
    });
    expect(configsByKey.get('womens-gender-sexuality-studies')).toMatchObject({
      parser: 'general-guidance',
      department: "Women's, Gender, and Sexuality Studies",
    });

    for (const config of DEFAULT_DEPARTMENT_UNDERGRAD_RESEARCH_PAGES) {
      expect(new URL(config.url).protocol).toBe('https:');
    }
  });

  it('tolerates humanities senior-essay prose and emits source-backed access evidence (#1460)', () => {
    const englishConfig = DEFAULT_DEPARTMENT_UNDERGRAD_RESEARCH_PAGES.find(
      (page) => page.key === 'english',
    )!;

    const [record] = parseGeneralDepartmentResearchPage(
      HUMANITIES_SENIOR_ESSAY_HTML,
      englishConfig,
    );

    expect(record).toMatchObject({
      entityKey: 'department-undergrad-research-english',
      kind: 'program',
      department: 'English',
      undergradAccessEvidence: true,
    });
    expect(record.description).toMatch(/^Supports undergraduate research in English\./);
    expect(record.description).toContain('extended research and writing project');
    expect(record.description).toContain('prospectus to the director of undergraduate studies');
    expect(record.description).not.toMatch(/Home Academics Calendar/);
    expect(record.evidenceQuote).toContain('faculty advisor');
    expect(record.contactEmail).toBeUndefined();
    expect(record.joinPageUrl).toBeUndefined();

    const fields = departmentUndergradResearchRecordsToObservations([record]).map(
      (observation) => observation.field,
    );
    expect(fields).toEqual(
      expect.arrayContaining(['sourceKey', 'title', 'description', 'programKind']),
    );
    expect(fields).not.toEqual(
      expect.arrayContaining([
        'postedOpportunityTitle',
        'opportunityTitle',
        'applicationUrl',
        'deadline',
        'contactEmail',
        'joinPageUrl',
      ]),
    );
  });

  it('tolerates a quantitative senior-project pathway without fabricating openings (#1460)', () => {
    const sdsConfig = DEFAULT_DEPARTMENT_UNDERGRAD_RESEARCH_PAGES.find(
      (page) => page.key === 'statistics-and-data-science',
    )!;

    const [record] = parseGeneralDepartmentResearchPage(QUANT_SENIOR_PROJECT_HTML, sdsConfig);

    expect(record).toMatchObject({
      entityKey: 'department-undergrad-research-statistics-and-data-science',
      department: 'Statistics and Data Science',
      undergradAccessEvidence: true,
    });
    expect(record.description).toContain('independent research project');
    expect(record.evidenceQuote).toContain('senior project');

    const fields = departmentUndergradResearchRecordsToObservations([record]).map(
      (observation) => observation.field,
    );
    expect(fields).toContain('description');
    expect(fields).not.toEqual(
      expect.arrayContaining([
        'postedOpportunityTitle',
        'applicationUrl',
        'deadline',
        'joinPageUrl',
      ]),
    );
  });

  it('still drops research pages that carry neither an undergraduate nor a senior-essay signal (#1460)', () => {
    const englishConfig = DEFAULT_DEPARTMENT_UNDERGRAD_RESEARCH_PAGES.find(
      (page) => page.key === 'english',
    )!;

    expect(
      parseGeneralDepartmentResearchPage(RESEARCH_WITHOUT_UNDERGRAD_SIGNAL_HTML, englishConfig),
    ).toEqual([]);
  });

  it('covers Environmental Studies, Global Affairs, History of Art, and Film & Media Studies pathway pages (#1647)', () => {
    const configsByKey = new Map(
      DEFAULT_DEPARTMENT_UNDERGRAD_RESEARCH_PAGES.map((page) => [page.key, page]),
    );

    expect(configsByKey.get('environmental-studies')).toMatchObject({
      url: 'https://evst.yale.edu/evst-senior-essay',
      parser: 'general-guidance',
      department: 'Environmental Studies',
    });
    expect(configsByKey.get('global-affairs')).toMatchObject({
      url: 'https://jackson.yale.edu/faculty-research/undergraduate-capstone-faculty',
      parser: 'general-guidance',
      department: 'Global Affairs',
      school: 'Jackson School of Global Affairs',
    });
    expect(configsByKey.get('history-of-art')).toMatchObject({
      url: 'https://arthistory.yale.edu/undergraduate/senior-essay',
      parser: 'general-guidance',
      department: 'History of Art',
    });
    expect(configsByKey.get('film-and-media-studies')).toMatchObject({
      url: 'https://filmstudies.yale.edu/undergraduate/senior-requirement',
      parser: 'general-guidance',
      department: 'Film and Media Studies',
    });

    const records = [
      ...parseGeneralDepartmentResearchPage(
        ENVIRONMENTAL_STUDIES_HTML,
        configsByKey.get('environmental-studies')!,
      ),
      ...parseGeneralDepartmentResearchPage(
        GLOBAL_AFFAIRS_CAPSTONE_HTML,
        configsByKey.get('global-affairs')!,
      ),
      ...parseGeneralDepartmentResearchPage(
        HISTORY_OF_ART_SENIOR_ESSAY_HTML,
        configsByKey.get('history-of-art')!,
      ),
      ...parseGeneralDepartmentResearchPage(
        FILM_MEDIA_SENIOR_REQUIREMENT_HTML,
        configsByKey.get('film-and-media-studies')!,
      ),
    ];

    expect(records).toMatchObject([
      {
        entityKey: 'department-undergrad-research-environmental-studies',
        name: 'Environmental Studies Senior Essay Research',
        undergradAccessEvidence: true,
        description: expect.stringContaining('original research essay'),
      },
      {
        entityKey: 'department-undergrad-research-global-affairs',
        name: 'Global Affairs Undergraduate Capstone Research',
        undergradAccessEvidence: true,
        description: expect.stringContaining('capstone project'),
      },
      {
        entityKey: 'department-undergrad-research-history-of-art',
        name: 'History of Art Senior Essay Research',
        undergradAccessEvidence: true,
        description: expect.stringContaining('original research and writing project'),
      },
      {
        entityKey: 'department-undergrad-research-film-and-media-studies',
        name: 'Film and Media Studies Senior Essay Research',
        undergradAccessEvidence: true,
        description: expect.stringContaining('independent research'),
      },
    ]);

    const capstoneRecord = records.find(
      (record) => record.entityKey === 'department-undergrad-research-global-affairs',
    )!;
    expect(capstoneRecord.evidenceQuote).toContain('capstone project');

    const fields = departmentUndergradResearchRecordsToObservations(records).map(
      (observation) => observation.field,
    );
    expect(fields).toEqual(
      expect.arrayContaining(['sourceKey', 'title', 'description', 'programKind']),
    );
    expect(fields).not.toEqual(
      expect.arrayContaining([
        'postedOpportunityTitle',
        'applicationUrl',
        'deadline',
        'joinPageUrl',
      ]),
    );
  });

  it('recognizes an undergraduate capstone project as a senior research pathway (#1647)', () => {
    const globalAffairsConfig = DEFAULT_DEPARTMENT_UNDERGRAD_RESEARCH_PAGES.find(
      (page) => page.key === 'global-affairs',
    )!;

    const [record] = parseGeneralDepartmentResearchPage(
      GLOBAL_AFFAIRS_CAPSTONE_HTML,
      globalAffairsConfig,
    );

    expect(record.description).toMatch(/^Supports undergraduate research in Global Affairs\./);
    expect(record.description).toContain('capstone project');
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

  it('skips a page whose fetch fails and still processes the remaining pages (#2171)', async () => {
    const scraper = new DepartmentUndergradResearchScraper({
      pageConfigs: [
        {
          key: 'physics',
          url: 'https://physics.yale.edu/dead-page',
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
      fetchHtml: async (url) => {
        if (url.includes('physics')) {
          const error = new Error('Request failed with status code 404') as Error & {
            response?: { status: number };
          };
          error.response = { status: 404 };
          throw error;
        }
        return CHEM_HTML;
      },
    });
    const emitted: ObservationInput[] = [];

    const result = await scraper.run(buildContext(scraper, emitted));

    expect(result.entitiesObserved).toBe(1);
    expect(result.observationCount).toBe(emitted.length);
    expect(emitted.length).toBeGreaterThan(0);
    expect(new Set(emitted.map((obs) => obs.sourceUrl))).toEqual(
      new Set(['https://chem.yale.edu/undergrad']),
    );
    expect(result.notes).toContain('1 page(s) skipped after fetch/parse failure');
    expect(result.fetchMetrics?.summary).toMatchObject({ total: 2, succeeded: 1, failed: 1 });
    expect(result.fetchMetrics?.attempts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target: 'https://physics.yale.edu/dead-page',
          success: false,
          statusCode: 404,
        }),
        expect.objectContaining({ target: 'https://chem.yale.edu/undergrad', success: true }),
      ]),
    );
  });

  it('skips a page whose body cannot be parsed and still processes the remaining pages (#2171)', async () => {
    const scraper = new DepartmentUndergradResearchScraper({
      pageConfigs: [
        {
          key: 'physics',
          url: 'https://physics.yale.edu/dead-page',
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
      fetchHtml: async (url) => (url.includes('physics') ? (null as unknown as string) : CHEM_HTML),
    });
    const emitted: ObservationInput[] = [];

    const result = await scraper.run(buildContext(scraper, emitted));

    expect(result.entitiesObserved).toBe(1);
    expect(result.observationCount).toBe(emitted.length);
    expect(new Set(emitted.map((obs) => obs.sourceUrl))).toEqual(
      new Set(['https://chem.yale.edu/undergrad']),
    );
    expect(result.notes).toContain('1 page(s) skipped after fetch/parse failure');
    expect(result.fetchMetrics?.summary).toMatchObject({
      total: 2,
      succeeded: 1,
      failed: 1,
      selectorBreakages: 1,
    });
    expect(result.fetchMetrics?.attempts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target: 'https://physics.yale.edu/dead-page',
          success: false,
          selectorBreakage: true,
        }),
      ]),
    );
  });

  it('fails the run when every attempted page fails so source health stays loud (#2171)', async () => {
    const scraper = new DepartmentUndergradResearchScraper({
      pageConfigs: [
        {
          key: 'physics',
          url: 'https://physics.yale.edu/dead-page',
          department: 'Physics',
          school: 'Yale Faculty of Arts and Sciences',
          parser: 'physics-project-list',
        },
        {
          key: 'chemistry',
          url: 'https://chem.yale.edu/dead-page',
          department: 'Chemistry',
          school: 'Yale Faculty of Arts and Sciences',
          parser: 'general-guidance',
          title: 'Chemistry Undergraduate Research',
        },
      ],
      fetchHtml: async () => {
        throw new Error('Request failed with status code 404');
      },
    });
    const emitted: ObservationInput[] = [];

    await expect(scraper.run(buildContext(scraper, emitted))).rejects.toThrow(
      /Every attempted department undergraduate research page failed \(2\/2\)/,
    );
    expect(emitted).toEqual([]);
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

  it('points every configured page at a student-facing research engagement path so its sourceUrl clears the organizational access-path gate (#1359)', () => {
    const engagementPath =
      /(undergrad|research|opportunit|for-students|senior-essay|senior-project)/i;
    const offenders = DEFAULT_DEPARTMENT_UNDERGRAD_RESEARCH_PAGES.filter((page) => {
      const path = new URL(page.url).pathname;
      return !engagementPath.test(path);
    }).map((page) => `${page.key} -> ${page.url}`);

    expect(offenders).toEqual([]);
  });
});
