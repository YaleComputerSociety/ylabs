import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResearchEntity } from '../../models/researchEntity';
import { Researcher } from '../../models/researcher';
import { RoleAssignment } from '../../models/roleAssignment';
import {
  buildResearchEntitySearchEmbedderConfig,
  buildResearchEntitySearchIndexDocument,
  buildStudentSearchTerms,
  fetchResearchEntitySearchMemberNames,
  getResearchEntitySearchIndexSettings,
  invalidateResearchEntitySearchEmbedderCache,
  isResearchEntitySearchEmbedderConfigured,
  readResearchEntitySearchEmbedderState,
  RESEARCH_ENTITY_SEARCH_EMBEDDER_MODEL,
  RESEARCH_ENTITY_SEARCH_INDEX_DOCUMENT_FIELDS,
  RESEARCH_ENTITY_SEARCH_INDEX_NAME,
  RESEARCH_ENTITY_SEARCH_INDEX_PRIMARY_KEY,
  RESEARCH_ENTITY_SEARCH_MAX_TOTAL_HITS,
  RESEARCH_ENTITY_SEARCH_MAX_VALUES_PER_FACET,
  rebuildResearchEntitySearchIndex,
} from '../researchEntitySearchIndexService';
import { RESEARCH_SEARCH_RELEVANCE_TEXT_FIELDS } from '../../scripts/researchSearchRelevanceCore';

const succeedingTaskClient = {
  waitForTask: async () => ({ status: 'succeeded' }),
};

describe('researchEntitySearchIndexService', () => {
  it('drops a person-scoped displayName that names an umbrella organization (#2351)', () => {
    const doc = buildResearchEntitySearchIndexDocument({
      _id: 'entity-affiliation-graft',
      slug: 'dept-econ-rafferty-duchamp',
      name: 'Rafferty Duchamp Faculty Research',
      displayName: 'Yale School of Management',
      kind: 'individual',
      entityType: 'FACULTY_RESEARCH_AREA',
      archived: false,
    });

    expect(doc).not.toHaveProperty('displayName');
    // The indexed name is now the served title, so the synthesized suffix is gone.
    // This test's subject is the dropped umbrella-org displayName, not the suffix.
    expect(doc?.name).toBe('Rafferty Duchamp');
  });

  // `displayName` is searchable, so filler left in the index keyword matches a
  // record whose served title is its real `name` (#2367).
  it('drops a placeholder displayName so filler cannot match the record', () => {
    const doc = buildResearchEntitySearchIndexDocument({
      _id: 'entity-placeholder-alias',
      slug: 'ysm-faculty-fixture-loyal',
      name: 'Loyal Lab',
      displayName: 'n/a',
      kind: 'individual',
      entityType: 'FACULTY_RESEARCH_AREA',
      archived: false,
    });

    expect(doc).not.toHaveProperty('displayName');
    expect(doc?.name).toBe('Loyal Lab');
  });

  it('keeps an organization-shaped record own organization displayName in the index', () => {
    const doc = buildResearchEntitySearchIndexDocument({
      _id: 'entity-center',
      slug: 'center-customer-insights',
      name: 'Yale Center for Customer Insights',
      displayName: 'Yale Center for Customer Insights',
      kind: 'center',
      entityType: 'CENTER',
      archived: false,
    });

    expect(doc?.displayName).toBe('Yale Center for Customer Insights');
  });

  it('indexes a sort title taken from the heading the card shows, not the stored name', () => {
    const doc = buildResearchEntitySearchIndexDocument({
      _id: 'entity-sort-title',
      name: 'Yale Optics Institute',
      displayName: 'Institute for Applied Optics',
      kind: 'institute',
      entityType: 'INSTITUTE',
      archived: false,
    });

    expect(doc?.sortTitle).toBe('institute for applied optics');
  });

  it('folds case, accents, and leading punctuation out of the sort title', () => {
    const doc = buildResearchEntitySearchIndexDocument({
      _id: 'entity-sort-title-folded',
      name: '"Émergent  Materials" Center',
      kind: 'center',
      entityType: 'CENTER',
      archived: false,
    });

    expect(doc?.sortTitle).toBe('emergent materials" center');
  });

  it('indexes the department and school a same-titled card is suffixed with as the tiebreak', () => {
    const doc = buildResearchEntitySearchIndexDocument({
      _id: 'entity-sort-title-qualifier',
      name: 'Nebula Imaging Center',
      kind: 'center',
      entityType: 'CENTER',
      departments: ['Écology', 'Physics'],
      school: 'Graduate School',
      archived: false,
    });

    expect(doc?.sortTitleQualifier).toBe('ecology) graduate school)');
  });

  it('breaks a title tie in the order the suffixed headings read when one label prefixes another', () => {
    const qualifierFor = (department: string) =>
      buildResearchEntitySearchIndexDocument({
        _id: `entity-sort-title-qualifier-${department}`,
        name: 'Nebula Imaging Center',
        kind: 'center',
        entityType: 'CENTER',
        departments: [department],
        archived: false,
      })?.sortTitleQualifier as string;
    const headings = ['Physics', 'Physics and Astronomy'].map(
      (department) => `nebula imaging center (${department.toLowerCase()})`,
    );

    expect(qualifierFor('Physics and Astronomy') < qualifierFor('Physics')).toBe(
      headings[1] < headings[0],
    );
  });

  it('sorts a faculty research row by its title without the synthesized suffix', () => {
    const doc = buildResearchEntitySearchIndexDocument({
      _id: 'entity-sort-title-faculty',
      name: 'Quasar Topics Faculty Research',
      kind: 'individual',
      entityType: 'FACULTY_RESEARCH_AREA',
      archived: false,
    });

    expect(doc?.sortTitle).toBe('quasar topics');
  });

  it('builds Meilisearch-ready research entity documents without internal fields', () => {
    const doc = buildResearchEntitySearchIndexDocument({
      _id: 'entity-1',
      __v: 3,
      embedding: [0.1, 0.2],
      name: 'Smith Lab',
      archived: false,
      departments: ['Psychology'],
    });

    expect(doc).toMatchObject({
      id: 'entity-1',
      name: 'Smith Lab',
      archived: false,
      departments: ['Psychology'],
    });
    expect(doc).not.toHaveProperty('__v');
    expect(doc).not.toHaveProperty('embedding');
  });

  it('blanks a "Studies <chips>" area echo of researchAreas in the indexed description fields (#1466)', () => {
    const doc = buildResearchEntitySearchIndexDocument({
      _id: 'entity-studies-echo',
      name: 'Echo Lab',
      archived: false,
      researchAreas: ['Economic Theory', 'Financial Economics', 'Macroeconomics'],
      fullDescription: 'Studies economic theory, financial economics, and macroeconomics.',
      shortDescription: 'Studies economic theory, financial economics, and macroeconomics.',
    });

    expect(doc?.fullDescription).toBe('');
    expect(doc?.shortDescription).toBe('');
  });

  it('keeps a genuine research-focus summary in the indexed description fields', () => {
    const doc = buildResearchEntitySearchIndexDocument({
      _id: 'entity-genuine-summary',
      name: 'Genuine Lab',
      archived: false,
      researchAreas: ['Mammalian evolutionary morphology', 'Functional morphology'],
      fullDescription:
        'The Genuine Lab studies mammalian functional morphology, systematics, and evolution across living and fossil groups.',
      shortDescription:
        'Studies mammalian functional morphology, systematics, and evolution across living and fossil groups.',
    });

    expect(doc?.fullDescription).toBe(
      'The Genuine Lab studies mammalian functional morphology, systematics, and evolution across living and fossil groups.',
    );
    expect(doc?.shortDescription).toBe(
      'Studies mammalian functional morphology, systematics, and evolution across living and fossil groups.',
    );
  });

  it('blanks the synthetic research-home metadata blurb + hedge in the indexed description fields (#1466)', () => {
    const doc = buildResearchEntitySearchIndexDocument({
      _id: 'entity-research-home-hedge',
      name: 'Synthetic Home Lab',
      archived: false,
      fullDescription:
        'Synthetic Home Lab is a Yale research home. This context is synthesized from indexed Yale metadata and should be checked against official sources before outreach.',
      shortDescription: 'Research home connected to .',
    });

    expect(doc?.fullDescription).toBe('');
    expect(doc?.shortDescription).toBe('');
  });

  it('strips retired legacy access fields', () => {
    const doc = buildResearchEntitySearchIndexDocument({
      _id: 'entity-access',
      name: 'Access Signal Lab',
      archived: false,
      openness: 'open',
      acceptingUndergrads: true,
      acceptanceConfidence: 0.9,
      opennessSignals: ['posted-opening'],
      opennessStatusCache: 'verified-accepting',
      opennessExplanationCache: 'Has a posted opening.',
      opennessComputedAt: '2026-01-01T00:00:00.000Z',
      opennessLastSignalAt: '2026-01-01T00:00:00.000Z',
    });

    expect(doc).toMatchObject({
      id: 'entity-access',
    });
    expect(doc).not.toHaveProperty('openness');
    expect(doc).not.toHaveProperty('acceptingUndergrads');
    expect(doc).not.toHaveProperty('acceptanceConfidence');
    expect(doc).not.toHaveProperty('opennessSignals');
    expect(doc).not.toHaveProperty('opennessStatusCache');
    expect(doc).not.toHaveProperty('opennessExplanationCache');
    expect(doc).not.toHaveProperty('opennessComputedAt');
    expect(doc).not.toHaveProperty('opennessLastSignalAt');
  });

  it('strips the retired undergraduate-logistics projections still stored on old rows', () => {
    const doc = buildResearchEntitySearchIndexDocument({
      _id: 'entity-undergrad-logistics',
      name: 'Undergraduate Logistics Lab',
      archived: false,
      undergraduateCurrentAvailability: 'OPEN',
      undergraduateCompensationModel: 'PAID_OR_STIPEND',
      undergraduateEligibleStudentLevels: ['FIRST_YEAR'],
      hasUndergradHostingEvidence: true,
    });

    expect(doc).toMatchObject({
      id: 'entity-undergrad-logistics',
      hasUndergradHostingEvidence: true,
    });
    expect(doc).not.toHaveProperty('undergraduateCurrentAvailability');
    expect(doc).not.toHaveProperty('undergraduateCompensationModel');
    expect(doc).not.toHaveProperty('undergraduateEligibleStudentLevels');
  });

  it('splits bare comma-delimited research-area blobs so facets do not surface jammed lists', () => {
    const doc = buildResearchEntitySearchIndexDocument({
      _id: 'entity-area-facet',
      name: 'Milivojevic Lab',
      archived: false,
      researchAreas: [
        'Anxiety, Depression, Psychometrics, Treatment, Cognitive Processes',
        'Water Supply, Quality, and Scarcity',
      ],
    });

    expect(doc?.researchAreas).toEqual([
      'Anxiety',
      'Depression',
      'Psychometrics',
      'Treatment',
      'Cognitive Processes',
      'Water Supply, Quality, and Scarcity',
    ]);
  });

  it('includes clean methods in the search document and drops empty methods lists', () => {
    const withMethods = buildResearchEntitySearchIndexDocument({
      _id: 'entity-methods',
      name: 'Methods Lab',
      archived: false,
      methods: ['CRISPR-Cas9 Gene Editing', 'Single-cell RNA sequencing'],
    });
    expect(withMethods?.methods).toEqual([
      'CRISPR-Cas9 Gene Editing',
      'Single-cell RNA sequencing',
    ]);

    const withoutMethods = buildResearchEntitySearchIndexDocument({
      _id: 'entity-no-methods',
      name: 'No Methods Lab',
      archived: false,
      methods: [],
    });
    expect(withoutMethods).not.toHaveProperty('methods');
  });

  it('adds curated student topic aliases to searchable index documents', () => {
    const doc = buildResearchEntitySearchIndexDocument({
      _id: 'entity-ai',
      name: 'Medical Imaging Group',
      fullDescription: 'Uses artificial intelligence for diagnostic imaging.',
      researchAreas: ['Computer Vision'],
      archived: false,
    });

    expect(doc).toMatchObject({
      id: 'entity-ai',
      studentSearchTerms: expect.arrayContaining([
        'ai',
        'artificial intelligence',
        'machine learning',
      ]),
    });
    // The sanitizer drops `Computer Vision` here as a domain-incoherent unsourced
    // area, leaving the served row with no research areas at all, so the aliases
    // must come off the surviving description and not off the dropped chip (#2396).
    expect(doc).not.toHaveProperty('researchAreas');
    expect(doc?.studentSearchTerms ?? []).not.toEqual(expect.arrayContaining(['computer vision']));
    expect(buildStudentSearchTerms({ name: 'Ailong Airway Lab' })).toEqual([]);
  });

  it('indexes a person-scoped lab under the name the serve path substitutes (#2373)', () => {
    const doc = buildResearchEntitySearchIndexDocument({
      _id: 'entity-bare-person-lab',
      slug: 'dept-econ-robin-roster',
      name: 'Robin Roster',
      kind: 'lab',
      entityType: 'LAB',
      archived: false,
    });

    expect(doc?.name).toBe('Robin Roster Lab');
  });

  it('leaves a branded person-scoped lab name unchanged in the index', () => {
    const doc = buildResearchEntitySearchIndexDocument({
      _id: 'entity-branded-lab',
      slug: 'dept-seas-cogitorium',
      name: 'The Cogitorium',
      kind: 'lab',
      entityType: 'LAB',
      archived: false,
    });

    expect(doc?.name).toBe('The Cogitorium');
  });

  it('surfaces computational-vision labs under the "computer vision" bigram query (#787)', () => {
    const doc = buildResearchEntitySearchIndexDocument({
      _id: 'entity-computational-vision',
      name: 'Zucker Faculty Research',
      researchAreas: ['Computational Vision'],
      archived: false,
    });

    expect(doc?.studentSearchTerms).toEqual(
      expect.arrayContaining(['cv', 'computer vision', 'computational vision']),
    );
  });

  it('does not trigger computer-vision aliases from curriculum-vitae phrasing (#899)', () => {
    const doc = buildResearchEntitySearchIndexDocument({
      _id: 'entity-comp-lit',
      name: 'Comparative Literature Program',
      departments: ['Comparative Literature'],
      fullDescription: 'Applicants should email a CV to the program coordinator to apply.',
      archived: false,
    });

    expect(doc?.studentSearchTerms ?? []).not.toEqual(
      expect.arrayContaining(['computer vision', 'image analysis', 'visual recognition']),
    );
  });

  it('does not trigger computer-vision aliases from a citation author-initials pattern (#899)', () => {
    const doc = buildResearchEntitySearchIndexDocument({
      _id: 'entity-neurology',
      name: 'Neurology Metabolism Lab',
      departments: ['Neurology'],
      fullDescription:
        'Recent publications include Mobbs CV, Yang X. Hypothalamic control of metabolism.',
      archived: false,
    });

    expect(doc?.studentSearchTerms ?? []).not.toEqual(
      expect.arrayContaining(['computer vision', 'image analysis', 'visual recognition']),
    );
  });

  it.each([
    'Our director is an economist of trade. Download CV',
    'Research on Japanese film theory. A short CV is available at my Yale profile.',
    'Health services research. The CV lists over 100 publications in medical journals.',
    'Political economy and game theory. CV | Google Scholar',
  ])(
    'does not tag a curriculum-vitae link as computer vision without vision context (#3853): %s',
    (fullDescription) => {
      const doc = buildResearchEntitySearchIndexDocument({
        _id: 'entity-cv-link',
        name: 'Fixture Faculty Research',
        departments: ['Economics'],
        fullDescription,
        archived: false,
      });

      expect(doc?.studentSearchTerms ?? []).not.toEqual(
        expect.arrayContaining(['computer vision']),
      );
    },
  );

  it.each([
    [['Radiology and Biomedical Imaging'], 'Cancer early detection research. Download CV'],
    [['Ophthalmology and Visual Science'], 'Retinal disease research. Download CV'],
    [['Internal Medicine'], 'CV imaging of heart failure and CV outcomes.'],
  ])(
    'does not let a department or a generic word corroborate a bare CV (#3853): %s',
    (departments, fullDescription) => {
      const doc = buildResearchEntitySearchIndexDocument({
        _id: 'entity-cv-generic-context',
        name: 'Fixture Faculty Research',
        departments,
        fullDescription,
        archived: false,
      });

      expect(doc?.studentSearchTerms ?? []).not.toEqual(
        expect.arrayContaining(['computer vision']),
      );
    },
  );

  it('still triggers computer-vision aliases when a lab genuinely abbreviates as CV (#899)', () => {
    const doc = buildResearchEntitySearchIndexDocument({
      _id: 'entity-real-cv',
      name: 'Vision Systems Lab',
      fullDescription:
        'Our CV group builds algorithms for object detection and scene understanding.',
      archived: false,
    });

    expect(doc?.studentSearchTerms).toEqual(
      expect.arrayContaining(['cv', 'computer vision', 'image analysis', 'visual recognition']),
    );
  });

  it('maps "computer vision" and "computational vision" as bidirectional Meili synonyms (#787)', () => {
    const { synonyms } = getResearchEntitySearchIndexSettings();

    expect(synonyms['computer vision']).toEqual(expect.arrayContaining(['computational vision']));
    expect(synonyms['computational vision']).toEqual(expect.arrayContaining(['computer vision']));
  });

  it('carries cross-domain topical synonyms so biomedical vernacular reaches canonical fields (#1463)', () => {
    const { synonyms } = getResearchEntitySearchIndexSettings();

    expect(synonyms.cancer).toEqual(expect.arrayContaining(['oncology']));
    expect(synonyms.oncology).toEqual(expect.arrayContaining(['cancer']));
    expect(synonyms.immune).toEqual(expect.arrayContaining(['immunology']));
  });

  it('keeps new cross-domain coverage on the query side and out of free-text enrichment to avoid false positives (#1463)', () => {
    const oncologyDoc = buildResearchEntitySearchIndexDocument({
      _id: 'entity-oncology',
      name: 'Tumor Immunology Program',
      researchAreas: ['Oncology'],
      archived: false,
    });
    expect(oncologyDoc?.studentSearchTerms ?? []).not.toEqual(expect.arrayContaining(['cancer']));

    const mlDoc = buildResearchEntitySearchIndexDocument({
      _id: 'entity-neural-network',
      name: 'Deep Learning Lab',
      fullDescription: 'Builds neural network architectures for image recognition.',
      archived: false,
    });
    expect(mlDoc?.studentSearchTerms ?? []).not.toEqual(
      expect.arrayContaining(['neuroscience', 'neurology', 'brain']),
    );
  });

  it('does not enrich from metaphor-prone vernacular that stays query-only (#1463)', () => {
    const doc = buildResearchEntitySearchIndexDocument({
      _id: 'entity-metaphor',
      name: 'Economic Policy Lab',
      fullDescription: 'Studies the political climate at the heart of modern democracies.',
      archived: false,
    });

    expect(doc?.studentSearchTerms ?? []).not.toEqual(
      expect.arrayContaining(['climate change', 'cardiology']),
    );
  });

  it('does not derive topic aliases from a description the sanitizer blanks (#2396)', () => {
    const doc = buildResearchEntitySearchIndexDocument({
      _id: 'entity-synthetic-metadata-description',
      name: 'Comparative Literature Program',
      departments: ['Comparative Literature'],
      fullDescription: 'Research home focused on neuroscience and psychology.',
      archived: false,
    });

    expect(doc?.fullDescription).toBe('');
    expect(doc?.studentSearchTerms ?? []).toEqual([]);
  });

  it('does not derive topic aliases from an endowed-chair title the sanitizer strips (#2396)', () => {
    const doc = buildResearchEntitySearchIndexDocument({
      _id: 'entity-endowed-chair',
      name: 'Doe Faculty Research',
      fullDescription: 'Jane Doe is the Alton Sterling Professor of Psychology at Yale.',
      archived: false,
    });

    expect(doc?.fullDescription ?? '').not.toContain('Professor of Psychology');
    expect(doc?.studentSearchTerms ?? []).not.toEqual(
      expect.arrayContaining(['psychology', 'psychiatry', 'cognitive science']),
    );
  });

  it('still derives topic aliases from copy that survives sanitization (#2396)', () => {
    const doc = buildResearchEntitySearchIndexDocument({
      _id: 'entity-surviving-copy',
      name: 'Cortical Circuits Lab',
      departments: ['Neuroscience'],
      researchAreas: ['Neuroscience'],
      fullDescription:
        'The lab records from cortical circuits in behaving mice to map how neural populations encode decisions.',
      archived: false,
    });

    expect(doc?.fullDescription).toContain('cortical circuits');
    expect(doc?.studentSearchTerms).toEqual(
      expect.arrayContaining(['neuroscience', 'neurology', 'neural', 'brain']),
    );
  });

  it('indexes a type word only for types whose label a student searches by, never the raw enum (#3942)', () => {
    const facultyRow = buildResearchEntitySearchIndexDocument({
      _id: 'entity-faculty-type-term',
      name: 'Synthetic Person Faculty Research',
      kind: 'individual',
      entityType: 'FACULTY_RESEARCH_AREA',
      shortDescription: 'Studies tidal sediment transport.',
      archived: false,
    });
    const facilityRow = buildResearchEntitySearchIndexDocument({
      _id: 'entity-core-facility-type-term',
      name: 'Synthetic Imaging Suite',
      kind: 'core_facility',
      entityType: 'CORE_FACILITY',
      archived: false,
    });

    const facultyTerms = (facultyRow?.studentSearchTerms ?? []).join(' ').toLowerCase();
    expect(facultyTerms).not.toMatch(/\b(faculty|area)\b/);
    expect(facilityRow?.studentSearchTerms).toContain('core facility');
    expect(facilityRow).toMatchObject({ kind: 'core_facility', entityType: 'CORE_FACILITY' });
  });

  it('filters unsafe URLs and direct contact text from public research entity index documents', () => {
    const doc = buildResearchEntitySearchIndexDocument({
      _id: 'entity-url-safety',
      name: 'URL Safety Lab',
      fullDescription: 'Contact pi@example.edu or 203-555-1212 for research roles.',
      shortDescription: 'Email pi@example.edu for details.',
      websiteUrl: 'javascript:alert(document.cookie)',
      website: 'https://safe.example.edu/lab',
      sourceUrls: [
        'mailto:pi@example.edu',
        'https://safe.example.edu/source',
        'javascript:alert(document.cookie)',
      ],
      archived: false,
    });

    expect(doc).toMatchObject({
      id: 'entity-url-safety',
      fullDescription: '',
      shortDescription: 'Email [email redacted] for details.',
    });
    expect(doc).not.toHaveProperty('websiteUrl');
    expect(doc).not.toHaveProperty('website');
    expect(doc).not.toHaveProperty('sourceUrls');
    expect(JSON.stringify(doc)).not.toContain('javascript:');
    expect(JSON.stringify(doc)).not.toContain('mailto:');
    expect(JSON.stringify(doc)).not.toContain('pi@example.edu');
    expect(JSON.stringify(doc)).not.toContain('203-555-1212');
  });

  it('redacts direct contact text from biography description fields stored in the index', () => {
    const doc = buildResearchEntitySearchIndexDocument({
      _id: 'entity-biography-contact',
      name: 'Biography Contact Lab',
      profileSynthesisDescription:
        'Studies synaptic plasticity. Email: someone@example.edu Phone555-010-0040Fields of interest: memory.',
      description: 'Reach the office by calling 555-010-0041.',
      archived: false,
    });

    const serialized = JSON.stringify(doc);
    expect(serialized).not.toContain('someone@example.edu');
    expect(serialized).not.toContain('555-010-0040');
    expect(serialized).not.toContain('555-010-0041');
    expect(doc).not.toHaveProperty('profileSynthesisDescription');
    expect(doc).not.toHaveProperty('description');
  });

  it('derives no match text, topic alias or rank from stored profile-synthesis prose no surface serves (#3937)', () => {
    const doc = buildResearchEntitySearchIndexDocument({
      _id: 'entity-unserved-synthesis',
      name: 'Unserved Synthesis Lab',
      shortDescription: 'Studies coastal sediment transport.',
      profileSynthesisDescription:
        'Applies machine learning to glacier imaging and hydroclimate forecasting.',
      websiteUrl: 'https://example.yale.edu/unserved-synthesis',
      archived: false,
    });

    const serialized = JSON.stringify(doc).toLowerCase();
    expect(serialized).not.toContain('glacier');
    expect(serialized).not.toContain('hydroclimate');
    expect(doc?.studentSearchTerms ?? []).not.toEqual(
      expect.arrayContaining(['artificial intelligence']),
    );
  });

  it('strips endowed-chair honorific titles from searchable description text so a chair-name term does not surface unrelated faculty (#1286)', () => {
    const doc = buildResearchEntitySearchIndexDocument({
      _id: 'entity-townsend-chair',
      name: 'Nicholas Parrillo Faculty Research',
      fullDescription:
        'Nicholas Parrillo is the William K. Townsend Professor of Law at Yale Law School.',
      archived: false,
    });

    expect(doc?.fullDescription).not.toMatch(/townsend/i);
    expect(doc?.fullDescription).toBe('Nicholas Parrillo is at Yale Law School.');
  });

  it('strips a bare "Sterling Professor of X" chair title without eating the surrounding sentence (#1286)', () => {
    const doc = buildResearchEntitySearchIndexDocument({
      _id: 'entity-sterling-chair',
      name: 'Ian Shapiro Faculty Research',
      shortDescription:
        'Ian Shapiro is Sterling Professor of Political Science and studies democracy.',
      archived: false,
    });

    expect(doc?.shortDescription).not.toMatch(/sterling/i);
    expect(doc?.shortDescription).toBe('Ian Shapiro is and studies democracy.');
  });

  it('leaves ordinary description text untouched when no chair-title boilerplate is present (#1286)', () => {
    const doc = buildResearchEntitySearchIndexDocument({
      _id: 'entity-no-chair-title',
      name: 'Genomics Lab',
      fullDescription:
        'The lab studies protein folding and works closely with the chemistry department.',
      archived: false,
    });

    expect(doc?.fullDescription).toBe(
      'The lab studies protein folding and works closely with the chemistry department.',
    );
  });

  it('exposes clone-safe settings used by the live Research browse filters', () => {
    const settings = getResearchEntitySearchIndexSettings();

    settings.filterableAttributes.push('mutated');

    expect(RESEARCH_ENTITY_SEARCH_INDEX_NAME).toBe('researchentities');
    expect(RESEARCH_ENTITY_SEARCH_INDEX_PRIMARY_KEY).toBe('id');
    expect(getResearchEntitySearchIndexSettings().filterableAttributes).toEqual(
      expect.arrayContaining([
        'archived',
        'kind',
        'school',
        'departments',
        'researchAreas',
        'hasUndergradHostingEvidence',
        'studentVisibilityTier',
      ]),
    );
    expect(getResearchEntitySearchIndexSettings().filterableAttributes).not.toContain(
      'acceptingUndergrads',
    );
    expect(getResearchEntitySearchIndexSettings().filterableAttributes).not.toContain('methods');
    const searchable = getResearchEntitySearchIndexSettings().searchableAttributes;
    expect(searchable).toEqual(expect.arrayContaining(['leadProfessorNames', 'professorNames']));
    expect(searchable).toEqual(expect.arrayContaining(['methods']));
    expect(searchable).toEqual(expect.arrayContaining(['shortDescription', 'fullDescription']));
    for (const unseenTokenField of ['websiteUrl', 'sourceUrls', 'kind', 'entityType']) {
      expect(searchable).not.toContain(unseenTokenField);
    }
    expect(searchable).not.toContain('keywords');
    expect(searchable).not.toContain('summary');
    expect(searchable).not.toContain('description');
    expect(searchable.indexOf('researchAreas')).toBeLessThan(
      searchable.indexOf('shortDescription'),
    );
    expect(searchable.indexOf('shortDescription')).toBeLessThan(
      searchable.indexOf('fullDescription'),
    );
    expect(getResearchEntitySearchIndexSettings().rankingRules).toEqual([
      'words',
      'proximity',
      'exactness',
      'typo',
      'attribute',
      'sort',
    ]);
    const rankingRules = getResearchEntitySearchIndexSettings().rankingRules;
    expect(rankingRules.indexOf('exactness')).toBeLessThan(rankingRules.indexOf('attribute'));
    expect(rankingRules.indexOf('typo')).toBeLessThan(rankingRules.indexOf('attribute'));
    expect(getResearchEntitySearchIndexSettings().typoTolerance).toMatchObject({
      minWordSizeForTypos: {
        oneTypo: 5,
        twoTypos: 9,
      },
      disableOnWords: expect.arrayContaining(['ai', 'ml', 'nlp', 'cv']),
    });
    expect(getResearchEntitySearchIndexSettings().synonyms).toMatchObject({
      ai: expect.arrayContaining(['artificial intelligence', 'machine learning']),
      cv: expect.arrayContaining(['computer vision']),
    });
    expect(getResearchEntitySearchIndexSettings().filterableAttributes).not.toContain('mutated');
    expect(getResearchEntitySearchIndexSettings().sortableAttributes).toEqual(
      expect.arrayContaining([
        'lastObservedAt',
        'name',
        'sortTitle',
        'sortTitleQualifier',
        'createdAt',
        'updatedAt',
      ]),
    );
  });

  it('raises the pagination ceiling above the Meili default so the full directory is reachable', () => {
    const settings = getResearchEntitySearchIndexSettings();

    expect(settings.pagination.maxTotalHits).toBe(RESEARCH_ENTITY_SEARCH_MAX_TOTAL_HITS);
    expect(settings.pagination.maxTotalHits).toBeGreaterThan(1000);

    settings.pagination.maxTotalHits = 1;
    expect(getResearchEntitySearchIndexSettings().pagination.maxTotalHits).toBe(
      RESEARCH_ENTITY_SEARCH_MAX_TOTAL_HITS,
    );
  });

  it('raises the facet-value ceiling above the Meili default so every department stays selectable', () => {
    const settings = getResearchEntitySearchIndexSettings();

    expect(settings.faceting.maxValuesPerFacet).toBe(RESEARCH_ENTITY_SEARCH_MAX_VALUES_PER_FACET);
    expect(settings.faceting.maxValuesPerFacet).toBeGreaterThan(100);

    settings.faceting.maxValuesPerFacet = 1;
    expect(getResearchEntitySearchIndexSettings().faceting.maxValuesPerFacet).toBe(
      RESEARCH_ENTITY_SEARCH_MAX_VALUES_PER_FACET,
    );
  });

  it('rebuilds the index in pages and applies settings before documents', async () => {
    const calls: Array<{ kind: string; payload?: unknown }> = [];
    const fakeIndex = {
      updateSettings: async (settings: unknown) => {
        calls.push({ kind: 'settings', payload: settings });
        return { taskUid: 1 };
      },
      deleteAllDocuments: async () => {
        calls.push({ kind: 'clear' });
        return { taskUid: 2 };
      },
      addDocuments: async (documents: unknown, options: unknown) => {
        calls.push({ kind: 'documents', payload: { documents, options } });
        return { taskUid: 3 };
      },
      tasks: succeedingTaskClient,
    };
    const fetchPage = async (page: number) =>
      page === 1
        ? [
            { _id: 'entity-1', name: 'Smith Lab', archived: false },
            { _id: 'entity-2', name: 'Tobin Center', archived: false },
          ]
        : [];

    const result = await rebuildResearchEntitySearchIndex({
      warmVocabulary: async () => new Set<string>(),
      pageSize: 2,
      clearExisting: true,
      getIndex: async () => fakeIndex,
      fetchPage,
    });

    expect(result).toEqual({
      indexName: RESEARCH_ENTITY_SEARCH_INDEX_NAME,
      pageSize: 2,
      fetchedDocumentCount: 2,
      indexedDocumentCount: 2,
      pageCount: 1,
      clearedExisting: true,
    });
    expect(calls.map((call) => call.kind)).toEqual(['settings', 'clear', 'documents']);
    expect(calls[2].payload).toMatchObject({
      options: { primaryKey: RESEARCH_ENTITY_SEARCH_INDEX_PRIMARY_KEY },
    });
  });

  it('configures the OpenAI text-embedding-3-small embedder for the research index', () => {
    const config = buildResearchEntitySearchEmbedderConfig('sk-test') as any;
    expect(config.default).toMatchObject({
      source: 'openAi',
      apiKey: 'sk-test',
      model: 'text-embedding-3-small',
    });
    expect(config.default.documentTemplate).toContain('{{doc.professorNames}}');
    expect(config.default.documentTemplate).toContain('{{doc.researchAreas}}');
    expect(config.default.documentTemplate).toContain('{{doc.shortDescription}}');
    expect(RESEARCH_ENTITY_SEARCH_EMBEDDER_MODEL).toBe('text-embedding-3-small');
  });

  it('guards optional fields in the embedder template so documents missing them still index', () => {
    const template = (buildResearchEntitySearchEmbedderConfig('sk-test') as any).default
      .documentTemplate as string;
    for (const field of [
      'professorNames',
      'departments',
      'researchAreas',
      'methods',
      'shortDescription',
      'fullDescription',
    ]) {
      expect(template).toContain(`{% if doc.${field} %}`);
    }
  });

  it('applies the embedder during rebuild only when OPENAI_API_KEY is present', async () => {
    const embedderCalls: any[] = [];
    const fakeIndex = {
      updateSettings: async () => ({ taskUid: 1 }),
      updateEmbedders: async (embedders: unknown) => {
        embedderCalls.push(embedders);
        return { taskUid: 2 };
      },
      deleteAllDocuments: async () => ({ taskUid: 3 }),
      addDocuments: async () => ({ taskUid: 4 }),
      tasks: succeedingTaskClient,
    };
    const fetchPage = async (page: number) =>
      page === 1 ? [{ _id: 'e1', name: 'Sample Lab', archived: false }] : [];
    const run = () =>
      rebuildResearchEntitySearchIndex({
        warmVocabulary: async () => new Set<string>(),
        pageSize: 5,
        getIndex: async () => fakeIndex as any,
        fetchPage,
        fetchMemberNames: async () => new Map(),
      });

    const prev = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'sk-test';
    await run();
    expect(embedderCalls).toHaveLength(1);
    expect(embedderCalls[0].default.model).toBe('text-embedding-3-small');

    embedderCalls.length = 0;
    delete process.env.OPENAI_API_KEY;
    await run();
    expect(embedderCalls).toHaveLength(0);

    if (prev !== undefined) process.env.OPENAI_API_KEY = prev;
    else delete process.env.OPENAI_API_KEY;
  });

  it('surfaces a failed updateEmbedders task instead of swallowing it', async () => {
    const fakeIndex = {
      updateSettings: async () => ({ taskUid: 1 }),
      updateEmbedders: async () => ({ taskUid: 2 }),
      tasks: {
        waitForTask: async (taskUid: number) =>
          taskUid === 2
            ? {
                status: 'failed',
                error: { code: 'invalid_document_fields', message: 'missing field in document' },
              }
            : { status: 'succeeded' },
      },
    };
    const prev = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'sk-test';

    await expect(
      rebuildResearchEntitySearchIndex({
        warmVocabulary: async () => new Set<string>(),
        pageSize: 5,
        getIndex: async () => fakeIndex as any,
        fetchPage: async () => [],
        fetchMemberNames: async () => new Map(),
      }),
    ).rejects.toThrow(/updateEmbedders task 2 did not succeed.*invalid_document_fields/s);

    if (prev !== undefined) process.env.OPENAI_API_KEY = prev;
    else delete process.env.OPENAI_API_KEY;
  });

  it('surfaces a failed updateSettings task instead of swallowing it', async () => {
    const fakeIndex = {
      updateSettings: async () => ({ taskUid: 1 }),
      tasks: {
        waitForTask: async () => ({ status: 'failed', error: { code: 'index_not_found' } }),
      },
    };

    await expect(
      rebuildResearchEntitySearchIndex({
        warmVocabulary: async () => new Set<string>(),
        pageSize: 5,
        getIndex: async () => fakeIndex as any,
        fetchPage: async () => [],
      }),
    ).rejects.toThrow(/updateSettings task 1 did not succeed.*index_not_found/s);
  });

  it('refuses to report a rebuild when the index client cannot confirm its tasks', async () => {
    const fakeIndex = {
      updateSettings: async () => ({ taskUid: 1 }),
      updateEmbedders: async () => ({ taskUid: 2 }),
    };
    const prev = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'sk-test';

    await expect(
      rebuildResearchEntitySearchIndex({
        warmVocabulary: async () => new Set<string>(),
        pageSize: 5,
        getIndex: async () => fakeIndex as any,
        fetchPage: async () => [],
        fetchMemberNames: async () => new Map(),
      }),
    ).rejects.toThrow(/updateSettings task 1 cannot be confirmed/);

    if (prev !== undefined) process.env.OPENAI_API_KEY = prev;
    else delete process.env.OPENAI_API_KEY;
  });

  it('enriches rebuilt research entity documents with searchable professor names', async () => {
    const entityId = '6a0567977c6d4fba869fc03d';
    const calls: Array<{ kind: string; payload?: unknown }> = [];
    const fakeIndex = {
      updateSettings: async (settings: unknown) => {
        calls.push({ kind: 'settings', payload: settings });
        return { taskUid: 1 };
      },
      addDocuments: async (documents: unknown, options: unknown) => {
        calls.push({ kind: 'documents', payload: { documents, options } });
        return { taskUid: 2 };
      },
      tasks: succeedingTaskClient,
    };

    await rebuildResearchEntitySearchIndex({
      warmVocabulary: async () => new Set<string>(),
      pageSize: 2,
      getIndex: async () => fakeIndex,
      fetchPage: async (page: number) =>
        page === 1
          ? [
              {
                _id: entityId,
                slug: 'ysm-ynn',
                name: 'Yale Clinical Neuroscience Neuroanalytics',
                archived: false,
              },
            ]
          : [],
      fetchMemberNames: async (entities: any[]) => {
        expect(entities.map((entity) => entity._id)).toEqual([entityId]);
        return new Map([
          [
            entityId,
            {
              leadProfessorNames: ['Dennis Spencer'],
              professorNames: ['Dennis Spencer', 'Example Core Faculty'],
            },
          ],
        ]);
      },
    } as any);

    const documentsCall = calls.find((call) => call.kind === 'documents');
    expect(documentsCall?.payload).toMatchObject({
      documents: [
        {
          id: entityId,
          slug: 'ysm-ynn',
          leadProfessorNames: ['Dennis Spencer'],
          professorNames: ['Dennis Spencer', 'Example Core Faculty'],
        },
      ],
      options: { primaryKey: RESEARCH_ENTITY_SEARCH_INDEX_PRIMARY_KEY },
    });
  });

  it('fails the rebuild when a document batch is accepted but its task fails (#3720)', async () => {
    const fakeIndex = {
      updateSettings: async () => ({ taskUid: 1 }),
      deleteAllDocuments: async () => ({ taskUid: 2 }),
      addDocuments: async () => ({ taskUid: 3 }),
      tasks: {
        waitForTask: async (taskUid: number) =>
          taskUid === 3
            ? { status: 'failed', error: { code: 'invalid_document_fields' } }
            : { status: 'succeeded' },
      },
    };

    const outcome = await rebuildResearchEntitySearchIndex({
      warmVocabulary: async () => new Set<string>(),
      pageSize: 5,
      clearExisting: true,
      getIndex: async () => fakeIndex as any,
      fetchPage: async (page: number) =>
        page === 1 ? [{ _id: 'e1', name: 'Sample Lab', archived: false }] : [],
      fetchMemberNames: async () => new Map(),
    }).then(
      (result) => ({ threw: false, indexed: result.indexedDocumentCount, message: '' }),
      (error: Error) => ({ threw: true, indexed: 0, message: error.message }),
    );

    expect(outcome.threw).toBe(true);
    expect(outcome.message).toMatch(
      /addDocuments task 3 did not succeed.*invalid_document_fields/s,
    );
  });

  it('fails the rebuild when clearing the index is accepted but its task fails (#3720)', async () => {
    let addDocumentsCalls = 0;
    const fakeIndex = {
      updateSettings: async () => ({ taskUid: 1 }),
      deleteAllDocuments: async () => ({ taskUid: 2 }),
      addDocuments: async () => {
        addDocumentsCalls += 1;
        return { taskUid: 3 };
      },
      tasks: {
        waitForTask: async (taskUid: number) =>
          taskUid === 2 ? { status: 'failed' } : { status: 'succeeded' },
      },
    };

    await expect(
      rebuildResearchEntitySearchIndex({
        warmVocabulary: async () => new Set<string>(),
        pageSize: 5,
        clearExisting: true,
        getIndex: async () => fakeIndex as any,
        fetchPage: async (page: number) =>
          page === 1 ? [{ _id: 'e1', name: 'Sample Lab', archived: false }] : [],
        fetchMemberNames: async () => new Map(),
      }),
    ).rejects.toThrow(/deleteAllDocuments task 2 did not succeed/);
    expect(addDocumentsCalls).toBe(0);
  });

  it('bounds each document task wait with a finite timeout', async () => {
    const timeouts: Array<number | undefined> = [];
    const fakeIndex = {
      updateSettings: async () => ({ taskUid: 1 }),
      addDocuments: async () => ({ taskUid: 3 }),
      tasks: {
        waitForTask: async (_taskUid: number, options?: { timeout?: number }) => {
          timeouts.push(options?.timeout);
          return { status: 'succeeded' };
        },
      },
    };

    await rebuildResearchEntitySearchIndex({
      warmVocabulary: async () => new Set<string>(),
      pageSize: 5,
      getIndex: async () => fakeIndex as any,
      fetchPage: async (page: number) =>
        page === 1 ? [{ _id: 'e1', name: 'Sample Lab', archived: false }] : [],
      fetchMemberNames: async () => new Map(),
    });

    expect(timeouts).toHaveLength(2);
    for (const timeout of timeouts) expect(Number.isFinite(timeout)).toBe(true);
  });

  it('rejects unsafe rebuild page sizes before configuring the index', async () => {
    let getIndexCalls = 0;

    await expect(
      rebuildResearchEntitySearchIndex({
        warmVocabulary: async () => new Set<string>(),
        pageSize: 9007199254740992,
        getIndex: async () => {
          getIndexCalls += 1;
          throw new Error('unexpected index setup');
        },
        fetchPage: async () => [],
      }),
    ).rejects.toThrow('--page-size must be a safe positive integer');

    expect(getIndexCalls).toBe(0);
  });
});

describe('isResearchEntitySearchEmbedderConfigured', () => {
  beforeEach(() => {
    invalidateResearchEntitySearchEmbedderCache();
  });

  it('returns true when the running index reports the default embedder', async () => {
    const configured = await isResearchEntitySearchEmbedderConfigured({
      getEmbedders: async () => ({ default: { source: 'openAi' } }),
    });
    expect(configured).toBe(true);
  });

  it('returns false when the running index has no embedders configured', async () => {
    const configured = await isResearchEntitySearchEmbedderConfigured({
      getEmbedders: async () => ({}),
    });
    expect(configured).toBe(false);
  });

  it('returns false when the index client does not support getEmbedders', async () => {
    const configured = await isResearchEntitySearchEmbedderConfigured({});
    expect(configured).toBe(false);
  });

  it('fails closed to false when checking the embedder throws', async () => {
    const configured = await isResearchEntitySearchEmbedderConfigured({
      getEmbedders: async () => {
        throw new Error('meili unreachable');
      },
    });
    expect(configured).toBe(false);
  });

  it('does not cache a failed embedder check, so the next request asks again', async () => {
    let calls = 0;
    const index = {
      getEmbedders: async () => {
        calls += 1;
        if (calls === 1) throw new Error('meili unreachable');
        return { default: {} };
      },
    };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      expect(await isResearchEntitySearchEmbedderConfigured(index)).toBe(false);
      expect(await isResearchEntitySearchEmbedderConfigured(index)).toBe(true);
      expect(calls).toBe(2);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('logs a failed embedder check through the sanitized logger', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await isResearchEntitySearchEmbedderConfigured({
        getEmbedders: async () => {
          throw new Error('meili unreachable at http://user:secret@meili.internal:7700');
        },
      });

      expect(consoleError).toHaveBeenCalledTimes(1);
      const logged = consoleError.mock.calls[0].map(String).join(' ');
      expect(logged).toMatch(/embedder/i);
      expect(logged).not.toContain('secret');
    } finally {
      consoleError.mockRestore();
    }
  });

  it('reports a failed embedder check as unknown rather than absent', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      expect(
        await readResearchEntitySearchEmbedderState({
          getEmbedders: async () => {
            throw new Error('meili unreachable');
          },
        }),
      ).toBe('unknown');
      expect(await readResearchEntitySearchEmbedderState({ getEmbedders: async () => ({}) })).toBe(
        'absent',
      );
      invalidateResearchEntitySearchEmbedderCache();
      expect(
        await readResearchEntitySearchEmbedderState({
          getEmbedders: async () => ({ default: {} }),
        }),
      ).toBe('configured');
    } finally {
      consoleError.mockRestore();
    }
  });

  it('caches the result until the cache is invalidated', async () => {
    let calls = 0;
    const index = {
      getEmbedders: async () => {
        calls += 1;
        return { default: {} };
      },
    };

    expect(await isResearchEntitySearchEmbedderConfigured(index)).toBe(true);
    expect(await isResearchEntitySearchEmbedderConfigured(index)).toBe(true);
    expect(calls).toBe(1);

    invalidateResearchEntitySearchEmbedderCache();
    expect(await isResearchEntitySearchEmbedderConfigured(index)).toBe(true);
    expect(calls).toBe(2);
  });
});

describe('fetchResearchEntitySearchMemberNames canonical roster projection', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    const db = mongoose.connection.db;
    if (!db) throw new Error('no db');
    for (const name of ['accounts', 'researchers', 'role_assignments']) {
      await db.collection(name).deleteMany({});
    }
  });

  const seedMember = async (
    entityId: mongoose.Types.ObjectId,
    displayName: string,
    role: string,
    state = 'CURRENT',
  ) => {
    const person = await Researcher.create({
      displayName,
      profileLinks: [],
      status: 'ACTIVE',
      archived: false,
    });
    await RoleAssignment.create({
      personId: person._id,
      target: { kind: 'RESEARCH_ENTITY', id: entityId },
      role,
      state,
      confidence: 0.9,
    });
  };

  it('derives professor and lead names from the canonical roster and excludes non-professor and historical rows', async () => {
    const entityId = new mongoose.Types.ObjectId();
    await seedMember(entityId, 'Lead Professor', 'PI');
    await seedMember(entityId, 'Core Faculty Member', 'CORE_FACULTY');
    await seedMember(entityId, 'Lab Staff', 'STAFF');
    await seedMember(entityId, 'Former Professor', 'PI', 'HISTORICAL');

    const byEntityId = await fetchResearchEntitySearchMemberNames([{ _id: entityId }]);
    const fields = byEntityId.get(entityId.toString());

    expect(fields?.leadProfessorNames).toEqual(['Lead Professor']);
    expect(fields?.professorNames).toEqual(['Lead Professor', 'Core Faculty Member']);
  });

  it('names a lead whose edge state is unknown, as the detail page serves it (#3745)', async () => {
    const entityId = new mongoose.Types.ObjectId();
    await seedMember(entityId, 'Unknown State Lead', 'PI', 'UNKNOWN');
    await seedMember(entityId, 'Unknown State Faculty', 'CORE_FACULTY', 'UNKNOWN');
    await seedMember(entityId, 'Departed Lead', 'DIRECTOR', 'HISTORICAL');

    const fields = (await fetchResearchEntitySearchMemberNames([{ _id: entityId }])).get(
      entityId.toString(),
    );

    expect(fields?.leadProfessorNames).toEqual(['Unknown State Lead']);
    expect(fields?.professorNames).toEqual(['Unknown State Lead', 'Unknown State Faculty']);
  });

  it('withholds an official-roster lead the detail page drops as stale (#3745)', async () => {
    const entityId = new mongoose.Types.ObjectId();
    const person = await Researcher.create({
      displayName: 'Stale Roster Lead',
      profileLinks: [],
      status: 'ACTIVE',
      archived: false,
    });
    await RoleAssignment.create({
      personId: person._id,
      target: { kind: 'RESEARCH_ENTITY', id: entityId },
      role: 'PI',
      state: 'UNKNOWN',
      confidence: 0.9,
      rosterProvenance: {
        sourceName: 'official-research-home-roster',
        evidenceStatus: 'verified',
        membershipKey: 'roster-key',
        sourceUrl: 'https://example.org/people',
        observedAt: new Date('2020-01-01T00:00:00Z'),
        freshnessExpiresAt: new Date('2020-02-01T00:00:00Z'),
      },
    });

    const byEntityId = await fetchResearchEntitySearchMemberNames([{ _id: entityId }]);

    expect(byEntityId.get(entityId.toString())).toBeUndefined();
  });
});

describe('rebuildResearchEntitySearchIndex archived exclusion', () => {
  let replSet: MongoMemoryReplSet;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet?.stop();
  });

  beforeEach(async () => {
    await ResearchEntity.deleteMany({});
  });

  const collectIndexedIds = async () => {
    const indexedIds: string[] = [];
    const fakeIndex = {
      updateSettings: async () => ({ taskUid: 1 }),
      deleteAllDocuments: async () => ({ taskUid: 2 }),
      addDocuments: async (documents: Array<{ id: string }>) => {
        for (const document of documents) indexedIds.push(document.id);
        return { taskUid: 3 };
      },
      tasks: succeedingTaskClient,
    };
    await rebuildResearchEntitySearchIndex({
      warmVocabulary: async () => new Set<string>(),
      pageSize: 50,
      clearExisting: true,
      getIndex: async () => fakeIndex as any,
      fetchMemberNames: async () => new Map(),
    });
    return indexedIds;
  };

  it('excludes dedupe-archived entities from the rebuilt index payload', async () => {
    const active = await ResearchEntity.create({ slug: 'active-lab', name: 'Active Lab' });
    const explicitlyLive = await ResearchEntity.create({
      slug: 'live-lab',
      name: 'Live Lab',
      archived: false,
    });
    await ResearchEntity.create({
      slug: 'archived-shell',
      name: 'Archived Shell',
      archived: true,
    });

    const indexedIds = await collectIndexedIds();

    expect(indexedIds).toEqual(
      expect.arrayContaining([active._id.toString(), explicitlyLive._id.toString()]),
    );
    expect(indexedIds).toHaveLength(2);
  });
});

describe('indexed title equals the served title (#2701 vocabulary, search relevance)', () => {
  it('strips the synthesized Faculty Research suffix from the indexed name', () => {
    const doc = buildResearchEntitySearchIndexDocument({
      _id: '000000000000000000000001',
      name: 'Fixture Scholar Faculty Research',
      entityType: 'FACULTY_RESEARCH_AREA',
    });

    expect(doc?.name).toBe('Fixture Scholar');
  });

  it('normalizes displayName too, because it is also searchable', () => {
    const doc = buildResearchEntitySearchIndexDocument({
      _id: '000000000000000000000002',
      name: 'Fixture Scholar Faculty Research',
      displayName: 'Fixture Scholar Faculty Research',
      entityType: 'FACULTY_RESEARCH_AREA',
    });

    expect(doc?.displayName).toBe('Fixture Scholar');
  });

  it('leaves a real lab name untouched', () => {
    const doc = buildResearchEntitySearchIndexDocument({
      _id: '000000000000000000000003',
      name: 'Fixture Scholar Lab',
      entityType: 'LAB',
    });

    expect(doc?.name).toBe('Fixture Scholar Lab');
  });

  it('leaves a centre whose own name ends in Research untouched', () => {
    const doc = buildResearchEntitySearchIndexDocument({
      _id: '000000000000000000000004',
      name: 'Fixture Centre for Cancer Research',
      entityType: 'CENTER',
    });

    expect(doc?.name).toBe('Fixture Centre for Cancer Research');
  });

  it('never empties the indexed name', () => {
    const doc = buildResearchEntitySearchIndexDocument({
      _id: '000000000000000000000005',
      name: 'Research',
      entityType: 'FACULTY_RESEARCH_AREA',
    });

    expect(doc?.name).toBe('Research');
  });
});

describe('first-person revoice parity with the detail path (#3418)', () => {
  it('indexes the third-person copy a student is shown, not the harvested first person', () => {
    const doc = buildResearchEntitySearchIndexDocument({
      _id: '6a0000000000000000000001',
      slug: 'faculty-row',
      name: 'Ada Lovelace Faculty Research',
      entityType: 'FACULTY_RESEARCH_AREA',
      kind: 'individual',
      researchAreas: ['Numerical Analysis'],
      fullDescription:
        'Most recently, I have been heavily involved in allocation policy. During my career, I have been extensively involved in clinical research.',
      shortDescription: 'My research interests focus on pain care.',
    } as any);
    expect(doc?.fullDescription).toBe(
      'Most recently, Ada Lovelace has been heavily involved in allocation policy. During their career, Lovelace has been extensively involved in clinical research.',
    );
    expect(doc?.shortDescription).toBe("Ada Lovelace's research interests focus on pain care.");
    expect(doc?.fullDescription).not.toMatch(/\bI have\b/);
    expect(doc?.shortDescription).not.toMatch(/\bMy\b/);
  });

  it('gives a lab its own name in the indexed copy', () => {
    const doc = buildResearchEntitySearchIndexDocument({
      _id: '6a0000000000000000000002',
      slug: 'lab-row',
      name: 'Lovelace Lab',
      entityType: 'LAB',
      kind: 'lab',
      researchAreas: ['Cytokinesis'],
      fullDescription: 'Our goal is to map cytokinesis.',
    } as any);
    expect(doc?.fullDescription).toBe("The Lovelace Lab's goal is to map cytokinesis.");
  });

  it('is idempotent, so a description already revoiced upstream is unchanged', () => {
    const already = "Ada Lovelace's research interests focus on pain care.";
    const doc = buildResearchEntitySearchIndexDocument({
      _id: '6a0000000000000000000003',
      slug: 'already-revoiced',
      name: 'Ada Lovelace Faculty Research',
      entityType: 'FACULTY_RESEARCH_AREA',
      kind: 'individual',
      shortDescription: already,
    } as any);
    expect(doc?.shortDescription).toBe(already);
  });
});

describe('index document field allowlist (#3944)', () => {
  const bookkeepingRow = () => ({
    _id: new mongoose.Types.ObjectId('64b7f0c2a1b2c3d4e5f60718'),
    __v: 3,
    slug: 'allowlist-fixture-lab',
    name: 'Allowlist Fixture Lab',
    kind: 'lab',
    entityType: 'LAB',
    archived: false,
    school: 'School of Public Health',
    departments: ['Epidemiology'],
    researchAreas: ['Genetics', 'China'],
    shortDescription: 'Studies how inherited variation shapes disease risk.',
    studentVisibilityTier: 'student_ready',
    browseRankScore: 12,
    fieldProvenance: {
      researchAreas: {
        sourceName: 'ysm-mesh-keyword',
        sourceUrl: 'https://ysph.yale.edu/profile/allowlist-fixture/',
      },
    },
    recentGrants: [{ id: 'award-allowlist', agency: 'NIH', title: 'Synthetic award' }],
    sourceLinkHealth: [{ url: 'https://example.yale.edu/allowlist', healthStatus: 'OK' }],
    confidenceByField: { researchAreas: 0.9 },
    manuallyLockedFields: ['name'],
    fieldLockProvenance: { name: { lockedBy: 'operator' } },
    studentVisibilityReasons: ['synthetic reason'],
    accessAcceptanceLevel: 'high',
    departmentIds: ['dept-1'],
    researchAreaIds: ['area-1'],
    openness: 'open',
    profileSynthesisDescription: 'A synthetic synthesis paragraph.',
    embedding: [0.1, 0.2],
  });

  it('indexes only allowlisted fields, dropping provenance, operator bookkeeping and retired fields', () => {
    const doc = buildResearchEntitySearchIndexDocument(bookkeepingRow());

    expect(doc).not.toBeNull();
    for (const key of Object.keys(doc as Record<string, unknown>)) {
      expect(RESEARCH_ENTITY_SEARCH_INDEX_DOCUMENT_FIELDS).toContain(key);
    }
    for (const dropped of [
      '_id',
      '__v',
      'fieldProvenance',
      'recentGrants',
      'sourceLinkHealth',
      'confidenceByField',
      'manuallyLockedFields',
      'fieldLockProvenance',
      'studentVisibilityReasons',
      'accessAcceptanceLevel',
      'departmentIds',
      'researchAreaIds',
      'openness',
      'profileSynthesisDescription',
      'embedding',
    ]) {
      expect(doc).not.toHaveProperty(dropped);
    }
    expect(doc).toMatchObject({
      id: '64b7f0c2a1b2c3d4e5f60718',
      slug: 'allowlist-fixture-lab',
      studentVisibilityTier: 'student_ready',
      browseRankScore: 12,
      departments: ['Epidemiology'],
    });
  });

  it('still consults provenance while building, though provenance is not indexed', () => {
    const doc = buildResearchEntitySearchIndexDocument(bookkeepingRow());

    expect(doc?.researchAreas).toEqual(['Genetics']);
    expect(doc).not.toHaveProperty('fieldProvenance');
  });

  it('allowlists every attribute the index settings search, filter or sort on', () => {
    const settings = getResearchEntitySearchIndexSettings();
    for (const attribute of [
      RESEARCH_ENTITY_SEARCH_INDEX_PRIMARY_KEY,
      ...settings.searchableAttributes,
      ...settings.filterableAttributes,
      ...settings.sortableAttributes,
    ]) {
      expect(RESEARCH_ENTITY_SEARCH_INDEX_DOCUMENT_FIELDS).toContain(attribute);
    }
  });

  it('allowlists every field the embedder template renders and every field an index reader retrieves', () => {
    const template =
      buildResearchEntitySearchEmbedderConfig('synthetic-key').default.documentTemplate;
    const templateFields = Array.from(template.matchAll(/doc\.([A-Za-z_]+)/g), (match) => match[1]);

    expect(templateFields.length).toBeGreaterThan(0);
    for (const field of [
      ...templateFields,
      ...RESEARCH_SEARCH_RELEVANCE_TEXT_FIELDS,
      'slug',
      'departments',
      'researchAreas',
      'leadProfessorNames',
      'professorNames',
      'studentVisibilityTier',
      'sortTitle',
      'sortTitleQualifier',
    ]) {
      expect(RESEARCH_ENTITY_SEARCH_INDEX_DOCUMENT_FIELDS).toContain(field);
    }
  });
});
