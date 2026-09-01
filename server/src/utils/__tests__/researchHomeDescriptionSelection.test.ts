import { describe, it, expect } from 'vitest';
import {
  collectDescriptionCandidates,
  isDemotablePersonBio,
  isHighConfidencePersonBio,
  isMissionOrCultureProse,
  isRecruitingNoticeLead,
  selectResearchHomeDescription,
} from '../researchHomeDescriptionSelection';

const WEAK_JOURNAL_CLUB_PASSAGE =
  'Members of the lab are interested in a broad range of questions and meet weekly for journal club, where we discuss recent preprints and take turns presenting works in progress.';

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
    expect(selectResearchHomeDescription([BIOGRAPHICAL_VERB_BIO], { kind: 'organization' })).toBe(
      BIOGRAPHICAL_VERB_BIO,
    );
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
  it('ranks a research passage above a mission statement from the same site (#2176)', () => {
    const MISSION_BLOCK =
      'Our Mission Create and communicate high-quality and creative science on the mechanisms that control tissue biology: development, homeostasis, regeneration, and disease. To foster personal and scientific growth and excellence.';
    const RESEARCH_BLOCK =
      'We are studying the dynamic interactions between non-epithelial cells in tissues that interface with the environment. Using mouse genetics, cell culture models, genomics, and microscopy, we tackle the cell-intrinsic and cell-extrinsic factors behind regeneration.';

    expect(isMissionOrCultureProse(MISSION_BLOCK)).toBe(true);
    expect(isMissionOrCultureProse(RESEARCH_BLOCK)).toBe(false);
    expect(selectResearchHomeDescription([MISSION_BLOCK, RESEARCH_BLOCK])).toBe(RESEARCH_BLOCK);
    expect(selectResearchHomeDescription([RESEARCH_BLOCK, MISSION_BLOCK])).toBe(RESEARCH_BLOCK);
  });

  it('still keeps a mission statement when the home publishes nothing else (#2176)', () => {
    const MISSION_ONLY =
      'Our Mission Create and communicate high-quality and creative science on the mechanisms that control tissue biology: development, homeostasis, regeneration, and disease. Our research uses multiple epithelial tissues to explore these scientific interests.';
    expect(selectResearchHomeDescription([MISSION_ONLY])).toBe(MISSION_ONLY);
  });

  it('ranks a research passage above a recruiting-notice lead, but keeps it alone (#2176)', () => {
    const HIRING_LEAD =
      'Hiring! Our group has open positions for a postdoc and a graduate student. We study quantum many-body systems out of equilibrium using ultracold atomic gases as a platform for these experiments.';

    expect(isRecruitingNoticeLead(HIRING_LEAD)).toBe(true);
    expect(isRecruitingNoticeLead(LAB_RESEARCH_BLOCK)).toBe(false);
    expect(selectResearchHomeDescription([HIRING_LEAD, LAB_RESEARCH_BLOCK])).toBe(
      LAB_RESEARCH_BLOCK,
    );
    expect(selectResearchHomeDescription([HIRING_LEAD])).toBe(HIRING_LEAD);
  });

  it('does not let an off-topic demotion blank a high-confidence person bio (#2176)', () => {
    // Both demotion-marked and a high-confidence bio, which is the only shape
    // the fail-closed blanking guard actually reaches.
    const CREDENTIALED_CULTURE_BIO =
      'Dr. Chen is committed to fostering an inclusive lab. Her research examines carbon storage in tidal wetlands and the chemistry of estuary sediments, combining fieldwork with numerical modeling of coastal systems.';
    expect(isMissionOrCultureProse(CREDENTIALED_CULTURE_BIO)).toBe(true);
    expect(isHighConfidencePersonBio(CREDENTIALED_CULTURE_BIO)).toBe(true);
    expect(selectResearchHomeDescription([CREDENTIALED_CULTURE_BIO], { kind: 'person' })).toBe(
      CREDENTIALED_CULTURE_BIO,
    );
  });

  it('does not demote research prose that merely closes with a recruiting invitation (#2176)', () => {
    const RESEARCH_THEN_INVITE =
      "The Smith Lab studies the neural circuits underlying decision-making, mapping how cortical populations accumulate evidence over time. If you're interested in joining, reach out.";

    expect(isRecruitingNoticeLead(RESEARCH_THEN_INVITE)).toBe(false);
    expect(selectResearchHomeDescription([RESEARCH_THEN_INVITE, WEAK_JOURNAL_CLUB_PASSAGE])).toBe(
      RESEARCH_THEN_INVITE,
    );
  });

  it('does not read ordinary research aims as a recruiting pitch (#2176)', () => {
    const BUILDING_AIM =
      'We are building a comprehensive atlas of cell types in the developing human brain, and we are looking for the genetic determinants of cortical folding across primate species.';
    const BUILDING_A_TEAM =
      "The Craven Lab launched in fall 2025 and we're building a team. We investigate organic reaction mechanisms, so reach out about a postdoc position if that excites you.";

    expect(isRecruitingNoticeLead(BUILDING_AIM)).toBe(false);
    expect(isRecruitingNoticeLead(BUILDING_A_TEAM)).toBe(true);
  });

  it('treats mission and vision as headings, not as topic words (#2176)', () => {
    const VISION_SCIENCE =
      'Vision is our most important sense, and we study how retinal circuits encode motion, colour, and contrast before that signal ever reaches the cortex.';
    const CENTER_MISSION_STATEMENT =
      'The mission of the Wetlands Center is to advance the diagnosis and treatment of coastal erosion, and our research examines how sediment chemistry responds to rising seas.';
    const MISSION_HEADING = 'Our Mission Foster an inclusive, welcoming community of scholars.';

    expect(isMissionOrCultureProse(VISION_SCIENCE)).toBe(false);
    expect(isMissionOrCultureProse(CENTER_MISSION_STATEMENT)).toBe(false);
    expect(isMissionOrCultureProse(MISSION_HEADING)).toBe(true);
    expect(selectResearchHomeDescription([VISION_SCIENCE, WEAK_JOURNAL_CLUB_PASSAGE])).toBe(
      VISION_SCIENCE,
    );
    expect(
      selectResearchHomeDescription([CENTER_MISSION_STATEMENT, WEAK_JOURNAL_CLUB_PASSAGE]),
    ).toBe(CENTER_MISSION_STATEMENT);
  });
});

describe('isDemotablePersonBio', () => {
  const TITLED_NAME_PROSE =
    "Professor Lindqvist's research investigates how engineered proteins fold inside living cells, combining single-molecule spectroscopy with computational modelling of folding pathways.";

  it('drops the bare titled-name opener the wider bio test accepts', () => {
    expect(isHighConfidencePersonBio(TITLED_NAME_PROSE)).toBe(true);
    expect(isDemotablePersonBio(TITLED_NAME_PROSE)).toBe(false);
  });

  it('still fires on a titled name whose passage also carries a degree narrative', () => {
    expect(
      isDemotablePersonBio(
        'Dr. Lindqvist is an assistant professor of applied physics who received a Ph.D. from a midwestern university and joined the faculty after two postdoctoral appointments.',
      ),
    ).toBe(true);
  });

  it('keeps the signals that organization prose never produces', () => {
    expect(
      isDemotablePersonBio(
        'I am an Associate Professor of Chemistry at the university, and my group works on catalysis.',
      ),
    ).toBe(true);
    expect(
      isDemotablePersonBio(
        'Avery Lindqvist, PhD, is an assistant professor in the department of applied physics.',
      ),
    ).toBe(true);
    expect(
      isDemotablePersonBio(
        'His research examines how coastal wetlands store carbon across tidal cycles.',
      ),
    ).toBe(true);
    expect(isDemotablePersonBio(LAB_RESEARCH_BLOCK)).toBe(false);
  });
});
