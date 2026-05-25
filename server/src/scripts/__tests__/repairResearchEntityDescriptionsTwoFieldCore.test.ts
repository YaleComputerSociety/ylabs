import { describe, expect, it } from 'vitest';
import {
  buildTwoFieldDescriptionRepair,
  shortDescriptionFromFullDescription,
} from '../repairResearchEntityDescriptionsTwoFieldCore';

describe('repairResearchEntityDescriptionsTwoFieldCore', () => {
  it('moves legacy description into fullDescription and derives concise shortDescription', () => {
    const repair = buildTwoFieldDescriptionRepair({
      slug: 'entity-1',
      name: 'Decision Lab',
      description:
        'The Decision Lab studies how people make choices under uncertainty. Projects use behavioral experiments, computational models, and longitudinal data to understand learning and risk.',
      shortDescription: '',
      fullDescription: '',
      departments: ['Psychology'],
      researchAreas: ['decision-making'],
    });

    expect(repair.update).toMatchObject({
      fullDescription:
        'The Decision Lab studies how people make choices under uncertainty. Projects use behavioral experiments, computational models, and longitudinal data to understand learning and risk.',
      shortDescription:
        'The Decision Lab studies how people make choices under uncertainty.',
      description: '',
    });
    expect(repair.reasons).toEqual(
      expect.arrayContaining([
        'copied-description-to-fullDescription',
        'generated-shortDescription',
        'cleared-legacy-description',
      ]),
    );
  });

  it('clears duplicated shortDescription when no evidence-backed summary can be derived', () => {
    const repair = buildTwoFieldDescriptionRepair({
      slug: 'entity-2',
      name: 'Topology Lab',
      description: 'Topology and geometry.',
      shortDescription: 'Topology and geometry.',
      fullDescription: 'Topology and geometry.',
      departments: ['Mathematics'],
      researchAreas: ['topology', 'geometry'],
    });

    expect(repair.update.shortDescription).toBe('');
    expect(repair.update).not.toHaveProperty('fullDescription');
  });

  it('does not create metadata-only descriptions when no real description fields exist', () => {
    const repair = buildTwoFieldDescriptionRepair({
      slug: 'entity-3',
      name: 'Archive Research Group',
      description: '',
      shortDescription: '',
      fullDescription: '',
      departments: ['History'],
      researchAreas: ['archival research', 'digital humanities'],
      school: 'Faculty of Arts and Sciences',
      sourceUrls: ['https://research.example.test/archive-group'],
    });

    expect(repair.update).toEqual({});
    expect(repair.reasons).not.toContain('generated-synthesized-fullDescription');
    expect(repair.reasons).not.toContain('generated-shortDescription');
  });

  it('does not copy raw profile synthesis biography blobs into fullDescription', () => {
    const repair = buildTwoFieldDescriptionRepair({
      slug: 'dudley-kdudley',
      name: 'Kathryn Dudley — Research',
      shortDescription: '',
      fullDescription: '',
      profileSynthesisDescription:
        'Questions about what ethnography is and does—as an aesthetic genre, political practice, and interpersonal field of knowledge construction—are at the center of my teaching and scholarly work. My books explore the production of embodied knowledge and social trauma under regimes of labor marginalized by transformations in global capitalism. My current research tracks the unfolding impact of federal policy, anthropogenic climate change, and industrial resource extraction on wild horses on America’s public lands. Among other honors, I received the Margaret Mead Award.',
      profileBio:
        'Questions about what ethnography is and does—as an aesthetic genre, political practice, and interpersonal field of knowledge construction—are at the center of my teaching and scholarly work. My books explore the production of embodied knowledge and social trauma under regimes of labor marginalized by transformations in global capitalism. My current research tracks the unfolding impact of federal policy, anthropogenic climate change, and industrial resource extraction on wild horses on America’s public lands. Among other honors, I received the Margaret Mead Award.',
    });

    expect(repair.update).toEqual({});
    expect(repair.reasons).not.toContain('copied-profileSynthesisDescription-to-fullDescription');
  });

  it('copies concise research-focused profile synthesis when it is safe as a public description', () => {
    const repair = buildTwoFieldDescriptionRepair({
      slug: 'schott-pks4',
      name: 'Peter Schott — Research',
      shortDescription: '',
      fullDescription: '',
      profileSynthesisDescription:
        'Peter Schott’s research focuses on how firms and workers respond to globalization. His recent projects examine manufacturing employment, export quality, and the relationship between trade policy and firm productivity.',
    });

    expect(repair.update.fullDescription).toBe(
      'Peter Schott’s research focuses on how firms and workers respond to globalization. His recent projects examine manufacturing employment, export quality, and the relationship between trade policy and firm productivity.',
    );
    expect(repair.update.shortDescription).toBe(
      'Peter Schott’s research focuses on how firms and workers respond to globalization.',
    );
    expect(repair.reasons).toContain('copied-profileSynthesisDescription-to-fullDescription');
  });

  it('does not copy profile synthesis that mixes research with publication biography', () => {
    const repair = buildTwoFieldDescriptionRepair({
      slug: 'inwood-bi35',
      name: 'Brad Inwood — Research',
      shortDescription: '',
      fullDescription: '',
      profileSynthesisDescription:
        'His research has always focused on ancient philosophy, especially in the Hellenistic and Presocratic periods. Major works include Ethics and Human Action in Early Stoicism, The Poem of Empedocles, Reading Seneca: Stoic Philosophy at Rome, Seneca: Selected Philosophical Letters, and Ethics After Aristotle. From 2007 to 2015 he was the editor of Oxford Studies in Ancient Philosophy and he has recently published Later Stoicism 155 BC to AD 200: An Introduction and Collection of Sources in Translation for Cambridge University Press.',
    });

    expect(repair.update).toEqual({});
    expect(repair.reasons).not.toContain('copied-profileSynthesisDescription-to-fullDescription');
  });

  it('does not synthesize placeholder descriptions without source or profile evidence', () => {
    const repair = buildTwoFieldDescriptionRepair({
      slug: 'placeholder-lab-aek58',
      name: 'Placeholder Lab',
      description: '',
      shortDescription: '',
      fullDescription: '',
      departments: [],
      researchAreas: [],
      sourceUrls: [],
    });

    expect(repair.update).toEqual({});
    expect(repair.reasons).not.toContain('generated-synthesized-fullDescription');
    expect(repair.reasons).not.toContain('generated-shortDescription');
  });

  it('keeps shortDescription to at most two sentences', () => {
    expect(
      shortDescriptionFromFullDescription(
        'First sentence. Second sentence. Third sentence. Fourth sentence.',
        { name: 'Example Lab', researchAreas: [] },
      ),
    ).toBe('First sentence. Second sentence.');
  });

  it('replaces weak lead-sentence short descriptions with browsing copy from richer full text', () => {
    const repair = buildTwoFieldDescriptionRepair({
      slug: 'dept-psych-social-learning',
      name: 'Social Learning Lab',
      description: '',
      shortDescription: 'My lab focuses on intergroup social cognition.',
      fullDescription:
        'My lab focuses on intergroup social cognition. Humans are perhaps the most social species on the planet. What are the origins of this pervasive psychological tendency? My lab addresses this question by studying how knowledge of social groups is acquired, both in cognitively mature adults and in the developing minds of children. We employ experimental and cross-cultural methodologies to gain purchase on these questions.',
      departments: ['Psychology'],
      researchAreas: [],
    });

    expect(repair.update.shortDescription).toBe(
      'The lab studies how knowledge of social groups is acquired, both in cognitively mature adults and in the developing minds of children. The lab uses experimental and cross-cultural methodologies to study these questions.',
    );
    expect(repair.reasons).toContain('replaced-weak-shortDescription');
  });

  it('replaces synthetic department placeholders with profile research terms', () => {
    const repair = buildTwoFieldDescriptionRepair({
      slug: 'ysm-synapse-signals',
      name: 'Synapse Signals Lab',
      description: '',
      shortDescription: 'Research home connected to Neurology.',
      fullDescription:
        'Synapse Signals Lab is a Yale research home connected to Neurology.',
      departments: ['Neurology'],
      researchAreas: [],
      repairWeakPlaceholders: true,
      profileResearchAreas: [
        'Neuroscience and Neuropharmacology Research',
        'Epilepsy research and treatment',
        'Synaptic Transmission',
      ],
    });

    expect(repair.update.shortDescription).toBe(
      'Research connected to neuroscience and neuropharmacology, epilepsy, and synaptic transmission.',
    );
    expect(repair.update.fullDescription).toBe(
      'Synapse Signals Lab is connected to neuroscience and neuropharmacology, epilepsy, and synaptic transmission. This profile-derived summary should be checked against the linked official sources before outreach.',
    );
    expect(repair.reasons).toContain('replaced-weak-shortDescription');
    expect(repair.reasons).toContain('replaced-weak-fullDescription');
  });

  it('uses a research-focused profile bio sentence before topic fallback', () => {
    const repair = buildTwoFieldDescriptionRepair({
      slug: 'dept-econ-public-reporting',
      name: 'Public Reporting Lab',
      description: '',
      shortDescription: 'Research home connected to Economics.',
      fullDescription:
        'Public Reporting Lab is a Yale research home connected to Economics.',
      departments: ['Economics'],
      repairWeakPlaceholders: true,
      profileBio:
        'Avery studies the role of reporting regulation and transparency in the social and public sectors, with an emphasis on business ethics. They teach accounting.',
    });

    expect(repair.update.shortDescription).toBe(
      'Avery studies the role of reporting regulation and transparency in the social and public sectors, with an emphasis on business ethics.',
    );
  });

  it('clears weak placeholder fields when no richer research evidence is available', () => {
    const repair = buildTwoFieldDescriptionRepair({
      slug: 'dept-mcdb-cytoskeleton-methods',
      name: 'Cytoskeleton Methods Lab',
      description: '',
      shortDescription: 'Research home connected to Molecular, Cellular & Developmental Biology.',
      fullDescription:
        'Cytoskeleton Methods Lab is a Yale research home connected to Molecular, Cellular & Developmental Biology.',
      departments: ['Molecular, Cellular & Developmental Biology'],
      repairWeakPlaceholders: true,
    });

    expect(repair.update).toMatchObject({
      shortDescription: '',
      fullDescription: '',
    });
    expect(repair.reasons).toEqual(
      expect.arrayContaining(['cleared-weak-shortDescription', 'cleared-weak-fullDescription']),
    );
  });

  it('does not replace weak placeholders with administrative profile biography text', () => {
    const repair = buildTwoFieldDescriptionRepair({
      slug: 'dept-econ-governance-economics',
      name: 'Governance Economics Lab',
      description: '',
      shortDescription: 'Research home connected to Economics.',
      fullDescription:
        'Governance Economics Lab is a Yale research home connected to Economics.',
      departments: ['Economics'],
      repairWeakPlaceholders: true,
      profileBio:
        'At Example University they served as director of the Example Center for Research in Economics for several years and chaired multiple faculty committees.',
    });

    expect(repair.update.shortDescription).toBe('');
    expect(repair.update.fullDescription).toBe('');
  });

  it('does not replace weak placeholders with CV residue before a research sentence', () => {
    const repair = buildTwoFieldDescriptionRepair({
      slug: 'dept-econ-macro-frictions',
      name: 'Macro Frictions Lab',
      description: '',
      shortDescription: 'Research home connected to Economics.',
      fullDescription: 'Macro Frictions Lab is a Yale research home connected to Economics.',
      departments: ['Economics'],
      repairWeakPlaceholders: true,
      profileBio:
        ', Economics, Example University, 2015 Morgan Lee is a macroeconomist whose research focuses on the role of information and financial frictions in shaping aggregate fluctuations.',
    });

    expect(repair.update.shortDescription).toBe('');
    expect(repair.update.fullDescription).toBe('');
  });

  it('chooses explicit research sentences over teaching and appointment biography text', () => {
    const repair = buildTwoFieldDescriptionRepair({
      slug: 'lin-pl98',
      name: 'Pauline Lin — Research',
      description: '',
      shortDescription: 'Research home connected to EALL - East Asian Languages & Literatures and .',
      fullDescription:
        'Pauline Lin — Research is a Yale research home connected to EALL - East Asian Languages & Literatures and .',
      departments: ['EALL - East Asian Languages & Literatures'],
      repairWeakPlaceholders: true,
      profileBio:
        'Here at Yale, I teach classical Chinese and courses that challenge me to explore new research tools. Prior to returning to Yale, I was Assistant Professor of East Asian Studies. My own research focuses on Early Medieval Chinese Literature and Art.',
    });

    expect(repair.update.shortDescription).toBe(
      'The research focuses on Early Medieval Chinese Literature and Art.',
    );
  });

  it('does not use appointment-only or publication-list biography sentences', () => {
    const appointment = buildTwoFieldDescriptionRepair({
      slug: 'almeling-ra354',
      name: 'Rene Almeling — Research',
      description: '',
      shortDescription: 'Research home connected to Sociology.',
      fullDescription: 'Rene Almeling — Research is a Yale research home connected to Sociology.',
      repairWeakPlaceholders: true,
      profileBio:
        'Professor of Sociology, History of Medicine, American Studies, and Public Health. Associate Professor Tenure, Social and Behavioral Sciences.',
    });
    const publications = buildTwoFieldDescriptionRepair({
      slug: 'bakker-eb342',
      name: 'Egbert Bakker — Research',
      description: '',
      shortDescription: 'Research home connected to Classics.',
      fullDescription: 'Egbert Bakker — Research is a Yale research home connected to Classics.',
      repairWeakPlaceholders: true,
      profileBio:
        'His recent books include Authorship and Greek Song. His commentary on Book 9 of the Odyssey will be published in February 2025.',
    });

    expect(appointment.update.shortDescription).toBe('');
    expect(publications.update.shortDescription).toBe('');
  });
});
