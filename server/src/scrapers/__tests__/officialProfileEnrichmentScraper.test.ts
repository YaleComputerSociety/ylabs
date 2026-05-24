import { describe, expect, it, vi } from 'vitest';
import {
  OfficialProfileEnrichmentScraper,
  officialProfileObservationsFromEnrichment,
  selectOfficialProfileTargets,
  type OfficialProfileUser,
} from '../sources/officialProfileEnrichmentScraper';
import { profileEnrichmentFromHtml } from '../sources/departmentRosterScraper';
import type { ObservationInput, ScraperContext } from '../types';

function makeContext(): { ctx: ScraperContext; emitted: ObservationInput[] } {
  const emitted: ObservationInput[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'test-run',
    sourceId: 'test-source',
    sourceName: 'official-profile-enrichment',
    sourceWeight: 0.7,
    options: {
      dryRun: true,
      useCache: false,
      release: false,
    },
    emit: async (obs) => {
      emitted.push(...(Array.isArray(obs) ? obs : [obs]));
    },
    log: () => undefined,
  };
  return { ctx, emitted };
}

const users: OfficialProfileUser[] = [
  {
    _id: 'u1',
    netid: 'fixtureprofile001',
    fname: 'Morgan',
    lname: 'Avery',
    userType: 'professor',
    profileUrls: {
      yalies: 'https://medicine.yale.edu/lab/example/profile/parker-fixture/',
    },
    bio: '',
    researchInterests: [],
    topics: [],
  },
];

const ysmProfileHtml = `
  <html>
    <head>
      <link rel="canonical" href="https://ysph.yale.edu/profile/parker-fixture/" />
      <script data-schema="ProfilePage" type="application/ld+json">
        {
          "@type": "ProfilePage",
          "mainEntity": {
            "@type": "Person",
            "name": "Parker Fixture",
            "url": "https://ysph.yale.edu/profile/parker-fixture/",
            "email": "parker.fixture@example.test",
            "jobTitle": [
              "Professor of Epidemiology"
            ],
            "description": "Parker Fixture studies synthetic prevention and survivorship research. Fixture's research has focused on randomized trials of movement and coaching on example markers, treatment side effects and quality of life in people diagnosed with a sample condition."
          }
        }
      </script>
    </head>
    <body>
      <main>
        <div class="profile-body">Deputy Director, Example Research Center</div>
      </main>
    </body>
  </html>
`;

describe('OfficialProfileEnrichmentScraper', () => {
  it('replaces role-only stored bios with richer official profile prose', () => {
    const user: OfficialProfileUser = {
      netid: 'fixtureprofile002',
      profileUrls: {
        departmental: 'https://mcdb.yale.edu/profile/riley-fixture-phd',
      },
      bio: 'Track Director, PMB',
      researchInterests: ['Chromatin'],
      topics: ['Chromatin'],
    };
    const enrichment = {
      profileUrl: 'https://mcdb.yale.edu/profile/riley-fixture-phd',
      bio: 'Riley Fixture studies how synthetic chromatin signals regulate DNA replication and genome engineering in model organisms.',
    };

    expect(selectOfficialProfileTargets([user], {})).toEqual([user]);
    expect(
      officialProfileObservationsFromEnrichment(
        user,
        'https://mcdb.yale.edu/profile/riley-fixture-phd',
        enrichment,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'bio',
          value: enrichment.bio,
        }),
      ]),
    );
    expect(
      officialProfileObservationsFromEnrichment(
        user,
        'https://mcdb.yale.edu/profile/riley-fixture-phd',
        enrichment,
      ).some((observation) => observation.field === 'profileUrls'),
    ).toBe(false);
  });

  it('targets project-fragment bios for richer official profile enrichment', () => {
    const user: OfficialProfileUser = {
      netid: 'fixtureprofile003',
      profileUrls: {
        departmental: 'https://astronomy.yale.edu/people/skyler-fixture',
      },
      bio: 'Synthetic radio instrumentation to measure example structure and sample energy - Example Sky Mapping Project, Example Real-time Analysis Experiment',
      researchInterests: ['Cosmology'],
      topics: ['Instrumentation'],
    };

    expect(selectOfficialProfileTargets([user], {})).toEqual([user]);
  });

  it('replaces stored bios that only differ by trailing website chrome', () => {
    const user: OfficialProfileUser = {
      netid: 'fixtureprofile004',
      profileUrls: {
        medicine: 'https://medicine.yale.edu/profile/cameron-fixture/',
      },
      bio: 'Dr. Cameron Fixture leads a research group applying machine learning to synthetic biomedical data.Website: examplelab.test',
      researchInterests: ['Machine Learning'],
      topics: ['Single-cell analysis'],
    };
    const enrichment = {
      profileUrl: 'https://medicine.yale.edu/profile/cameron-fixture/',
      bio: 'Dr. Cameron Fixture leads a research group applying machine learning to synthetic biomedical data.',
    };

    expect(selectOfficialProfileTargets([user], {})).toEqual([user]);
    expect(
      officialProfileObservationsFromEnrichment(
        user,
        'https://medicine.yale.edu/profile/cameron-fixture/',
        enrichment,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'bio',
          value: enrichment.bio,
        }),
      ]),
    );
  });

  it('replaces stored bios with missing sentence spacing from official profile prose', () => {
    const user: OfficialProfileUser = {
      netid: 'fixtureprofile005',
      profileUrls: {
        official: 'https://medicine.yale.edu/lab/example/profile/jordan-fixture/',
      },
      bio: 'Prior to joining Yale, Dr. Fixture trained at a research center.Dr. Fixture studies climate and health.',
      researchInterests: ['Climate and health'],
      topics: ['Climate and health'],
    };
    const enrichment = {
      profileUrl: 'https://medicine.yale.edu/lab/example/profile/jordan-fixture/',
      bio: 'Prior to joining Yale, Dr. Fixture trained at a research center. Dr. Fixture studies climate and health.',
    };

    expect(selectOfficialProfileTargets([user], {})).toEqual([user]);
    expect(
      officialProfileObservationsFromEnrichment(
        user,
        'https://medicine.yale.edu/lab/example/profile/jordan-fixture/',
        enrichment,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'bio',
          value: enrichment.bio,
        }),
      ]),
    );
  });

  it('emits a richer bio candidate even when a usable shorter bio already exists', () => {
    const user: OfficialProfileUser = {
      netid: 'fixtureprofile006',
      profileUrls: {
        official: 'https://anthropology.yale.edu/profile/avery-fixture',
      },
      bio: 'My research interests include the functional morphology and phylogenetics of mammals. I study primates and small mammals.',
      researchInterests: ['Mammal evolution'],
      topics: ['Primates'],
    };
    const enrichment = {
      profileUrl: 'https://campuspress.yale.edu/examplelab/research/',
      bio: 'My research interests include the functional morphology and systematics of mammals. I have studied the evolutionary morphology of several groups of extant and extinct mammals, such as primates and small mammals. My current collaborative study focuses on newly discovered specimens from field collections, and this project has significant conservation implications. I also co-direct museum field expeditions to fossil localities.',
    };

    expect(selectOfficialProfileTargets([user], {})).toEqual([user]);
    expect(
      officialProfileObservationsFromEnrichment(
        user,
        'https://campuspress.yale.edu/examplelab/research/',
        enrichment,
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'bio',
          value: enrichment.bio,
        }),
      ]),
    );
  });

  it('extracts bio and research interests from official YSM profile JSON-LD', async () => {
    const fetchPage = vi.fn(async () => ysmProfileHtml);
    const scraper = new OfficialProfileEnrichmentScraper({
      userFinder: async () => users,
      fetchPage,
    });
    const { ctx, emitted } = makeContext();

    const result = await scraper.run(ctx);

    expect(fetchPage).toHaveBeenCalledWith(
      'https://medicine.yale.edu/lab/example/profile/parker-fixture/',
      false,
      'official-profile-enrichment',
    );
    expect(result.entitiesObserved).toBe(1);
    expect(emitted.find((o) => o.field === 'bio')?.value).toContain(
      'synthetic prevention and survivorship research',
    );
    expect(emitted.find((o) => o.field === 'researchInterests')?.value).toEqual(
      expect.arrayContaining([
        'randomized trials of movement and coaching on example markers',
        'treatment side effects',
        'quality of life in people diagnosed with a sample condition',
      ]),
    );
    expect(emitted.find((o) => o.field === 'topics')?.value).toEqual(
      emitted.find((o) => o.field === 'researchInterests')?.value,
    );
    expect(emitted.find((o) => o.field === 'profileUrls')?.value).toEqual({
      yalies: 'https://medicine.yale.edu/lab/example/profile/parker-fixture/',
      official: 'https://ysph.yale.edu/profile/parker-fixture/',
    });
  });

  it('sanitizes research term observations before emitting profile enrichment fields', () => {
    const emitted = officialProfileObservationsFromEnrichment(
      {
        netid: 'fixtureprofile007',
        researchInterests: [],
        topics: [],
      },
      'https://physics.yale.edu/people/sam-fixture',
      {
        researchInterests: [
          'Research Areas: My research interests include electric dipole moment and Casimir effect.',
          'Teaching Interests: My main teaching interests lie in Experimental Physics',
          'Quantum Mechanics (PHYS 441)',
        ],
        topics: [
          'Atomic and Subatomic Physics Research',
          'Teaching Interests: My main teaching interests lie in Experimental Physics',
          'Physics of the Earth and Environment (PHYS 342)',
        ],
      },
    );

    expect(emitted.find((o) => o.field === 'researchInterests')?.value).toEqual([
      'electric dipole moment',
      'Casimir effect',
    ]);
    expect(emitted.find((o) => o.field === 'topics')?.value).toEqual([
      'Atomic and Subatomic Physics Research',
    ]);
  });

  it('uses official Yale profile pages stored in website and extracts labeled Drupal profile fields', async () => {
    const user: OfficialProfileUser = {
      _id: 'u-profile008',
      netid: 'fixtureprofile008',
      fname: 'Taylor',
      lname: 'Fixture',
      userType: 'professor',
      profileUrls: {},
      website: 'https://physics.yale.edu/people/taylor-fixture',
      bio: '',
      researchInterests: [],
      topics: [],
    };
    const html = `
      <html>
        <head><link rel="canonical" href="https://physics.yale.edu/people/taylor-fixture" /></head>
        <body>
          <main>
            <h1>Taylor Fixture</h1>
            <div class="field field-name-field-title"><div class="field-item">Professor of Physics and Astronomy</div></div>
            <div class="field field-name-field-field-of-study">
              <div class="field-label">Research Areas:&nbsp;</div>
              <div class="field-item">Nuclear Physics; Particle Physics</div>
            </div>
            <div class="field field-name-field-list-of-experiments">
              <div class="field-label">Current Projects:&nbsp;</div>
              <div class="field-item">
                <p>Example Underground Observatory (EUO), Example Neutrino Observatory, Example Axion Telescope</p>
              </div>
            </div>
            <div class="field field-name-field-bio">
              <div class="field-label">Biographical Sketch:&nbsp;</div>
              <div class="field-item">
                <p>Professor Taylor Fixture is an experimental particle/atomic/nuclear physicist. Fixture explores new physics in nuclear and particle astrophysics, in particular, in dark matter and neutrinos.</p>
                <p>Her group is carrying out experiments in direct detection of dark matter with terrestrial-based detectors for both axions and WIMPs and searches for neutrinoless double beta decay.</p>
              </div>
            </div>
            <div class="field field-name-field-selected-publications">
              <div class="field-label">Selected Publications:&nbsp;</div>
              <div class="field-item">
                <ul>
                  <li>
                    Example quantum-enhanced search for dark matter axions,
                    <a href="https://example.com/articles/example-axion-search">Example Journal 1, 1-2 (2021)</a>.
                    DOI: 10.5555/example-axion-search
                  </li>
                </ul>
              </div>
            </div>
          </main>
        </body>
      </html>
    `;
    const fetchPage = vi.fn(async () => html);
    const scraper = new OfficialProfileEnrichmentScraper({
      userFinder: async () => [user],
      fetchPage,
    });
    const { ctx, emitted } = makeContext();

    expect(selectOfficialProfileTargets([user], {})).toEqual([user]);

    const result = await scraper.run(ctx);

    expect(fetchPage).toHaveBeenCalledWith(
      'https://physics.yale.edu/people/taylor-fixture',
      false,
      'official-profile-enrichment',
    );
    expect(result.entitiesObserved).toBe(1);
    expect(emitted.find((o) => o.field === 'bio')?.value).toContain(
      'experimental particle/atomic/nuclear physicist',
    );
    expect(emitted.find((o) => o.field === 'researchInterests')?.value).toEqual(
      expect.arrayContaining([
        'Nuclear Physics',
        'Particle Physics',
        'Example Underground Observatory (EUO)',
        'Example Axion Telescope',
      ]),
    );
    expect(emitted.find((o) => o.field === 'profileUrls')?.value).toEqual({
      official: 'https://physics.yale.edu/people/taylor-fixture',
    });
    const scholarlyLinkObservations = emitted.filter((o) => o.entityType === 'scholarlyLink');
    expect(scholarlyLinkObservations.find((o) => o.field === 'title')?.value).toContain(
      'Example quantum-enhanced search for dark matter axions',
    );
    expect(scholarlyLinkObservations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'url',
          value: 'https://doi.org/10.5555/example-axion-search',
        }),
        expect.objectContaining({ field: 'destinationKind', value: 'DOI' }),
        expect.objectContaining({
          field: 'externalIds',
          value: { doi: '10.5555/example-axion-search' },
        }),
      ]),
    );
  });

  it('preserves official profile paragraph breaks in extracted bios', () => {
    const html = `
      <main>
        <div class="field field-name-field-bio">
          <div class="field-label">Biographical Sketch:&nbsp;</div>
          <div class="field-item">
            <p>Professor Jordan Fixture studies computation, symbolic reasoning, and mathematical collaboration.</p>
            <p>Her current work examines how students can connect theory, machines, and creative research practice.</p>
          </div>
        </div>
      </main>
    `;

    const enrichment = profileEnrichmentFromHtml(
      html,
      'https://computerscience.yale.edu/people/jordan-fixture',
    );

    expect(enrichment.bio).toBe(
      [
        'Professor Jordan Fixture studies computation, symbolic reasoning, and mathematical collaboration.',
        'Her current work examines how students can connect theory, machines, and creative research practice.',
      ].join('\n\n'),
    );
  });

  it('checks all official profile URLs for a user so secondary pages can supply selected publications', async () => {
    const user: OfficialProfileUser = {
      _id: 'u-profile009',
      netid: 'fixtureprofile009',
      fname: 'Casey',
      lname: 'Fixture',
      userType: 'professor',
      profileUrls: {
        american_studies: 'https://americanstudies.yale.edu/people/casey-fixture',
        anthropology: 'https://anthropology.yale.edu/profile/casey-fixture',
      },
      bio: '',
      researchInterests: [],
      topics: [],
    };
    const pages: Record<string, string> = {
      'https://americanstudies.yale.edu/people/casey-fixture': `
        <main>
          <p>Casey Fixture teaches anthropology and American studies.</p>
        </main>
      `,
      'https://anthropology.yale.edu/profile/casey-fixture': `
        <main>
          <p>
            <a href="https://example.com/books/example-field-study">
              Example Field Study: Work and Community Change
            </a>
          </p>
          <div class="text">
            <h3>Selected Publications:</h3>
            <p>Example Field Study: Work and Community Change</p>
          </div>
        </main>
      `,
    };
    const fetchPage = vi.fn(async (url: string) => pages[url] || '');
    const scraper = new OfficialProfileEnrichmentScraper({
      userFinder: async () => [user],
      fetchPage,
    });
    const { ctx, emitted } = makeContext();

    const result = await scraper.run(ctx);

    expect(fetchPage).toHaveBeenCalledWith(
      'https://americanstudies.yale.edu/people/casey-fixture',
      false,
      'official-profile-enrichment',
    );
    expect(fetchPage).toHaveBeenCalledWith(
      'https://anthropology.yale.edu/profile/casey-fixture',
      false,
      'official-profile-enrichment',
    );
    expect(result.entitiesObserved).toBe(1);
    expect(emitted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: 'scholarlyLink',
          field: 'title',
          value: 'Example Field Study: Work and Community Change',
        }),
      ]),
    );
  });

  it('prefers DOI destinations for selected publications when the DOI is present', () => {
    const user: OfficialProfileUser = {
      _id: 'u-doi',
      netid: 'fixtureprofile010',
      fname: 'Doi',
      lname: 'Fixture',
      userType: 'professor',
      profileUrls: {
        official: 'https://physics.yale.edu/people/doi-fixture',
      },
      bio: '',
      researchInterests: [],
      topics: [],
    };
    const enrichment = {
      profileUrl: 'https://physics.yale.edu/people/doi-fixture',
      selectedPublicationLinks: [
        {
          title: 'Example quantum-enhanced search for dark matter axions',
          url: 'https://doi.org/10.5555/example-doi-profile',
          doi: '10.5555/example-doi-profile',
          destinationKind: 'DOI' as const,
          displaySource: 'DOI',
          year: 2021,
        },
      ],
    };

    const observations = officialProfileObservationsFromEnrichment(
      user,
      'https://physics.yale.edu/people/doi-fixture',
      enrichment,
    );

    expect(observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: 'scholarlyLink',
          field: 'url',
          value: 'https://doi.org/10.5555/example-doi-profile',
        }),
        expect.objectContaining({
          entityType: 'scholarlyLink',
          field: 'destinationKind',
          value: 'DOI',
        }),
        expect.objectContaining({
          entityType: 'scholarlyLink',
          field: 'displaySource',
          value: 'DOI',
        }),
        expect.objectContaining({
          entityType: 'scholarlyLink',
          field: 'externalIds',
          value: { doi: '10.5555/example-doi-profile' },
        }),
      ]),
    );
  });

  it('keeps official profile enrichment profile-only and does not emit access artifacts', () => {
    const observations = officialProfileObservationsFromEnrichment(
      {
        _id: 'u-profile-only',
        netid: 'fixtureprofile011',
        fname: 'Profile',
        lname: 'Only',
        userType: 'professor',
        profileUrls: {
          official: 'https://physics.yale.edu/people/profile-only',
        },
        bio: '',
        researchInterests: [],
        topics: [],
      },
      'https://physics.yale.edu/people/profile-only',
      {
        bio: 'Professor Profile Only studies condensed matter experiments and instrument design.',
        researchInterests: ['Condensed Matter Physics'],
        topics: ['Instrument design'],
        selectedPublicationLinks: [
          {
            title: 'An official profile publication',
            url: 'https://doi.org/10.5555/profile-only',
            doi: '10.5555/profile-only',
            destinationKind: 'DOI',
            displaySource: 'DOI',
          },
        ],
        // Future parser changes may discover these words on profile pages, but this
        // source must not materialize undergraduate access or contact-route claims.
        joinPageUrl: 'https://physics.yale.edu/people/profile-only#contact',
        undergradAccessEvidence: 'Undergraduates should contact the lab manager.',
        contactInstructionsQuote: 'Email the lab manager to ask about research roles.',
      } as any,
    );

    expect(observations.length).toBeGreaterThan(0);
    expect(observations.map((o) => o.entityType)).not.toEqual(
      expect.arrayContaining(['entryPathway', 'accessSignal', 'contactRoute']),
    );
    expect(observations.map((o) => o.field)).not.toEqual(
      expect.arrayContaining([
        'acceptingUndergrads',
        'undergradAccessEvidence',
        'joinPageUrl',
        'contactInstructionsQuote',
      ]),
    );
  });

  it('extracts plain selected-publication paragraphs by matching title links elsewhere on the page', () => {
    const html = `
      <main>
        <p>
          My books include
          <a href="https://example.com/books/example-line-study">
            <em>Example Line Study: Work, Mobility, and Community Change</em>
          </a>
          ,
          <a href="https://example.com/books/example-farm-loss">
            <em>Example Farm Loss: Land, Credit, and Rural Change</em>
          </a>
          and
          <a href="https://example.com/books/example-craft-values">
            <em>Example Craft Values: Artisanal Work in North America</em>
          </a>.
        </p>
        <div class="text">
          <h3>Selected Publications:</h3>
          <p><span>Example Line Study: Work, Mobility, and Community Change</span></p>
          <p><span>Example Farm Loss: Land, Credit, and Rural Change</span></p>
          <p><span>Example Craft Values: Artisanal Work in North America</span></p>
        </div>
      </main>
    `;

    const enrichment = profileEnrichmentFromHtml(
      html,
      'https://anthropology.yale.edu/profile/casey-fixture',
    );

    expect(enrichment.selectedPublicationLinks).toEqual([
      expect.objectContaining({
        title: 'Example Line Study: Work, Mobility, and Community Change',
        url: 'https://example.com/books/example-line-study',
        destinationKind: 'PUBLISHER',
      }),
      expect.objectContaining({
        title: 'Example Farm Loss: Land, Credit, and Rural Change',
        url: 'https://example.com/books/example-farm-loss',
        destinationKind: 'PUBLISHER',
      }),
      expect.objectContaining({
        title: 'Example Craft Values: Artisanal Work in North America',
        url: 'https://example.com/books/example-craft-values',
        destinationKind: 'PUBLISHER',
      }),
    ]);
  });
});
