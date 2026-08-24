import { describe, it, expect } from 'vitest';
import {
  collectDescriptionCandidates,
  selectResearchHomeDescription,
} from '../researchHomeDescriptionSelection';

const LAB_RESEARCH_BLOCK =
  'The Marlowe Lab studies how coastal wetlands store carbon and how tidal cycles reshape sediment chemistry. We combine field sampling, stable-isotope analysis, and numerical models to understand how these ecosystems respond to rising seas.';

const PI_BIO_RESEARCH_BLOCK =
  'Professor Ada Marlowe is a coastal ecologist at a New England university. Her research examines carbon storage in tidal wetlands and the chemistry of estuary sediments, combining fieldwork with numerical modeling.';

const ADMIN_CV_BLOCK =
  'Dr. Ada Marlowe earned her doctorate from a midwestern university and joined the faculty in 2009. She served as department chair from 2015 to 2020 and has received several awards for teaching and mentoring throughout her career.';

const BOILERPLATE_BLOCK =
  'Welcome to the homepage of the Marlowe Lab. Here you will find information about our team, recent news, publications, and opportunities to get involved. Please use the navigation menu to explore the site.';

const LAB_DNA_REPAIR_BLOCK =
  'Our lab studies how tumor cells evade DNA repair and how gene editing can restore normal repair pathways. We combine mouse models, CRISPR screens, and single-cell sequencing to map these mechanisms across cancer types.';

const CREDENTIAL_PROFESSION_BIO =
  'Radiation oncologist Alex Rivera, MD, PhD, is the chair of the therapeutic radiology department. ' +
  '"When patients undergo radiotherapy, it can be a difficult time for them and their families," he says. ' +
  '"We take great pride in giving our physicians the best tools," he says. ' +
  'Dr. Rivera researches new therapeutic strategies for treating cancer and the role of altered DNA repair in tumor progression.';

const CREDENTIAL_NAME_VERB_BIO =
  'Sam Ortega, MD, PhD, is a cardio-oncologist and associate professor of medicine. ' +
  "Ortega's research focuses on the structure of skin proteins and how inherited mutations drive inflammatory skin disease across patient populations.";

const MIDDLE_INITIAL_CREDENTIAL_BIO =
  'Carrie A. Redlich, MD, is an occupational and environmental medicine specialist who focuses on ' +
  'diagnosing and treating lung diseases related to environmental and workplace exposures.';

const BIOGRAPHICAL_VERB_BIO =
  'Jordan Ellis obtained a medical degree abroad and now investigates how blood flow in the brain changes during stroke recovery and rehabilitation across a range of patient populations.';

const CAPITALIZED_TOPIC_ORG_LEAD =
  'Long COVID is a pressing public health issue affecting millions of Americans. Our research focuses on the mechanisms that damage the nervous system after infection and how they might be reversed.';

describe('collectDescriptionCandidates', () => {
  it('drops blocks below the minimum length and deduplicates case-insensitively', () => {
    const candidates = collectDescriptionCandidates([
      'Too short.',
      LAB_RESEARCH_BLOCK,
      LAB_RESEARCH_BLOCK.toUpperCase(),
      '   ',
      42,
    ]);

    expect(candidates).toEqual([LAB_RESEARCH_BLOCK]);
  });
});

describe('selectResearchHomeDescription', () => {
  it('prefers the lab research block over a PI bio for an organization', () => {
    expect(
      selectResearchHomeDescription([PI_BIO_RESEARCH_BLOCK, LAB_RESEARCH_BLOCK], {
        kind: 'organization',
      }),
    ).toBe(LAB_RESEARCH_BLOCK);
  });

  it('keeps preferring the lab research block even when the bio appears first', () => {
    expect(
      selectResearchHomeDescription([LAB_RESEARCH_BLOCK, PI_BIO_RESEARCH_BLOCK], {
        kind: 'organization',
      }),
    ).toBe(LAB_RESEARCH_BLOCK);
  });

  it('drops administrative CV text and selects the research block', () => {
    expect(
      selectResearchHomeDescription([ADMIN_CV_BLOCK, LAB_RESEARCH_BLOCK], {
        kind: 'organization',
      }),
    ).toBe(LAB_RESEARCH_BLOCK);
  });

  it('returns null when only boilerplate and administrative CV are available', () => {
    expect(
      selectResearchHomeDescription([BOILERPLATE_BLOCK, ADMIN_CV_BLOCK], { kind: 'organization' }),
    ).toBeNull();
  });

  it('keeps a research-focused bio and drops administrative CV for a person entity', () => {
    expect(
      selectResearchHomeDescription([ADMIN_CV_BLOCK, PI_BIO_RESEARCH_BLOCK], { kind: 'person' }),
    ).toBe(PI_BIO_RESEARCH_BLOCK);
  });

  it('does not penalize a person-centric bio when the entity is a person', () => {
    expect(selectResearchHomeDescription([PI_BIO_RESEARCH_BLOCK], { kind: 'person' })).toBe(
      PI_BIO_RESEARCH_BLOCK,
    );
  });

  it('defaults to organization handling when no kind is provided', () => {
    expect(selectResearchHomeDescription([PI_BIO_RESEARCH_BLOCK, LAB_RESEARCH_BLOCK])).toBe(
      LAB_RESEARCH_BLOCK,
    );
  });

  it('never selects a candidate carrying raw HTML citation markup (#909)', () => {
    const CITATION_MARKUP_BLOCK =
      'Doe A, Roe B, <span data-id="10001">Ng A</span>, ' +
      '<strong data-id="20002">Park M</strong>. ' +
      '<span data-type="title">Bridging the gap between structure and function in tidal systems.</span>';
    expect(
      selectResearchHomeDescription([CITATION_MARKUP_BLOCK], { kind: 'organization' }),
    ).toBeNull();
    expect(selectResearchHomeDescription([CITATION_MARKUP_BLOCK, LAB_RESEARCH_BLOCK])).toBe(
      LAB_RESEARCH_BLOCK,
    );
  });

  it('rejects a credentialed clinical bio in favor of the lab research block (#919)', () => {
    expect(
      selectResearchHomeDescription([CREDENTIAL_PROFESSION_BIO, LAB_DNA_REPAIR_BLOCK], {
        kind: 'organization',
      }),
    ).toBe(LAB_DNA_REPAIR_BLOCK);
  });

  it('rejects a name-plus-credentials profile lead in favor of the lab research block (#919)', () => {
    expect(
      selectResearchHomeDescription([CREDENTIAL_NAME_VERB_BIO, LAB_DNA_REPAIR_BLOCK], {
        kind: 'organization',
      }),
    ).toBe(LAB_DNA_REPAIR_BLOCK);
  });

  it('rejects a biographical-verb profile lead in favor of the lab research block (#919)', () => {
    expect(
      selectResearchHomeDescription([BIOGRAPHICAL_VERB_BIO, LAB_DNA_REPAIR_BLOCK], {
        kind: 'organization',
      }),
    ).toBe(LAB_DNA_REPAIR_BLOCK);
  });

  it('fails closed to null when a high-confidence clinical bio is the only candidate (#919)', () => {
    expect(
      selectResearchHomeDescription([CREDENTIAL_PROFESSION_BIO], { kind: 'organization' }),
    ).toBeNull();
    expect(
      selectResearchHomeDescription([CREDENTIAL_NAME_VERB_BIO], { kind: 'organization' }),
    ).toBeNull();
  });

  it('rejects a credential-name lead with a middle initial in favor of the lab research block (#1040)', () => {
    expect(
      selectResearchHomeDescription([MIDDLE_INITIAL_CREDENTIAL_BIO, LAB_DNA_REPAIR_BLOCK], {
        kind: 'organization',
      }),
    ).toBe(LAB_DNA_REPAIR_BLOCK);
    expect(
      selectResearchHomeDescription([MIDDLE_INITIAL_CREDENTIAL_BIO], { kind: 'organization' }),
    ).toBeNull();
  });

  it('rejects a possessive-pronoun lead in favor of the lab research block (#1040)', () => {
    const POSSESSIVE_PRONOUN_LEAD_BIO =
      'His surgical practice focuses on the treatment of benign and malignant tumors of the head and ' +
      'neck. He was an early adopter of trans-oral robotic surgery.';
    expect(
      selectResearchHomeDescription([POSSESSIVE_PRONOUN_LEAD_BIO, LAB_DNA_REPAIR_BLOCK], {
        kind: 'organization',
      }),
    ).toBe(LAB_DNA_REPAIR_BLOCK);
    expect(
      selectResearchHomeDescription([POSSESSIVE_PRONOUN_LEAD_BIO], { kind: 'organization' }),
    ).toBeNull();
  });

  it('rejects a single first-name degree-earned narrative in favor of the lab research block (#1040)', () => {
    const DEGREE_EARNED_NARRATIVE_BIO =
      'Jamie received a B.S.E. in Electrical Engineering from a state university and a Ph.D. in ' +
      'Computational Neuroscience from another university. As a graduate student, Jamie studied ' +
      'sensory processing in insects.';
    expect(
      selectResearchHomeDescription([DEGREE_EARNED_NARRATIVE_BIO, LAB_DNA_REPAIR_BLOCK], {
        kind: 'organization',
      }),
    ).toBe(LAB_DNA_REPAIR_BLOCK);
    expect(
      selectResearchHomeDescription([DEGREE_EARNED_NARRATIVE_BIO], { kind: 'organization' }),
    ).toBeNull();
  });

  it('rejects a high-confidence bio buried after an organization-voice lead word (#1040)', () => {
    const PI_LABEL_BIO_WITH_ORG_VOICE_LEAD =
      'The PI, Dr. Jun Deng is a Professor at the Department of Therapeutic Radiology of Yale ' +
      'University School of Medicine. Dr. Deng obtained his PhD from a state university in 1998 ' +
      'and finished his postdoctoral fellowship at another university in 2001.';
    expect(
      selectResearchHomeDescription([PI_LABEL_BIO_WITH_ORG_VOICE_LEAD, LAB_DNA_REPAIR_BLOCK], {
        kind: 'organization',
      }),
    ).toBe(LAB_DNA_REPAIR_BLOCK);
    expect(
      selectResearchHomeDescription([PI_LABEL_BIO_WITH_ORG_VOICE_LEAD], { kind: 'organization' }),
    ).toBeNull();
  });

  it('rejects a title-clause lead into a Dr./Prof. name in favor of the lab research block (#1040)', () => {
    const TITLE_CLAUSE_THEN_NAME_BIO =
      "As an associate professor of pediatrics at Yale School of Medicine, Dr. Bakshi's research " +
      'focuses on understanding chronic pain in sickle cell disease.';
    expect(
      selectResearchHomeDescription([TITLE_CLAUSE_THEN_NAME_BIO, LAB_DNA_REPAIR_BLOCK], {
        kind: 'organization',
      }),
    ).toBe(LAB_DNA_REPAIR_BLOCK);
    expect(
      selectResearchHomeDescription([TITLE_CLAUSE_THEN_NAME_BIO], { kind: 'organization' }),
    ).toBeNull();
  });

  it('rejects a first-person experience/background CV lead in favor of the lab research block (#1040)', () => {
    const FIRST_PERSON_EXPERIENCE_BIO =
      'I have a broad background in signal processing, psychophysics, and computational modeling ' +
      'from pre-doctoral and doctoral work. My doctoral research resulted in the first ' +
      'comprehensive model of visual crowding.';
    expect(
      selectResearchHomeDescription([FIRST_PERSON_EXPERIENCE_BIO, LAB_DNA_REPAIR_BLOCK], {
        kind: 'organization',
      }),
    ).toBe(LAB_DNA_REPAIR_BLOCK);
    expect(
      selectResearchHomeDescription([FIRST_PERSON_EXPERIENCE_BIO], { kind: 'organization' }),
    ).toBeNull();
  });

  it('does not blank a loose name-verb lead that is the only candidate (#919)', () => {
    expect(
      selectResearchHomeDescription([BIOGRAPHICAL_VERB_BIO], { kind: 'organization' }),
    ).toBe(BIOGRAPHICAL_VERB_BIO);
  });

  it('does not blank an organization lead that only looks name-like (#919)', () => {
    expect(
      selectResearchHomeDescription([CAPITALIZED_TOPIC_ORG_LEAD], { kind: 'organization' }),
    ).toBe(CAPITALIZED_TOPIC_ORG_LEAD);
  });

  it('still keeps a credentialed research bio for a person entity (#919)', () => {
    expect(selectResearchHomeDescription([CREDENTIAL_NAME_VERB_BIO], { kind: 'person' })).toBe(
      CREDENTIAL_NAME_VERB_BIO,
    );
  });

  it('never selects A-Z directory-index boilerplate as a description (#517)', () => {
    const A_TO_Z_INDEX_BLOCK =
      'This A–Z index lists Yale School of Medicine lab websites in one place, making it easy to find a specific lab, research group, or program site. Browse alphabetically or use your browser search to quickly locate a lab by name.';
    expect(
      selectResearchHomeDescription([A_TO_Z_INDEX_BLOCK], { kind: 'organization' }),
    ).toBeNull();
    expect(selectResearchHomeDescription([A_TO_Z_INDEX_BLOCK, LAB_RESEARCH_BLOCK])).toBe(
      LAB_RESEARCH_BLOCK,
    );
  });
});
