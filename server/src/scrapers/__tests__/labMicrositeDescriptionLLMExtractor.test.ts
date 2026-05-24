import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getCached, setCached } from '../snapshotCache';
import {
  LabMicrositeDescriptionLLMExtractor,
  candidateDescriptionCrawlUrls,
  candidateDescriptionSupplementalUrls,
  descriptionCandidateFromResearchEntityDoc,
  descriptionExtractionToObservations,
  descriptionExtractionFromHomePage,
  descriptionLooksWeak,
  discoverDescriptionSubPageUrls,
  normalizeDescriptionExtraction,
  selectDescriptionTargets,
  sourceUrlForDescriptionExtraction,
  usableDescriptionWebsiteUrlFromDoc,
  type DescriptionCandidateEntity,
  type DescriptionLLMExtraction,
  type FetchedPage,
  type LabMicrositeDescriptionLLMExtractorDeps,
  type WorkPlanLoaderFn,
} from '../sources/labMicrositeDescriptionLLMExtractor';
import type { ObservationInput, ScraperContext } from '../types';

vi.mock('../snapshotCache', () => ({
  getCached: vi.fn(async () => null),
  setCached: vi.fn(async () => undefined),
}));

function makeContext(
  overrides: Partial<ScraperContext['options']> = {},
): { ctx: ScraperContext; emitted: ObservationInput[]; logs: string[] } {
  const emitted: ObservationInput[] = [];
  const logs: string[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'test-run',
    sourceId: 'test-source',
    sourceName: 'lab-microsite-description-llm',
    sourceWeight: 0.55,
    options: {
      dryRun: true,
      useCache: false,
      release: false,
      ...overrides,
    },
    emit: async (obs) => {
      emitted.push(...(Array.isArray(obs) ? obs : [obs]));
    },
    log: (msg) => logs.push(msg),
  };
  return { ctx, emitted, logs };
}

const alwaysFetchWorkPlan: WorkPlanLoaderFn = async (entity, policy) => ({
  entityType: policy.entityType,
  entityKey: entity.slug,
  sourceName: policy.sourceName,
  fields: policy.targetFields.map((field) => ({
    field,
    shouldFetch: true,
    reason: 'missing' as const,
  })),
  shouldFetch: true,
});

function newTestScraper(
  deps: LabMicrositeDescriptionLLMExtractorDeps,
): LabMicrositeDescriptionLLMExtractor {
  return new LabMicrositeDescriptionLLMExtractor({
    workPlanLoader: alwaysFetchWorkPlan,
    renderedFetcher: null,
    ...deps,
  });
}

function makeFetchPage(pages: Record<string, string>) {
  return vi.fn(async (url: string): Promise<FetchedPage | null> => {
    if (pages[url] !== undefined) return { url, html: pages[url] };
    return null;
  });
}

const RESEARCH_HOME_HTML = `
<html><body>
  <h1>Example Cognition Lab</h1>
  <p>The lab studies social cognition, intergroup attitudes, and the development of social categories.</p>
  <a href="/research">Research</a>
</body></html>
`;

const RESEARCH_PAGE_HTML = `
<html><body>
  <h2>Research</h2>
  <p>Projects examine how children and adults reason about social groups using behavioral experiments,
  developmental studies, and computational models of category learning.</p>
</body></html>
`;

const extraction: DescriptionLLMExtraction = {
  fullDescription:
    'The lab studies social cognition across development, with projects on how children and adults form, apply, and revise beliefs about social groups. Its work combines behavioral experiments, developmental studies, and computational models of category learning.',
  shortDescription:
    'Studies social cognition, intergroup attitudes, and social category development.',
  researchAreas: ['social cognition', 'developmental psychology', 'intergroup attitudes'],
  evidenceQuote: 'Projects examine how children and adults reason about social groups',
};

describe('descriptionCandidateFromResearchEntityDoc', () => {
  it('does not use the YSM lab websites index as a description target website fallback', () => {
    expect(
      descriptionCandidateFromResearchEntityDoc({
        _id: 'entity-sample-lab',
        slug: 'ysm-sample-lab',
        name: 'Sample Lab',
        websiteUrl: '',
        sourceUrls: [
          'https://medicine.yale.edu/about/a-to-z-index/atoz/lab-websites/',
          'https://medicine.yale.edu/lab/sample/',
        ],
      }),
    ).toMatchObject({
      slug: 'ysm-sample-lab',
      websiteUrl: 'https://medicine.yale.edu/lab/sample/',
    });
  });

  it('does not use generic CMS links as description targets', () => {
    expect(
      descriptionCandidateFromResearchEntityDoc({
        _id: 'entity-example-faculty',
        slug: 'dept-cs-example-faculty',
        name: 'Example Faculty — Research',
        websiteUrl: 'http://wordpress.org/',
        sourceUrls: [
          'https://engineering.yale.edu/academic-study/departments/computer-science/faculty/load_faculty/4841',
          'https://campuspress.yale.edu/examplefaculty/',
          'http://wordpress.org/',
        ],
      }),
    ).toMatchObject({
      slug: 'dept-cs-example-faculty',
      websiteUrl: 'https://campuspress.yale.edu/examplefaculty/',
    });
  });

  it('uses the research home instead of member roster pages for description extraction', () => {
    expect(
      usableDescriptionWebsiteUrlFromDoc({
        websiteUrl: 'https://quantuminstitute.yale.edu/people/members',
      }),
    ).toBe('https://quantuminstitute.yale.edu/');

    expect(
      usableDescriptionWebsiteUrlFromDoc({
        websiteUrl: 'https://medicine.yale.edu/lab/fixture-airway/members',
      }),
    ).toBe('https://medicine.yale.edu/lab/fixture-airway/');

    expect(
      usableDescriptionWebsiteUrlFromDoc({
        websiteUrl: 'https://whc.yale.edu/people/our-people',
      }),
    ).toBe('https://whc.yale.edu/');
  });

  it('does not target department rosters but can use official profile pages as description sources', () => {
    expect(
      usableDescriptionWebsiteUrlFromDoc({
        websiteUrl: 'https://economics.yale.edu/people?page=3',
        sourceUrls: [
          'https://economics.yale.edu/people?page=3',
          'https://economics.yale.edu/people/example-economist',
        ],
      }),
    ).toBe('https://economics.yale.edu/people/example-economist');

    expect(
      usableDescriptionWebsiteUrlFromDoc({
        websiteUrl: 'https://mcdb.yale.edu/profile/fixture-scientist-phd',
      }),
    ).toBe('');

    expect(
      usableDescriptionWebsiteUrlFromDoc({
        websiteUrl: 'https://medicine.yale.edu/labmed/',
        sourceUrls: [
          'https://medicine.yale.edu/labmed/',
          'https://medicine.yale.edu/profile/example-clinician/',
        ],
      }),
    ).toBe('https://medicine.yale.edu/profile/example-clinician/');

    expect(
      usableDescriptionWebsiteUrlFromDoc({
        websiteUrl: '',
        sourceUrls: [
          'https://engineering.yale.edu/research-and-faculty/faculty-directory/example-engineer',
        ],
      }),
    ).toBe('https://engineering.yale.edu/research-and-faculty/faculty-directory/example-engineer');

    expect(
      usableDescriptionWebsiteUrlFromDoc({
        websiteUrl: 'https://economics.yale.edu/people?page=13',
        sourceUrls: [
          'https://economics.yale.edu/people?page=13',
          'https://economics.yale.edu/people/senior-economist',
        ],
      }),
    ).toBe('https://economics.yale.edu/people/senior-economist');

    expect(
      usableDescriptionWebsiteUrlFromDoc({
        websiteUrl: 'https://economics.yale.edu/people?page=1',
        sourceUrls: [
          'https://economics.yale.edu/people?page=1',
          'https://economics.yale.edu/people/example-economist',
          'https://example-economist.example.edu/',
        ],
      }),
    ).toBe('https://example-economist.example.edu/');
  });

  it('retains official Engineering profile URLs as supplemental evidence sources', () => {
    const candidate = descriptionCandidateFromResearchEntityDoc({
      _id: 'entity-example-engineer',
      slug: 'dept-seas-example-engineer',
      name: 'Example Engineer — Research',
      websiteUrl: 'https://example-engineer.example.edu/',
      sourceUrls: [
        'https://engineering.yale.edu/research-and-faculty/faculty-directory/load_faculty/172',
        'https://engineering.yale.edu/research-and-faculty/faculty-directory/example-engineer',
        'https://example-engineer.example.edu/',
      ],
    });

    expect(candidate.websiteUrl).toBe('https://example-engineer.example.edu/');
    expect(candidateDescriptionSupplementalUrls(candidate)).toEqual([
      'https://engineering.yale.edu/research-and-faculty/faculty-directory/example-engineer',
    ]);
  });

  it('retains official Economics profile URLs as supplemental evidence sources', () => {
    const candidate = descriptionCandidateFromResearchEntityDoc({
      _id: 'entity-example-economist',
      slug: 'dept-econ-example-economist',
      name: 'Example Economist Lab',
      websiteUrl: 'https://example-economist.example.edu/',
      sourceUrls: [
        'https://economics.yale.edu/people?page=1',
        'https://economics.yale.edu/people/example-economist',
        'https://example-economist.example.edu/',
      ],
    });

    expect(candidate.websiteUrl).toBe('https://example-economist.example.edu/');
    expect(candidateDescriptionSupplementalUrls(candidate)).toEqual([
      'https://economics.yale.edu/people/example-economist',
      'https://som.yale.edu/faculty-research/faculty-directory/example-economist',
    ]);
  });

  it('generates official faculty profile fallbacks for sparse department rows', () => {
    const economist = descriptionCandidateFromResearchEntityDoc({
      _id: 'entity-sparse-economist',
      slug: 'dept-econ-sparse-economist',
      name: 'Sparse Economist Lab',
      websiteUrl: 'https://sparse-economist.example.edu/',
      sourceUrls: [
        'https://economics.yale.edu/people?page=1',
        'https://economics.yale.edu/people/sparse-economist',
        'https://sparse-economist.example.edu/',
      ],
    });
    expect(candidateDescriptionSupplementalUrls(economist)).toEqual([
      'https://economics.yale.edu/people/sparse-economist',
      'https://som.yale.edu/faculty-research/faculty-directory/sparse-economist',
    ]);

    const engineer = descriptionCandidateFromResearchEntityDoc({
      _id: 'entity-sparse-engineer',
      slug: 'dept-cs-sparse-engineer',
      name: 'Sparse Engineer Lab',
      websiteUrl: 'https://sparse-engineer.example.edu/',
      sourceUrls: [
        'https://engineering.yale.edu/academic-study/departments/computer-science/faculty/load_faculty/4841',
        'https://sparse-engineer.example.edu/',
      ],
    });
    expect(candidateDescriptionSupplementalUrls(engineer)).toEqual([
      'https://engineering.yale.edu/research-and-faculty/faculty-directory/sparse-engineer',
    ]);
  });
});

describe('descriptionLooksWeak', () => {
  it('treats missing, short, and generic roster-derived descriptions as weak', () => {
    expect(descriptionLooksWeak('')).toBe(true);
    expect(descriptionLooksWeak('Research area: Neuroscience.')).toBe(true);
    expect(descriptionLooksWeak('Research areas include cognition and development.')).toBe(true);
    expect(descriptionLooksWeak('Studies biology.')).toBe(true);
    expect(
      descriptionLooksWeak(
        'Fixture Metadata Lab is a Yale research home connected to EASCEE CEE Faculty, EAS School of Engineering and Applied Science, and . This context is synthesized from indexed Yale metadata and should be checked against official sources before outreach.',
      ),
    ).toBe(true);
    expect(
      descriptionLooksWeak(
        'The goal of our laboratory is to bring together chemistry and neuroscience, with the aim of advancing knowledge about normal physiology and developing',
      ),
    ).toBe(true);
    expect(
      descriptionLooksWeak(
        'Professor Fixture is Assistant Professor of Anthropology and Principal Investigator of the Human Evolutionary Genomics Laboratory at Yale University.',
      ),
    ).toBe(true);
    expect(
      descriptionLooksWeak(
        'Director of Department Cores, Therapeutic Radiology Radiobiology Course Director, Therapeutic Radiology Director of Department Cores, Therapeutic Radiology Radiobiology Course Director, Therapeutic Radiology Director of Department...',
      ),
    ).toBe(true);
    expect(descriptionLooksWeak('Publications TimelineA big-picture view of P.')).toBe(true);
    expect(
      descriptionLooksWeak(
        'News People Projects Publications Opportunities Contact Example Research Lab What We Do About us The natural world is filled with soft, adaptive systems capable of stably and safely interacting with their environme.',
      ),
    ).toBe(true);
    expect(
      descriptionLooksWeak(
        'Our group focuses on using tau leptons to probe for and characterize physics beyond the standard model at the ATLAS Experiment at CERN’s Large Hadron Collider. We are also involved in hunting for signs of new physics at the Mu2e Experiment at Fermilab.',
      ),
    ).toBe(true);
  });

  it('keeps specific student-facing descriptions', () => {
    expect(
      descriptionLooksWeak(
        'The lab studies how children and adults reason about social groups using behavioral experiments and computational models.',
      ),
    ).toBe(false);
  });

  it('treats Cancer Center profile navigation chrome as weak', () => {
    expect(
      descriptionLooksWeak(
        'Ruby Tu is an Associate Research Scientist at Yale School of Medicine AdministrationNCI DesignationHistoryCommunity OutreachCommunity Advisory BoardProgramsBy the NumbersInformation & ResourcesResearchTrainingMeet Our TeamPatient InformationCancer TypesCenter for Breast CancerYSM HomeINFORMATION FORAbout YSMFacultyStaffStudentsResidents & FellowsPatientsResearchersAlumni',
      ),
    ).toBe(true);

    expect(
      descriptionLooksWeak(
        "View Doctor ProfileAdditional TitlesAssistant Professor, Biomedical Informatics & Data ScienceClinical Member, Cancer Prevention and Control Program View this doctor's clinical profile on the Yale Medicine website for information about the services we offer and making an appointment.",
      ),
    ).toBe(true);
  });

  it('treats appointment-only Engineering profile copy as weak', () => {
    expect(
      descriptionLooksWeak(
        'Senior Lecturer of Computer Science Example Faculty is faculty at Yale Engineering. See the campus, culture, and people that make Yale Engineering a top-ranked program.',
      ),
    ).toBe(true);
  });
});

describe('selectDescriptionTargets', () => {
  const candidates: DescriptionCandidateEntity[] = [
    {
      _id: '1',
      slug: 'missing-description',
      name: 'Missing',
      websiteUrl: 'https://missing.example.edu/',
      description: '',
    },
    {
      _id: '2',
      slug: 'weak-description',
      name: 'Weak',
      websiteUrl: 'https://weak.example.edu/',
      description: 'Research area: Cognition.',
    },
    {
      _id: '3',
      slug: 'strong-description',
      name: 'Strong',
      websiteUrl: 'https://strong.example.edu/',
      description:
        'The lab studies memory systems using behavioral experiments, neuroimaging, and computational models.',
    },
    {
      _id: '4',
      slug: 'locked-description',
      name: 'Locked',
      websiteUrl: 'https://locked.example.edu/',
      description: '',
      manuallyLockedFields: ['description'],
    },
    {
      _id: '5',
      slug: 'archived-description',
      name: 'Archived',
      websiteUrl: 'https://archived.example.edu/',
      archived: true,
    },
    {
      _id: '6',
      slug: 'no-site',
      name: 'No Site',
      websiteUrl: '',
      description: '',
      fullDescription:
        'The Fixture Relativity Lab investigates gravitational physics, particularly the global properties of solutions to geometric field equations, aiming to characterize stability and singularity formation. The lab uses mathematical methods to study nonlinear field equations.',
      shortDescription:
        "Fixture Relativity's research focuses on analyzing the global properties of solutions to geometric field equations with a view towards...",
    },
    {
      _id: '7',
      slug: 'faculty-research-area-profile-only',
      name: 'Profile Only Research',
      websiteUrl: 'https://profiles.example.edu/profile-only',
      description: '',
    },
    {
      _id: '8',
      slug: 'copied-short-description',
      name: 'Copied Short Lab',
      websiteUrl: 'https://copied-short.example.edu/',
      fullDescription:
        'The lab investigates memory systems using behavioral experiments, neuroimaging, and computational models. Projects examine how people encode and retrieve social information across development. The group also develops open datasets for cognitive neuroscience.',
      shortDescription:
        'The lab investigates memory systems using behavioral experiments, neuroimaging, and computational models.',
    },
  ];

  it('includes active research homes with usable websites and missing or weak descriptions', () => {
    expect(selectDescriptionTargets(candidates, {}).map((entity) => entity.slug)).toEqual([
      'copied-short-description',
      'missing-description',
      'weak-description',
      'strong-description',
      'locked-description',
      'no-site',
    ]);
  });

  it('honors --only as an explicit reprocess list before offset and limit', () => {
    const out = selectDescriptionTargets(candidates, {
      only: ['good-description', 'weak-description', 'missing-description'],
      offset: 1,
      limit: 1,
    });
    expect(out.map((entity) => entity.slug)).toEqual(['weak-description']);
  });

  it('uses official Engineering profile URLs as fetch targets for weak rows without homepages', () => {
    const out = selectDescriptionTargets(
      [
        {
          slug: 'official-profile-only',
          name: 'Official Profile Only Lab',
          websiteUrl:
            'https://engineering.yale.edu/research-and-faculty/faculty-directory/example-engineer',
          sourceUrls: [
            'https://engineering.yale.edu/research-and-faculty/faculty-directory/example-engineer',
          ],
          fullDescription:
            'Official Profile Only Lab is a Yale research home connected to CPSC - Computer Science and . This context is synthesized from indexed Yale metadata and should be checked against official sources before outreach.',
          shortDescription: 'Research home connected to CPSC - Computer Science and .',
        },
      ],
      { only: ['official-profile-only'] },
    );

    expect(out.map((entity) => entity.slug)).toEqual(['official-profile-only']);
  });

  it('prioritizes lab microsites over center pages for limited dry runs', () => {
    const out = selectDescriptionTargets(
      [
        {
          slug: 'center-jackson-program',
          name: 'Jackson Program',
          websiteUrl: 'https://jackson.yale.edu/centers-initiatives/example/',
          description: '',
        },
        {
          slug: 'dept-mcdb-example',
          name: 'Example Lab',
          websiteUrl: 'https://medicine.yale.edu/lab/example/',
          description: '',
        },
        {
          slug: 'dept-econ-personal',
          name: 'Personal Site Lab',
          websiteUrl: 'https://campuspress.yale.edu/person/',
          description: '',
        },
      ],
      { limit: 2 },
    );

    expect(out.map((entity) => entity.slug)).toEqual([
      'dept-mcdb-example',
      'dept-econ-personal',
    ]);
  });
});

describe('description crawl URL selection', () => {
  it('keeps nested lab microsite links inside the lab path and skips global same-host navigation', () => {
    const html = `
      <a href="/about">About Yale Medicine</a>
      <a href="/lab/fixture-research/research">Research</a>
      <a href="/lab/fixture-research/interdisciplinary-research">Interdisciplinary Research</a>
      <a href="/lab/fixture-research/projects#current">Projects</a>
    `;

    expect(
      discoverDescriptionSubPageUrls(html, 'https://medicine.yale.edu/lab/fixture-research/'),
    ).toEqual([
      'https://medicine.yale.edu/lab/fixture-research/research',
      'https://medicine.yale.edu/lab/fixture-research/projects',
    ]);

    expect(
      candidateDescriptionCrawlUrls(html, 'https://medicine.yale.edu/lab/fixture-research/', 5),
    ).toEqual([
      'https://medicine.yale.edu/lab/fixture-research/research',
      'https://medicine.yale.edu/lab/fixture-research/projects',
      'https://medicine.yale.edu/lab/fixture-research/science',
      'https://medicine.yale.edu/lab/fixture-research/work',
      'https://medicine.yale.edu/lab/fixture-research/about',
    ]);
  });

  it('discovers same-site iframe pages before generic fallback paths', () => {
    const html = `
      <iframe src="right.html"></iframe>
      <iframe src="https://elsewhere.example.edu/research.html"></iframe>
    `;

    expect(
      candidateDescriptionCrawlUrls(html, 'https://www.eng.yale.edu/fixturelab/', 3),
    ).toEqual([
      'https://www.eng.yale.edu/fixturelab/right.html',
      'https://www.eng.yale.edu/fixturelab/research',
      'https://www.eng.yale.edu/fixturelab/projects',
    ]);
  });
});

describe('descriptionExtractionToObservations', () => {
  it('builds source-backed full and short descriptions from official homepage metadata', () => {
    const extraction = descriptionExtractionFromHomePage({
      url: 'https://fabrication.example.edu/',
      html: `
        <html>
          <head>
            <meta name="description" content="The Fabrication Lab pursues innovation at the intersection of manufacturing, materials, and robotics. Led by Professor Example." />
          </head>
          <body>
            <h1>The Fabrication Lab</h1>
            <p>The natural world is filled with soft, adaptive systems capable of stably and safely interacting with their environment. The group uses soft robotics experiments, materials design, and fabrication methods to build adaptive machines.</p>
          </body>
        </html>
      `,
    });

    expect(extraction?.shortDescription).toBe(
      'The Fabrication Lab pursues innovation at the intersection of manufacturing, materials, and robotics, using soft robotics experiments, materials design, and fabrication methods.',
    );
    expect(extraction?.fullDescription).toContain(
      'Led by Professor Example.',
    );
    expect([...(extraction?.researchAreas || [])].sort()).toEqual([
      'fabrication',
      'manufacturing',
      'materials',
      'robotics',
      'soft robotics',
    ]);
  });

  it('does not append generic page chrome as the homepage full description', () => {
    const extraction = descriptionExtractionFromHomePage({
      url: 'https://medicine.yale.edu/lab/example/',
      html: `
        <html>
          <head>
            <meta name="description" content="The Example Lab studies airway disease mechanisms using patient samples, molecular assays, and translational models to understand inflammation and tissue repair." />
          </head>
          <body>
            <p>INFORMATION FOR</p>
            <p>Prospective Students Current Students Faculty Staff Alumni</p>
            <p>The laboratory investigates inflammatory pathways in airway disease using patient samples and translational models.</p>
          </body>
        </html>
      `,
    });

    expect(extraction?.fullDescription).toBe(
      'The Example Lab studies airway disease mechanisms using patient samples, molecular assays, and translational models to understand inflammation and tissue repair. The laboratory investigates inflammatory pathways in airway disease using patient samples and translational models.',
    );
  });

  it('keeps the official body paragraph when Yale Medicine metadata is a truncated prefix', () => {
    const extraction = descriptionExtractionFromHomePage({
      url: 'https://medicine.yale.edu/lab/fixture-airway/',
      html: `
        <html>
          <head>
            <meta name="description" content="Our lab focuses on the Pathogenesis of airway diseases with a focus on asthma and asthma severity, the role of chitinases in the development and severity of" />
          </head>
          <body>
            <p>INFORMATION FOR</p>
            <h2>Research Focus</h2>
            <p>Our lab focuses on the Pathogenesis of airway diseases with a focus on asthma and asthma severity, the role of chitinases in the development and severity of asthma, and expression and genotype-phenotype relationships of novel inflammatory molecules.</p>
          </body>
        </html>
      `,
    });

    expect(extraction).toMatchObject({
      fullDescription:
        'Focuses on the Pathogenesis of airway diseases with a focus on asthma and asthma severity, the role of chitinases in the development and severity of asthma, and expression and genotype-phenotype relationships of novel inflammatory molecules.',
      shortDescription:
        'Studies the Pathogenesis of airway diseases with a focus on asthma and asthma severity, the role of chitinases in the development and severity of asthma, and expression and genotype-phenotype relationships of novel inflammatory molecules.',
    });
    expect(extraction?.evidenceQuote).toMatch(
      /^Our lab focuses on the Pathogenesis of airway diseases/,
    );
    expect(extraction?.evidenceQuote.length).toBeLessThanOrEqual(240);
  });

  it('uses a substantial official homepage paragraph when metadata is missing', () => {
    const extraction = descriptionExtractionFromHomePage({
      url: 'https://quantuminstitute.yale.edu/',
      html: `
        <html>
          <body>
            <p>Home of Everything Quantum at Yale</p>
            <p>Founded in 2014 and spanning 30 research groups, the Fixture Quantum Institute serves as a forum to bring together experimental and theoretical researchers and students in the field of quantum information science on campus. In addition to research, FQI offers an active quantum science outreach program, including a synthetic artist residency, to make quantum science accessible through art and the humanities.</p>
          </body>
        </html>
      `,
    });

    expect(extraction).toMatchObject({
      fullDescription:
        'Founded in 2014 and spanning 30 research groups, the Fixture Quantum Institute serves as a forum to bring together experimental and theoretical researchers and students in the field of quantum information science on campus. In addition to research, FQI offers an active quantum science outreach program, including a synthetic artist residency, to make quantum science accessible through art and the humanities.',
      shortDescription:
        'Founded in 2014 and spanning 30 research groups, the Fixture Quantum Institute serves as a forum to bring together experimental and theoretical researchers and students in the field of quantum information science on campus.',
    });
  });

  it('extracts first-person research-page prose from YaleSites lab pages', () => {
    const extraction = descriptionExtractionFromHomePage({
      url: 'https://quantum-matter.example.edu/research',
      html: `
        <html><body>
          <h1>Research</h1>
          <h2>Quantum matter</h2>
          <p>I actively engage in the study of quantum mechanics of large ensembles of particles in condensed systems, collectively refered to as quantum matter. I use first-principle modeling of experiments as a starting point, combined with many-body approaches to study emergent quantum states.</p>
          <h2>Non-equilibrium quantum dynamics</h2>
          <p>Using field theoretic and numerical approaches, I investigate the non-equilibrium and time-resolved spectroscopy of large, complex systems, including correlated electron-phonon solids, Rydberg gases, disordered systems and optically pumped condensed-phase platforms.</p>
        </body></html>
      `,
    });

    expect(extraction?.fullDescription).toContain('Studies quantum mechanics');
    expect(extraction?.shortDescription).toBe(
      'Studies quantum mechanics of large ensembles of particles in condensed systems, collectively referred to as quantum matter.',
    );
  });

  it('extracts source-backed descriptions from legacy Engineering research pages', () => {
    const extraction = descriptionExtractionFromHomePage({
      url: 'https://www.eng.yale.edu/fixture-lab/research/index.html',
      html: `
        <html><body>
          <p>A common thread throughout our research is striving to have a measure of control in the challenging technical problems we tackle. We apply this approach to two primary research areas: combustion and electrospray applications. Our activity was funded by the National Science Foundation.</p>
        </body></html>
      `,
    });

    expect(extraction?.fullDescription).toContain(
      'two primary research areas: combustion and electrospray applications.',
    );
    expect(extraction?.shortDescription).toContain('combustion and electrospray');
  });

  it('extracts complete Yale Medicine About Us text from flattened page content', () => {
    const extraction = descriptionExtractionFromHomePage({
      url: 'https://medicine.yale.edu/lab/fixture-clinical/',
      html: `
        <html>
          <head>
            <meta name="description" content="The goal of our laboratory is to bring together chemistry and neuroscience, with the aim of advancing knowledge about normal physiology and developing" />
          </head>
          <body>
            <main>
              Fixture Clinical Lab
              About Us
              Copy Link
              The goal of our laboratory is to bring together chemistry and neuroscience, with the aim of advancing knowledge about normal physiology and developing translational tools and treatments for debilitating neurological disorders.
              Current projects are focused on the development of small molecules that can enter specific brain cell types and can be used for therapeutic targeting and cell-specific imaging strategies.
              Our studies are highly collaborative and involve a variety of techniques, including chemical synthesis, molecular biology, cell-based assays, intravital imaging, and neurological disease modeling.
              Research/Training Opportunities
              Copy Link
              Thank you for your interest in our laboratory.
            </main>
          </body>
        </html>
      `,
    });

    expect(extraction?.fullDescription).toContain(
      'developing translational tools and treatments for debilitating neurological disorders.',
    );
    expect(extraction?.fullDescription).toContain(
      'chemical synthesis, molecular biology, cell-based assays, intravital imaging, and neurological disease modeling.',
    );
    expect(extraction?.fullDescription).not.toContain('Thank you for your interest');
  });

  it('maps structured LLM output to full and short description fields only', () => {
    const obs = descriptionExtractionToObservations(
      {
        slug: 'example-cognition-lab',
        name: 'Example Cognition Lab',
        websiteUrl: 'https://cognition.example.edu/',
      },
      'https://cognition.example.edu/research',
      extraction,
      new Date('2026-05-15T12:00:00Z'),
    );

    expect(obs.map((o) => o.field).sort()).toEqual(
      [
        'fullDescription',
        'lastObservedAt',
        'researchAreas',
        'shortDescription',
      ].sort(),
    );
    expect(obs.find((o) => o.field === 'description')).toBeUndefined();
    expect(obs.find((o) => o.field === 'fullDescription')?.value).toBe(extraction.fullDescription);
    expect(obs.find((o) => o.field === 'shortDescription')?.value).toBe(
      'Studies social cognition across development, with projects on how children and adults form, apply, and revise beliefs about social groups, using behavioral experiments, developmental studies, and computational models of category learning.',
    );
    expect(obs.find((o) => o.field === 'researchAreas')?.value).toEqual([
      'social cognition',
      'developmental psychology',
      'intergroup attitudes',
    ]);
    expect(obs.every((o) => o.entityType === 'researchEntity')).toBe(true);
    expect(obs.every((o) => o.entityKey === 'example-cognition-lab')).toBe(true);
    expect(obs.every((o) => o.sourceUrl === 'https://cognition.example.edu/research')).toBe(true);
    expect(obs.find((o) => o.field === 'fullDescription')?.confidenceOverride).toBe(0.55);
  });

  it('emits no description fields when LLM output is unsupported or empty', () => {
    const obs = descriptionExtractionToObservations(
      {
        slug: 'unsupported-lab',
        name: 'Unsupported Lab',
        websiteUrl: 'https://unsupported.example.edu/',
      },
      'https://unsupported.example.edu/',
      {
        fullDescription: '',
        shortDescription: '',
        researchAreas: [],
        evidenceQuote: '',
      },
      new Date('2026-05-15T12:00:00Z'),
    );

    expect(obs.map((o) => o.field)).toEqual([]);
  });

  it('uses a source-backed research quote as a conservative fallback when LLM prose is blank', () => {
    const sourceText =
      'Our research focuses primarily on combustion and electrospray fundamentals with applications in energy conversion and aerosol science.';
    const obs = descriptionExtractionToObservations(
      {
        slug: 'fixture-lab',
        name: 'Fixture Combustion Lab',
        websiteUrl: 'https://www.eng.yale.edu/fixture-lab',
      },
      'https://www.eng.yale.edu/fixture-lab',
      {
        fullDescription: '',
        shortDescription: '',
        researchAreas: [],
        evidenceQuote: sourceText,
      },
      new Date('2026-05-15T12:00:00Z'),
      sourceText,
    );

    expect(obs.find((o) => o.field === 'fullDescription')?.value).toBe(
      'Research focuses primarily on combustion and electrospray fundamentals with applications in energy conversion and aerosol science.',
    );
    expect(obs.find((o) => o.field === 'shortDescription')?.value).toBe(
      'Studies combustion and electrospray fundamentals with applications in energy conversion and aerosol science.',
    );
    expect(obs.find((o) => o.field === 'lastObservedAt')).toBeDefined();
  });

  it('derives product-facing descriptions from a source-backed research-method quote', () => {
    const sourceText =
      'Through the development of polymer based ECM mimetics, we can dissect the role of individual bioactive domains within each ECM protein to elucidate the changes in cellular behavior that can be attributed to cell-ECM binding interactions.';
    const obs = descriptionExtractionToObservations(
      {
        slug: 'fixture-matrix-lab',
        name: 'Fixture Matrix Lab',
        websiteUrl: 'https://fixturelab.yale.edu/',
      },
      'https://fixturelab.yale.edu/',
      {
        fullDescription: '',
        shortDescription: '',
        researchAreas: [],
        evidenceQuote: sourceText,
      },
      new Date('2026-05-15T12:00:00Z'),
      sourceText,
    );

    expect(obs.find((o) => o.field === 'fullDescription')?.value).toBe(
      'Uses polymer based ECM mimetics to dissect the role of individual bioactive domains within each ECM protein to elucidate the changes in cellular behavior in cell-ECM binding interactions.',
    );
    expect(obs.find((o) => o.field === 'shortDescription')?.value).toBe(
      'Studies the role of individual bioactive domains within each ECM protein to elucidate cellular behavior in cell-ECM binding interactions using polymer based ECM mimetics.',
    );
  });

  it('matches official quotes despite hyphenation and quote punctuation differences', () => {
    const sourceText =
      'Through the development of polymer-based ECM mimetics, we can dissect the role of individual bioactive domains within each ECM protein to elucidate the changes in cellular behavior that can be attributed to cell-ECM binding interactions.';
    const obs = descriptionExtractionToObservations(
      {
        slug: 'fixture-matrix-lab',
        name: 'Fixture Matrix Lab',
        websiteUrl: 'https://fixturelab.yale.edu/',
      },
      'https://fixturelab.yale.edu/',
      {
        fullDescription: '',
        shortDescription: '',
        researchAreas: [],
        evidenceQuote:
          '"Through the development of polymer based ECM mimetics, we can dissect the role of individual bioactive domains within each ECM protein to elucidate the changes in cellular behavior"',
      },
      new Date('2026-05-15T12:00:00Z'),
      sourceText,
    );

    expect(obs.find((o) => o.field === 'fullDescription')?.value).toMatch(
      /^Uses polymer based ECM mimetics/,
    );
    expect(obs.find((o) => o.field === 'shortDescription')?.value).toMatch(
      /^Studies the role of individual bioactive domains/,
    );
  });

  it('builds separate short descriptions from one-sentence research-interest quotes', () => {
    const sourceText =
      'His main interest is in system theory and he has done research in network synthesis, optimal control, multivariable control, adaptive control, urban transportation, vision-based control, hybrid and nonlinear systems, sensor networks, and coordination and control of distributed systems.';
    const obs = descriptionExtractionToObservations(
      {
        slug: 'fixture-control-research',
        name: 'Fixture Control Research',
        websiteUrl: 'https://www.eng.yale.edu/controls/',
      },
      'https://www.eng.yale.edu/controls/',
      {
        fullDescription: '',
        shortDescription: '',
        researchAreas: [],
        evidenceQuote:
          '"His main interest is in system theory and he has done research in network synthesis, optimal control, multivariable control, adaptive control, urban transportation, vision-based control, hybrid and nonlinear systems, sensor networks, and c',
      },
      new Date('2026-05-15T12:00:00Z'),
      sourceText,
    );

    expect(obs.find((o) => o.field === 'fullDescription')?.value).toMatch(
      /^Research interests include system theory/,
    );
    expect(obs.find((o) => o.field === 'shortDescription')?.value).toMatch(
      /^Studies system theory/,
    );
  });

  it('uses the source-quote fallback when generated full prose is weak', () => {
    const sourceText =
      'My research is in the intersection of mathematical optimization, quantitative risk, decision making under uncertainty, statistical learning, and signal processing.';
    const obs = descriptionExtractionToObservations(
      {
        slug: 'fixture-optimization-research',
        name: 'Fixture Optimization Research',
        websiteUrl: 'https://optimization.example.edu/',
      },
      'https://optimization.example.edu/',
      {
        fullDescription: 'Research areas include optimization.',
        shortDescription: '',
        researchAreas: [],
        evidenceQuote: sourceText,
      },
      new Date('2026-05-15T12:00:00Z'),
      sourceText,
    );

    expect(obs.find((o) => o.field === 'fullDescription')?.value).toBe(
      'Research focuses on the intersection of mathematical optimization, quantitative risk, decision making under uncertainty, statistical learning, and signal processing.',
    );
    expect(obs.find((o) => o.field === 'shortDescription')?.value).toBe(
      'Studies mathematical optimization, quantitative risk, decision making under uncertainty, statistical learning, and signal processing.',
    );
  });

  it('expands unterminated evidence quote prefixes to the full source sentence', () => {
    const sourceText =
      "Example's research interests are in industrial organization and applied microeconomics. Their current research focuses on search, learning, and matching problems faced by economic agents in settings including natural resource exploration, consumer search, and organ allocation.";
    const obs = descriptionExtractionToObservations(
      {
        slug: 'dept-econ-example-economist',
        name: 'Example Economist Lab',
        websiteUrl: 'https://economics.yale.edu/people/example-economist',
      },
      'https://economics.yale.edu/people/example-economist',
      {
        fullDescription: '',
        shortDescription: '',
        researchAreas: [],
        evidenceQuote:
          "Example's research interests are in industrial organization and applied microeconomics. Their current research focuses on search, learning, and matching problems faced by economic agents in settings including natural resource exploration, con",
      },
      new Date('2026-05-22T12:00:00Z'),
      sourceText,
    );

    expect(obs.find((o) => o.field === 'fullDescription')?.value).toContain(
      'consumer search, and organ allocation.',
    );
    expect(obs.find((o) => o.field === 'shortDescription')?.value).toBe(
      'Studies search, learning, and matching problems faced by economic agents in settings including natural resource exploration, consumer search, and organ allocation.',
    );
  });

  it('does not emit partial description observations when the paired short description fails quality', () => {
    const sourceText =
      'Phishing alert: If you received an email about a research internship with me, it is a scam and part of a phishing campaign.';
    const obs = descriptionExtractionToObservations(
      {
        slug: 'dept-econ-fixture-economist',
        name: 'Fixture Macro Theory Lab',
        websiteUrl: 'https://fixture-economist.example.edu/',
      },
      'https://fixture-economist.example.edu/',
      {
        fullDescription: sourceText,
        shortDescription: '',
        researchAreas: [],
        evidenceQuote: sourceText,
      },
      new Date('2026-05-22T12:00:00Z'),
      sourceText,
    );

    expect(obs).toEqual([]);
  });

  it('derives a short description for research interests at an intersection', () => {
    const sourceText =
      'His research interests lie at the intersection of financial economics and macroeconomics, with an emphasis on normative questions.';
    const obs = descriptionExtractionToObservations(
      {
        slug: 'dept-econ-fixture-policy',
        name: 'Fixture Policy Lab',
        websiteUrl: 'https://economics.yale.edu/people/fixture-policy',
      },
      'https://economics.yale.edu/people/fixture-policy',
      {
        fullDescription: sourceText,
        shortDescription: '',
        researchAreas: [],
        evidenceQuote: sourceText,
      },
      new Date('2026-05-22T12:00:00Z'),
      sourceText,
    );

    expect(obs.find((o) => o.field === 'fullDescription')?.value).toBe(
      'Research focuses on the intersection of financial economics and macroeconomics, with an emphasis on normative questions.',
    );
    expect(obs.find((o) => o.field === 'shortDescription')?.value).toBe(
      'Studies financial economics and macroeconomics, with an emphasis on normative questions.',
    );
  });

  it.each([
    {
      slug: 'dept-econ-fixture-macroeconometrics',
      sourceText:
        "Fixture's main research is in macroeconometrics, but they have also done work in the areas of finance, voting behavior, and aging in sports.",
      full:
        'Research focuses on macroeconometrics, but they have also done work in the areas of finance, voting behavior, and aging in sports.',
      short:
        'Studies macroeconometrics, but they have also done work in the areas of finance, voting behavior, and aging in sports.',
    },
    {
      slug: 'dept-econ-fixture-labor-policy',
      sourceText:
        'I am a labor economist who studies how public policy shapes economic opportunity for children, families, and young adults.',
      full:
        'Studies how public policy shapes economic opportunity for children, families, and young adults.',
      short:
        'Studies how public policy shapes economic opportunity for children, families, and young adults.',
    },
    {
      slug: 'dept-econ-fixture-growth',
      sourceText:
        'He works in the fields of economic growth and development, with current work focusing on the relationship between labor markets frictions and economic growth and the importance of rural infrastructure in developing countries.',
      full:
        'Research focuses on economic growth and development, with current work focusing on the relationship between labor markets frictions and economic growth and the importance of rural infrastructure in developing countries.',
      short:
        'Studies economic growth and development, with current work focusing on the relationship between labor markets frictions and economic growth and the importance of rural infrastructure in developing countries.',
    },
    {
      slug: 'dept-econ-fixture-theory',
      sourceText:
        'I am a macroeconomist and economic theorist interested in business cycles and mechanism design.',
      full:
        'Research focuses on macroeconomics, economic theory, business cycles and mechanism design.',
      short:
        'Studies macroeconomics, economic theory, business cycles and mechanism design.',
    },
  ])('normalizes economics profile research voice for $slug', ({ slug, sourceText, full, short }) => {
    const obs = descriptionExtractionToObservations(
      {
        slug,
        name: `${slug} Lab`,
        websiteUrl: 'https://economics.yale.edu/people/example',
      },
      'https://economics.yale.edu/people/example',
      {
        fullDescription: sourceText,
        shortDescription: '',
        researchAreas: [],
        evidenceQuote: sourceText,
      },
      new Date('2026-05-22T12:00:00Z'),
      sourceText,
    );

    expect(obs.find((o) => o.field === 'fullDescription')?.value).toBe(full);
    expect(obs.find((o) => o.field === 'shortDescription')?.value).toBe(short);
  });

  it('deterministically extracts Yale Economics profile research descriptions', () => {
    const extraction = descriptionExtractionFromHomePage({
      url: 'https://economics.yale.edu/people/example-economist',
      html: `
        <main>
          <p>Example's research interests are in industrial organization and applied microeconomics. Their current research focuses on search, learning, and matching problems faced by economic agents in settings including natural resource exploration, consumer search, and organ allocation.</p>
          <p>PhD Economics, Example University.</p>
        </main>
      `,
    });

    expect(extraction?.fullDescription).toBe(
      "Example's research interests are in industrial organization and applied microeconomics. Research focuses on search, learning, and matching problems faced by economic agents in settings including natural resource exploration, consumer search, and organ allocation.",
    );
    expect(extraction?.shortDescription).toBe(
      'Studies search, learning, and matching problems faced by economic agents in settings including natural resource exploration, consumer search, and organ allocation.',
    );

    const fieldsExtraction = descriptionExtractionFromHomePage({
      url: 'https://economics.yale.edu/people/example-finance',
      html: `
        <main>
          <p>Example Finance is Professor of Finance.</p>
          <p>Professor Example’s primary research fields are asset pricing and financial econometrics. He is interested in issues related to financial machine learning; volatility, tail risk, and correlation modeling in financial markets; banking sector systemic risk; financial intermediation; and financial networks.</p>
        </main>
      `,
    });

    expect(fieldsExtraction?.fullDescription).toBe(
      'Research focuses on asset pricing and financial econometrics. Studies issues related to financial machine learning; volatility, tail risk, and correlation modeling in financial markets; banking sector systemic risk; financial intermediation; and financial networks.',
    );
    expect(fieldsExtraction?.shortDescription).toBe(
      'Studies issues related to financial machine learning; volatility, tail risk, and correlation modeling in financial markets; banking sector systemic risk; financial intermediation; and financial networks.',
    );

    const specializesExtraction = descriptionExtractionFromHomePage({
      url: 'https://economics.yale.edu/people/example-theorist',
      html: `
        <main>
          <p>Example specializes in econometric theory. Their interests include inference under partial identification, inference with weak identification and/or weak instruments, uniformity in asymptotic approximations, stationary and nonstationary time series, bootstrap methods, and robust estimation and testing.</p>
        </main>
      `,
    });

    expect(specializesExtraction?.fullDescription).toBe(
      'Research focuses on econometric theory. Research interests include inference under partial identification, inference with weak identification and/or weak instruments, uniformity in asymptotic approximations, stationary and nonstationary time series, bootstrap methods, and robust estimation and testing.',
    );
    expect(specializesExtraction?.shortDescription).toBe(
      'Studies inference under partial identification, inference with weak identification and/or weak instruments, uniformity in asymptotic approximations, stationary and nonstationary time series, bootstrap methods, and robust estimation and testing.',
    );
  });

  it('uses the source-quote fallback when generated lab identity is unsupported', () => {
    const sourceText =
      'My research is in the intersection of mathematical optimization, quantitative risk, decision making under uncertainty, statistical learning, and signal processing.';
    const obs = descriptionExtractionToObservations(
      {
        slug: 'fixture-optimization-research',
        name: 'Fixture Optimization Research',
        websiteUrl: 'https://optimization.example.edu/',
      },
      'https://optimization.example.edu/',
      {
        fullDescription:
          'The Fixture Optimization Lab studies optimization, quantitative risk, decision making under uncertainty, statistical learning, and signal processing.',
        shortDescription:
          'The Fixture Optimization Lab studies optimization, quantitative risk, decision making under uncertainty, statistical learning, and signal processing.',
        researchAreas: [],
        evidenceQuote: sourceText,
      },
      new Date('2026-05-15T12:00:00Z'),
      sourceText,
    );

    expect(obs.find((o) => o.field === 'fullDescription')?.value).toBe(
      'Research focuses on the intersection of mathematical optimization, quantitative risk, decision making under uncertainty, statistical learning, and signal processing.',
    );
  });

  it('accepts evidence quotes with ellipses when each segment is source-backed', () => {
    const sourceText =
      'The Fixture Soft Matter Group tackles a broad range of fundamental questions in soft matter and biological physics using a combination of theoretical and computational techniques.';
    const obs = descriptionExtractionToObservations(
      {
        slug: 'fixture-soft-matter-lab',
        name: 'Fixture Soft Matter Lab',
        websiteUrl: 'https://jamming.research.yale.edu/',
      },
      'https://jamming.research.yale.edu/',
      {
        fullDescription:
          'The Fixture Soft Matter Group investigates fundamental questions in soft matter and biological physics using theoretical and computational techniques.',
        shortDescription:
          'The Fixture Soft Matter Group studies soft matter and biological physics using theoretical and computational techniques.',
        researchAreas: ['soft matter'],
        evidenceQuote:
          'The Fixture Soft Matter Group... tackles a broad range of fundamental questions in soft matter and biological physics using a combination of theoretical and computational techniques.',
      },
      new Date('2026-05-15T12:00:00Z'),
      sourceText,
    );

    expect(obs.find((o) => o.field === 'fullDescription')).toBeDefined();
  });

  it('emits no description fields when the evidence quote is not present in scraped source text', () => {
    const obs = descriptionExtractionToObservations(
      {
        slug: 'hallucinated-lab',
        name: 'Hallucinated Lab',
        websiteUrl: 'https://hallucinated.example.edu/',
      },
      'https://hallucinated.example.edu/research',
      {
        fullDescription:
          'The Hallucinated Lab studies memory circuits using imaging, behavioral experiments, and computational models to understand learning across development.',
        shortDescription:
          'Studies memory circuits using imaging, behavioral experiments, and computational models.',
        researchAreas: ['memory circuits'],
        evidenceQuote: 'This quote does not appear in the official page text.',
      },
      new Date('2026-05-15T12:00:00Z'),
      'Official page text: The page only lists lab members and contact information.',
    );

    expect(obs.map((o) => o.field)).toEqual([]);
  });

  it('rejects profile biography fragments and non-substantive evidence quotes', () => {
    const normalized = normalizeDescriptionExtraction(
      {
        fullDescription:
          'Dr. Fixture received an undergraduate degree in Biology and English Literature (Honors) from Example State University. Dr. Fixture carried out graduate work with Dr. D. in 2004 and postdoctoral work with Dr. S. at an example genome institute before joining the Yale Genetics faculty in September 2007.',
        shortDescription:
          'Dr. Fixture received an undergraduate degree in Biology and English Literature (Honors) from Example State University.',
        researchAreas: ['genetics'],
        evidenceQuote: 'Dr.',
      },
      'Dr. Fixture received an undergraduate degree in Biology and English Literature (Honors) from Example State University. Dr. Fixture carried out graduate work with Dr. D. in 2004 and postdoctoral work with Dr. S. at an example genome institute before joining the Yale Genetics faculty in September 2007.',
    );

    expect(normalized).toEqual({
      fullDescription: '',
      shortDescription: '',
      researchAreas: [],
      evidenceQuote: '',
    });
  });

  it('rejects CV-style education biographies even when they mention a laboratory', () => {
    const sourceText =
      'Fixture Researcher studied Chemistry and Molecular Biology at Example University and Example Technical Institute. During undergraduate study, Fixture Researcher worked with Example Mentor at an example biology center. Fixture Researcher did a PhD with Example Advisor and a post-doc with Example Collaborator before establishing a laboratory at Yale in 2007 to investigate regulatory codes that shape gene expression during embryonic development.';
    const extraction = {
      fullDescription: sourceText,
      shortDescription:
        'Fixture Researcher studied Chemistry and Molecular Biology at Example University and Example Technical Institute.',
      researchAreas: ['gene expression'],
      evidenceQuote:
        'Fixture Researcher established a laboratory at Yale in 2007 to investigate regulatory codes that shape gene expression during embryonic development.',
    };

    expect(normalizeDescriptionExtraction(extraction, sourceText)).toEqual({
      fullDescription: '',
      shortDescription: '',
      researchAreas: [],
      evidenceQuote: '',
    });
    expect(
      descriptionExtractionToObservations(
        {
          slug: 'faculty-research-area-fixture-researcher',
          name: 'Fixture Researcher Research',
          websiteUrl: 'https://medicine.yale.edu/cancer/profile/fixture-researcher/',
        },
        'https://medicine.yale.edu/cancer/profile/fixture-researcher/',
        extraction,
        new Date('2026-05-22T12:00:00Z'),
        sourceText,
      ),
    ).toEqual([]);
  });

  it('normalizes named faculty research-interest sentences into useful descriptions', () => {
    const sourceText =
      'Professor Fixture’s research interests include household consumption, saving and labour supply behavior, risk sharing, evaluation and design of policies in developing countries, human capital accumulation in developing countries, early years interventions, micro-credit, and measurement tools in surveys.';

    expect(
      normalizeDescriptionExtraction(
        {
          fullDescription: sourceText,
          shortDescription: '',
          researchAreas: ['household consumption'],
          evidenceQuote: sourceText,
        },
        sourceText,
      ),
    ).toMatchObject({
      fullDescription:
        'Research interests include household consumption, saving and labour supply behavior, risk sharing, evaluation and design of policies in developing countries, human capital accumulation in developing countries, early years interventions, micro-credit, and measurement tools in surveys.',
      shortDescription:
        'Studies household consumption, saving and labour supply behavior, risk sharing, evaluation and design of policies in developing countries, human capital accumulation in developing countries, early years interventions, micro-credit, and measurement tools in surveys.',
    });
  });

  it('derives short descriptions from applied microeconomist profile prose', () => {
    const sourceText =
      'Professor Fixture is an applied microeconomist whose research is motivated by policy-relevant questions in trade and development.';

    expect(
      normalizeDescriptionExtraction(
        {
          fullDescription: sourceText,
          shortDescription: '',
          researchAreas: ['trade and development'],
          evidenceQuote: sourceText,
        },
        sourceText,
      ),
    ).toMatchObject({
      fullDescription:
        'Research focuses on applied microeconomics, with policy-relevant questions in trade and development.',
      shortDescription:
        'Studies applied microeconomics, with policy-relevant questions in trade and development.',
    });
  });

  it('normalizes Economics profile research voice before deriving short descriptions', () => {
    const monetaryPolicyText =
      'His research has focused on issues related to monetary policy, including unconventional policy, and banking issues.';

    expect(
      normalizeDescriptionExtraction(
        {
          fullDescription: monetaryPolicyText,
          shortDescription: '',
          researchAreas: ['monetary policy'],
          evidenceQuote: monetaryPolicyText,
        },
        monetaryPolicyText,
      ),
    ).toMatchObject({
      fullDescription:
        'Research focuses on issues related to monetary policy, including unconventional policy, and banking issues.',
      shortDescription:
        'Studies issues related to monetary policy, including unconventional policy, and banking issues.',
    });

    const laborEconomistText =
      'I am a labor economist who studies how public policy shapes economic opportunity for children, families, and young adults. Three themes unite my work: the dynamics of human capital accumulation, novel measurement strategies through data linkages, and quasi-experimental methods guided by economic frameworks. My research provides empirical evidence on policy questions spanning education, housing, and criminal justice. My CV is available here.';

    expect(
      normalizeDescriptionExtraction(
        {
          fullDescription: laborEconomistText,
          shortDescription: '',
          researchAreas: ['labor economics'],
          evidenceQuote: laborEconomistText,
        },
        laborEconomistText,
      ),
    ).toMatchObject({
      fullDescription:
        'Studies how public policy shapes economic opportunity for children, families, and young adults. Three themes unite this work: the dynamics of human capital accumulation, novel measurement strategies through data linkages, and quasi-experimental methods guided by economic frameworks. Research provides empirical evidence on policy questions spanning education, housing, and criminal justice.',
      shortDescription:
        'Studies how public policy shapes economic opportunity for children, families, and young adults.',
    });

    const researchFieldsText =
      "Professor Fixture's research fields include applied microeconomic theory, industrial organization, and information economics.";

    expect(
      normalizeDescriptionExtraction(
        {
          fullDescription: researchFieldsText,
          shortDescription: '',
          researchAreas: ['microeconomic theory'],
          evidenceQuote: researchFieldsText,
        },
        researchFieldsText,
      ),
    ).toMatchObject({
      fullDescription:
        'Research focuses on applied microeconomic theory, industrial organization, and information economics.',
      shortDescription:
        'Studies applied microeconomic theory, industrial organization, and information economics.',
    });

    const macroeconomistText =
      'Professor Fixture is a macroeconomist whose research focuses on the role of information and financial frictions in shaping aggregate fluctuations.';

    expect(
      normalizeDescriptionExtraction(
        {
          fullDescription: macroeconomistText,
          shortDescription: '',
          researchAreas: ['macroeconomics'],
          evidenceQuote: macroeconomistText,
        },
        macroeconomistText,
      ),
    ).toMatchObject({
      fullDescription:
        'Research focuses on the role of information and financial frictions in shaping aggregate fluctuations.',
      shortDescription:
        'Studies the role of information and financial frictions in shaping aggregate fluctuations.',
    });

    const interestedInText =
      'I am interested in modelling household behaviour in developed and developing countries and, more generally, in Applied Econometrics. Much of my research has looked at life-cycle models of individual behaviour and their implications for aggregate fluctuations.';

    expect(
      normalizeDescriptionExtraction(
        {
          fullDescription: interestedInText,
          shortDescription: '',
          researchAreas: ['Applied Econometrics'],
          evidenceQuote:
            'I am interested in modelling household behaviour in developed and developing countries and, more generally, in Applied Econometrics.',
        },
        interestedInText,
      ),
    ).toMatchObject({
      fullDescription:
        'Research focuses on modelling household behaviour in developed and developing countries and, more generally, in Applied Econometrics. Much of this research has looked at life-cycle models of individual behaviour and their implications for aggregate fluctuations.',
      shortDescription:
        'Studies modelling household behaviour in developed and developing countries and, more generally, in Applied Econometrics.',
    });

    const healthEconomistText =
      'He is a health economist whose research focuses on the evaluation of health and development programs in resource-poor and low- and middle-income country settings.';

    expect(
      normalizeDescriptionExtraction(
        {
          fullDescription: healthEconomistText,
          shortDescription: '',
          researchAreas: ['health economics'],
          evidenceQuote: healthEconomistText,
        },
        healthEconomistText,
      ),
    ).toMatchObject({
      fullDescription:
        'Research focuses on the evaluation of health and development programs in resource-poor and low- and middle-income country settings.',
      shortDescription:
        'Studies the evaluation of health and development programs in resource-poor and low- and middle-income country settings.',
    });

    const namedStudiesText =
      'Fixture Analyst studies the impact of reporting regulation and transparency in the social and public sectors, focusing on business ethics. Their research examines how these factors influence ethical behavior and decision-making within organizations.';

    expect(
      normalizeDescriptionExtraction(
        {
          fullDescription: namedStudiesText,
          shortDescription: '',
          researchAreas: ['business ethics'],
          evidenceQuote:
            'Fixture Analyst studies the impact of reporting regulation and transparency in the social and public sectors, focusing on business ethics.',
        },
        namedStudiesText,
      ),
    ).toMatchObject({
      fullDescription:
        'Studies the impact of reporting regulation and transparency in the social and public sectors, focusing on business ethics. Research focuses on how these factors influence ethical behavior and decision-making within organizations.',
      shortDescription:
        'Studies the impact of reporting regulation and transparency in the social and public sectors, focusing on business ethics.',
    });

    const researchLiesText =
      'Professor Example’s research lies at the intersection between economic history and labor economics.';

    expect(
      normalizeDescriptionExtraction(
        {
          fullDescription: researchLiesText,
          shortDescription: '',
          researchAreas: ['economic history', 'labor economics'],
          evidenceQuote: researchLiesText,
        },
        researchLiesText,
      ),
    ).toMatchObject({
      fullDescription:
        'Research focuses on the intersection between economic history and labor economics.',
      shortDescription:
        'Studies the intersection between economic history and labor economics.',
    });

    const researchStreamsText =
      'I currently work on two related research streams. The first stream combines economic theory with experiments and econometrics to develop pricing and market design tools for companies and policy agencies.';

    expect(
      normalizeDescriptionExtraction(
        {
          fullDescription: researchStreamsText,
          shortDescription: '',
          researchAreas: ['market design'],
          evidenceQuote: researchStreamsText,
        },
        researchStreamsText,
      ),
    ).toMatchObject({
      fullDescription:
        'Research focuses on two related research streams. Combines economic theory with experiments and econometrics to develop pricing and market design tools for companies and policy agencies.',
      shortDescription:
        'Combines economic theory with experiments and econometrics to develop pricing and market design tools for companies and policy agencies.',
    });

    const primaryFieldsText =
      'Professor Example’s primary research fields are asset pricing and financial econometrics. He is interested in issues related to financial machine learning; volatility, tail risk, and correlation modeling in financial markets; banking sector.';

    expect(
      normalizeDescriptionExtraction(
        {
          fullDescription: primaryFieldsText,
          shortDescription:
            'He is interested in issues related to financial machine learning; volatility, tail risk, and correlation modeling in financial markets; banking sector.',
          researchAreas: ['finance'],
          evidenceQuote: primaryFieldsText,
        },
        primaryFieldsText,
      ),
    ).toMatchObject({
      fullDescription:
        'Research focuses on asset pricing and financial econometrics. Studies issues related to financial machine learning; volatility, tail risk, and correlation modeling in financial markets; banking sector.',
      shortDescription:
        'Studies issues related to financial machine learning; volatility, tail risk, and correlation modeling in financial markets; banking sector.',
    });

    const econometricTheoryText =
      'Example specializes in econometric theory. His interests include inference under partial identification, inference with weak identification and/or weak instruments, uniformity in asymptotic approximations, stationary and nonstationary time series.';

    expect(
      normalizeDescriptionExtraction(
        {
          fullDescription: econometricTheoryText,
          shortDescription: '',
          researchAreas: ['econometrics'],
          evidenceQuote: econometricTheoryText,
        },
        econometricTheoryText,
      ),
    ).toMatchObject({
      fullDescription:
        'Research focuses on econometric theory. Research interests include inference under partial identification, inference with weak identification and/or weak instruments, uniformity in asymptotic approximations, stationary and nonstationary time series.',
      shortDescription:
        'Studies inference under partial identification, inference with weak identification and/or weak instruments, uniformity in asymptotic approximations, stationary and nonstationary time series.',
    });
  });

  it('seeds first-person research quotes even when source navigation is glued to the sentence', () => {
    const sourceText =
      'Math 408L (Integral Calculus) Course page Papers I work on problems in string theory and supersymmetric field theory, usually ones which have some overlap with geometry. My most recent papers/preprints are listed below.';
    const quote =
      'I work on problems in string theory and supersymmetric field theory, usually ones which have some overlap with geometry.';

    expect(
      normalizeDescriptionExtraction(
        {
          fullDescription: '',
          shortDescription: '',
          researchAreas: ['string theory'],
          evidenceQuote: quote,
        },
        sourceText,
      ),
    ).toMatchObject({
      fullDescription:
        'Research focuses on problems in string theory and supersymmetric field theory, usually ones which have some overlap with geometry.',
      shortDescription:
        'Studies problems in string theory and supersymmetric field theory, usually ones which have some overlap with geometry.',
    });
  });

  it('normalizes official profile prose that describes fields a faculty member has written on', () => {
    const sourceText =
      'In addition to international economics, he has written on economic growth, innovation, technology diffusion, and firm dynamics.';

    expect(
      normalizeDescriptionExtraction(
        {
          fullDescription: sourceText,
          shortDescription: '',
          researchAreas: ['international economics'],
          evidenceQuote: sourceText,
        },
        sourceText,
      ),
    ).toMatchObject({
      fullDescription:
        'Research focuses on international economics, economic growth, innovation, technology diffusion, and firm dynamics.',
      shortDescription:
        'Studies international economics, economic growth, innovation, technology diffusion, and firm dynamics.',
    });
  });

  it('normalizes standalone personal-site research-interest prose without lab-voice hallucination', () => {
    const sourceText =
      'I am an assistant professor of Statistics and Data Science at Yale University. My research interests include probability theory, high-dimensional statistics, theoretical machine learning, and the theory of algorithms. Talks California Institute of Technology CM+X Seminar.';

    expect(
      normalizeDescriptionExtraction(
        {
          fullDescription:
            'My research interests include probability theory, high-dimensional statistics, theoretical machine learning, and the theory of algorithms.',
          shortDescription: '',
          researchAreas: ['probability theory'],
          evidenceQuote:
            'My research interests include probability theory, high-dimensional statistics, theoretical machine learning, and the theory of algorithms.',
        },
        sourceText,
      ),
    ).toMatchObject({
      fullDescription:
        'Research interests include probability theory, high-dimensional statistics, theoretical machine learning, and the theory of algorithms.',
      shortDescription:
        'Studies probability theory, high-dimensional statistics, theoretical machine learning, and the theory of algorithms.',
    });
  });

  it('deterministically extracts concise personal-site research interests before talk listings', () => {
    expect(
      descriptionExtractionFromHomePage({
        url: 'https://fifalsp.github.io/index.html',
        html: `
          <html><body>
            <p>I am an assistant professor of Statistics and Data Science at Yale University.</p>
            <p>My research interests include probability theory, high-dimensional statistics, theoretical machine learning, and the theory of algorithms.</p>
            <h2>Talks</h2>
            <p>California Institute of Technology CM+X Seminar, May 2026.</p>
          </body></html>
        `,
      }),
    ).toMatchObject({
      fullDescription:
        'Research interests include probability theory, high-dimensional statistics, theoretical machine learning, and the theory of algorithms.',
      shortDescription:
        'Studies probability theory, high-dimensional statistics, theoretical machine learning, and the theory of algorithms.',
      evidenceQuote:
        'My research interests include probability theory, high-dimensional statistics, theoretical machine learning, and the theory of algorithms.',
    });
  });

  it('resolves vague this-question phrasing in biological timing descriptions', () => {
    const sourceText =
      'Circadian clocks coordinate processes across the day, but they can also be used to measure daylength (photoperiod) allowing for coordination of seasonal development. There is a considerable amount known about the circadian oscillator itself, but we know far less about how the oscillator connects to daily and seasonal biological processes. We study this question in the model plant Arabidopsis because it has easily observable circadian physiology, and transgenics that express visual reporters for daily and seasonal rhythms.';

    expect(
      normalizeDescriptionExtraction(
        {
          fullDescription: sourceText,
          shortDescription:
            'We study this question in the model plant Arabidopsis because it has easily observable circadian physiology, and transgenics that express visual reporters for daily and seasonal rhythms.',
          researchAreas: ['circadian clocks'],
          evidenceQuote:
            'Circadian clocks coordinate processes across the day, but they can also be used to measure daylength (photoperiod) allowing for coordination of seasonal development.',
        },
        sourceText,
      ),
    ).toMatchObject({
      fullDescription:
        'Circadian clocks coordinate processes across the day, but they can also be used to measure daylength (photoperiod) allowing for coordination of seasonal development. There is a considerable amount known about the circadian oscillator itself, but we know far less about how the oscillator connects to daily and seasonal biological processes. Studies biological timing in the model plant Arabidopsis because it has easily observable circadian physiology, and transgenics that express visual reporters for daily and seasonal rhythms.',
      shortDescription:
        'Studies biological timing in the model plant Arabidopsis because it has easily observable circadian physiology, and transgenics that express visual reporters for daily and seasonal rhythms.',
    });
  });

  it('normalizes concise lab-uses prose into a useful short summary', () => {
    const sourceText =
      'Our lab uses chemical approaches to control cellular systems as exemplified by the development of Proteolysis Targeting Chimeras (PROTACs) in the new field of Targeted Protein Degradation.';

    expect(
      normalizeDescriptionExtraction(
        {
          fullDescription: sourceText,
          shortDescription: '',
          researchAreas: ['chemical biology'],
          evidenceQuote: sourceText,
        },
        sourceText,
      ),
    ).toMatchObject({
      fullDescription:
        'Uses chemical approaches to control cellular systems as exemplified by the development of Proteolysis Targeting Chimeras (PROTACs) in the new field of Targeted Protein Degradation.',
      shortDescription:
        'Studies targeted protein degradation and control of cellular systems using chemical approaches.',
    });
  });

  it('deterministically extracts biological timing prose that starts with we-study phrasing', () => {
    expect(
      descriptionExtractionFromHomePage({
        url: 'https://fixture-plant-signaling.example.edu/',
        html: `
          <html><body>
            <nav>Home People Publications Contact</nav>
            <p>Circadian clocks coordinate processes across the day, but they can also be used to measure daylength (photoperiod) allowing for coordination of seasonal development.</p>
            <p>There is a considerable amount known about the circadian oscillator itself, but we know far less about how the oscillator connects to daily and seasonal biological processes.</p>
            <p>We study this question in the model plant Arabidopsis because it has easily observable circadian physiology, and transgenics that express visual reporters for daily and seasonal rhythms.</p>
            <h2>People</h2>
          </body></html>
        `,
      }),
    ).toMatchObject({
      fullDescription:
        'Studies biological timing in the model plant Arabidopsis because it has easily observable circadian physiology, and transgenics that express visual reporters for daily and seasonal rhythms.',
      shortDescription:
        'Studies biological timing, circadian physiology, and daily and seasonal plant rhythms.',
    });
  });

  it('rejects Cancer Center navigation chrome from generated descriptions', () => {
    const normalized = normalizeDescriptionExtraction(
      {
        fullDescription:
          'Fixture Clinician, PhD Associate Professor of Psychiatry AdministrationNCI DesignationHistoryCommunity OutreachCommunity Advisory BoardProgramsBy the NumbersInformation & ResourcesResearchTrainingMeet Our TeamPatient InformationCancer TypesCenter for Breast CancerYSM HomeINFORMATION FORAbout YSMFacultyStaffStudentsResidents & FellowsPatientsResearchersAlumni',
        shortDescription:
          'AdministrationNCI DesignationHistoryCommunity OutreachCommunity Advisory BoardProgramsBy the NumbersInformation & ResourcesResearchTrainingMeet Our TeamPatient InformationCancer Types',
        researchAreas: ['Cancer Prevention & Control'],
        evidenceQuote:
          'AdministrationNCI DesignationHistoryCommunity OutreachCommunity Advisory BoardPrograms',
      },
      'Fixture Clinician, PhD Associate Professor of Psychiatry AdministrationNCI DesignationHistoryCommunity OutreachCommunity Advisory BoardProgramsBy the NumbersInformation & ResourcesResearchTrainingMeet Our TeamPatient InformationCancer TypesCenter for Breast CancerYSM HomeINFORMATION FORAbout YSMFacultyStaffStudentsResidents & FellowsPatientsResearchersAlumni',
    );

    expect(normalized).toEqual({
      fullDescription: '',
      shortDescription: '',
      researchAreas: [],
      evidenceQuote: '',
    });
  });

  it('normalizes source-voice lab prose before materializing descriptions', () => {
    const normalized = normalizeDescriptionExtraction(
      {
        fullDescription:
          'Our lab studies the mechanisms by which animals sense odors, tastants, and pheromones, and translate them into behavior. We use transcriptomics, genome editing, electrophysiology, GC-MS, and optogenetics. Most of our work uses Drosophila and insects that spread global infectious disease.',
        shortDescription:
          'Our lab studies the mechanisms by which animals sense odors, tastants, and pheromones, and translate them into behavior.',
        researchAreas: [],
        evidenceQuote:
          'Our lab studies the mechanisms by which animals sense odors, tastants, and pheromones, and translate them into behavior.',
      },
      'Our lab studies the mechanisms by which animals sense odors, tastants, and pheromones, and translate them into behavior. We use transcriptomics, genome editing, electrophysiology, GC-MS, and optogenetics. Most of our work uses Drosophila and insects that spread global infectious disease.',
    );

    expect(normalized.fullDescription).toBe(
      'Studies the mechanisms by which animals sense odors, tastants, and pheromones, and translate them into behavior. Uses transcriptomics, genome editing, electrophysiology, GC-MS, and optogenetics. Most work uses Drosophila and insects that spread global infectious disease.',
    );
    expect(normalized.shortDescription).toBe(
      'Studies the mechanisms by which animals sense odors, tastants, and pheromones, and translate them into behavior, using transcriptomics, genome editing, electrophysiology, GC-MS, and optogenetics.',
    );
  });

  it('normalizes first-person methods prose from official lab pages', () => {
    const normalized = normalizeDescriptionExtraction(
      {
        fullDescription:
          'We apply physical techniques to study biological interactions. Currently our primary approach is optical tweezers where we apply a variety of techniques, including tethered particle motion, flow-forces, magnetic tweezers, and single-molecule fluorescence. We are now building a novel STED microscope to study biological systems.',
        shortDescription: '',
        researchAreas: [],
        evidenceQuote: 'We apply physical techniques to study biological interactions.',
      },
      'We apply physical techniques to study biological interactions. Currently our primary approach is optical tweezers where we apply a variety of techniques, including tethered particle motion, flow-forces, magnetic tweezers, and single-molecule fluorescence. We are now building a novel STED microscope to study biological systems.',
    );

    expect(normalized.fullDescription).toBe(
      'Applies physical techniques to study biological interactions. Currently our primary approach is optical tweezers where we apply a variety of techniques, including tethered particle motion, flow-forces, magnetic tweezers, and single-molecule fluorescence. Is building a novel STED microscope to study biological systems.',
    );
    expect(normalized.shortDescription).toBe(
      'Applies physical techniques to study biological interactions, using a variety of techniques, including tethered particle motion, flow-forces, magnetic tweezers, and single-molecule fluorescence.',
    );
  });

  it('normalizes first-person continuation prose from official lab pages', () => {
    const normalized = normalizeDescriptionExtraction(
      {
        fullDescription:
          'The Fixture RNA Lab studies RNA structure and RNA recognition by proteins and small molecules. We also work on RNA-dependent ATPase enzymes that bind and remodel RNA structures. We have also solved many first-in-class protein structures.',
        shortDescription: '',
        researchAreas: [],
        evidenceQuote:
          'The Fixture RNA Lab studies RNA structure and RNA recognition by proteins and small molecules.',
      },
      'The Fixture RNA Lab studies RNA structure and RNA recognition by proteins and small molecules. We also work on RNA-dependent ATPase enzymes that bind and remodel RNA structures. We have also solved many first-in-class protein structures.',
    );

    expect(normalized.fullDescription).toBe(
      'The Fixture RNA Lab studies RNA structure and RNA recognition by proteins and small molecules. Also studies RNA-dependent ATPase enzymes that bind and remodel RNA structures. Has also solved many first-in-class protein structures.',
    );
  });

  it('normalizes professor-profile voice before accepting generated full descriptions', () => {
    expect(
      normalizeDescriptionExtraction(
        {
          fullDescription:
            'Our group focuses on experimental particle physics, including neutrino detectors, instrumentation, and collider searches.',
          shortDescription:
            'The Fixture Particle Physics Lab studies experimental particle physics, focusing on neutrino detectors, instrumentation, and collider searches.',
          researchAreas: ['particle physics'],
          evidenceQuote:
            'Our group focuses on experimental particle physics, including neutrino detectors, instrumentation, and collider searches.',
        },
        'Our group focuses on experimental particle physics, including neutrino detectors, instrumentation, and collider searches.',
      ).fullDescription,
    ).toBe(
      'Focuses on experimental particle physics, including neutrino detectors, instrumentation, and collider searches.',
    );

    expect(
      normalizeDescriptionExtraction(
        {
          fullDescription:
            'I do research in international economics, finance, and macroeconomics. My research topics include geoeconomics and geopolitics, reserve currency internationalization, multinational banking, financial regulation, and monetary policy.',
          shortDescription:
            'The Fixture International Finance Lab studies international economics and finance, focusing on geoeconomics, reserve currency internationalization, and financial regulation.',
          researchAreas: ['international economics'],
          evidenceQuote:
            'I do research in international economics, finance, and macroeconomics. My research topics include geoeconomics and geopolitics, reserve currency internationalization, multinational banking, financial regulation, and monetary policy.',
        },
        'I do research in international economics, finance, and macroeconomics. My research topics include geoeconomics and geopolitics, reserve currency internationalization, multinational banking, financial regulation, and monetary policy.',
      ).fullDescription,
    ).toBe(
      'Research focuses on international economics, finance, and macroeconomics. Research topics include geoeconomics and geopolitics, reserve currency internationalization, multinational banking, financial regulation, and monetary policy.',
    );

    expect(
      normalizeDescriptionExtraction(
        {
          fullDescription:
            'I work on questions in urban and public economics, often using tools from industrial organization. In my research, I am currently studying topics including affordable housing, congestion pricing, and urban inequality.',
          shortDescription:
            'Studies questions in urban and public economics, often using tools from industrial organization. In my research, I am currently studying topics including affordable housing, congestion pricing, and urban inequality.',
          researchAreas: ['urban economics'],
          evidenceQuote:
            'I work on questions in urban and public economics, often using tools from industrial organization. In my research, I am currently studying topics including affordable housing, congestion pricing, and urban inequality.',
        },
        'I work on questions in urban and public economics, often using tools from industrial organization. In my research, I am currently studying topics including affordable housing, congestion pricing, and urban inequality.',
      ).fullDescription,
    ).toBe(
      'Research focuses on questions in urban and public economics, often using tools from industrial organization. Currently studies topics including affordable housing, congestion pricing, and urban inequality.',
    );

    expect(
      normalizeDescriptionExtraction(
        {
          fullDescription:
            'I study firm responses to trade policy and other sector/firm-targeting reforms in emerging markets, and how this response shapes the organization of production, employment, and wages.',
          shortDescription:
            'The Fixture Trade Policy Lab investigates how trade policy and sector reforms affect firm behavior, employment, and wages in emerging markets, using microdata and survey experiments.',
          researchAreas: ['trade policy'],
          evidenceQuote:
            'I study firm responses to trade policy and other sector/firm-targeting reforms in emerging markets, and how this response shapes the organization of production, employment, and wages.',
        },
        'I study firm responses to trade policy and other sector/firm-targeting reforms in emerging markets, and how this response shapes the organization of production, employment, and wages.',
      ).fullDescription,
    ).toBe(
      'Studies firm responses to trade policy and other sector/firm-targeting reforms in emerging markets, and how this response shapes the organization of production, employment, and wages.',
    );

    expect(
      normalizeDescriptionExtraction(
        {
          fullDescription:
            'I study firm responses to trade policy and other sector/firm-targeting reforms in emerging markets, and how this response shapes the organization of production, employment, and wages.',
          shortDescription: '',
          researchAreas: ['trade policy'],
          evidenceQuote:
            'I study firm responses to trade policy and other sector/firm-targeting reforms in emerging markets, and how this response shapes the organization of production, employment, and wages.',
        },
        'I study firm responses to trade policy and other sector/firm-targeting reforms in emerging markets, and how this response shapes the organization of production, employment, and wages.',
      ).shortDescription,
    ).toBe(
      'Studies firm responses to trade policy and other sector/firm-targeting reforms in emerging markets.',
    );

    expect(
      normalizeDescriptionExtraction(
        {
          fullDescription:
            "His current research has focused on applications of Artificial Intelligence (AI) and Large Language Models (LLMs) in healthcare; health equity; and 'hydration spas'.",
          shortDescription:
            'The Fixture Healthcare Management Lab studies healthcare management, emphasizing AI applications in healthcare, health equity, and improving imaging services delivery.',
          researchAreas: ['healthcare management'],
          evidenceQuote:
            "His current research has focused on applications of Artificial Intelligence (AI) and Large Language Models (LLMs) in healthcare; health equity; and 'hydration spas'.",
        },
        "His current research has focused on applications of Artificial Intelligence (AI) and Large Language Models (LLMs) in healthcare; health equity; and 'hydration spas'.",
      ).fullDescription,
    ).toBe(
      "Research focuses on applications of Artificial Intelligence (AI) and Large Language Models (LLMs) in healthcare; health equity; and 'hydration spas'.",
    );

    expect(
      normalizeDescriptionExtraction(
        {
          fullDescription:
            'Her core research is focused on using Pulsar Timing Arrays to detect low-frequency gravitational waves, with forays into electromagnetic counterparts to gravitational-wave events, such as fast radio bursts.',
          shortDescription:
            'The Fixture Gravitational Waves Lab studies gravitational-wave astrophysics, focusing on detecting low-frequency gravitational waves from supermassive black hole binaries using Pulsar Timing Arrays and exploring related electromagnetic counterparts.',
          researchAreas: ['astrophysics'],
          evidenceQuote:
            'Her core research is focused on using Pulsar Timing Arrays to detect low-frequency gravitational waves, with forays into electromagnetic counterparts to gravitational-wave events, such as fast radio bursts.',
        },
        'Her core research is focused on using Pulsar Timing Arrays to detect low-frequency gravitational waves, with forays into electromagnetic counterparts to gravitational-wave events, such as fast radio bursts.',
      ).fullDescription,
    ).toBe(
      'Research focuses on using Pulsar Timing Arrays to detect low-frequency gravitational waves, with forays into electromagnetic counterparts to gravitational-wave events, such as fast radio bursts.',
    );

    expect(
      normalizeDescriptionExtraction(
        {
          fullDescription:
            'His focus is on financially material environmental and social risks to companies and investment portfolios.',
          shortDescription:
            'The Fixture Sustainability Lab investigates corporate sustainability and sustainable finance, emphasizing the financial implications of environmental and social risks through applied financial models.',
          researchAreas: ['sustainable finance'],
          evidenceQuote:
            'His focus is on financially material environmental and social risks to companies and investment portfolios.',
        },
        'His focus is on financially material environmental and social risks to companies and investment portfolios.',
      ).fullDescription,
    ).toBe(
      'Focuses on financially material environmental and social risks to companies and investment portfolios.',
    );

    expect(
      normalizeDescriptionExtraction(
        {
          fullDescription:
            'Professor Fixture’s research examines how information design, disclosure, and governance mechanisms shape managerial incentives, firm decision-making, and capital market outcomes. Her work spans corporate governance, financial reporting, managerial disclosure, and bank transparency. She studies topics including shareholder horizon and managerial short-termism.',
          shortDescription: '',
          researchAreas: ['accounting'],
          evidenceQuote:
            'Professor Fixture’s research examines how information design, disclosure, and governance mechanisms shape managerial incentives, firm decision-making, and capital market outcomes.',
        },
        'Professor Fixture’s research examines how information design, disclosure, and governance mechanisms shape managerial incentives, firm decision-making, and capital market outcomes. Her work spans corporate governance, financial reporting, managerial disclosure, and bank transparency. She studies topics including shareholder horizon and managerial short-termism.',
      ),
    ).toMatchObject({
      fullDescription:
        'Research examines how information design, disclosure, and governance mechanisms shape managerial incentives, firm decision-making, and capital market outcomes.',
      shortDescription:
        'Studies how information design, disclosure, and governance mechanisms shape managerial incentives, firm decision-making, and capital market outcomes.',
    });

    expect(
      normalizeDescriptionExtraction(
        {
          fullDescription:
            'Focuses on using tau leptons to probe for and characterize physics beyond the standard model at the ATLAS Experiment at CERN’s Large Hadron Collider. We are also involved in hunting for signs of new physics at the Mu2e Experiment at Fermilab.',
          shortDescription: '',
          researchAreas: ['particle physics'],
          evidenceQuote:
            'Our group focuses on using tau leptons to probe for and characterize physics beyond the standard model at the ATLAS Experiment at CERN’s Large Hadron Collider.',
        },
        'Our group focuses on using tau leptons to probe for and characterize physics beyond the standard model at the ATLAS Experiment at CERN’s Large Hadron Collider. We are also involved in hunting for signs of new physics at the Mu2e Experiment at Fermilab.',
      ).fullDescription,
    ).toBe(
      'Focuses on using tau leptons to probe for and characterize physics beyond the standard model at the ATLAS Experiment at CERN’s Large Hadron Collider. Also hunts for signs of new physics at the Mu2e Experiment at Fermilab.',
    );

    expect(
      normalizeDescriptionExtraction(
        {
          fullDescription:
            'The Fixture Plant Roots Lab is dedicated to understanding how plants let beneficial soil microbes into their roots while keeping pathogens at bay. Develops transcriptomics, single cell-omics, and imaging methods to explore fundamental questions in plant immunity and cell type-specific regulatory mechanisms. Our research program is designed to address these questions and leverage the acquired knowledge to modulate plant responsiveness to microbes, ultimately improving agricultural productivity and food security.',
          shortDescription: '',
          researchAreas: ['plant immunity'],
          evidenceQuote:
            'The Fixture Plant Roots Lab is dedicated to understanding how plants let beneficial soil microbes into their roots while keeping pathogens at bay.',
        },
        'The Fixture Plant Roots Lab is dedicated to understanding how plants let beneficial soil microbes into their roots while keeping pathogens at bay. Develops transcriptomics, single cell-omics, and imaging methods to explore fundamental questions in plant immunity and cell type-specific regulatory mechanisms. Our research program is designed to address these questions and leverage the acquired knowledge to modulate plant responsiveness to microbes, ultimately improving agricultural productivity and food security.',
      ).shortDescription,
    ).toBe(
      'Studies how plants let beneficial soil microbes into their roots while keeping pathogens at bay.',
    );

    expect(
      normalizeDescriptionExtraction(
        {
          fullDescription:
            'Her current work analyzes how technology affects firm-level offshoring and production fragmentation decisions, and the impact of these decisions on domestic employment and innovation.',
          shortDescription: '',
          researchAreas: ['international trade'],
          evidenceQuote:
            'Her current work analyzes how technology affects firm-level offshoring and production fragmentation decisions, and the impact of these decisions on domestic employment and innovation.',
        },
        'Her current work analyzes how technology affects firm-level offshoring and production fragmentation decisions, and the impact of these decisions on domestic employment and innovation.',
      ),
    ).toMatchObject({
      fullDescription:
        'Current work analyzes how technology affects firm-level offshoring and production fragmentation decisions, and the impact of these decisions on domestic employment and innovation.',
      shortDescription:
        'Studies how technology affects firm-level offshoring and production fragmentation decisions, and the impact of these decisions on domestic employment and innovation.',
    });

    expect(
      normalizeDescriptionExtraction(
        {
          fullDescription:
            "The Fixture Cardiovascular Modeling Lab focuses on developing personalized computational models of the cardiovascular system to predict disease progression, prevent heart failure, and optimize therapies. The lab employs finite element simulations and reduced order modeling to analyze cardiac solid mechanics, cardiovascular fluid dynamics, and tissue growth and remodeling. These methods integrate multi-modal imaging data and measurements to create accurate 3D models of patients' hearts and blood vessels, enabling tailored medical interventions.",
          shortDescription: '',
          researchAreas: ['cardiovascular biomechanics'],
          evidenceQuote:
            "The Fixture Cardiovascular Modeling Lab focuses on developing personalized computational models of the cardiovascular system to predict disease progression, prevent heart failure, and optimize therapies.",
        },
        "The Fixture Cardiovascular Modeling Lab focuses on developing personalized computational models of the cardiovascular system to predict disease progression, prevent heart failure, and optimize therapies. The lab employs finite element simulations and reduced order modeling to analyze cardiac solid mechanics, cardiovascular fluid dynamics, and tissue growth and remodeling. These methods integrate multi-modal imaging data and measurements to create accurate 3D models of patients' hearts and blood vessels, enabling tailored medical interventions.",
      ).shortDescription,
    ).toBe(
      'Develops personalized computational models of the cardiovascular system to predict disease progression, prevent heart failure, and optimize therapies.',
    );

    expect(
      normalizeDescriptionExtraction(
        {
          fullDescription:
            'The extracellular matrix (ECM) is the protein rich system that induces cellular behavior in response to microenvironmental cues. In disease models of sepsis, cancer metastasis, and lung disease, we understand that a provisional ECM is created in the affected tissue, altering matrix driven signals and subsequent cell activity in response to the newly modified microenvironment. Through the development of polymer based ECM mimetics, we can dissect the role of individual bioactive domains within each ECM protein to elucidate the changes in cellular behavior that can be attributed to cell-ECM binding interactions.',
          shortDescription: '',
          researchAreas: ['extracellular matrix'],
          evidenceQuote:
            'The extracellular matrix (ECM) is the protein rich system that induces cellular behavior in response to microenvironmental cues.',
        },
        'The extracellular matrix (ECM) is the protein rich system that induces cellular behavior in response to microenvironmental cues. In disease models of sepsis, cancer metastasis, and lung disease, we understand that a provisional ECM is created in the affected tissue, altering matrix driven signals and subsequent cell activity in response to the newly modified microenvironment. Through the development of polymer based ECM mimetics, we can dissect the role of individual bioactive domains within each ECM protein to elucidate the changes in cellular behavior that can be attributed to cell-ECM binding interactions.',
      ).shortDescription,
    ).toBe(
      'Studies cell-ECM binding interactions using polymer based ECM mimetics.',
    );

    expect(
      normalizeDescriptionExtraction(
        {
          fullDescription:
            'We are interested in understanding how microbes impact the behavior of host animals. Animal nervous systems likely evolved in environments richly surrounded by microbes, yet the impact of bacteria on nervous system function has been relatively under-studied. A challenge has been to identify systems in which both host and microbe are amenable to genetic manipulation, and which enable high-throughput behavioral screening in response to defined and naturalistic conditions.',
          shortDescription: '',
          researchAreas: ['host-microbe interactions'],
          evidenceQuote: 'We are interested in understanding how microbes impact the behavior of host animals.',
        },
        'We are interested in understanding how microbes impact the behavior of host animals. Animal nervous systems likely evolved in environments richly surrounded by microbes, yet the impact of bacteria on nervous system function has been relatively under-studied. A challenge has been to identify systems in which both host and microbe are amenable to genetic manipulation, and which enable high-throughput behavioral screening in response to defined and naturalistic conditions.',
      ),
    ).toMatchObject({
      fullDescription:
        'Studies how microbes impact the behavior of host animals. Animal nervous systems likely evolved in environments richly surrounded by microbes, yet the impact of bacteria on nervous system function has been relatively under-studied. A challenge has been to identify systems in which both host and microbe are amenable to genetic manipulation, and which enable high-throughput behavioral screening in response to defined and naturalistic conditions.',
      shortDescription: 'Studies how microbes impact the behavior of host animals.',
    });

    expect(
      normalizeDescriptionExtraction(
        {
          fullDescription:
            'His research and teaching specialize in general equilibrium trade theory, spatial economics, macroeconomics and industrial organization.',
          shortDescription: '',
          researchAreas: ['international trade'],
          evidenceQuote:
            'His research and teaching specialize in general equilibrium trade theory, spatial economics, macroeconomics and industrial organization.',
        },
        'His research and teaching specialize in general equilibrium trade theory, spatial economics, macroeconomics and industrial organization.',
      ),
    ).toMatchObject({
      fullDescription:
        'Research focuses on general equilibrium trade theory, spatial economics, macroeconomics and industrial organization.',
      shortDescription:
        'Studies general equilibrium trade theory, spatial economics, macroeconomics and industrial organization.',
    });

    expect(
      normalizeDescriptionExtraction(
        {
          fullDescription:
            'His recent works center around the use of payment methods in developing countries.',
          shortDescription: '',
          researchAreas: ['monetary economics'],
          evidenceQuote:
            'His recent works center around the use of payment methods in developing countries.',
        },
        'His recent works center around the use of payment methods in developing countries.',
      ),
    ).toMatchObject({
      fullDescription: 'Recent work centers on the use of payment methods in developing countries.',
      shortDescription: 'Studies the use of payment methods in developing countries.',
    });

    expect(
      normalizeDescriptionExtraction(
        {
          fullDescription: '',
          shortDescription: '',
          researchAreas: ['labor economics'],
          evidenceQuote:
      'Professor Fixture is a labor economist working on topics related to education, inequality, and creativity.',
        },
        'Professor Fixture is a labor economist working on topics related to education, inequality, and creativity.',
      ),
    ).toMatchObject({
      fullDescription:
        'Research focuses on labor economics, with topics related to education, inequality, and creativity.',
      shortDescription:
        'Studies labor economics, with topics related to education, inequality, and creativity.',
    });

    expect(
      normalizeDescriptionExtraction(
        {
          fullDescription:
            'Professor Example’s interests include applied macroeconomics, macro development, innovation, and monetary economics. Prof. Example’s recent works center around the use of payment methods in developing countries.',
          shortDescription: '',
          researchAreas: ['applied macroeconomics'],
          evidenceQuote:
            'Professor Example’s interests include applied macroeconomics, macro development, innovation, and monetary economics.',
        },
        'Professor Example’s interests include applied macroeconomics, macro development, innovation, and monetary economics. Prof. Example’s recent works center around the use of payment methods in developing countries.',
      ),
    ).toMatchObject({
      fullDescription:
        'Research focuses on applied macroeconomics, macro development, innovation, and monetary economics. Recent work centers on the use of payment methods in developing countries.',
      shortDescription:
        'Studies applied macroeconomics, macro development, innovation, and monetary economics.',
    });
  });

  it('can derive a conservative description from official Engineering profile perspectives', () => {
    const extraction = descriptionExtractionFromHomePage({
      url: 'https://engineering.yale.edu/research-and-faculty/faculty-directory/example-theorist',
      html: `
        <main>
          <h2>Professor of Computer Science</h2>
          <h3>Perspectives</h3>
          <ul>
            <li>Theory of Computation</li>
            <li>Economics &amp; Computation</li>
            <li>Optimization</li>
            <li>Learning</li>
          </ul>
          <h3>Selected Publications</h3>
        </main>
      `,
    });

    expect(extraction).toMatchObject({
      fullDescription:
        'Research focuses on Theory of Computation, Economics and Computation, Optimization, and Learning.',
      shortDescription:
        'Studies Theory of Computation, Economics and Computation, Optimization, and Learning.',
      researchAreas: [
        'Theory of Computation',
        'Economics and Computation',
        'Optimization',
        'Learning',
      ],
    });
  });

  it('extracts official Engineering profile perspective paragraphs before LLM fallback', () => {
    const extraction = descriptionExtractionFromHomePage({
      url: 'https://engineering.yale.edu/research-and-faculty/faculty-directory/example-networker',
      html: `
        <main>
          <div class="grid">
            <div><h3>Perspectives</h3></div>
            <div>
              <p>Research interests are in the field of computer and communication networks with emphasis on fundamental mathematical models and algorithms of complex networks, architectures and protocols of wireless systems, sensor networks, novel internet architectures and experimental platforms for network research.</p>
              <p>His most notable contributions include the max-weight scheduling algorithm and the back-pressure network control policy, opportunistic scheduling in wireless, the maximum lifetime approach for wireless network energy management, and multiple antenna wireless systems.</p>
            </div>
          </div>
          <h3>Selected Awards & Honors</h3>
        </main>
      `,
    });

    expect(extraction).toMatchObject({
      fullDescription:
        "Research interests are in the field of computer and communication networks with emphasis on fundamental mathematical models and algorithms of complex networks, architectures and protocols of wireless systems, sensor networks, novel internet architectures and experimental platforms for network research. Notable contributions include the max-weight scheduling algorithm and the back-pressure network control policy, opportunistic scheduling in wireless, the maximum lifetime approach for wireless network energy management, and multiple antenna wireless systems.",
      shortDescription:
        'Studies computer and communication networks with emphasis on fundamental mathematical models and algorithms of complex networks, architectures and protocols of wireless systems, sensor networks, novel internet architectures and experimental platforms for network research.',
    });
  });

  it('clips official Engineering perspective text before awards and publication chrome', () => {
    const extraction = descriptionExtractionFromHomePage({
      url: 'https://engineering.yale.edu/research-and-faculty/faculty-directory/example-imaging',
      html: `
        <main>
          <div class="grid">
            <div><h3>Perspectives</h3></div>
            <div>
              <p>Automated medical image analysis including model-based image segmentation, nonrigid registration methods, characterization of deformation, machine learning, structural connectivity image analysis, and functional magnetic resonance image analysis with applications in neuroscience, cardiology and cancer. Selected Awards &amp; Honors Example award. Selected Publications Example article title.</p>
            </div>
          </div>
        </main>
      `,
    });

    expect(extraction).toMatchObject({
      fullDescription:
        'Automated medical image analysis including model-based image segmentation, nonrigid registration methods, characterization of deformation, machine learning, structural connectivity image analysis, and functional magnetic resonance image analysis with applications in neuroscience, cardiology and cancer.',
      shortDescription:
        'Studies automated medical image analysis for neuroscience, cardiology, and cancer applications.',
    });
  });

  it('extracts focused research prose from official SOM faculty profiles', () => {
    const extraction = descriptionExtractionFromHomePage({
      url: 'https://som.yale.edu/faculty-research/faculty-directory/example-economist',
      html: `
        <main>
          <div class="ckeditor">
            <p><strong>Professor Example’s interests include applied macroeconomics, macro development, innovation, and monetary economics</strong>. Recent work centers on the use of payment methods in developing countries.</p>
          </div>
        </main>
      `,
    });

    expect(extraction).toMatchObject({
      fullDescription:
        'Research focuses on applied macroeconomics, macro development, innovation, and monetary economics. Recent work centers on the use of payment methods in developing countries.',
      shortDescription:
        'Studies applied macroeconomics, macro development, innovation, and monetary economics.',
    });
  });

  it('extracts focused research prose from official Yale Medicine faculty profiles', () => {
    const extraction = descriptionExtractionFromHomePage({
      url: 'https://medicine.yale.edu/profile/example-clinician/',
      html: `
        <main>
          <p>Biography Dr. Example studies the T cell co-receptor CD8ab and the functional significance of four isoforms of the human CD8b protein that exist in humans and great apes but not mice. More recently she is studying the basis for acquired resistance to immunotherapy of human lung cancer tumors. Dr. Example is currently Vice Chair for Collaborative Excellence.</p>
        </main>
      `,
    });

    expect(extraction).toMatchObject({
      fullDescription:
        'Dr. Example studies the T cell co-receptor CD8ab and the functional significance of four isoforms of the human CD8b protein that exist in humans and great apes but not mice. More recently she is studying the basis for acquired resistance to immunotherapy of human lung cancer tumors.',
      shortDescription:
        'Studies the T cell co-receptor CD8ab and the functional significance of four isoforms of the human CD8b protein that exist in humans and great apes but not mice.',
    });
  });

  it('rejects generated lab descriptions when the source only supports a faculty biography', () => {
    const normalized = normalizeDescriptionExtraction(
      {
        fullDescription:
          "The Example Faculty Lab focuses on economic theory, particularly the concepts of collateral general equilibrium and the leverage cycle, which provide insights into financial crises. The lab employs mathematical economics and agent-based modeling to explore issues such as monetary equilibrium, social security reform, and the dynamics of credit markets.",
        shortDescription:
          'The Example Faculty Lab studies economic theory, focusing on collateral general equilibrium and leverage cycles, using mathematical and agent-based modeling to analyze financial crises and systemic risk.',
        researchAreas: ['economic theory'],
        evidenceQuote:
          'The profile holder was the inventor of the collateral general equilibrium and the leverage cycle.',
      },
      'Example Faculty is a named professor of economics. Education Ph.D., Economics, Example University. The profile holder was the inventor of the collateral general equilibrium and the leverage cycle.',
    );

    expect(normalized).toEqual({
      fullDescription: '',
      shortDescription: '',
      researchAreas: [],
      evidenceQuote: '',
    });
  });

  it('does not treat incidental lab event text as support for a generated lab identity', () => {
    const normalized = normalizeDescriptionExtraction(
      {
        fullDescription:
          'The Example Faculty Lab studies financial crises using economic theory, market design, and applied modeling to understand systemic risk.',
        shortDescription:
          'Studies financial crises using economic theory, market design, and applied modeling.',
        researchAreas: ['financial crises'],
        evidenceQuote:
          'Research topics include market design and financial crises using economic theory.',
      },
      'Research topics include market design and financial crises using economic theory. Strategic Investment Annual Idea Lab Conference.',
    );

    expect(normalized).toEqual({
      fullDescription: '',
      shortDescription: '',
      researchAreas: [],
      evidenceQuote: '',
    });
  });

  it('derives short descriptions for center and initiative research prose', () => {
    expect(
      normalizeDescriptionExtraction(
        {
          fullDescription:
            'The Fixture Program on Comparative Governance investigates the relationship between regime types and economic performance, focusing on how different democratic and autocratic structures influence growth and prosperity. It examines the mechanisms through which political arrangements and societal factors affect economic outcomes, particularly in weakly institutionalized democracies where clientelism may prevail. The program aims to understand the dynamics that lead to effective democratic institutions and their impact on long-term development.',
          shortDescription: '',
          researchAreas: ['democratic governance'],
          evidenceQuote:
            'This program builds on that work to probe more deeply into what aspects of democracy (or autocracy), law, and social arrangements matter, by what mechanisms.',
        },
        'The Fixture Program on Comparative Governance investigates the relationship between regime types and economic performance, focusing on how different democratic and autocratic structures influence growth and prosperity. It examines the mechanisms through which political arrangements and societal factors affect economic outcomes, particularly in weakly institutionalized democracies where clientelism may prevail. The program aims to understand the dynamics that lead to effective democratic institutions and their impact on long-term development. This program builds on that work to probe more deeply into what aspects of democracy (or autocracy), law, and social arrangements matter, by what mechanisms.',
      ).shortDescription,
    ).toBe(
      'Investigates the relationship between regime types and economic performance, focusing on how different democratic and autocratic structures influence growth and prosperity.',
    );

    expect(
      normalizeDescriptionExtraction(
        {
          fullDescription:
            'The Fixture Initiative on Environment and Global Affairs focuses on the intersection of environmental change and global affairs, equipping students with skills to address its impacts on policy areas such as urban planning, financial stability, and trade. The initiative includes a core curriculum on earth system science, specialized courses on energy transitions and development finance, and practical experiences through talks and immersion opportunities with industry leaders.',
          shortDescription: '',
          researchAreas: ['environmental change'],
          evidenceQuote:
            'Environmental change is a defining strategic challenge for current and future leaders. Its impacts run through policy areas from urban planning and infrastructure investments to financial market stability and border security.',
        },
        'The Fixture Initiative on Environment and Global Affairs focuses on the intersection of environmental change and global affairs, equipping students with skills to address its impacts on policy areas such as urban planning, financial stability, and trade. The initiative includes a core curriculum on earth system science, specialized courses on energy transitions and development finance, and practical experiences through talks and immersion opportunities with industry leaders. Environmental change is a defining strategic challenge for current and future leaders. Its impacts run through policy areas from urban planning and infrastructure investments to financial market stability and border security.',
      ).shortDescription,
    ).toBe(
      'Focuses on the intersection of environmental change and global affairs, equipping students with skills to address its impacts on policy areas such as urban planning, financial stability, and trade.',
    );
  });

  it('derives short descriptions from soft-matter focus prose', () => {
    const fullDescription =
      'In the soft matter area, we focus on understanding glass and jamming transitions in granular materials, dense colloidal suspensions, foams, and model systems, in which the structural and stress relaxation times diverge when various control parameters such as temperature, density, and applied stress are tuned. Employs a combination of theoretical and computational techniques to understand fundamental aspects of glass and jamming transitions.';

    expect(
      normalizeDescriptionExtraction(
        {
          fullDescription,
          shortDescription: '',
          researchAreas: ['soft matter'],
          evidenceQuote:
            'In the soft matter area, we focus on understanding glass and jamming transitions in granular materials, dense colloidal suspensions, foams, and model systems.',
        },
        `${fullDescription} In the soft matter area, we focus on understanding glass and jamming transitions in granular materials, dense colloidal suspensions, foams, and model systems.`,
      ).shortDescription,
    ).toBe(
      'Studies glass and jamming transitions in granular materials, dense colloidal suspensions, foams, and model systems.',
    );
  });

  it('derives short descriptions from uses-to-attack source prose without malformed study verbs', () => {
    const fullDescription =
      'Uses first principles computational methods to attack topical and fundamental questions in condensed materials theory and materials physics.';

    expect(
      normalizeDescriptionExtraction(
        {
          fullDescription,
          shortDescription: '',
          researchAreas: ['condensed materials theory'],
          evidenceQuote:
            'Our group uses first principles computational methods to attack topical and fundamental questions in condensed materials theory and materials physics.',
        },
        'Our group uses first principles computational methods to attack topical and fundamental questions in condensed materials theory and materials physics.',
      ).shortDescription,
    ).toBe(
      'Studies topical and fundamental questions in condensed materials theory and materials physics using first principles computational methods.',
    );
  });

  it('derives short descriptions from research-focus understanding prose without awkward gerunds', () => {
    const fullDescription =
      'Research focuses on understanding the mechanisms that underlie genetic forms of heart disease.';
    const evidenceQuote =
      'Dr. Fixture’s research currently focuses on understanding the mechanisms that underlie genetic forms of heart disease.';

    expect(
      normalizeDescriptionExtraction(
        {
          fullDescription,
          shortDescription: '',
          researchAreas: ['heart disease'],
          evidenceQuote,
        },
        evidenceQuote,
      ).shortDescription,
    ).toBe('Studies the mechanisms that underlie genetic forms of heart disease.');
  });

  it('derives short descriptions from named lab investigates prose', () => {
    const fullDescription =
      'The Fixture Nucleus Lab investigates fundamental aspects of nuclear structure, dynamics, and integrity, focusing on how nuclear organization influences genome function and cellular health.';

    expect(
      normalizeDescriptionExtraction(
        {
          fullDescription,
          shortDescription: '',
          researchAreas: ['nuclear structure'],
          evidenceQuote:
            'The Fixture Nucleus Lab investigates fundamental aspects of nuclear structure, dynamics, and integrity, focusing on how nuclear organization influences genome function and cellular health.',
        },
        fullDescription,
      ).shortDescription,
    ).toBe(
      'Investigates fundamental aspects of nuclear structure, dynamics, and integrity, focusing on how nuclear organization influences genome function and cellular health.',
    );
  });

  it('derives short descriptions from emotional-process research prose instead of setup sentences', () => {
    const fullDescription =
      'Emotions are at the core of our human experience. Yet much of our emotional lives remains shrouded in mystery. Why do some people experience such a diverse range of emotions? When does culture create a barrier to a mutual understanding of each other’s states? We address questions like these with research focused on the dynamic influences of social, affective, and cultural processes on emotional experience, emotion perception and their downstream consequences for the mind, behavior, and relationships. Employs a multi-method approach, including ambulatory, fieldwork, and lab-based studies using behavioral and physiological methods.';

    expect(
      normalizeDescriptionExtraction(
        {
          fullDescription,
          shortDescription: '',
          researchAreas: ['emotion perception'],
          evidenceQuote: 'Emotions are at the core of our human experience.',
        },
        fullDescription,
      ).shortDescription,
    ).toBe(
      'Studies the dynamic influences of social, affective, and cultural processes on emotional experience, emotion perception and their downstream consequences for the mind, behavior, and relationships.',
    );
  });

  it('sanitizes malformed source fragments and derives short descriptions from research-aims prose', () => {
    const fullDescription =
      'The Computational Health Dynamics Lab is directed by Dr. Example. Our research aims to capture and model the complex dynamics of health behavior, with a focus on risk signals, intervention timing, and care-seeking patterns. Health behavior is complex, heterogeneous, and dynamic, varying within people, between people, and across time. The goal of our research is to develop and harness methods that can capture and model this complexity, with a focus on time-varying risk and protective factors. Our work is interdisciplinary by nature. e.g., via smartphones and wearable biosensors).';

    expect(
      normalizeDescriptionExtraction(
        {
          fullDescription,
          shortDescription: '',
          researchAreas: ['health behavior'],
          evidenceQuote:
            'Health behavior is complex, heterogeneous, and dynamic, varying within people, between people, and across time.',
        },
        fullDescription,
      ),
    ).toMatchObject({
      fullDescription:
        'The Computational Health Dynamics Lab is directed by Dr. Example. Research aims to capture and model the complex dynamics of health behavior, with a focus on risk signals, intervention timing, and care-seeking patterns. Health behavior is complex, heterogeneous, and dynamic, varying within people, between people, and across time. The goal of our research is to develop and harness methods that can capture and model this complexity, with a focus on time-varying risk and protective factors. Our work is interdisciplinary by nature.',
      shortDescription:
        'Models the complex dynamics of health behavior, with a focus on risk signals, intervention timing, and care-seeking patterns.',
    });
  });

  it('rejects question-form shorts and derives computational social cognition mission prose', () => {
    const fullDescription =
      'As you go through your day, you are effortlessly interacting with other people by building living simulations of who they are and how they think. Our lab’s mission is to build a computational theory of how minds understand each other by answering four foundational questions: How does the mind model other minds? How do we build accurate models of each other?';

    expect(
      normalizeDescriptionExtraction(
        {
          fullDescription,
          shortDescription: 'How do we build accurate models of each other?',
          researchAreas: ['social cognition'],
          evidenceQuote:
            'As you go through your day, you are effortlessly interacting with other people by building living simulations of who they are and how they think.',
        },
        fullDescription,
      ).shortDescription,
    ).toBe(
      'Builds a computational theory of how minds understand each other by answering four foundational questions.',
    );
  });

  it('derives short descriptions from group works-on prose', () => {
    const fullDescription =
      'Works on diverse topics in theoretical high energy physics, including physics beyond the Standard Model, field theory, quantum chromodynamics, conformal bootstrap, and early universe physics.';

    expect(
      normalizeDescriptionExtraction(
        {
          fullDescription,
          shortDescription: '',
          researchAreas: ['theoretical high energy physics'],
          evidenceQuote:
            'Our group works on diverse topics in theoretical high energy physics, including physics beyond the Standard Model, field theory, quantum chromodynamics, conformal bootstrap, and early universe physics.',
        },
        'Our group works on diverse topics in theoretical high energy physics, including physics beyond the Standard Model, field theory, quantum chromodynamics, conformal bootstrap, and early universe physics.',
      ).shortDescription,
    ).toBe(
      'Studies diverse topics in theoretical high energy physics, including physics beyond the Standard Model, field theory, quantum chromodynamics, conformal bootstrap, and early universe physics.',
    );
  });

  it('derives short descriptions from lab-focus and combine/model prose', () => {
    expect(
      normalizeDescriptionExtraction(
        {
          fullDescription:
            'We combine computation and experiment to tackle difficult challenges in basic science and drug discovery.',
          shortDescription: '',
          researchAreas: ['drug discovery'],
          evidenceQuote:
            'We combine computation and experiment to tackle difficult challenges in basic science and drug discovery.',
        },
        'We combine computation and experiment to tackle difficult challenges in basic science and drug discovery.',
      ).shortDescription,
    ).toBe(
      'Studies tackle difficult challenges in basic science and drug discovery by combining computation and experiment.',
    );

    expect(
      normalizeDescriptionExtraction(
        {
          fullDescription:
            'At the Fixture Immune Modeling Laboratory, we model and mechanistically study human infectious, inflammatory, fibrotic diseases, and cancer. We combine in vitro and in vivo models, bioinformatic approaches, and perturbation studies in humanized mice to examine the role of various human immune cells in disease pathophysiology.',
          shortDescription: '',
          researchAreas: ['immunology'],
          evidenceQuote:
            'At the Fixture Immune Modeling Laboratory, we model and mechanistically study human infectious, inflammatory, fibrotic diseases, and cancer.',
        },
        'At the Fixture Immune Modeling Laboratory, we model and mechanistically study human infectious, inflammatory, fibrotic diseases, and cancer. We combine in vitro and in vivo models, bioinformatic approaches, and perturbation studies in humanized mice to examine the role of various human immune cells in disease pathophysiology.',
      ).shortDescription,
    ).toBe(
      'Studies human infectious, inflammatory, fibrotic diseases, and cancer.',
    );

    expect(
      normalizeDescriptionExtraction(
        {
          fullDescription:
            'In the Fixture Cytoskeleton Lab, research focuses on the spectrin membrane cytoskeleton and its critical role in organizing specialized membrane-surface domains essential for multicellular function. The lab investigates how cells achieve spatial design, the mechanisms of spectrin polarized assembly, and its interactions with proteins involved in signal transduction and membrane assembly.',
          shortDescription: '',
          researchAreas: ['cell biology'],
          evidenceQuote:
            'In the Fixture Cytoskeleton Lab, research focuses on the spectrin membrane cytoskeleton and its critical role in organizing specialized membrane-surface domains essential for multicellular function.',
        },
        'In the Fixture Cytoskeleton Lab, research focuses on the spectrin membrane cytoskeleton and its critical role in organizing specialized membrane-surface domains essential for multicellular function. The lab investigates how cells achieve spatial design, the mechanisms of spectrin polarized assembly, and its interactions with proteins involved in signal transduction and membrane assembly.',
      ).shortDescription,
    ).toBe(
      'Studies the spectrin membrane cytoskeleton and its critical role in organizing specialized membrane-surface domains essential for multicellular function.',
    );
  });

  it('accepts source quotes wrapped in quotation marks and falls back to a useful generated short description', () => {
    const obs = descriptionExtractionToObservations(
      {
        slug: 'quantum-institute',
        name: 'Fixture Quantum Institute',
        websiteUrl: 'https://quantuminstitute.yale.edu/',
      },
      'https://quantuminstitute.yale.edu/',
      {
        fullDescription:
          'The Fixture Quantum Institute focuses on advancing quantum science and technology by uniting experimental and theoretical researchers in quantum information physics, quantum control, quantum measurement, and quantum many-body physics. The institute aims to harness quantum mechanics principles to develop transformative technologies in computing, sensing, and communication. It also hosts conferences and workshops to foster collaboration and innovation in the field.',
        shortDescription:
          'Unites Yale researchers in quantum information physics, quantum control, quantum measurement, and quantum many-body physics, with programs that support collaboration in computing, sensing, and communication.',
        researchAreas: ['quantum information physics'],
        evidenceQuote:
          '"The Fixture Quantum Institute serves as a forum to bring together experimental and theoretical researchers in the field of quantum information physics, quantum control, quantum measurement, and quantum many-body physics."',
      },
      new Date('2026-05-15T12:00:00Z'),
      'The Fixture Quantum Institute serves as a forum to bring together experimental and theoretical researchers in the field of quantum information physics, quantum control, quantum measurement, and quantum many-body physics.',
    );

    expect(obs.find((o) => o.field === 'fullDescription')).toBeDefined();
    expect(obs.find((o) => o.field === 'shortDescription')?.value).toBe(
      'Unites Yale researchers in quantum information physics, quantum control, quantum measurement, and quantum many-body physics, with programs that support collaboration in computing, sensing, and communication.',
    );
  });

  it('rejects research descriptions supported only by an identity quote', () => {
    const obs = descriptionExtractionToObservations(
      {
        slug: 'dept-psych-fixture-attention',
        name: 'Fixture Attention Lab',
        websiteUrl: 'https://www.brognition.yale.edu/',
      },
      'https://www.brognition.yale.edu/',
      {
        fullDescription:
          'The Fixture Brain Modeling Lab is a scientific research group headed by Professor Fixture. We use human neuroscience methods to investigate how the brain makes sense out of signals and guides adaptive behavior.',
        shortDescription:
          'Uses human neuroscience methods to investigate how the brain makes sense out of signals and guides adaptive behavior.',
        researchAreas: ['Human neuroscience'],
        evidenceQuote:
          'The Fixture Brain Modeling Lab is a scientific research group headed by Professor Fixture.',
      },
      new Date('2026-05-22T00:00:00Z'),
      'The Fixture Brain Modeling Lab is a scientific research group headed by Professor Fixture. We use human neuroscience methods to investigate how the brain makes sense out of signals and guides adaptive behavior.',
    );

    expect(obs.map((o) => o.field)).toEqual([]);
  });

  it('rejects facility descriptions for person-style research entities', () => {
    const obs = descriptionExtractionToObservations(
      {
        slug: 'dept-seas-fixture-facility-profile',
        name: 'Fixture Researcher — Research',
        websiteUrl: 'https://medicine.yale.edu/pet/',
      },
      'https://medicine.yale.edu/pet/',
      {
        fullDescription:
          'The Fixture PET Core focuses on molecular imaging research using Positron Emission Tomography (PET) to study organ function and biochemical changes in disease.',
        shortDescription:
          'Studies molecular imaging research using Positron Emission Tomography to study organ function and biochemical changes in disease.',
        researchAreas: ['PET imaging'],
        evidenceQuote:
          'The Fixture PET Core focuses on molecular imaging research using Positron Emission Tomography (PET).',
      },
      new Date('2026-05-22T00:00:00Z'),
      'The Fixture PET Core focuses on molecular imaging research using Positron Emission Tomography (PET).',
    );

    expect(obs).toEqual([]);
  });

  it('attributes blank or rejected extraction samples to the homepage instead of the first crawled subpage', () => {
    expect(
      sourceUrlForDescriptionExtraction(
        { url: 'https://medicine.yale.edu/lab/chupp/', text: 'Research Focus' },
        [{ url: 'https://medicine.yale.edu/lab/chupp/publications', text: 'Publications' }],
        {
          fullDescription: '',
          shortDescription: '',
          researchAreas: [],
          evidenceQuote: '',
        },
      ),
    ).toBe('https://medicine.yale.edu/lab/chupp/');
  });

  it('respects manually locked description fields when mapping observations', () => {
    const obs = descriptionExtractionToObservations(
      {
        slug: 'locked-short',
        name: 'Locked Short',
        websiteUrl: 'https://locked-short.example.edu/',
        manuallyLockedFields: ['shortDescription', 'researchAreas'],
      },
      'https://locked-short.example.edu/research',
      extraction,
    );

    expect(obs.find((o) => o.field === 'fullDescription')).toBeDefined();
    expect(obs.find((o) => o.field === 'shortDescription')).toBeUndefined();
    expect(obs.find((o) => o.field === 'researchAreas')).toBeUndefined();
  });

  it('sanitizes generated text without product character caps', () => {
    const normalized = normalizeDescriptionExtraction({
      fullDescription: `
        The lab studies how social environments shape learning, attention, and decision-making across development.
        Projects examine how children and adults use categories, institutions, and shared narratives to reason about other people.
        The team combines behavioral experiments, longitudinal studies, interviews, and computational models to connect classroom experience with cognitive development.
        Current work also compares urban and rural learning contexts to understand how social expectations influence curiosity, collaboration, and memory.
        These studies help explain when everyday environments support flexible reasoning and when they reinforce narrow assumptions.
      `,
      shortDescription: `
        Studies how social environments shape learning, attention, and decision-making across development, using behavioral experiments, longitudinal studies, interviews, and computational models to connect classroom experience with cognitive development.
      `,
      researchAreas: [
        ' Social Cognition ',
        'social cognition',
        'A'.repeat(120),
        '',
        'Developmental psychology',
      ],
      evidenceQuote: ` ${'quote '.repeat(80)} `,
    });

    expect(normalized.fullDescription.length).toBeGreaterThan(520);
    expect(normalized.shortDescription.length).toBeGreaterThan(180);
    expect(normalized.evidenceQuote.length).toBeLessThanOrEqual(240);
    expect(normalized.fullDescription).not.toMatch(/\s{2,}/);
    expect(normalized.researchAreas).toEqual([
      'Social Cognition',
      'A'.repeat(80),
      'Developmental psychology',
    ]);
  });

  it('drops YSM profile chrome from normalized research areas', () => {
    const normalized = normalizeDescriptionExtraction({
      ...extraction,
      researchAreas: [
        'ORCID0000-0000-0000-001X',
        'Lab Whisk Cup Streamline Icon: https://streamlinehq.comFixture Oncology LabView Lab Website',
        'Fixture Clinician, MDView Full ProfileView 27 Common Publications',
        'Pancreatic Neoplasms',
        'Publications',
        '13',
        '328',
        '10 YSM Researchers',
        'View Related Publication',
        'Yale Co-AuthorsFrequent collaborators of Fixture A.',
      ],
    });

    expect(normalized.researchAreas).toEqual(['Pancreatic Neoplasms']);
  });
});

describe('LabMicrositeDescriptionLLMExtractor.run', () => {
  beforeEach(() => {
    vi.mocked(getCached).mockReset();
    vi.mocked(getCached).mockResolvedValue(null);
    vi.mocked(setCached).mockReset();
    vi.mocked(setCached).mockResolvedValue(undefined);
  });

  it('fetches official microsite pages and emits only description-oriented observations', async () => {
    const fetchPage = makeFetchPage({
      'https://cognition.example.edu/': RESEARCH_HOME_HTML,
      'https://cognition.example.edu/research': RESEARCH_PAGE_HTML,
    });
    const callLLM = vi.fn(async () => extraction);
    const scraper = newTestScraper({
      fetchPage,
      callLLM,
      apiKey: 'sk-test',
      entityFinder: async () => [
        {
          _id: '1',
          slug: 'dept-psych-example-cognition',
          name: 'Example Cognition Lab',
          websiteUrl: 'https://cognition.example.edu/',
          description: '',
        },
      ],
    });
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);

    expect(fetchPage).toHaveBeenCalledWith('https://cognition.example.edu/');
    expect(fetchPage).toHaveBeenCalledWith('https://cognition.example.edu/research');
    expect(callLLM).toHaveBeenCalledTimes(1);
    const llmInput = (callLLM.mock.calls as unknown as Array<
      [{ systemPrompt: string; userPrompt: string }]
    >)[0][0];
    expect(llmInput.systemPrompt).toMatch(/must not create entry pathways/i);
    expect(llmInput.systemPrompt).toMatch(/2-5 sentences/i);
    expect(llmInput.systemPrompt).toMatch(
      /Do not write a fullDescription from the lab name, departments, topics, or current description metadata/i,
    );
    expect(llmInput.userPrompt).toContain('social cognition');
    expect(llmInput.userPrompt).toContain('SUB-PAGE TEXT');
    expect(result.entitiesObserved).toBe(1);
    expect((result.metrics as any)?.descriptionReviewSamples).toEqual([
      expect.objectContaining({
        slug: 'dept-psych-example-cognition',
        name: 'Example Cognition Lab',
        sourceUrl: 'https://cognition.example.edu/research',
        decision: 'accepted',
        fullDescription: extraction.fullDescription,
        evidenceQuote: extraction.evidenceQuote,
      }),
    ]);
    expect(emitted.map((o) => o.field).sort()).toEqual(
      [
        'fullDescription',
        'lastObservedAt',
        'researchAreas',
        'shortDescription',
      ].sort(),
    );
    const emittedFields = emitted.map((o) => o.field);
    for (const forbiddenField of [
      'acceptingUndergrads',
      'undergradAccessEvidence',
      'joinPageUrl',
      'postedOpportunity',
    ]) {
      expect(emittedFields).not.toContain(forbiddenField);
    }
  });

  it('drops LLM-generated description fields when the evidence quote is unsupported by fetched pages', async () => {
    const fetchPage = makeFetchPage({
      'https://unsupported-quote.example.edu/': RESEARCH_HOME_HTML,
      'https://unsupported-quote.example.edu/research': RESEARCH_PAGE_HTML,
    });
    const callLLM = vi.fn(async () => ({
      fullDescription:
        'The Unsupported Quote Lab studies decision-making using behavioral experiments and computational modeling.',
      shortDescription:
        'Studies decision-making using behavioral experiments and computational modeling.',
      researchAreas: ['decision-making'],
      evidenceQuote: 'A phrase that does not appear anywhere in the fetched source text.',
    }));
    const scraper = newTestScraper({
      fetchPage,
      callLLM,
      apiKey: 'sk-test',
      entityFinder: async () => [
        {
          _id: '1',
          slug: 'unsupported-quote-lab',
          name: 'Unsupported Quote Lab',
          websiteUrl: 'https://unsupported-quote.example.edu/',
          description: '',
        },
      ],
    });
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);

    expect(emitted.map((o) => o.field)).toEqual([]);
    expect((result.metrics as any)?.descriptionReviewSamples).toEqual([
      expect.objectContaining({
        slug: 'unsupported-quote-lab',
        decision: 'rejected',
        rejectionReasons: expect.arrayContaining(['unsupported-evidence-quote']),
        evidenceQuote: 'A phrase that does not appear anywhere in the fetched source text.',
      }),
    ]);
  });

  it('falls back to the LLM when homepage parsing cannot produce a distinct short description', async () => {
    const fetchPage = makeFetchPage({
      'https://environment.example.edu/yibs': `
        <html><body>
          <p>YIBS is an umbrella environmental science center on campus, supporting and inspiring the environmental community at Yale through research and training, grants and fellowships, and weekly seminars and events.</p>
        </body></html>
      `,
    });
    const callLLM = vi.fn(async () => ({
      fullDescription:
        'YIBS is an umbrella environmental science center that supports Yale environmental research and training through grants, fellowships, seminars, and events.',
      shortDescription:
        'Supports Yale environmental research and training through grants, fellowships, seminars, and events.',
      researchAreas: ['environmental science'],
      evidenceQuote:
        'supporting and inspiring the environmental community at Yale through research and training',
    }));
    const scraper = newTestScraper({
      fetchPage,
      callLLM,
      apiKey: 'sk-test',
      entityFinder: async () => [
        {
          _id: '1',
          slug: 'yse-institute-biospheric-studies',
          name: 'Fixture Institute for Biospheric Studies',
          websiteUrl: 'https://environment.example.edu/yibs',
          fullDescription:
            'YIBS is an umbrella environmental science center on campus, supporting and inspiring the environmental community at Yale through research and training, grants and fellowships, and weekly seminars and events.',
          shortDescription: '',
        },
      ],
    });
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);

    expect(callLLM).toHaveBeenCalledTimes(1);
    expect(emitted.find((o) => o.field === 'shortDescription')?.value).toBe(
      'Supports Yale environmental research and training through grants, fellowships, seminars, and events.',
    );
  });

  it('keeps useful deterministic descriptions without LLM fallback', async () => {
    const deterministicFull =
      'Our lab is dedicated to advancing natural language processing (NLP) through the development of novel methods, robust software, and real-world applications across a range of biomedical texts, including clinical notes, scientific literature, and social media. These three areas are closely interconnected: innovative methods inform the creation of widely used software; that software supports clinical applications; and insights from those applications highlight new challenges, guiding the development of future methods. Together, they form a dynamic and collaborative ecosystem that drives our research in clinical NLP.';
    const fetchPage = makeFetchPage({
      'https://clinical-nlp.example.edu/': `<html><body><p>${deterministicFull}</p></body></html>`,
    });
    const callLLM = vi.fn(async () => ({
      fullDescription: '',
      shortDescription: '',
      researchAreas: [],
      evidenceQuote:
        'Our lab is dedicated to advancing natural language processing (NLP) through the development of novel methods, robust software, and real-world applications across a range of biomedical texts.',
    }));
    const scraper = newTestScraper({
      fetchPage,
      callLLM,
      apiKey: 'sk-test',
      entityFinder: async () => [
        {
          _id: '1',
          slug: 'dept-cs-fixture-clinical-ai',
          name: 'Fixture Clinical AI Lab',
          websiteUrl: 'https://clinical-nlp.example.edu/',
          fullDescription: '',
          shortDescription: '',
        },
      ],
    });
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);

    expect(callLLM).not.toHaveBeenCalled();
    expect(emitted.find((o) => o.field === 'fullDescription')?.value).toBe(deterministicFull);
    expect(emitted.find((o) => o.field === 'shortDescription')?.value).toBe(
      'Develops novel methods, robust software, and real-world applications for natural language processing (NLP).',
    );
    expect(emitted.find((o) => o.field === 'lastObservedAt')).toBeDefined();
  });

  it('fetches same-site research pages before supplemental profile fallbacks', async () => {
    const fetchPage = makeFetchPage({
      'https://fixture-plant-signaling.example.edu/': `
        <html><body>
          <h1>Fixture Plant Signaling Lab</h1>
          <p>Welcome to the Fixture Plant Signaling lab website.</p>
          <a href="/research">Research</a>
        </body></html>
      `,
      'https://fixture-plant-signaling.example.edu/research': `
        <html><body>
          <h2>Research</h2>
          <p>Circadian clocks coordinate processes across the day, but they can also be used to measure daylength (photoperiod) allowing for coordination of seasonal development.</p>
          <p>We study this question in the model plant Arabidopsis because it has easily observable circadian physiology, and transgenics that express visual reporters for daily and seasonal rhythms.</p>
        </body></html>
      `,
      'https://profile.example.edu/one': '<html><body><p>Appointment profile only.</p></body></html>',
      'https://profile.example.edu/two': '<html><body><p>Appointment profile only.</p></body></html>',
      'https://profile.example.edu/three': '<html><body><p>Appointment profile only.</p></body></html>',
    });
    const callLLM = vi.fn(async () => {
      throw new Error('LLM should not be needed');
    });
    const scraper = newTestScraper({
      fetchPage,
      callLLM,
      apiKey: 'sk-test',
      entityFinder: async () => [
        {
          _id: '1',
          slug: 'dept-mcdb-fixture-plant-signaling',
          name: 'Fixture Plant Signaling Lab',
          websiteUrl: 'https://fixture-plant-signaling.example.edu/',
          sourceUrls: [
            'https://profile.example.edu/one',
            'https://profile.example.edu/two',
            'https://profile.example.edu/three',
          ],
          description: '',
        },
      ],
    });
    const { ctx, emitted } = makeContext({
      only: ['dept-mcdb-fixture-plant-signaling'],
      limit: 1,
    });

    await scraper.run(ctx);

    expect(fetchPage).toHaveBeenCalledWith('https://fixture-plant-signaling.example.edu/research');
    expect(callLLM).not.toHaveBeenCalled();
    expect(emitted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'shortDescription',
          value:
            'Studies biological timing, circadian physiology, and daily and seasonal plant rhythms.',
        }),
      ]),
    );
  });

  it('uses official Engineering profile pages as fallback evidence when a personal site is sparse', async () => {
    const fetchPage = makeFetchPage({
      'https://example-engineer.example.edu/': '<html><body><p>I am a faculty member in Statistics &amp; Data Science.</p></body></html>',
      'https://engineering.yale.edu/research-and-faculty/faculty-directory/example-engineer': `
        <html><body>
          <h2>Perspectives</h2>
          <p>Example's research interests include randomized algorithms with applications to harmonic analysis, signal and image processing, and massive datasets.</p>
          <ul>
            <li>My research interests include analysis, probability, discrete mathematics, and algorithms.</li>
            <li>I am especially interested in randomized algorithms with applications to harmonic analysis, signal and image processing, and massive datasets.</li>
          </ul>
        </body></html>
      `,
    });
    const callLLM = vi.fn(async () => ({
      fullDescription:
        'Research interests include analysis, probability, discrete mathematics, and algorithms. Research focuses on randomized algorithms with applications to harmonic analysis, signal and image processing, and massive datasets.',
      shortDescription:
        'Studies analysis, probability, discrete mathematics, and randomized algorithms with applications to signal and image processing.',
      researchAreas: ['algorithms'],
      evidenceQuote:
        'My research interests include analysis, probability, discrete mathematics, and algorithms.',
    }));
    const scraper = newTestScraper({
      fetchPage,
      callLLM,
      apiKey: 'sk-test',
      entityFinder: async () => [
        {
          _id: '1',
          slug: 'dept-seas-example-engineer',
          name: 'Example Engineer — Research',
          websiteUrl: 'https://example-engineer.example.edu/',
          sourceUrls: [
            'https://engineering.yale.edu/research-and-faculty/faculty-directory/load_faculty/172',
            'https://engineering.yale.edu/research-and-faculty/faculty-directory/example-engineer',
          ],
          fullDescription: '',
          shortDescription: '',
        },
      ],
    });
    const { ctx, emitted } = makeContext();
    await scraper.run(ctx);

    expect(fetchPage).toHaveBeenCalledWith(
      'https://engineering.yale.edu/research-and-faculty/faculty-directory/example-engineer',
    );
    expect(emitted.find((o) => o.field === 'fullDescription')?.sourceUrl).toBe(
      'https://engineering.yale.edu/research-and-faculty/faculty-directory/example-engineer',
    );
    expect(emitted.find((o) => o.field === 'shortDescription')?.value).toContain(
      'randomized algorithms',
    );
  });

  it('matches pronoun evidence quotes against named official profile source text', () => {
    const obs = descriptionExtractionToObservations(
      {
        slug: 'dept-cs-fixture-algorithms',
        name: 'Fixture Algorithms Lab',
        websiteUrl: 'https://engineering.yale.edu/research-and-faculty/faculty-directory/fixture-algorithms',
        fullDescription: '',
        shortDescription: '',
      },
      'https://engineering.yale.edu/research-and-faculty/faculty-directory/fixture-algorithms',
      {
        fullDescription:
          'Research focuses on Internet algorithms, computational complexity, security and privacy, and digital copyright. She has developed influential algorithms for massive data sets.',
        shortDescription: '',
        researchAreas: ['security'],
        evidenceQuote:
          'Her research interests include Internet algorithms, computational complexity, security and privacy, and digital copyright.',
      },
      new Date('2026-05-22T12:00:00Z'),
      "Professor Fixture's research interests include Internet algorithms, computational complexity, security and privacy, and digital copyright.",
    );

    expect(obs.find((o) => o.field === 'fullDescription')?.value).toContain(
      'Internet algorithms',
    );
    expect(obs.find((o) => o.field === 'shortDescription')?.value).toBe(
      'Studies Internet algorithms, computational complexity, security and privacy, and digital copyright.',
    );
  });

  it('uses official Engineering profile pages when a personal site cannot be fetched', async () => {
    const fetchPage = makeFetchPage({
      'https://engineering.yale.edu/research-and-faculty/faculty-directory/fixture-database-systems': `
        <html><body>
          <h2>Perspectives</h2>
          <p>Research interests include database systems, operating systems, and distributed computing.</p>
          <p>Projects examine how software infrastructure supports reliable data management, transaction processing, storage systems, and scalable computing platforms.</p>
        </body></html>
      `,
    });
    const callLLM = vi.fn(async () => ({
      fullDescription:
        'Research interests include database systems, operating systems, and distributed computing. Projects examine reliable data management, transaction processing, storage systems, and scalable computing platforms.',
      shortDescription:
        'Studies database systems, operating systems, distributed computing, and reliable data management.',
      researchAreas: ['database systems'],
      evidenceQuote:
        'Research interests include database systems, operating systems, and distributed computing.',
    }));
    const scraper = newTestScraper({
      fetchPage,
      callLLM,
      apiKey: 'sk-test',
      entityFinder: async () => [
        {
          _id: '1',
          slug: 'dept-cs-fixture-database-systems',
          name: 'Fixture Database Systems Lab',
          websiteUrl: 'https://codex.cs.yale.edu/fixture-db/',
          sourceUrls: [
            'https://engineering.yale.edu/research-and-faculty/faculty-directory/fixture-database-systems',
          ],
          fullDescription:
            'Fixture Database Systems Lab is a Yale research home connected to Computer Science.',
          shortDescription: 'Research home connected to Computer Science.',
        },
      ],
    });
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);

    expect(fetchPage).toHaveBeenCalledWith('https://codex.cs.yale.edu/fixture-db/');
    expect(fetchPage).toHaveBeenCalledWith(
      'https://engineering.yale.edu/research-and-faculty/faculty-directory/fixture-database-systems',
    );
    expect((result.metrics as any)?.descriptionReviewSamples).toEqual([
      expect.objectContaining({
        sourceUrl:
          'https://engineering.yale.edu/research-and-faculty/faculty-directory/fixture-database-systems',
        decision: 'accepted',
      }),
    ]);
    expect(emitted.find((o) => o.field === 'fullDescription')?.sourceUrl).toBe(
      'https://engineering.yale.edu/research-and-faculty/faculty-directory/fixture-database-systems',
    );
    expect(emitted.find((o) => o.field === 'shortDescription')?.value).toBe(
      'Studies database systems, operating systems, and distributed computing.',
    );
  });

  it('derives a missing short description from an already useful stored full description', async () => {
    const fetchPage = vi.fn();
    const callLLM = vi.fn();
    const scraper = newTestScraper({
      fetchPage,
      callLLM,
      apiKey: 'sk-test',
      entityFinder: async () => [
        {
          _id: '1',
          slug: 'dept-cs-fixture-network-systems',
          name: 'Fixture Network Systems Lab',
          websiteUrl: 'https://cs-www.cs.yale.edu/homes/fixture-network/',
          fullDescription:
            'The Fixture Network Systems Lab conducts research in computer networks, wireless networking, mobile computing, distributed systems, and network security. Key research questions include Internet standards, traffic engineering, and network localization.',
          shortDescription: '',
        },
      ],
    });
    const { ctx, emitted } = makeContext();
    await scraper.run(ctx);

    expect(fetchPage).not.toHaveBeenCalled();
    expect(callLLM).not.toHaveBeenCalled();
    expect(emitted).toEqual([
      expect.objectContaining({
        entityKey: 'dept-cs-fixture-network-systems',
        field: 'shortDescription',
        sourceUrl: 'https://cs-www.cs.yale.edu/homes/fixture-network/',
        value:
          'Studies computer networks, wireless networking, mobile computing, distributed systems, and network security.',
      }),
      expect.objectContaining({
        entityKey: 'dept-cs-fixture-network-systems',
        field: 'lastObservedAt',
      }),
    ]);
  });

  it('derives an existing-full short repair even when the fetch target URL is excluded', async () => {
    const fetchPage = vi.fn();
    const callLLM = vi.fn();
    const scraper = newTestScraper({
      fetchPage,
      callLLM,
      apiKey: 'sk-test',
      entityFinder: async () => [
        descriptionCandidateFromResearchEntityDoc({
          _id: '1',
          slug: 'dept-math-fixture-relativity',
          name: 'Fixture Relativity Lab',
          websiteUrl: 'https://physics.yale.edu/people/fixture-geometer',
          sourceUrls: [
            'https://math.yale.edu/people/faculty',
            'https://math.yale.edu/profile/fixture-geometer',
          ],
          fullDescription:
            'The Fixture Relativity Lab investigates gravitational physics, particularly the global properties of solutions to geometric field equations, aiming to characterize stability and singularity formation. The lab uses mathematical methods to study nonlinear field equations.',
          shortDescription:
            "Fixture Relativity's research focuses on analyzing the global properties of solutions to geometric field equations with a view towards...",
        }),
      ],
    });
    const { ctx, emitted } = makeContext();
    await scraper.run(ctx);

    expect(fetchPage).not.toHaveBeenCalled();
    expect(callLLM).not.toHaveBeenCalled();
    const shortDescription = emitted.find((o) => o.field === 'shortDescription');
    expect(shortDescription).toEqual(
      expect.objectContaining({
        entityKey: 'dept-math-fixture-relativity',
        sourceUrl: 'https://math.yale.edu/people/faculty',
      }),
    );
    expect(String(shortDescription?.value)).toContain('gravitational physics');
    expect(String(shortDescription?.value)).not.toContain('Fixture Relativity Lab');
    expect(emitted.find((o) => o.field === 'lastObservedAt')).toEqual(
      expect.objectContaining({ entityKey: 'dept-math-fixture-relativity' }),
    );
  });

  it('derives a bad copied short description from an already useful stored full description', async () => {
    const fetchPage = vi.fn();
    const callLLM = vi.fn();
    const scraper = newTestScraper({
      fetchPage,
      callLLM,
      apiKey: 'sk-test',
      entityFinder: async () => [
        {
          _id: '1',
          slug: 'dept-cs-fixture-social-cognition',
          name: 'Fixture Social Cognition Lab',
          websiteUrl: 'https://social-cognition.example.edu/',
          fullDescription:
            "The Fixture Social Cognition Lab investigates computational social cognition, addressing how people model and understand each other's minds. The lab conducts experiments to discover new phenomena, builds theories to explain human thinking, and develops computational models to formalize these ideas. The lab's work spans social cognition and child development.",
          shortDescription:
            "The Fixture Social Cognition Lab investigates computational social cognition, addressing how people model and understand each other's minds. The lab conducts experiments to discover new phenomena.",
        },
      ],
    });
    const { ctx, emitted } = makeContext();
    await scraper.run(ctx);

    expect(fetchPage).not.toHaveBeenCalled();
    expect(callLLM).not.toHaveBeenCalled();
    const shortDescription = emitted.find((o) => o.field === 'shortDescription');
    expect(shortDescription).toEqual(
      expect.objectContaining({
        entityKey: 'dept-cs-fixture-social-cognition',
        sourceUrl: 'https://social-cognition.example.edu/',
      }),
    );
    expect(String(shortDescription?.value)).toContain('computational social cognition');
    expect(String(shortDescription?.value)).not.toContain('Fixture Social Cognition Lab');
    expect(String(shortDescription?.value)).not.toContain('The lab conducts experiments');
    expect(emitted.find((o) => o.field === 'lastObservedAt')).toEqual(
      expect.objectContaining({ entityKey: 'dept-cs-fixture-social-cognition' }),
    );
  });

  it('follows same-site iframe pages for legacy Engineering lab microsites', async () => {
    const fetchPage = makeFetchPage({
      'https://www.eng.yale.edu/fixturelab/': `
        <html><body>
          <iframe src="right.html"></iframe>
        </body></html>
      `,
      'https://www.eng.yale.edu/fixturelab/right.html': `
        <html><body>
          <p>Our lab focuses on photonic materials and nanoscale light transport. Our aim is to better understand and control propagation, scattering, absorption, and lasing in engineered structures for a range of imaging applications. We study unconventional light sources and explore applications ranging from low-speckle imaging to multimodal microscopy.</p>
        </body></html>
      `,
    });
    const callLLM = vi.fn(async () => ({
      fullDescription: '',
      shortDescription: '',
      researchAreas: [],
      evidenceQuote: '',
    }));
    const scraper = newTestScraper({
      fetchPage,
      callLLM,
      apiKey: 'sk-test',
      entityFinder: async () => [
        {
          _id: '1',
          slug: 'dept-seas-fixture-photonics',
          name: 'Fixture Photonics Lab',
          websiteUrl: 'https://www.eng.yale.edu/fixturelab/',
          fullDescription: '',
          shortDescription: '',
        },
      ],
    });
    const { ctx, emitted } = makeContext();
    await scraper.run(ctx);

    expect(fetchPage).toHaveBeenCalledWith('https://www.eng.yale.edu/fixturelab/right.html');
    expect(emitted.find((o) => o.field === 'fullDescription')?.value).toContain(
      'photonic materials and nanoscale light transport',
    );
    expect(emitted.find((o) => o.field === 'shortDescription')?.sourceUrl).toBe(
      'https://www.eng.yale.edu/fixturelab/right.html',
    );
  });

  it('uses cached LLM extraction when --use-cache is set', async () => {
    vi.mocked(getCached).mockResolvedValue(extraction);
    const fetchPage = makeFetchPage({
      'https://cached.example.edu/': RESEARCH_HOME_HTML,
    });
    const callLLM = vi.fn();
    const scraper = newTestScraper({
      fetchPage,
      callLLM,
      apiKey: 'sk-test',
      entityFinder: async () => [
        {
          _id: '1',
          slug: 'cached-lab',
          name: 'Cached Lab',
          websiteUrl: 'https://cached.example.edu/',
          description: '',
        },
      ],
    });
    const { ctx, emitted } = makeContext({ useCache: true });
    await scraper.run(ctx);

    expect(getCached).toHaveBeenCalledWith(
      'lab-microsite-description-llm',
      'llm:gpt-4o-mini:https://cached.example.edu/',
    );
    expect(callLLM).not.toHaveBeenCalled();
    expect(setCached).not.toHaveBeenCalled();
    expect(emitted.find((o) => o.field === 'description')).toBeUndefined();
  });

  it('honors --only and --limit as explicit reprocess controls', async () => {
    const fetchPage = makeFetchPage({
      'https://b.example.edu/': RESEARCH_HOME_HTML,
    });
    const callLLM = vi.fn(async () => extraction);
    const scraper = newTestScraper({
      fetchPage,
      callLLM,
      apiKey: 'sk-test',
      entityFinder: async () => [
        {
          _id: '1',
          slug: 'lab-a',
          name: 'A',
          websiteUrl: 'https://a.example.edu/',
          description: '',
        },
        {
          _id: '2',
          slug: 'lab-b',
          name: 'B',
          websiteUrl: 'https://b.example.edu/',
          fullDescription:
            'The B Lab studies cellular signaling pathways in development and disease using imaging and computational methods.',
          shortDescription:
            'Studies cellular signaling pathways in development and disease using imaging and computational methods.',
        },
        {
          _id: '3',
          slug: 'lab-c',
          name: 'C',
          websiteUrl: 'https://c.example.edu/',
          description: '',
        },
      ],
    });
    const { ctx } = makeContext({ only: ['lab-b', 'lab-c'], limit: 1 });
    await scraper.run(ctx);

    expect(fetchPage).not.toHaveBeenCalledWith('https://a.example.edu/');
    expect(fetchPage).toHaveBeenCalledWith('https://b.example.edu/');
    expect(fetchPage).not.toHaveBeenCalledWith('https://c.example.edu/');
    expect(callLLM).toHaveBeenCalledTimes(1);
  });

  it('normalizes first-person research-interest prose before deriving short descriptions', () => {
    const sourceText =
      'My research interests span a wide range, from stars and stellar populations to the most distant galaxies. I am also interested in astronomical instrumentation and telescopes.';
    const normalized = normalizeDescriptionExtraction(
      {
        fullDescription: sourceText,
        shortDescription:
          'The Fixture Astronomy Lab studies stars, stellar populations, and distant galaxies, while also developing astronomical instrumentation like the SkyLens Array.',
        researchAreas: ['Extragalactic Astronomy'],
        evidenceQuote: sourceText,
      },
      sourceText,
    );

    expect(normalized.fullDescription).toBe(
      'Research spans a wide range, from stars and stellar populations to the most distant galaxies. Research also includes astronomical instrumentation and telescopes.',
    );
    expect(normalized.shortDescription).toBe(
      'Research spans a wide range, from stars and stellar populations to the most distant galaxies.',
    );
    expect(normalized.shortDescription).not.toMatch(/SkyLens/i);
  });

  it('normalizes first-person follow-up research-focus prose before materializing descriptions', () => {
    const sourceText =
      'I study computational linguistics using techniques from cognitive science and artificial intelligence. My research focuses on the computational principles that underlie human language.';
    const normalized = normalizeDescriptionExtraction(
      {
        fullDescription: sourceText,
        shortDescription:
          'Studies computational linguistics using techniques from cognitive science and artificial intelligence.',
        researchAreas: ['Computational Linguistics'],
        evidenceQuote: sourceText,
      },
      sourceText,
    );

    expect(normalized.fullDescription).toBe(
      'Studies computational linguistics using techniques from cognitive science and artificial intelligence. Research focuses on the computational principles that underlie human language.',
    );
    expect(normalized.shortDescription).toBe(
      'Studies computational linguistics using techniques from cognitive science and artificial intelligence.',
    );
  });

  it('rescues blank LLM descriptions from an adjacent source research-focus sentence', () => {
    const sourceText =
      'I study computational linguistics using techniques from cognitive science and artificial intelligence. My research focuses on the computational principles that underlie human language.';
    const normalized = normalizeDescriptionExtraction(
      {
        fullDescription: '',
        shortDescription: '',
        researchAreas: ['Computational Linguistics'],
        evidenceQuote:
          'I study computational linguistics using techniques from cognitive science and artificial intelligence.',
      },
      sourceText,
    );

    expect(normalized.fullDescription).toBe(
      'Studies computational linguistics using techniques from cognitive science and artificial intelligence. Research focuses on the computational principles that underlie human language.',
    );
    expect(normalized.shortDescription).toBe(
      'Studies computational linguistics using techniques from cognitive science and artificial intelligence.',
    );
    expect(normalized.evidenceQuote).toBe(sourceText);
  });

  it('derives a grammatical short description from named-lab study-of focus prose', () => {
    const fullDescription =
      'The Fixture Stellar Modeling Lab focuses on the study of pulsating stars, utilizing asteroseismology to explore fundamental physics, the properties of exoplanets, and the history of the Milky Way galaxy. The lab employs machine learning and simulations to analyze stellar evolution and the dynamics of binary star systems.';
    const evidenceQuote =
      'My research broadly revolves around various kinds of pulsating stars, which are fascinating because they are key to many interesting astrophysical endeavours.';
    const sourceText = `${fullDescription} ${evidenceQuote}`;
    const normalized = normalizeDescriptionExtraction(
      {
        fullDescription,
        shortDescription:
          'the study of pulsating stars, utilizing asteroseismology to explore fundamental physics, the properties of exoplanets, and the history of the Milky Way galaxy.',
        researchAreas: ['Asteroseismology'],
        evidenceQuote,
      },
      sourceText,
    );

    expect(normalized.shortDescription).toBe(
      'Studies pulsating stars, utilizing asteroseismology to explore fundamental physics, the properties of exoplanets, and the history of the Milky Way galaxy.',
    );
  });
});
