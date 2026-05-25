import { describe, expect, it } from 'vitest';

import {
  buildPathwayEvidenceRows,
  buildGroupedSearchResults,
  buildIdentityConfidenceRecords,
  buildResearchHomeContextSummary,
  dedupePathwayDisplayHits,
  formatSourceLabel,
  getPathwayActionLabel,
  getStudentFacingPathwayLabel,
  getPathwayTypeLabel,
  parseQueryInterpretationChips,
} from '../researchDiscoveryAdapters';
import type { ResearchEntity } from '../../types/researchEntity';
import type { PathwaySearchHit } from '../../types/pathway';

const entity = (overrides: Partial<ResearchEntity>): ResearchEntity => ({
  _id: overrides._id || 'entity-1',
  slug: overrides.slug || 'entity-1',
  name: overrides.name || 'Example Research Group',
  displayName: overrides.displayName,
  kind: overrides.kind || 'lab',
  description: overrides.description || 'Studies a focused research area.',
  websiteUrl: overrides.websiteUrl || '',
  location: overrides.location || '',
  departments: overrides.departments || [],
  researchAreas: overrides.researchAreas || [],
  school: overrides.school || '',
  openness: overrides.openness || 'unknown',
  typicalUndergradRoles: overrides.typicalUndergradRoles || [],
  prerequisiteCourses: overrides.prerequisiteCourses || [],
  creditOptions: overrides.creditOptions || [],
  fundingPrograms: overrides.fundingPrograms || [],
  contactEmail: overrides.contactEmail || '',
  contactName: overrides.contactName || '',
  contactRole: overrides.contactRole || '',
  sourceUrls: overrides.sourceUrls || [],
  ...overrides,
});

describe('pathway display helpers', () => {
  const pathway = (overrides: Partial<PathwaySearchHit> = {}): PathwaySearchHit => ({
    _id: 'pathway-1',
    pathwayType: 'POSTED_ROLE',
    status: 'ACTIVE',
    evidenceStrength: 'DIRECT',
    studentFacingLabel: 'Posted research role',
    explanation: 'A posted opening mentions undergraduate research.',
    bestNextStep: 'Apply through the posted listing.',
    bestNextStepCategory: 'apply',
    confidence: 0.9,
    sourceUrls: ['https://program.example.test/posting'],
    researchEntity: {
      _id: 'entity-1',
      slug: 'example-research-home',
      name: 'Example Research Home',
      departments: ['Neuroscience'],
      researchAreas: ['Systems neuroscience'],
    },
    evidence: [
      {
        signalType: 'POSTED_OPENING',
        confidence: 'HIGH',
        confidenceScore: 1,
        sourceUrl: 'https://program.example.test/posting',
        excerpt: 'Posted listing: example faculty sponsor',
      },
    ],
    ...overrides,
  });

  it('maps best-next-step categories to student-facing actions', () => {
    expect(getPathwayActionLabel('apply')).toBe('Apply');
    expect(getPathwayActionLabel('contact-program')).toBe('Contact program');
    expect(getPathwayActionLabel('plan-outreach')).toBe('Plan targeted outreach');
    expect(getPathwayActionLabel('find-funding')).toBe('Find funding');
    expect(getPathwayActionLabel('register-for-credit')).toBe(
      'Ask about credit after finding a mentor',
    );
    expect(getPathwayActionLabel('save-for-thesis')).toBe('Save for thesis planning');
    expect(getPathwayActionLabel('check-back-later')).toBe('Save for later');
    expect(getPathwayActionLabel('save-for-later')).toBe('Save for later');
  });

  it('normalizes pathway type and evidence labels without raw enums', () => {
    expect(getPathwayTypeLabel('POSTED_ROLE')).toBe('Posted opening');
    expect(getStudentFacingPathwayLabel('POSTED_ROLE')).toBe('Posted opening');
    expect(getPathwayTypeLabel('REACH_OUT_PLAUSIBLE')).toBe('Exploratory outreach');
    expect(formatSourceLabel('https://www.example-lab.test/research')).toBe('example-lab.test');

    const evidenceRows = buildPathwayEvidenceRows(pathway());

    expect(evidenceRows[0]).toMatchObject({
      claim: 'A posted opening mentions undergraduate research.',
      sourceType: 'Posted opening',
      url: 'https://program.example.test/posting',
    });
    expect(JSON.stringify(evidenceRows)).not.toContain('POSTED_OPENING');
    expect(JSON.stringify(evidenceRows)).not.toContain('POSTED_ROLE');
  });

  it('dedupes display pathways while preserving distinct student-facing routes', () => {
    const postedRole = pathway({
      activePostedOpportunity: {
        _id: 'opportunity-1',
        title: 'Spring RA role',
        status: 'OPEN',
      },
    });
    const duplicatePostedRole = pathway({
      _id: 'pathway-duplicate',
      activePostedOpportunity: {
        _id: 'opportunity-1',
        title: 'Spring RA role',
        status: 'OPEN',
      },
    });
    const sameLabOutreach = pathway({
      _id: 'pathway-outreach',
      pathwayType: 'EXPLORATORY_CONTACT',
      studentFacingLabel: 'Plan outreach',
      bestNextStepCategory: 'plan-outreach',
      activePostedOpportunity: undefined,
    });

    const displayHits = dedupePathwayDisplayHits([postedRole, duplicatePostedRole, sameLabOutreach]);

    expect(displayHits).toHaveLength(2);
    expect(displayHits.map((item) => item._id)).toEqual(['pathway-1', 'pathway-outreach']);
  });

  it('dedupes same-name exploratory pathways from duplicate research entity rows', () => {
    const firstProfile = pathway({
      _id: 'profile-pathway-a',
      pathwayType: 'EXPLORATORY_CONTACT',
      studentFacingLabel: 'Explore the PI profile',
      bestNextStep:
        'Review the PI profile and lab site first, then decide whether targeted exploratory outreach is appropriate.',
      bestNextStepCategory: 'plan-outreach',
      activePostedOpportunity: undefined,
      researchEntity: {
        _id: 'entity-a',
        slug: 'dept-astronomy-example-faculty',
        name: 'Example Faculty Lab',
        departments: ['Astronomy'],
        researchAreas: [],
      },
    });
    const duplicateProfile = pathway({
      _id: 'profile-pathway-b',
      pathwayType: 'EXPLORATORY_CONTACT',
      studentFacingLabel: 'Explore the PI profile',
      bestNextStep:
        'Review the PI profile and lab site first, then decide whether targeted exploratory outreach is appropriate.',
      bestNextStepCategory: 'plan-outreach',
      activePostedOpportunity: undefined,
      researchEntity: {
        _id: 'entity-b',
        slug: 'dept-physics-example-faculty',
        name: 'Example Faculty Lab',
        departments: ['Physics'],
        researchAreas: [],
      },
    });

    expect(dedupePathwayDisplayHits([firstProfile, duplicateProfile]).map((item) => item._id)).toEqual([
      'profile-pathway-a',
    ]);
  });

  it('preserves distinct posted opportunities that share a source page', () => {
    const springPostedRole = pathway({
      _id: 'spring-pathway',
      activePostedOpportunity: {
        _id: 'spring-role',
        title: 'Spring RA role',
        status: 'OPEN',
      },
      sourceUrls: ['https://program.example.test/opportunities'],
    });
    const summerPostedRole = pathway({
      _id: 'summer-pathway',
      activePostedOpportunity: {
        _id: 'summer-role',
        title: 'Summer RA role',
        status: 'OPEN',
      },
      sourceUrls: ['https://program.example.test/opportunities'],
    });

    expect(dedupePathwayDisplayHits([springPostedRole, summerPostedRole]).map((item) => item._id)).toEqual([
      'spring-pathway',
      'summer-pathway',
    ]);
  });

});

describe('buildResearchHomeContextSummary', () => {
  it('does not use short descriptions when the full description is only a metadata placeholder', () => {
    expect(
      buildResearchHomeContextSummary({
        shortDescription: 'Research home connected to TEST - Fixture Medicine and .',
        fullDescription:
          'Example Lab is a Yale research home connected to TEST - Fixture Medicine and .',
        departments: ['Fixture Medicine'],
        sourceUrls: ['https://research-home.example.test/lab/example/'],
      }),
    ).toMatchObject({
      text: 'Limited public description. Open the profile to review source links and Fixture Medicine context.',
      state: 'sparse',
      label: 'Summary limited',
    });
  });

  it('uses concise short descriptions only when a useful full description backs them', () => {
    expect(
      buildResearchHomeContextSummary({
        shortDescription:
          'Studies how children and adults learn social-group categories using experimental and cross-cultural methods.',
        fullDescription:
          'The lab studies how children and adults learn social-group categories and use them to reason about other people. Its projects combine behavioral experiments, developmental studies, and cross-cultural methods to understand intergroup cognition.',
      }),
    ).toMatchObject({
      text: 'Studies how children and adults learn social-group categories using experimental and cross-cultural methods.',
      state: 'complete',
      label: 'Research description',
    });
  });

  it('prefers a short research description over longer description text', () => {
    expect(
      buildResearchHomeContextSummary({
        shortDescription: 'Studies visual cortex circuits with imaging and computation.',
        description: 'A longer description should not appear first.',
        researchAreas: ['visual cortex'],
        departments: ['Neuroscience'],
      }),
    ).toMatchObject({
      text: 'Studies visual cortex circuits with imaging and computation.',
      state: 'complete',
      label: 'Research description',
    });
  });

  it('falls back to useful full descriptions when the short description is a generic lead', () => {
    expect(
      buildResearchHomeContextSummary({
        shortDescription: 'My lab focuses on intergroup social cognition.',
        description:
          'My lab focuses on fixture social cognition. The lab studies how synthetic groups are acquired in controlled examples, using experimental and cross-context fixture methods.',
        fullDescription:
          'My lab focuses on fixture social cognition. The lab studies how synthetic groups are acquired in controlled examples, using experimental and cross-context fixture methods.',
        departments: ['Psychology'],
      }),
    ).toMatchObject({
      text: 'My lab focuses on fixture social cognition. The lab studies how synthetic groups are acquired in controlled examples, using experimental and cross-context fixture methods.',
      state: 'complete',
      label: 'Research description',
    });
  });

  it('surfaces missing descriptions instead of using research areas as description copy', () => {
    expect(
      buildResearchHomeContextSummary({
        researchAreas: ['archival research', 'digital humanities'],
      }),
    ).toMatchObject({
      text: 'Limited public description. This profile needs source review before fit can be assessed.',
      state: 'sparse',
      label: 'Summary limited',
    });
  });

  it('labels PI-profile synthesis as profile context rather than a research description', () => {
    expect(
      buildResearchHomeContextSummary({
        profileSynthesisDescription:
          'This faculty research profile is synthesized from PI profile topics and recent scholarly work.',
        departments: ['Anthropology'],
        sourceUrls: ['https://profile.example.test/example'],
      }),
    ).toMatchObject({
      text: 'This faculty research profile is synthesized from PI profile topics and recent scholarly work.',
      state: 'complete',
      label: 'Profile context',
    });
  });

  it('prefers lab description fields over noisy source metadata', () => {
    expect(
      buildResearchHomeContextSummary({
        fullDescription:
          'Example Lab studies fixture cell signaling, sample transcript processing, and synthetic response pathways.',
        researchAreas: [
          'ORCID0000-0000-0000-0001',
          'Lab Whisk Cup Streamline Icon: https://streamlinehq.com',
          'View Lab Website',
          '10 YSM Researchers',
          'View Related Publication',
          'Elasticity and Material Modeling',
        ],
      }),
    ).toMatchObject({
      text: 'Example Lab studies fixture cell signaling, sample transcript processing, and synthetic response pathways.',
      state: 'complete',
      label: 'Research description',
    });
  });

  it('does not surface YSM profile chrome as a research description or area', () => {
    expect(
      buildResearchHomeContextSummary({
        shortDescription:
          'Director of Fixture Core, Example Methods Course Director, Fixture Department Director of Fixture Core, Example Methods Course Director, Fixture Department Director of Fixture...',
        researchAreas: [
          'ORCID0000-0000-0000-0002',
          'Lab Whisk Cup Streamline Icon: https://streamlinehq.comExample LabView Lab Website',
          'View Lab Website',
          'Fixture Topic10 YSM ResearchersView Related Publication',
          '10 YSM Researchers',
          'View Related Publication',
        ],
        school: 'Fixture School of Medicine',
      }),
    ).toMatchObject({
      text: 'Limited public description. Use the Fixture School of Medicine context while this profile is reviewed.',
      state: 'sparse',
      label: 'Summary limited',
    });
  });

  it('prefers the lab research description over faculty appointment metadata', () => {
    expect(
      buildResearchHomeContextSummary({
        shortDescription:
          'Department Chair and Fixture Professor of Environmental Health and of Visual Science and of Environment Director, Fixture Research Center; Affiliated Faculty, Fixture Cancer...',
        description:
          'The Example Laboratory investigates fixture mechanisms in synthetic disease models, focusing on sample organ systems and response pathways.',
        school: 'Fixture School of Medicine',
      }),
    ).toMatchObject({
      text: 'The Example Laboratory investigates fixture mechanisms in synthetic disease models, focusing on sample organ systems and response pathways.',
      state: 'complete',
      label: 'Research description',
    });
  });

  it('prefers lab descriptions over PI profile summaries', () => {
    expect(
      buildResearchHomeContextSummary({
        shortDescription:
          'Example Person is Assistant Professor of Anthropology and Principal Investigator of the Example Genomics Laboratory at Example University.',
        description:
          'The Example Lab studies fixture ancestry models and population history through synthetic sequence analysis.',
        school: 'Faculty of Arts and Sciences',
      }),
    ).toMatchObject({
      text: 'The Example Lab studies fixture ancestry models and population history through synthetic sequence analysis.',
      state: 'complete',
      label: 'Research description',
    });
  });

  it('filters profile and publication widgets while preserving real topic areas', () => {
    expect(
      buildResearchHomeContextSummary({
        shortDescription:
          'Publications TimelineA big-picture view of P.',
        researchAreas: [
          '0000-0000-0000-0003',
          'Example Person, MDView Full ProfileView 27 Common Publications',
          'View Full Profile',
          'View 27 Common Publications',
          'Fixture Co-AuthorsFrequent collaborators of Example P.',
          'Publications',
          '844',
          'Epigenetics and DNA Methylation',
          'Genetic Associations and Epidemiology',
        ],
      }),
    ).toMatchObject({
      text: 'Limited public description. This profile needs source review before fit can be assessed.',
      state: 'sparse',
      label: 'Summary limited',
    });
  });

  it('uses department metadata for sparse context when descriptions are missing', () => {
    expect(
      buildResearchHomeContextSummary({
        departments: ['Computer Science'],
      }),
    ).toMatchObject({
      text: 'Limited public description. Use the Computer Science context while this profile is reviewed.',
      state: 'sparse',
      label: 'Summary limited',
    });
  });

  it('keeps source-link guidance when sparse profiles actually have source URLs', () => {
    expect(
      buildResearchHomeContextSummary({
        departments: ['Computer Science'],
        sourceUrls: ['https://source.example.test/example'],
      }),
    ).toMatchObject({
      text: 'Limited public description. Open the profile to review source links and Computer Science context.',
      state: 'sparse',
      label: 'Summary limited',
    });
  });

  it('uses generic sparse context when no useful metadata is present', () => {
    expect(buildResearchHomeContextSummary({})).toMatchObject({
      text: 'Limited public description. This profile needs source review before fit can be assessed.',
      state: 'sparse',
      label: 'Summary limited',
    });
  });
});

describe('buildIdentityConfidenceRecords', () => {
  it('keeps same-name records separate and flags meaningful ambiguity', () => {
    const identities = buildIdentityConfidenceRecords([
      {
        id: 'ada-cs',
        name: 'Example Researcher',
        title: 'Professor',
        departments: ['Computer Science'],
        affiliations: ['Example College'],
        netid: 'example1',
        sourceContext: 'Analytical Systems Lab',
      },
      {
        id: 'ada-math',
        name: 'Example Researcher',
        title: 'Lecturer',
        departments: ['Mathematics'],
        affiliations: ['Graduate School'],
        sourceContext: 'Mechanism Design Group',
      },
    ]);

    expect(identities).toHaveLength(2);
    expect(identities[0].name).toBe('Example Researcher');
    expect(identities[1].name).toBe('Example Researcher');
    expect(identities.every((identity) => identity.ambiguityLabel === 'Possible same-name ambiguity')).toBe(true);
    expect(identities[0].identityLabel).toBe('Identity: Yale-confirmed');
    expect(identities[1].identityLabel).toBe('Identity: unresolved');
  });
});

describe('buildGroupedSearchResults', () => {
  it('passes research-area labels through so browse cards can apply responsive caps', () => {
    const grouped = buildGroupedSearchResults({
      query: 'fixture morphology',
      researchEntities: [
        entity({
          _id: 'a',
          slug: 'fixture-morphology-lab',
          name: 'Fixture Morphology Lab',
          researchAreas: [
            'Fixture evolutionary morphology',
            'Functional morphology',
            'Fixture systematics',
            'Comparative evolution',
            'Paleontology',
            'Vertebrate paleontology',
          ],
        }),
      ],
      pathways: [],
      papers: [],
    });

    expect(grouped.clusters[0].labels).toEqual([
      expect.stringMatching(/Fixture evolutionary morphology|Functional morphology|Fixture systematics|Comparative evolution|Paleontology|Vertebrate paleontology/),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
      expect.any(String),
    ]);
    expect(grouped.clusters[0].labels).toEqual(
      expect.arrayContaining([
        'Fixture evolutionary morphology',
        'Functional morphology',
        'Fixture systematics',
        'Comparative evolution',
        'Paleontology',
        'Vertebrate paleontology',
      ]),
    );
  });

  it('adds profile links when contact emails identify Yale netids and exposes lab context', () => {
    const grouped = buildGroupedSearchResults({
      query: 'AI safety mechanism design',
      researchEntities: [
        entity({
          _id: 'a',
          slug: 'safe-ai',
          name: 'Safe AI Lab',
          researchAreas: ['AI Safety'],
          departments: ['Computer Science'],
          contactName: 'Example Contact',
          contactRole: 'PI',
          contactEmail: 'example.contact@yale.edu',
        }),
      ],
      pathways: [],
      papers: [],
    });

    expect(grouped.people).toHaveLength(1);
    expect(grouped.people[0].profileUrl).toBe('/profile/example.contact');
    expect(grouped.people[0].labName).toBe('Safe AI Lab');
    expect(grouped.people[0].labSlug).toBe('safe-ai');
  });

  it('merges duplicate people surfaced through multiple research homes', () => {
    const grouped = buildGroupedSearchResults({
      query: 'machine learning',
      researchEntities: [
        entity({
          _id: 'a',
          slug: 'safe-ai',
          name: 'Safe AI Lab',
          departments: ['Computer Science'],
          contactName: 'Example Contact',
          contactRole: 'PI',
          contactEmail: 'example.contact@yale.edu',
          sourceUrls: ['https://department.example.test/contact-a'],
        }),
        entity({
          _id: 'b',
          slug: 'systems-ai',
          name: 'Systems AI Lab',
          departments: ['Statistics & Data Science'],
          contactName: 'Example Contact',
          contactRole: 'PI',
          contactEmail: 'example.contact@yale.edu',
          sourceUrls: ['https://department.example.test/contact-b'],
        }),
      ],
      pathways: [],
      papers: [],
    });

    expect(grouped.people).toHaveLength(1);
    expect(grouped.people[0]).toMatchObject({
      name: 'Example Contact',
      netid: 'example.contact',
      profileUrl: '/profile/example.contact',
      departments: ['Computer Science', 'Statistics & Data Science'],
    });
    expect(grouped.people[0].evidence).toHaveLength(2);
  });

  it('keeps same display-name people separate when netids differ', () => {
    const grouped = buildGroupedSearchResults({
      query: 'shared-name lab',
      researchEntities: [
        entity({
          _id: 'a',
          slug: 'shared-name-a',
          name: 'Shared Name Lab',
          departments: ['Computer Science'],
          contactName: 'J Example',
          contactRole: 'PI',
          contactEmail: 'fixture.alpha@yale.edu',
        }),
        entity({
          _id: 'b',
          slug: 'shared-name-b',
          name: 'Shared Name Lab',
          departments: ['Pharmacology'],
          contactName: 'J Example',
          contactRole: 'PI',
          contactEmail: 'fixture.beta@yale.edu',
        }),
      ],
      pathways: [],
      papers: [],
    });

    expect(grouped.people).toHaveLength(2);
    expect(grouped.people.map((person) => person.netid)).toEqual(['fixture.alpha', 'fixture.beta']);
  });

  it('returns clusters, people, pathways, papers, and interpretation chips', () => {
    const grouped = buildGroupedSearchResults({
      query: 'AI safety mechanism design',
      researchEntities: [
        entity({
          _id: 'a',
          slug: 'safe-ai',
          name: 'Safe AI Lab',
          researchAreas: ['AI Safety'],
          departments: ['Computer Science'],
          contactName: 'Example Contact',
          contactRole: 'PI',
        }),
      ],
      pathways: [],
      papers: [],
    });

    expect(grouped.clusters).toHaveLength(1);
    expect(grouped.people).toHaveLength(1);
    expect(grouped.papers).toHaveLength(0);
    expect(grouped.pathways).toHaveLength(0);
    expect(grouped.interpretationChips).toEqual([
      'Query: AI safety mechanism design',
      'Topic term: AI',
      'Topic term: safety',
      'Topic term: mechanism',
      'Topic term: design',
    ]);
  });
});

describe('parseQueryInterpretationChips', () => {
  it('drops tiny words and caps visible interpretation chips', () => {
    expect(parseQueryInterpretationChips('BCIs for ALS and protein folding')).toEqual([
      'Query: BCIs for ALS and protein folding',
      'Topic term: BCIs',
      'Topic term: ALS',
      'Topic term: protein',
      'Topic term: folding',
    ]);
  });
});
