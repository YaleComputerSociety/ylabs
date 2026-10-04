import { describe, expect, it } from 'vitest';
import {
  ACCESS_SIGNAL_EVIDENCE_WITHDRAWN_REASON,
  MATERIALIZED_ACCESS_SIGNAL_TYPES,
  deriveAccessArtifactsFromObservations,
  planEvidenceGovernedSignalChanges,
  deriveAccessArtifactsForResearchGroup,
  normalizeAccessMaterializerObjectId,
  officialNonGrantSourceUrl,
  parsePostedOpening,
  type AccessObservation,
} from '../accessMaterializer';
import { isExplicitUndergradUnavailabilityPhrase } from '../undergradEvidenceQuoteValidation';

const D = new Date('2026-05-07T12:00:00.000Z');

function obs(overrides: Partial<AccessObservation>): AccessObservation {
  return {
    _id: overrides._id || `obs-${overrides.field || 'field'}`,
    entityKey: 'smith-lab',
    field: overrides.field || 'field',
    value: overrides.value,
    sourceName: overrides.sourceName || 'test-source',
    sourceUrl: overrides.sourceUrl || 'https://example.test/source',
    confidence: overrides.confidence ?? 0.8,
    observedAt: overrides.observedAt || D,
  };
}

describe('deriveAccessArtifactsFromObservations', () => {
  it('normalizes access materializer ObjectIds without object-shaped coercion', () => {
    expect(normalizeAccessMaterializerObjectId(' 64f000000000000000000001 ')).toBe(
      '64f000000000000000000001',
    );
    expect(normalizeAccessMaterializerObjectId('abcdefghijkl')).toBeUndefined();
    expect(
      normalizeAccessMaterializerObjectId({
        toString: () => '64f000000000000000000001',
      }),
    ).toBeUndefined();
  });

  it('keeps independent-study evidence as formalization signals when explicit', () => {
    const result = deriveAccessArtifactsFromObservations('64f000000000000000000001', [
      obs({ field: 'offersIndependentStudy', value: true, confidence: 0.7 }),
      obs({
        field: 'independentStudyCourses',
        value: [{ code: 'HIST 491', title: 'Senior Essay' }],
        confidence: 0.7,
      }),
    ]);

    expect(result.accessSignals.map((signal) => signal.type).sort()).toEqual([
      'CREDIT_FORMALIZATION_POSSIBLE',
      'FACULTY_SUPERVISES_STUDENT_PROJECTS',
    ]);
    expect(result.accessSignals.every((signal) => signal.confidenceScore === 0.7)).toBe(true);
  });

  it('does not turn a course-listing-only lane into generic exploratory outreach', () => {
    const result = deriveAccessArtifactsFromObservations('64f000000000000000000001', [
      obs({
        field: 'offersIndependentStudy',
        value: true,
        sourceName: 'department-research-pathways',
        confidence: 0.7,
      }),
      obs({
        field: 'independentStudyCourses',
        value: [{ code: 'MCDB 471', title: 'Independent Research' }],
        sourceName: 'department-research-pathways',
        confidence: 0.7,
      }),
    ]);

    expect(result.accessSignals.map((signal) => signal.type)).toEqual([
      'CREDIT_FORMALIZATION_POSSIBLE',
    ]);
  });

  it('mints no current-undergraduates signal from the retired cache-backfill lane (#3789)', () => {
    const result = deriveAccessArtifactsFromObservations('64f000000000000000000001', [
      obs({
        field: 'currentUndergradCount',
        value: 4,
        sourceName: 'research-entity-cache-backfill',
        confidence: 0.5,
      }),
    ]);
    expect(result.accessSignals.map((signal) => signal.type)).not.toContain('CURRENT_UNDERGRADS');
  });

  it('turns listed current undergrads into exploratory outreach evidence', () => {
    const result = deriveAccessArtifactsFromObservations('64f000000000000000000001', [
      obs({ field: 'currentUndergradCount', value: 2, confidence: 0.5 }),
    ]);

    expect(result.accessSignals).toMatchObject([
      {
        type: 'CURRENT_UNDERGRADS',
        confidence: 'MEDIUM',
        confidenceScore: 0.5,
      },
    ]);
  });

  it('turns fellowship-recipient advisees into past-undergraduates evidence only (#4637)', () => {
    const result = deriveAccessArtifactsFromObservations('64f000000000000000000001', [
      obs({
        field: 'pastUndergradAdvisees',
        value: [{ year: 2025, programName: 'STARS', count: 2 }],
        sourceName: 'undergrad-fellowships-recipients',
        confidence: 0.8,
      }),
    ]);

    expect(result.accessSignals.map((signal) => signal.type)).toEqual(['PAST_UNDERGRADS']);
    expect(result.accessSignals.every((signal) => signal.confidence === 'HIGH')).toBe(true);
  });

  describe('roster counts from the microsite lane (#4430)', () => {
    const LANE = 'lab-microsite-undergrad-llm';
    const types = (observations: AccessObservation[]) =>
      deriveAccessArtifactsFromObservations('64f000000000000000000001', observations)
        .accessSignals.map((signal) => signal.type)
        .sort();

    it('cites the roster page the count was read from', () => {
      const result = deriveAccessArtifactsFromObservations('64f000000000000000000001', [
        obs({
          field: 'currentUndergradCount',
          value: 2,
          sourceName: LANE,
          sourceUrl: 'https://examplelab.example.org/people',
        }),
      ]);
      expect(result.accessSignals).toMatchObject([
        { type: 'CURRENT_UNDERGRADS', sourceUrl: 'https://examplelab.example.org/people' },
      ]);
    });

    it('derives no current-undergraduates signal from a count citing a join or contact page', () => {
      for (const sourceUrl of [
        'https://examplelab.example.org/join-us',
        'https://examplelab.example.org/opportunities',
        'https://examplelab.example.org/contact-2/',
      ]) {
        expect(
          types([obs({ field: 'currentUndergradCount', value: 2, sourceName: LANE, sourceUrl })]),
        ).toEqual([]);
      }
    });

    it("lets the lane's newer zero displace an older count stated on a merged-in row", () => {
      expect(
        types([
          obs({
            _id: 'obs-loser-count',
            entityKey: 'example-merged-loser',
            field: 'currentUndergradCount',
            value: 6,
            sourceName: LANE,
            observedAt: new Date('2026-09-01T00:00:00.000Z'),
          }),
          obs({
            _id: 'obs-survivor-count',
            field: 'currentUndergradCount',
            value: 0,
            sourceName: LANE,
            observedAt: new Date('2026-10-01T00:00:00.000Z'),
          }),
        ]),
      ).toEqual([]);
    });

    it('turns roster alumni into past-hosting evidence but not fellowship evidence', () => {
      const result = deriveAccessArtifactsFromObservations('64f000000000000000000001', [
        obs({
          field: 'pastUndergradAdvisees',
          value: [{ programName: 'Lab roster alumni', count: 3 }],
          sourceName: LANE,
          sourceUrl: 'https://examplelab.example.org/people',
          confidence: 0.5,
        }),
      ]);
      expect(result.accessSignals).toMatchObject([
        { type: 'PAST_UNDERGRADS', sourceUrl: 'https://examplelab.example.org/people' },
      ]);
    });

    it('derives one past-undergraduates signal from roster alumni and fellowship recipients (#4637)', () => {
      expect(
        types([
          obs({
            _id: 'obs-roster-alumni',
            field: 'pastUndergradAdvisees',
            value: [{ programName: 'Lab roster alumni', count: 3 }],
            sourceName: LANE,
          }),
          obs({
            _id: 'obs-fellowship',
            field: 'pastUndergradAdvisees',
            value: [{ year: 2025, programName: 'STARS', count: 1 }],
            sourceName: 'undergrad-fellowships-recipients',
          }),
        ]),
      ).toEqual(['PAST_UNDERGRADS']);
    });
  });

  it('uses the original observation confidence, not resolved field confidence', () => {
    const result = deriveAccessArtifactsFromObservations('64f000000000000000000001', [
      obs({
        field: 'currentUndergradCount',
        value: 3,
        sourceName: 'lab-microsite-undergrad-llm',
        confidence: 0.32,
      }),
    ]);

    expect(result.accessSignals).toMatchObject([
      {
        type: 'CURRENT_UNDERGRADS',
        confidence: 'LOW',
        confidenceScore: 0.32,
        originalConfidence: 0.32,
        sourceName: 'lab-microsite-undergrad-llm',
      },
    ]);
  });

  // #696 required two independent sources before a bare `acceptingUndergrads=true`
  // could become outreach evidence. #2055 retired the boolean instead, so no number
  // of stored copies of it derives anything: only `undergradAccessEvidence`, which
  // carries a verdict and the quote that backs it, is read.
  it('derives nothing from the retired acceptingUndergrads boolean, whatever asserts it (#696, #2055)', () => {
    const result = deriveAccessArtifactsFromObservations('64f000000000000000000001', [
      obs({
        _id: 'accepting-a',
        field: 'acceptingUndergrads',
        value: true,
        sourceName: 'lab-microsite-undergrad-llm',
        confidence: 0.9,
      }),
      obs({
        _id: 'accepting-b',
        field: 'acceptingUndergrads',
        value: true,
        sourceName: 'department-faculty-roster',
        confidence: 0.9,
      }),
      obs({
        _id: 'accepting-c',
        field: 'acceptingUndergrads',
        value: false,
        sourceName: 'ysm-atoz-index',
        confidence: 0.9,
      }),
    ]);

    expect(result.accessSignals).toEqual([]);
  });

  it('derives no access signal from a yes verdict, its quote, or contact instructions (#4637)', () => {
    const result = deriveAccessArtifactsFromObservations('64f000000000000000000001', [
      obs({
        field: 'undergradAccessEvidence',
        value: {
          openToUndergrads: 'yes',
          evidenceSource: 'explicit_text',
          evidenceQuote: 'Undergraduates are welcome to join the lab.',
        },
        sourceName: 'lab-microsite-undergrad-llm',
        confidence: 0.6,
      }),
      obs({
        field: 'undergradEvidenceQuote',
        value: 'Undergraduates are welcome to join the lab.',
        sourceName: 'lab-microsite-undergrad-llm',
        confidence: 0.6,
      }),
      obs({
        field: 'contactInstructionsQuote',
        value: 'Interested undergraduates should email the lab manager with a CV.',
        sourceName: 'lab-microsite-undergrad-llm',
        confidence: 0.6,
      }),
      obs({ field: 'contactEmail', value: 'fixture.person@example.edu', confidence: 0.7 }),
    ]);

    expect(result.accessSignals).toEqual([]);
  });

  it('derives no access signal from a no verdict that states the lab takes no undergraduates (#4637)', () => {
    const result = deriveAccessArtifactsFromObservations('64f000000000000000000001', [
      obs({
        field: 'undergradAccessEvidence',
        value: {
          openToUndergrads: 'no',
          evidenceSource: 'explicit_text',
          evidenceQuote: 'We are not currently accepting undergraduate students.',
        },
        sourceName: 'lab-microsite-undergrad-llm',
        confidence: 0.6,
      }),
    ]);

    expect(result.accessSignals).toEqual([]);
  });

  it('derives official application routes from lab-microsite join-page evidence', () => {
    const result = deriveAccessArtifactsFromObservations('64f000000000000000000001', [
      obs({
        field: 'undergradAccessEvidence',
        value: {
          openToUndergrads: 'yes',
          evidenceSource: 'explicit_text',
          evidenceQuote: 'We invite undergraduates to apply.',
        },
        sourceName: 'lab-microsite-undergrad-llm',
        confidence: 0.5,
      }),
      obs({
        field: 'joinPageUrl',
        value: 'https://lab.example.edu/join',
        sourceName: 'lab-microsite-undergrad-llm',
        confidence: 0.5,
      }),
      obs({
        field: 'contactInstructionsQuote',
        value: 'Apply using the form on this page.',
        sourceName: 'lab-microsite-undergrad-llm',
        confidence: 0.5,
      }),
    ]);

    expect(result.accessSignals.map((signal) => signal.type)).toEqual(['APPLICATION_FORM_EXISTS']);
  });

  it('mints no join-page signal when the only undergraduate verdict is no (#4637)', () => {
    const result = deriveAccessArtifactsFromObservations('64f000000000000000000001', [
      obs({
        field: 'undergradAccessEvidence',
        value: {
          openToUndergrads: 'no',
          evidenceSource: 'explicit_text',
          evidenceQuote: 'We are looking for postdocs and graduate students to work with us.',
        },
        sourceName: 'lab-microsite-undergrad-llm',
        confidence: 0.5,
      }),
      obs({
        field: 'joinPageUrl',
        value: 'https://lab.example.edu/join-us',
        sourceName: 'lab-microsite-undergrad-llm',
        confidence: 0.5,
      }),
    ]);

    expect(result.accessSignals).toEqual([]);
  });

  it('derives no reach-out or posted-opening signal from a department undergraduate research page (#4637)', () => {
    const result = deriveAccessArtifactsFromObservations('64f000000000000000000001', [
      obs({
        field: 'undergradAccessEvidence',
        value: {
          openToUndergrads: 'yes',
          evidenceSource: 'department_undergrad_research_page',
        },
        sourceName: 'department-undergrad-research',
        sourceUrl: 'https://chem.yale.edu/undergraduate-research',
        confidence: 0.8,
      }),
      obs({
        field: 'undergradEvidenceQuote',
        value:
          'Students interested in research should contact the faculty member directly to explore opportunities.',
        sourceName: 'department-undergrad-research',
        sourceUrl: 'https://chem.yale.edu/undergraduate-research',
        confidence: 0.8,
      }),
    ]);

    expect(result.accessSignals).toEqual([]);
  });

  it('derives department structured application pages as guarded official routes', () => {
    const result = deriveAccessArtifactsFromObservations('64f000000000000000000001', [
      obs({
        field: 'undergradAccessEvidence',
        value: {
          openToUndergrads: 'yes',
          evidenceSource: 'department_undergrad_research_page',
        },
        sourceName: 'department-undergrad-research',
        sourceUrl: 'https://mcdb.yale.edu/undergraduate/undergraduate-research-opportunities',
        confidence: 0.8,
      }),
      obs({
        field: 'joinPageUrl',
        value: 'https://yalesurvey.ca1.qualtrics.com/jfe/form/SV_fixture',
        sourceName: 'department-undergrad-research',
        sourceUrl: 'https://mcdb.yale.edu/undergraduate/undergraduate-research-opportunities',
        confidence: 0.8,
      }),
    ]);

    expect(result.accessSignals.map((signal) => signal.type)).toEqual(['APPLICATION_FORM_EXISTS']);
  });

  describe('join pages that are not an undergraduate route (#4430)', () => {
    const positiveAccess = obs({
      field: 'undergradAccessEvidence',
      value: {
        openToUndergrads: 'yes',
        evidenceSource: 'explicit_text',
        evidenceQuote: 'We invite undergraduates to apply.',
      },
      sourceName: 'lab-microsite-undergrad-llm',
      confidence: 0.5,
    });
    const joinPage = (value: string) =>
      obs({
        field: 'joinPageUrl',
        value,
        sourceName: 'lab-microsite-undergrad-llm',
        confidence: 0.5,
      });
    const derivedTypes = (
      observations: AccessObservation[],
      entity?: Parameters<typeof deriveAccessArtifactsFromObservations>[2],
    ) =>
      deriveAccessArtifactsFromObservations(
        '64f000000000000000000001',
        observations,
        entity,
      ).accessSignals.map((signal) => signal.type);

    it('does not derive an application route from a study-recruitment page', () => {
      expect(
        derivedTypes([positiveAccess, joinPage('https://lab.example.edu/participate/')]),
      ).not.toContain('APPLICATION_FORM_EXISTS');
    });

    it('does not derive an application route from a graduate-admissions or PhD page', () => {
      expect(
        derivedTypes([positiveAccess, joinPage('https://lab.example.edu/graduate/admissions/')]),
      ).not.toContain('APPLICATION_FORM_EXISTS');
      expect(
        derivedTypes([
          positiveAccess,
          joinPage('https://lab.example.edu/phd-opportunities-in-our-lab'),
        ]),
      ).not.toContain('APPLICATION_FORM_EXISTS');
    });

    it("does not derive a person row's route from a center's training page", () => {
      const training = joinPage(
        'https://medicine.yale.edu/cancer/collaborative-excellence/training-opportunities/',
      );
      expect(
        derivedTypes([positiveAccess, training], {
          entityType: 'FACULTY_RESEARCH_AREA',
          kind: 'individual',
        }),
      ).not.toContain('APPLICATION_FORM_EXISTS');
      expect(
        derivedTypes([positiveAccess, training], {
          entityType: 'CENTER',
          kind: 'center',
          websiteUrl: 'https://medicine.yale.edu/cancer/',
        }),
      ).toContain('APPLICATION_FORM_EXISTS');
    });

    it("derives a person row's route from its own department's undergraduate research page", () => {
      const psychologyPage = joinPage(
        'https://psychology.yale.edu/undergraduate/research-opportunities',
      );
      const faculty = { entityType: 'FACULTY_RESEARCH_AREA', kind: 'individual' };
      expect(
        derivedTypes([positiveAccess, psychologyPage], { ...faculty, departments: ['Psychology'] }),
      ).toContain('APPLICATION_FORM_EXISTS');
      expect(
        derivedTypes([positiveAccess, psychologyPage], { ...faculty, departments: ['Philosophy'] }),
      ).not.toContain('APPLICATION_FORM_EXISTS');
    });

    it('still derives the route when another source names an admissible join page', () => {
      expect(
        derivedTypes([
          positiveAccess,
          joinPage('https://lab.example.edu/participate/'),
          obs({
            _id: 'obs-department-join',
            field: 'joinPageUrl',
            value: 'https://lab.example.edu/join',
            sourceName: 'department-undergrad-research',
          }),
        ]),
      ).toContain('APPLICATION_FORM_EXISTS');
    });

    it("reads a lane's newer empty join page as replacing the page an older read named", () => {
      const older = obs({
        _id: 'obs-older-join',
        field: 'joinPageUrl',
        value: 'https://lab.example.edu/join',
        sourceName: 'lab-microsite-undergrad-llm',
        observedAt: new Date('2026-05-01T00:00:00.000Z'),
      });
      const newerEmpty = obs({
        _id: 'obs-newer-join',
        field: 'joinPageUrl',
        value: '',
        sourceName: 'lab-microsite-undergrad-llm',
        observedAt: new Date('2026-09-01T00:00:00.000Z'),
      });
      expect(derivedTypes([positiveAccess, older, newerEmpty])).not.toContain(
        'APPLICATION_FORM_EXISTS',
      );
      expect(derivedTypes([positiveAccess, older])).toContain('APPLICATION_FORM_EXISTS');
    });
  });

  describe("application routes judged on the lane's own quote and cited to the join page (#4543)", () => {
    const LANE = 'lab-microsite-undergrad-llm';
    const access = (quote: string, quoteSourceUrl: string, id = 'obs-access') =>
      obs({
        _id: id,
        field: 'undergradAccessEvidence',
        value: {
          openToUndergrads: 'yes',
          evidenceSource: 'explicit_text',
          evidenceQuote: quote,
          quoteSourceUrl,
        },
        sourceName: LANE,
        sourceUrl: quoteSourceUrl,
        confidence: 0.5,
      });
    const join = (value: string, readFrom: string) =>
      obs({
        _id: 'obs-join',
        field: 'joinPageUrl',
        value,
        sourceName: LANE,
        sourceUrl: readFrom,
        confidence: 0.5,
      });
    const derive = (
      observations: AccessObservation[],
      entity?: Parameters<typeof deriveAccessArtifactsFromObservations>[2],
    ) =>
      deriveAccessArtifactsFromObservations('64f000000000000000000001', observations, entity)
        .accessSignals;
    const application = (signals: ReturnType<typeof derive>) =>
      signals.find((signal) => signal.type === 'APPLICATION_FORM_EXISTS');
    const labRow = { entityType: 'LAB', kind: 'lab', websiteUrl: 'https://examplelab.yale.edu/' };

    it('cites the join page the lane found, not the page it was reading', () => {
      const signals = derive(
        [
          access(
            'Interested undergraduate students are encouraged to contact the PI.',
            'https://examplelab.yale.edu/join-our-lab',
          ),
          join('https://examplelab.yale.edu/join-our-lab', 'https://examplelab.yale.edu/'),
        ],
        labRow,
      );
      expect(application(signals)?.sourceUrl).toBe('https://examplelab.yale.edu/join-our-lab');
    });

    it('mints no application route from a generic recruiting line (#4637)', () => {
      const signals = derive(
        [
          access(
            'We are always looking for enthusiastic individuals to join our group!',
            'https://examplelab.yale.edu/join-us',
          ),
          join('https://examplelab.yale.edu/join-us', 'https://examplelab.yale.edu/join-us'),
          obs({
            field: 'contactInstructionsQuote',
            value: 'Individuals interested in joining should email the PI directly.',
            sourceName: LANE,
            confidence: 0.5,
          }),
        ],
        labRow,
      );
      expect(signals).toEqual([]);
    });

    it("refuses the row's home page and a member listing that invite no undergraduate by name", () => {
      expect(
        application(
          derive(
            [
              access(
                'We are hiring at all levels! Please check our open positions!',
                labRow.websiteUrl,
              ),
              join(labRow.websiteUrl, labRow.websiteUrl),
            ],
            labRow,
          ),
        ),
      ).toBeUndefined();
      expect(
        application(
          derive(
            [
              access('Undergraduate Students Jordan Example', 'https://examplelab.yale.edu/people'),
              join('https://examplelab.yale.edu/people', labRow.websiteUrl),
            ],
            labRow,
          ),
        ),
      ).toBeUndefined();
    });

    it('refuses a faculty profile with no joining content and keeps one that invites undergraduates', () => {
      const profile = 'https://medicine.yale.edu/profile/avery-example/';
      const faculty = { entityType: 'FACULTY_RESEARCH_AREA', kind: 'individual' };
      expect(
        application(
          derive(
            [
              access(
                'The team has a long history of mentoring Yale undergraduate students.',
                profile,
              ),
              join(profile, profile),
            ],
            faculty,
          ),
        ),
      ).toBeUndefined();
      expect(
        application(
          derive(
            [
              access(
                'Undergraduate and graduate students interested in joining my research group should contact me directly.',
                profile,
              ),
              join(profile, profile),
            ],
            faculty,
          ),
        )?.sourceUrl,
      ).toBe(profile);
    });

    it("cites the row's inviting profile when the lane named its department's jobs page", () => {
      const profile = 'https://earth.yale.edu/profile/avery-example';
      const signals = derive(
        [
          access(
            'For Yale undergraduates I have research project ideas, so please feel free to contact me.',
            profile,
          ),
          join('https://earth.yale.edu/opportunities-0', profile),
        ],
        {
          entityType: 'FACULTY_RESEARCH_AREA',
          kind: 'individual',
          departments: ['Earth and Planetary Sciences'],
        },
      );
      expect(application(signals)?.sourceUrl).toBe(profile);
    });

    it('admits a join page on the invitation the lane recorded from it, whatever quote the model chose', () => {
      const joinUrl = 'https://examplelab.yale.edu/join-the-lab';
      const verdict = obs({
        _id: 'obs-access',
        field: 'undergradAccessEvidence',
        value: {
          openToUndergrads: 'yes',
          evidenceSource: 'members_section',
          evidenceQuote: 'Undergraduate Students and Staff',
          quoteSourceUrl: 'https://examplelab.yale.edu/people',
          joinPageUrl: joinUrl,
          joinPageInvitation:
            'Undergraduate research assistants commit to the lab for two semesters.',
        },
        sourceName: LANE,
        confidence: 0.5,
      });
      expect(application(derive([verdict, join(joinUrl, joinUrl)], labRow))?.sourceUrl).toBe(
        joinUrl,
      );
      const withoutInvitation = obs({
        ...verdict,
        value: { ...(verdict.value as object), joinPageInvitation: undefined },
      });
      expect(
        application(derive([withoutInvitation, join(joinUrl, joinUrl)], labRow)),
      ).toBeUndefined();
    });

    it("keeps a department's own undergraduate research page on that department's faculty row", () => {
      const programme =
        'https://physics.yale.edu/undergraduate-academics/undergraduate-research-opportunities';
      const profile = 'https://physics.yale.edu/profile/avery-example';
      const faculty = { entityType: 'FACULTY_RESEARCH_AREA', kind: 'individual' };
      const observations = [
        access('Avery Example Assistant Professor', profile),
        join(programme, profile),
      ];
      expect(
        application(derive(observations, { ...faculty, departments: ['Physics'] }))?.sourceUrl,
      ).toBe(programme);
      expect(
        application(derive(observations, { ...faculty, departments: ['Chemistry'] })),
      ).toBeUndefined();
    });
  });

  it('does not derive official application artifacts from a bare join page without undergraduate access evidence', () => {
    const result = deriveAccessArtifactsFromObservations('64f000000000000000000001', [
      obs({
        field: 'joinPageUrl',
        value: 'https://lab.example.edu/join',
        sourceName: 'lab-microsite-undergrad-llm',
        confidence: 0.6,
      }),
    ]);

    expect(result.accessSignals).toEqual([]);
  });

  it('emits exactly the signal types listed in MATERIALIZED_ACCESS_SIGNAL_TYPES (#1303)', () => {
    const perBranchFixtures: AccessObservation[][] = [
      [
        obs({ field: 'offersIndependentStudy', value: true, confidence: 0.7 }),
        obs({
          field: 'independentStudyCourses',
          value: [{ code: 'HIST 491', title: 'Senior Essay' }],
          confidence: 0.7,
        }),
      ],
      [obs({ field: 'currentUndergradCount', value: 2, confidence: 0.5 })],
      [
        obs({
          field: 'pastUndergradAdvisees',
          value: [{ year: 2025, programName: 'STARS', count: 2 }],
          sourceName: 'undergrad-fellowships-recipients',
          confidence: 0.8,
        }),
      ],
      [
        obs({
          field: 'undergradAccessEvidence',
          value: {
            openToUndergrads: 'yes',
            evidenceSource: 'explicit_text',
            evidenceQuote: 'We invite undergraduates to apply.',
          },
          sourceName: 'lab-microsite-undergrad-llm',
          confidence: 0.5,
        }),
        obs({
          field: 'joinPageUrl',
          value: 'https://lab.example.edu/join',
          sourceName: 'lab-microsite-undergrad-llm',
          confidence: 0.5,
        }),
        obs({
          field: 'contactInstructionsQuote',
          value: 'Apply using the form on this page.',
          sourceName: 'lab-microsite-undergrad-llm',
          confidence: 0.5,
        }),
      ],
      [
        obs({
          field: 'undergradAccessEvidence',
          value: { openToUndergrads: 'no', evidenceSource: 'explicit_text' },
          sourceName: 'lab-microsite-undergrad-llm',
          confidence: 0.5,
        }),
        obs({
          field: 'undergradEvidenceQuote',
          value: 'We are not taking undergraduate researchers this year.',
          sourceName: 'lab-microsite-undergrad-llm',
          confidence: 0.5,
        }),
      ],
      [
        obs({
          field: 'postedOpening',
          value: {
            title: 'Summer RA - Smith Lab',
            applyUrl: 'https://apply.example.test/smith-lab-ra',
            deadline: '2026-12-01T00:00:00.000Z',
            hiringHome: 'Smith Lab',
          },
          sourceName: 'undergrad-research-posting',
          confidence: 0.85,
        }),
      ],
    ];

    const emitted = new Set(
      perBranchFixtures.flatMap((observations) =>
        deriveAccessArtifactsFromObservations(
          '64f000000000000000000001',
          observations,
        ).accessSignals.map((signal) => signal.type),
      ),
    );

    expect([...emitted].sort()).toEqual([...MATERIALIZED_ACCESS_SIGNAL_TYPES].sort());
  });

  it('deduplicates repeated evidence by derivation key', () => {
    const first = deriveAccessArtifactsFromObservations('64f000000000000000000001', [
      obs({ _id: 'course-a', field: 'offersIndependentStudy', value: true, confidence: 0.7 }),
      obs({ _id: 'course-b', field: 'offersIndependentStudy', value: true, confidence: 0.7 }),
    ]);
    const second = deriveAccessArtifactsFromObservations('64f000000000000000000001', [
      obs({ _id: 'course-a', field: 'offersIndependentStudy', value: true, confidence: 0.7 }),
      obs({ _id: 'course-b', field: 'offersIndependentStudy', value: true, confidence: 0.7 }),
    ]);

    expect(first.accessSignals).toHaveLength(1);
    expect(first.accessSignals.map((signal) => signal.derivationKey)).toEqual(
      second.accessSignals.map((signal) => signal.derivationKey),
    );
  });
});

describe('officialNonGrantSourceUrl', () => {
  it('prefers an official non-grant page over NIH/NSF/ORCID grant URLs', () => {
    expect(
      officialNonGrantSourceUrl({
        sourceUrls: [
          'https://reporter.nih.gov/project-details/123',
          'https://medicine.yale.edu/profile/jane-smith/',
        ],
      }),
    ).toBe('https://medicine.yale.edu/profile/jane-smith/');
  });

  it('returns empty when only grant/orcid sources exist', () => {
    expect(
      officialNonGrantSourceUrl({
        sourceUrls: ['https://reporter.nih.gov/project-details/1', 'https://orcid.org/0000-0002'],
      }),
    ).toBe('');
  });

  it('skips a websiteUrl the corpus knows is gone and falls through to a live source', () => {
    expect(
      officialNonGrantSourceUrl({
        websiteUrl: 'https://medicine.yale.edu/lab/solomon/',
        sourceUrls: ['https://medicine.yale.edu/profile/a-person/'],
        sourceLinkHealth: [
          {
            url: 'https://medicine.yale.edu/lab/solomon/',
            healthStatus: 'UNAVAILABLE',
            httpStatusCode: 404,
          },
        ],
      }),
    ).toBe('https://medicine.yale.edu/profile/a-person/');
  });

  // #2556: a host resolving only into private address space is alive and unopenable
  // at once. It recorded no liveness verdict, so it read here as an unprobed URL and
  // therefore as proof of access for a student who cannot reach it.
  it('skips a private-address host and falls through to a publicly reachable citation', () => {
    expect(
      officialNonGrantSourceUrl({
        websiteUrl: 'https://internal.example.edu/lab/',
        sourceUrls: ['https://medicine.yale.edu/profile/a-person/'],
        sourceLinkHealth: [
          {
            url: 'https://internal.example.edu/lab/',
            healthStatus: 'UNKNOWN',
            privateAddressHost: true,
          },
          {
            url: 'https://medicine.yale.edu/profile/a-person/',
            healthStatus: 'HEALTHY',
            httpStatusCode: 200,
          },
        ],
      }),
    ).toBe('https://medicine.yale.edu/profile/a-person/');
  });

  it('returns empty when the only citation is a private-address host', () => {
    expect(
      officialNonGrantSourceUrl({
        websiteUrl: 'https://internal.example.edu/lab/',
        sourceLinkHealth: [
          {
            url: 'https://internal.example.edu/lab/',
            healthStatus: 'UNKNOWN',
            privateAddressHost: true,
          },
        ],
      }),
    ).toBe('');
  });

  // The control: a plain inconclusive verdict on a public Yale host must keep
  // counting, or every throttled probe would demote a row.
  it('still credits a public Yale host whose verdict is merely inconclusive', () => {
    expect(
      officialNonGrantSourceUrl({
        websiteUrl: 'https://medicine.yale.edu/lab/a-lab/',
        sourceLinkHealth: [
          {
            url: 'https://medicine.yale.edu/lab/a-lab/',
            healthStatus: 'UNKNOWN',
            httpStatusCode: 403,
          },
        ],
      }),
    ).toBe('https://medicine.yale.edu/lab/a-lab/');
  });

  it('returns empty when every candidate is known dead, so the gate sees no way in', () => {
    expect(
      officialNonGrantSourceUrl({
        websiteUrl: 'http://art.yale.edu/SomePerson',
        sourceLinkHealth: [
          {
            url: 'http://art.yale.edu/SomePerson',
            healthStatus: 'UNAVAILABLE',
            httpStatusCode: 404,
          },
        ],
      }),
    ).toBe('');
  });

  it('matches a verdict across cosmetic url differences in scheme, www, and trailing slash', () => {
    expect(
      officialNonGrantSourceUrl({
        websiteUrl: 'http://www.art.yale.edu/SomePerson/',
        sourceLinkHealth: [
          {
            url: 'https://art.yale.edu/SomePerson',
            healthStatus: 'UNAVAILABLE',
            httpStatusCode: 404,
          },
        ],
      }),
    ).toBe('');
  });

  it('still counts an unprobed url, since absence of a verdict is not evidence of death', () => {
    expect(
      officialNonGrantSourceUrl({
        websiteUrl: 'https://somelab.yale.edu/',
        sourceLinkHealth: [],
      }),
    ).toBe('https://somelab.yale.edu/');
  });

  it('still counts a url whose verdict is only inconclusive', () => {
    expect(
      officialNonGrantSourceUrl({
        websiteUrl: 'https://slow.yale.edu/lab/',
        sourceLinkHealth: [
          { url: 'https://slow.yale.edu/lab/', healthStatus: 'UNKNOWN', httpStatusCode: 403 },
        ],
      }),
    ).toBe('https://slow.yale.edu/lab/');
  });
});

describe('deriveAccessArtifactsForResearchGroup', () => {
  it('returns the same current evidence bundle without writing canonical artifacts', async () => {
    const result = await deriveAccessArtifactsForResearchGroup(
      { researchEntityId: '64f000000000000000000001' },
      [obs({ _id: '64f000000000000000000099', field: 'currentUndergradCount', value: 2 })],
    );

    expect(result.researchEntityId).toBe('64f000000000000000000001');
    expect(result.artifacts.accessSignals[0]).toMatchObject({
      type: 'CURRENT_UNDERGRADS',
      sourceEvidenceId: '64f000000000000000000099',
    });
  });
});

describe('POSTED_OPENING materialization (#1568)', () => {
  const validPosting = {
    title: 'Summer RA - Smith Lab',
    applyUrl: 'https://apply.example.test/smith-lab-ra',
    deadline: '2026-12-01T00:00:00.000Z',
    hiringHome: 'Smith Lab',
    evidenceQuote: 'The Smith Lab seeks an undergraduate research assistant for summer 2026.',
  };

  it('lists POSTED_OPENING in the materializer producer contract', () => {
    expect(MATERIALIZED_ACCESS_SIGNAL_TYPES).toContain('POSTED_OPENING');
  });

  it('emits a POSTED_OPENING signal with the apply route and deadline expiry', () => {
    const result = deriveAccessArtifactsFromObservations('64f000000000000000000001', [
      obs({ field: 'postedOpening', value: validPosting, confidence: 0.85 }),
    ]);
    expect(result.accessSignals.map((s) => s.type)).toEqual(['POSTED_OPENING']);
    const signal = result.accessSignals[0];
    expect(signal.sourceUrl).toBe(validPosting.applyUrl);
    expect(signal.expiresAt?.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(signal.confidence).toBe('HIGH');
    expect(signal.excerpt).toMatch(/Apply by 2026-12-01/);
  });

  it('fails closed when a posting is missing an apply route, deadline, or title', () => {
    const missing = [
      { ...validPosting, applyUrl: '' },
      { ...validPosting, applyUrl: 'mailto:pi@example.test' },
      { ...validPosting, deadline: '' },
      { ...validPosting, deadline: 'not a date' },
      { ...validPosting, title: '' },
    ];
    for (const value of missing) {
      const result = deriveAccessArtifactsFromObservations('64f000000000000000000001', [
        obs({ field: 'postedOpening', value }),
      ]);
      expect(result.accessSignals).toEqual([]);
    }
  });

  it('deduplicates postings that share an apply route', () => {
    const result = deriveAccessArtifactsFromObservations('64f000000000000000000001', [
      obs({ field: 'postedOpening', value: validPosting, _id: 'obs-a' }),
      obs({ field: 'postedOpening', value: { ...validPosting, title: 'Alias' }, _id: 'obs-b' }),
    ]);
    expect(result.accessSignals).toHaveLength(1);
  });

  it('parsePostedOpening rejects incomplete payloads', () => {
    expect(parsePostedOpening(null)).toBeNull();
    expect(parsePostedOpening({ title: 'X', applyUrl: 'https://a.test' })).toBeNull();
    expect(parsePostedOpening(validPosting)).not.toBeNull();
  });
});

describe('isExplicitUndergradUnavailabilityPhrase (#1304)', () => {
  it('accepts explicit undergraduate-unavailability phrases', () => {
    const unavailable = [
      'We are not taking undergraduate researchers this year.',
      'We are not currently accepting undergraduate students.',
      'The lab is currently full.',
      'No undergraduate positions are available at this time.',
      'We are not accepting applications right now.',
      'Prof. Doe is unable to take on new undergraduate students.',
      'I do not have bandwidth to respond to inquiries about undergraduate positions.',
    ];
    for (const quote of unavailable) {
      expect(isExplicitUndergradUnavailabilityPhrase(quote)).toBe(true);
    }
  });

  it('rejects recruiting, research-abstract, and empty-roster text', () => {
    const notUnavailable = [
      'We currently have an opening for either a postdoctoral associate or an associate research scientist.',
      "We're Hiring! Apply to become a Postgraduate Research Associate in the YCVL!",
      'The Dove Lab is currently accepting PhD and MESc students.',
      'We are currently seeking talented developers and postdoctoral scholars to join.',
      'My research relates to the study of conformal field theories and the conformal bootstrap.',
      'No undergraduates listed on the lab roster.',
      '',
      undefined,
    ];
    for (const quote of notUnavailable) {
      expect(isExplicitUndergradUnavailabilityPhrase(quote)).toBe(false);
    }
  });
});

const LANE = 'lab-microsite-undergrad-llm';
const EARLIER = new Date('2026-05-01T12:00:00.000Z');
const LATER = new Date('2026-06-01T12:00:00.000Z');

const verdict = (openToUndergrads: 'yes' | 'no', observedAt: Date, id: string) =>
  obs({
    _id: id,
    field: 'undergradAccessEvidence',
    value: {
      openToUndergrads,
      evidenceSource: 'explicit_text',
      evidenceQuote:
        openToUndergrads === 'yes'
          ? 'Undergraduates join our projects each term.'
          : 'We are not accepting undergraduate researchers at this time.',
    },
    sourceName: LANE,
    confidence: 0.5,
    observedAt,
  });

const signalKeys = (observations: AccessObservation[]) =>
  deriveAccessArtifactsFromObservations('64f000000000000000000001', observations)
    .accessSignals.map((signal) => signal.derivationKey)
    .sort();

describe('contact quotes and verdicts mint no signal (#4637)', () => {
  it('mints no contact signal from an address or from an instruction', () => {
    for (const value of [
      'Contact [email redacted]',
      'Interested students should email [email redacted] with a CV.',
    ]) {
      expect(
        signalKeys([obs({ field: 'contactInstructionsQuote', value, sourceName: LANE })]),
      ).toEqual([]);
    }
  });

  it('mints no signal from verdicts alone, whichever is newest', () => {
    expect(
      signalKeys([verdict('yes', EARLIER, 'older-yes'), verdict('no', LATER, 'newer-no')]),
    ).toEqual([]);
    expect(
      signalKeys([verdict('no', EARLIER, 'older-no'), verdict('yes', LATER, 'newer-yes')]),
    ).toEqual([]);
  });

  it('leaves join-page minting reading every live read', () => {
    const keys = signalKeys([
      verdict('yes', EARLIER, 'older-yes'),
      verdict('no', LATER, 'newer-no'),
      obs({
        field: 'joinPageUrl',
        value: 'https://lab.example.edu/join',
        sourceName: LANE,
        observedAt: EARLIER,
      }),
    ]);
    expect(keys).toEqual(['signal:APPLICATION_FORM_EXISTS:JOIN_PAGE']);
  });
});

describe('planEvidenceGovernedSignalChanges', () => {
  const live = (derivationKey: string, id = '64f0000000000000000000a1') => ({
    _id: id,
    derivationKey,
    archived: false,
  });
  const pastAdvisees = (id: string) =>
    obs({ _id: id, field: 'pastUndergradAdvisees', value: [], observedAt: LATER });
  const independentStudy = (id: string) =>
    obs({ _id: id, field: 'offersIndependentStudy', value: false, observedAt: LATER });

  it('retires a live signal the derivation declined over evidence it read', () => {
    const plan = planEvidenceGovernedSignalChanges(
      new Set(),
      [pastAdvisees('newer-read')],
      [live('signal:PAST_UNDERGRADS')],
    );
    expect(plan.retired).toEqual([
      { signalId: '64f0000000000000000000a1', derivationKey: 'signal:PAST_UNDERGRADS' },
    ]);
  });

  it('retires nothing when the read holds none of the signal evidence fields', () => {
    const plan = planEvidenceGovernedSignalChanges(
      new Set(),
      [],
      [
        live('signal:PAST_UNDERGRADS'),
        live('signal:CREDIT_FORMALIZATION_POSSIBLE', '64f0000000000000000000a2'),
      ],
    );
    expect(plan).toEqual({ retired: [], revived: [] });
  });

  it('never touches a signal key it does not govern or a suppression-locked signal', () => {
    const plan = planEvidenceGovernedSignalChanges(
      new Set(),
      [pastAdvisees('newer-read'), verdict('no', LATER, 'newer-no')],
      [
        live('signal:CURRENT_UNDERGRADS', '64f0000000000000000000a2'),
        live('signal:APPLICATION_FORM_EXISTS:JOIN_PAGE', '64f0000000000000000000a6'),
        live('signal:REACH_OUT_PLAUSIBLE', '64f0000000000000000000a7'),
        {
          ...live('signal:PAST_UNDERGRADS', '64f0000000000000000000a3'),
          suppression: { reason: 'operator review' },
        },
      ],
    );
    expect(plan.retired).toEqual([]);
  });

  it('governs every other materializer key by its own evidence fields (#3920)', () => {
    const plan = planEvidenceGovernedSignalChanges(
      new Set(),
      [independentStudy('newer-read')],
      [
        live('signal:CREDIT_FORMALIZATION_POSSIBLE', '64f0000000000000000000a7'),
        live('signal:PAST_UNDERGRADS', '64f0000000000000000000a8'),
      ],
    );
    expect(plan.retired).toEqual([
      {
        signalId: '64f0000000000000000000a7',
        derivationKey: 'signal:CREDIT_FORMALIZATION_POSSIBLE',
      },
    ]);
  });

  it('retires a signal whose cited evidence was withdrawn even when the read holds none of its fields (#3920)', () => {
    const withdrawn = '64f0000000000000000000e1';
    const plan = planEvidenceGovernedSignalChanges(
      new Set(),
      [verdict('yes', LATER, '64f0000000000000000000e9')],
      [
        {
          ...live('signal:PAST_UNDERGRADS', '64f0000000000000000000a8'),
          source: { evidenceIds: [withdrawn] },
        },
        {
          ...live('signal:CREDIT_FORMALIZATION_POSSIBLE', '64f0000000000000000000a9'),
          source: { evidenceIds: [] },
        },
      ],
      { live: new Set(), retired: new Set([withdrawn]) },
    );
    expect(plan.retired).toEqual([
      { signalId: '64f0000000000000000000a8', derivationKey: 'signal:PAST_UNDERGRADS' },
    ]);
  });

  it('keeps a signal whose cited evidence is live under a key this read did not reach (#3920)', () => {
    const elsewhere = '64f0000000000000000000e2';
    const plan = planEvidenceGovernedSignalChanges(
      new Set(),
      [pastAdvisees('64f0000000000000000000e9')],
      [
        {
          ...live('signal:PAST_UNDERGRADS'),
          source: { evidenceIds: [elsewhere] },
        },
      ],
      { live: new Set([elsewhere]), retired: new Set() },
    );
    expect(plan.retired).toEqual([]);
  });

  it('revives only a signal this lane archived, once the evidence derives it again', () => {
    const plan = planEvidenceGovernedSignalChanges(
      new Set(['signal:PAST_UNDERGRADS', 'signal:APPLICATION_FORM_EXISTS:JOIN_PAGE']),
      [pastAdvisees('newer-read')],
      [
        {
          _id: '64f0000000000000000000a4',
          derivationKey: 'signal:PAST_UNDERGRADS',
          archived: true,
          archivedReason: ACCESS_SIGNAL_EVIDENCE_WITHDRAWN_REASON,
        },
        {
          _id: '64f0000000000000000000a5',
          derivationKey: 'signal:APPLICATION_FORM_EXISTS:JOIN_PAGE',
          archived: true,
          archivedReason: 'research-entity:dedupe-by-pi',
        },
      ],
    );
    expect(plan.revived).toEqual([
      { signalId: '64f0000000000000000000a4', derivationKey: 'signal:PAST_UNDERGRADS' },
    ]);
    expect(plan.retired).toEqual([]);
  });
});
