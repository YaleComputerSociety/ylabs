import { describe, expect, it } from 'vitest';

import {
  isAcademicAppointmentDescription,
  isCredentialOrAwardLeadBiography,
  isCredentialOrTitleLeadBiography,
  isDeceasedOrEmeritusLeadBiography,
  isDirectoryIndexChromeText,
  isMidCvContinuationOpener,
  isPersonBiographyOrAdvisingDescription,
  isResearchEntitySourceChromeText,
  isSyntheticResearchHomeMetadataDescription,
  publicResearchEntityDescriptionText,
  repairSubjectlessResearchLead,
  revoiceFirstPersonResearchLead,
  sanitizeFacultyResearchEntityText,
  sanitizeResearchEntityPublicDescriptionFields,
  sanitizeResearchHomeSelfReferenceCopyFields,
  sanitizeResearchHomeSelfReferenceText,
  sanitizeServedResearchEntityCopyFields,
} from '../researchEntityDescriptionText';

const PROGRAM_DIRECTOR_BIO =
  'Anthony Leiserowitz, PhD is the JoshAni-TomKat Professor of Climate Communication and Director of the Yale Program on Climate Change Communication. He is an internationally recognized expert on public climate change beliefs. In 2020, he was named the second-most influential climate scientist in the world by Reuters. I only consider doctoral student applicants that already have a strong background in climate change or environmental communication. I advise masters students focused on climate perceptions and communication.';

describe('isDirectoryIndexChromeText', () => {
  it('flags YSM A-Z lab-website index directory boilerplate (#517)', () => {
    expect(
      isDirectoryIndexChromeText(
        'This A–Z index lists Yale School of Medicine lab websites in one place. Browse alphabetically or use your browser search.',
      ),
    ).toBe(true);
    expect(
      isDirectoryIndexChromeText('This A-Z index lists Yale School of Medicine lab websites.'),
    ).toBe(true);
  });

  it('does not flag a real lab research description', () => {
    expect(
      isDirectoryIndexChromeText('Studies chromatin dynamics and nuclear envelope assembly.'),
    ).toBe(false);
    expect(isDirectoryIndexChromeText('')).toBe(false);
    expect(isDirectoryIndexChromeText(undefined)).toBe(false);
  });
});

describe('isAcademicAppointmentDescription', () => {
  it('flags a short appointment-only title fragment', () => {
    expect(
      isAcademicAppointmentDescription('Jane Doe is Associate Professor of Biomedical Engineering.'),
    ).toBe(true);
  });

  it('does not flag a long multi-sentence research description that opens with an appointment sentence (#1456)', () => {
    const description =
      'Anjelica L. Gonzalez is Associate Professor of Biomedical Engineering. Her appointment in Biomedical Engineering, in association with the Vascular Biology and Therapeutics Program, has provided a supportive and convenient platform for her research, focused on the development of biomaterials for use as investigational tools, particularly for the investigation of immunological responses to inflammatory signals from endogenous and exogenous sources. Gonzalez has a dedicated interest in training the next generation of scientists to think with an interdisciplinary approach to problems and to have a scientifically global perspective. The Gonzalez lab combines organic chemistry, molecular biology, mathematics, computational modeling and image analysis to develop human tissue-based biomimetic scaffolds to better understand healthy and diseased states.';
    expect(isAcademicAppointmentDescription(description)).toBe(false);
  });
});

describe('isMidCvContinuationOpener', () => {
  it('flags a description that opens mid-CV, continuing a biography cut from elsewhere on the page (#1456)', () => {
    expect(
      isMidCvContinuationOpener(
        'Next, he completed his graduate studies on cell cytoskeleton and protein trafficking under the direction of John V. Cox at the University of Tennessee, Memphis.',
      ),
    ).toBe(true);
    expect(
      isMidCvContinuationOpener(
        'Subsequently, Dr. Ghosh did his postdoctoral research on cell signaling at the Salk Institute for Biological Studies.',
      ),
    ).toBe(true);
    expect(
      isMidCvContinuationOpener('After completing his fellowship, he joined Geneva University Hospital.'),
    ).toBe(true);
    expect(
      isMidCvContinuationOpener('In 2018, he joined the Department of Neuroscience at Yale University.'),
    ).toBe(true);
  });

  it('does not flag a genuine research-focused description', () => {
    expect(isMidCvContinuationOpener('Studies chromatin dynamics and nuclear envelope assembly.')).toBe(
      false,
    );
    expect(isMidCvContinuationOpener('')).toBe(false);
    expect(isMidCvContinuationOpener(undefined)).toBe(false);
  });
});

describe('publicResearchEntityDescriptionText', () => {
  it('suppresses scraped sentence fragments that should not display as descriptions', () => {
    expect(
      publicResearchEntityDescriptionText(
        'focuses in identifying ecological thresholds beyond which global changes cause abrupt ecosystem degradation.',
      ),
    ).toBe('');
    expect(
      publicResearchEntityDescriptionText(
        'of post-colonialism, South Asian cultural studies, mobility and modernity.',
      ),
    ).toBe('');
    expect(
      publicResearchEntityDescriptionText(
        'is in experimental particle physics: The energy frontier at the Large Hadron Collider.',
      ),
    ).toBe('');
  });

  it('suppresses incomplete source snippets that end mid-name or mid-title', () => {
    expect(
      publicResearchEntityDescriptionText(
        'A Comment on descriptive statistics by Isaiah Andrews, Matthew Gentzkow, and Jesse M.',
      ),
    ).toBe('');
    expect(
      publicResearchEntityDescriptionText(
        'Two primary projects use MRI images in collaboration with Dr.',
      ),
    ).toBe('');
  });

  it('suppresses a mid-CV continuation opener (#1456)', () => {
    expect(
      publicResearchEntityDescriptionText(
        'Next, he completed his graduate studies on cell cytoskeleton and protein trafficking under the direction of John V. Cox at the University of Tennessee, Memphis.',
      ),
    ).toBe('');
  });

  it('suppresses copied profile contact chrome', () => {
    expect(
      publicResearchEntityDescriptionText(
        'eduHQ 323203-432-4669 Zareena Grewal is a historical anthropologist.',
      ),
    ).toBe('');
  });

  it('suppresses contact-route snippets materialized as descriptions', () => {
    expect(
      publicResearchEntityDescriptionText(
        'Contact: Dana Fixture ( dana.c.fixture@yale.edu) Website: https://campuspress.yale.edu/moorelab/ We have projects aiming to test fundamental physics.',
      ),
    ).toBe('');
  });

  it('suppresses A-Z directory-index boilerplate that leaked into a stored description (#535)', () => {
    expect(
      publicResearchEntityDescriptionText(
        'This A–Z index lists Yale School of Medicine lab websites in one place, making it easy to find a specific lab, research group, or program site.',
      ),
    ).toBe('');
  });

  it('suppresses an institutional center/council promotional blurb grafted onto a lab detail description (#559)', () => {
    expect(
      publicResearchEntityDescriptionText(
        'The Institute for Sample Studies is a leading center of excellence for regional research and teaching on the local, national, and international levels.',
      ),
    ).toBe('');
    expect(
      publicResearchEntityDescriptionText(
        'The Council on Placeholder Studies is a center dedicated to research and teaching across many disciplines.',
      ),
    ).toBe('');
  });

  it('keeps complete research descriptions with abbreviations', () => {
    expect(
      publicResearchEntityDescriptionText(
        'Dr. Jones studies U.S. health policy and vaccination programs.',
      ),
    ).toBe('Dr. Jones studies U.S. health policy and vaccination programs.');
  });

  it('keeps a genuine research description that merely mentions a center', () => {
    const description =
      'Studies neural circuits underlying decision-making, in collaboration with the campus imaging center.';
    expect(publicResearchEntityDescriptionText(description)).toBe(description);
  });

  it('keeps concise research-series cards whose final topic is a single capitalized word (#1414)', () => {
    const cards = [
      'Studies Microbiology and Pathology.',
      'Studies poetry, primarily but not only American and British.',
      'Studies Islamic Law and Civilization.',
      'Studies Gene Expression, Public Health, Genomics, and Proteomics.',
      'Research focuses on the evolution and maintenance of social monogamy, pair bonding, and paternal care in primates, with projects in Argentina and Ecuador.',
    ];
    for (const card of cards) {
      expect(publicResearchEntityDescriptionText(card)).toBe(card);
    }
  });

  it('still suppresses genuine author-list and collaboration truncations (#1414)', () => {
    expect(
      publicResearchEntityDescriptionText(
        'A Comment on descriptive statistics by Isaiah Andrews, Matthew Gentzkow, and Jesse M.',
      ),
    ).toBe('');
    expect(
      publicResearchEntityDescriptionText(
        'Two primary projects use MRI images in collaboration with Dr.',
      ),
    ).toBe('');
    expect(
      publicResearchEntityDescriptionText('This work was done in collaboration with Smith.'),
    ).toBe('');
  });
});

describe('sanitizeFacultyResearchEntityText', () => {
  it('rephrases lab-only copy for faculty research entities only', () => {
    const facultyResearch = {
      name: 'Charles Bailyn Faculty Research',
      kind: 'individual',
      entityType: 'FACULTY_RESEARCH_AREA',
    };
    const lab = { name: 'Example Lab', kind: 'lab', entityType: 'LAB' };
    const copy =
      'The Charles Bailyn Lab conducts research focused on black holes. this research uses telescopes. Review the lab site before contacting this lab.';

    expect(sanitizeFacultyResearchEntityText(copy, facultyResearch)).toBe(
      "Charles Bailyn's research focuses on black holes. This research uses telescopes. Review the research website before contacting this research profile.",
    );
    expect(sanitizeFacultyResearchEntityText(copy, lab)).toBe(copy);
  });

  it('rephrases possessive faculty lab copy', () => {
    const facultyResearch = {
      name: 'David Breslow Faculty Research',
      kind: 'individual',
      entityType: 'FACULTY_RESEARCH_AREA',
    };

    expect(
      sanitizeFacultyResearchEntityText(
        "David Breslow's lab studies ciliary signaling. His lab uses genomic tools.",
        facultyResearch,
      ),
    ).toBe("David Breslow's research studies ciliary signaling. His research uses genomic tools.");
    expect(
      sanitizeFacultyResearchEntityText(
        "The lab's work includes genomic screening. The lab's research addresses cilia.",
        facultyResearch,
      ),
    ).toBe('This research includes genomic screening. This research addresses cilia.');
  });

  it('strips a trailing "Research" suffix (with or without a dash separator) from the possessive name', () => {
    const dashSuffixEntity = {
      name: 'Tara Boroushaki - Research',
      kind: 'individual',
      entityType: 'INDIVIDUAL_RESEARCH',
    };
    expect(
      sanitizeFacultyResearchEntityText(
        'The Boroushaki Lab investigates sensing and mobile technologies.',
        dashSuffixEntity,
      ),
    ).toBe("Tara Boroushaki's research investigates sensing and mobile technologies.");

    const bareSuffixEntity = {
      name: 'Ada Lovelace Research',
      kind: 'individual',
      entityType: 'INDIVIDUAL_RESEARCH',
    };
    expect(
      sanitizeFacultyResearchEntityText(
        'The Lovelace Lab focuses on analytical engines.',
        bareSuffixEntity,
      ),
    ).toBe("Ada Lovelace's research focuses on analytical engines.");
  });
});

describe('sanitizeResearchEntityPublicDescriptionFields', () => {
  it('drops PI profile synthesis summaries that are not research-focused', () => {
    const sanitized = sanitizeResearchEntityPublicDescriptionFields(
      {
        descriptionSource: 'PI_PROFILE_SYNTHESIS',
        profileSynthesisDescription:
          'David Lang has been performed by major music, dance, and theater organizations throughout the world, and in the most renowned concert halls and festivals in the United States and Europe. His works have been performed many times on Yale concert series.',
      },
      ['David Glahn'],
    );

    expect(sanitized).toEqual({
      descriptionSource: 'PI_PROFILE_SYNTHESIS',
      profileSynthesisDescription: '',
    });
  });

  it('preserves PI profile synthesis summaries that stay research-focused after correction', () => {
    const sanitized = sanitizeResearchEntityPublicDescriptionFields(
      {
        descriptionSource: 'PI_PROFILE_SYNTHESIS',
        profileSynthesisDescription:
          "David Lang's lab studies how humans process complex sound patterns.",
      },
      ['David Glahn'],
    );

    expect(sanitized.profileSynthesisDescription).toBe(
      'This lab studies how humans process complex sound patterns.',
    );
  });

  it('keeps a research-verb-led card whose eponymous object mismatches the lead name', () => {
    const medical = sanitizeResearchEntityPublicDescriptionFields(
      {
        entityType: 'LAB',
        kind: 'lab',
        shortDescription:
          "Studies Ménétrier's disease, cell plasticity, and sex-differential expression of the epidermal growth factor receptor to understand signaling networks and inform therapeutic development.",
      },
      ['Won Jae Huh'],
    );
    expect(medical.shortDescription).toBe(
      "Studies Ménétrier's disease, cell plasticity, and sex-differential expression of the epidermal growth factor receptor to understand signaling networks and inform therapeutic development.",
    );

    const scholarly = sanitizeResearchEntityPublicDescriptionFields(
      {
        entityType: 'FACULTY_RESEARCH_AREA',
        kind: 'individual',
        shortDescription:
          'Studies Ivan Goncharov’s travelogue about Africa and Asia, The Frigate Pallada (1858) in the context of global imperial history.',
      },
      ['Edyta Bojanowska'],
    );
    expect(scholarly.shortDescription).toBe(
      'Studies Ivan Goncharov’s travelogue about Africa and Asia, The Frigate Pallada (1858) in the context of global imperial history.',
    );
  });

  it('still strips a genuine mismatched person-name possessive prefix', () => {
    const sanitized = sanitizeResearchEntityPublicDescriptionFields(
      {
        entityType: 'LAB',
        kind: 'lab',
        shortDescription: "Jane Smith's research examines coral reef resilience.",
      },
      ['Won Jae Huh'],
    );
    expect(sanitized.shortDescription).toBe('This research examines coral reef resilience.');
  });

  it('drops a director biography served as a non-person entity description (#806)', () => {
    const program = {
      entityType: 'PROGRAM',
      kind: 'program',
      fullDescription: PROGRAM_DIRECTOR_BIO,
      shortDescription: 'Anthony Leiserowitz, PhD is the JoshAni-TomKat Professor of Climate Communication.',
    };
    const sanitized = sanitizeResearchEntityPublicDescriptionFields(program);

    expect(sanitized.fullDescription).toBe('');
    expect(sanitized.shortDescription).toBe('');
  });

  it('keeps a genuine program description on a non-person entity', () => {
    const program = {
      entityType: 'PROGRAM',
      kind: 'program',
      fullDescription:
        'The Yale Program on Climate Change Communication conducts scientific research on public climate change knowledge and develops tools to help decision-makers communicate effectively.',
    };
    const sanitized = sanitizeResearchEntityPublicDescriptionFields(program);

    expect(sanitized.fullDescription).toBe(
      'The Yale Program on Climate Change Communication conducts scientific research on public climate change knowledge and develops tools to help decision-makers communicate effectively.',
    );
  });

  it('blanks a researcher-voice "Studies <topic>" shortDescription on a funding-program entity (#1555)', () => {
    const raProgram = {
      entityType: 'RA_PROGRAM',
      fullDescription:
        'The Impulsivity and Impulse Control Disorder Research Program funds undergraduate research assistantships in psychiatry, neuroscience, psychology, and developmental biology.',
      shortDescription: 'Studies Psychiatry, Neuroscience, Psychology, and Developmental Biology.',
    };
    const sanitized = sanitizeResearchEntityPublicDescriptionFields(raProgram);

    expect(sanitized.shortDescription).toBe('');
  });

  it('keeps a "Studies <topic>" shortDescription on a lab/faculty entity (#1555 scope)', () => {
    const lab = {
      entityType: 'FACULTY_RESEARCH_AREA',
      kind: 'individual',
      fullDescription: 'Studies coral reef resilience under ocean acidification.',
      shortDescription: 'Studies coral reef resilience under ocean acidification.',
    };
    const sanitized = sanitizeResearchEntityPublicDescriptionFields(lab);

    expect(sanitized.shortDescription).toBe('Studies coral reef resilience under ocean acidification.');
  });

  it('applies the biography/advising guard to faculty-research entities too (#1526)', () => {
    const facultyResearch = {
      entityType: 'FACULTY_RESEARCH_AREA',
      kind: 'individual',
      fullDescription: PROGRAM_DIRECTOR_BIO,
    };
    const sanitized = sanitizeResearchEntityPublicDescriptionFields(facultyResearch);

    expect(sanitized.fullDescription).toBe('');
  });

  it('strips only the appointment-opener sentence on a faculty entity, keeping the research content (#1586)', () => {
    const facultyResearch = {
      entityType: 'FACULTY_RESEARCH_AREA',
      kind: 'individual',
      fullDescription:
        'Elleza Kelley is an Assistant Professor of English and Black Studies, and affiliate faculty in American Studies. Kelley works on African American literature, print culture, and Black feminist theory in the twentieth century.',
    };
    const sanitized = sanitizeResearchEntityPublicDescriptionFields(facultyResearch);

    expect(sanitized.fullDescription).toBe(
      'Kelley works on African American literature, print culture, and Black feminist theory in the twentieth century.',
    );
  });

  it('still blanks a faculty-entity biography opener with no surviving research content (#1586)', () => {
    const facultyResearch = {
      entityType: 'FACULTY_RESEARCH_AREA',
      kind: 'individual',
      fullDescription:
        'Jane Doe is the Sterling Professor of Physics. She was born in Ohio and joined the Yale faculty in 2001.',
    };
    const sanitized = sanitizeResearchEntityPublicDescriptionFields(facultyResearch);

    expect(sanitized.fullDescription).toBe('');
  });

  it('repairs a subject-less "Research {verb}..." fullDescription on a LAB entity (#999)', () => {
    const lab = {
      entityType: 'LAB',
      kind: 'lab',
      fullDescription: 'Research investigates the mechanics of soft robotic materials.',
    };
    const sanitized = sanitizeResearchEntityPublicDescriptionFields(lab);

    expect(sanitized.fullDescription).toBe('Investigates the mechanics of soft robotic materials.');
  });

  it('re-voices a raw first-person PI bio served as a LAB fullDescription to third person (#964)', () => {
    const lab = {
      entityType: 'LAB',
      kind: 'lab',
      shortDescription:
        'Investigates novel immune checkpoints and the inhibitory immune landscape in cutaneous malignancies.',
      fullDescription:
        'I am a physician-scientist with specialized training in immunology, molecular biology, genetics, and clinical dermatology. My career is dedicated to integrating fundamental immunology with clinical dermatology.',
    };
    const sanitized = sanitizeResearchEntityPublicDescriptionFields(lab);

    expect(sanitized.fullDescription).toBe(
      "This researcher is a physician-scientist with specialized training in immunology, molecular biology, genetics, and clinical dermatology. This researcher's career is dedicated to integrating fundamental immunology with clinical dermatology.",
    );
    expect(sanitized.shortDescription).toBe(lab.shortDescription);
  });

  it('strips a leading personal-page greeting before re-voicing remaining lab copy (#964)', () => {
    const lab = {
      entityType: 'LAB',
      kind: 'lab',
      fullDescription:
        'Welcome to my web page! My research studies the genetics of neurodegenerative disease across model organisms.',
    };
    const sanitized = sanitizeResearchEntityPublicDescriptionFields(lab);

    expect(sanitized.fullDescription).toBe(
      'This research studies the genetics of neurodegenerative disease across model organisms.',
    );
  });

  it('blanks a faculty-research entity whose description is a recruiting/advising note (#1526)', () => {
    const facultyResearch = {
      entityType: 'FACULTY_RESEARCH_AREA',
      kind: 'individual',
      fullDescription: PROGRAM_DIRECTOR_BIO,
    };
    const sanitized = sanitizeResearchEntityPublicDescriptionFields(facultyResearch);

    expect(sanitized.fullDescription).toBe('');
  });

  it('strips a title/possessive "Welcome to Prof./Professor/Dr." greeting opener despite embedded abbreviation periods (#1667)', () => {
    const cases: Array<[string, string]> = [
      [
        "Welcome to Prof. Fengnian Xia's research group. Our lab studies two-dimensional materials and their applications in nanoelectronics.",
        'This lab studies two-dimensional materials and their applications in nanoelectronics.',
      ],
      [
        "Welcome to Professor Scott A. Strobel's Laboratory at Yale University! We study RNA biology and its applications to synthetic biology and antibiotic discovery.",
        'This group studies RNA biology and its applications to synthetic biology and antibiotic discovery.',
      ],
      [
        'Welcome to Yale Smart Medicine Lab (YSML). We do research on healthcare technology and digital tools for patients.',
        'We do research on healthcare technology and digital tools for patients.',
      ],
    ];
    for (const [fullDescription, expected] of cases) {
      const sanitized = sanitizeResearchEntityPublicDescriptionFields({
        entityType: 'LAB',
        kind: 'lab',
        fullDescription,
      });
      expect(sanitized.fullDescription).toBe(expected);
    }
  });

  it('strips trailing website-navigation chrome from a lab fullDescription instead of blanking it (#1667)', () => {
    const cases: Array<[string, string]> = [
      [
        'Studies molecular signaling pathways in cancer biology and drug resistance, please click on the links above.',
        'Studies molecular signaling pathways in cancer biology and drug resistance',
      ],
      [
        'Studies inflammatory bowel disease and mucosal immunology, please check the Research section.',
        'Studies inflammatory bowel disease and mucosal immunology',
      ],
      [
        'Studies transplant immunology and organ rejection, please visit the Positions section for more information, or contact Dr. Ke Xu, MD, PhD.',
        'Studies transplant immunology and organ rejection',
      ],
      [
        'Studies polymer physics and mechanics, please contact Michael Crowley, and include in the subject heading, your area of interest.',
        'Studies polymer physics and mechanics',
      ],
      [
        'Studies robotic grasping and prosthetics, more information can be found on the Research and Publications pages.',
        'Studies robotic grasping and prosthetics',
      ],
    ];
    for (const [fullDescription, expected] of cases) {
      const sanitized = sanitizeResearchEntityPublicDescriptionFields({
        entityType: 'LAB',
        kind: 'lab',
        fullDescription,
      });
      expect(sanitized.fullDescription).toBe(expected);
    }
  });

  it('repairs a subject-less "Research {verb}..." fullDescription on an individual-research entity (#999)', () => {
    const individual = {
      entityType: 'INDIVIDUAL_RESEARCH',
      kind: 'individual',
      fullDescription:
        'Research examines musical topics within the black Atlantic cultural sphere of Africa and the African diaspora.',
    };
    const sanitized = sanitizeResearchEntityPublicDescriptionFields(individual);

    expect(sanitized.fullDescription).toBe(
      'Examines musical topics within the black Atlantic cultural sphere of Africa and the African diaspora.',
    );
  });

  it('strips only the appointment-opener sentence on a LAB entity, keeping the research content (#1638)', () => {
    const lab = {
      entityType: 'LAB',
      kind: 'lab',
      fullDescription:
        'Jane Doe is an Associate Professor of Biostatistics at Yale. Her research is focused on statistical modeling of longitudinal cohort data.',
    };
    const sanitized = sanitizeResearchEntityPublicDescriptionFields(lab);

    expect(sanitized.fullDescription).toBe(
      'Her research is focused on statistical modeling of longitudinal cohort data.',
    );
  });

  it('blanks a LAB-entity biography opener with no surviving research content (#1638)', () => {
    const lab = {
      entityType: 'LAB',
      kind: 'lab',
      fullDescription: 'Samuel Doe is a Professor Adjunct Emeritus of Art at Yale University.',
    };
    const sanitized = sanitizeResearchEntityPublicDescriptionFields(lab);

    expect(sanitized.fullDescription).toBe('');
  });

  it('blanks a deceased-lead LAB fullDescription rather than stripping a single sentence (#1638)', () => {
    const lab = {
      entityType: 'LAB',
      kind: 'lab',
      fullDescription:
        'Pierre R. Demarque (1932 - 2025), Munson Professor Emeritus of Natural Philosophy and Astronomy, came to Yale as professor of astronomy and department chair in 1968, holding the latter post until 1975.',
    };
    const sanitized = sanitizeResearchEntityPublicDescriptionFields(lab);

    expect(sanitized.fullDescription).toBe('');
  });

  it('does not guard a non-LAB, non-faculty entity against the deceased/emeritus lead signal', () => {
    const program = {
      entityType: 'PROGRAM',
      fullDescription:
        'Pierre R. Demarque (1932 - 2025) endowed this fellowship to support graduate study in astronomy.',
    };
    const sanitized = sanitizeResearchEntityPublicDescriptionFields(program);

    expect(sanitized.fullDescription).toBe(
      'Pierre R. Demarque (1932 - 2025) endowed this fellowship to support graduate study in astronomy.',
    );
  });

  it('strips a lowercase "professor" credential opener on a LAB entity (#1638)', () => {
    const lab = {
      entityType: 'LAB',
      kind: 'lab',
      fullDescription:
        'Matthew Kotchen is the Langdon K. Storm professor of economics in the Yale School of the Environment. His research interests lie at the intersection of environmental and public economics and policy.',
    };
    const sanitized = sanitizeResearchEntityPublicDescriptionFields(lab);

    expect(sanitized.fullDescription).toBe(
      'His research interests lie at the intersection of environmental and public economics and policy.',
    );
  });

  it('strips a "Director of"/"senior lecturer" credential opener on a LAB entity (#1638)', () => {
    const lab = {
      entityType: 'LAB',
      kind: 'lab',
      fullDescription:
        'William Casey King is a senior lecturer at the Jackson School of Global Affairs. His research focuses on big data and data-driven policy analyses and solutions.',
    };
    const sanitized = sanitizeResearchEntityPublicDescriptionFields(lab);

    expect(sanitized.fullDescription).toBe(
      'His research focuses on big data and data-driven policy analyses and solutions.',
    );
  });

  it('strips a "Dr. X, a graduate of ..." credential opener behind a leading title fragment on a LAB entity (#1638)', () => {
    const lab = {
      entityType: 'LAB',
      kind: 'lab',
      fullDescription:
        'Senior Research Scientist in Medicine Dr. Wisnewski, a graduate of the University of California, is a widely experienced research scientist. His laboratory studies chemicals that cause asthma in the workplace.',
    };
    const sanitized = sanitizeResearchEntityPublicDescriptionFields(lab);

    expect(sanitized.fullDescription).toBe(
      'His laboratory studies chemicals that cause asthma in the workplace.',
    );
  });

  it('does not treat a leading pronoun as a credential-opener name lead (#1638)', () => {
    const lab = {
      entityType: 'LAB',
      kind: 'lab',
      fullDescription:
        'She is excited to be the inaugural director of a research program space for open collaboration among practitioners and policymakers.',
    };
    const sanitized = sanitizeResearchEntityPublicDescriptionFields(lab);

    expect(sanitized.fullDescription).toBe(
      'She is excited to be the inaugural director of a research program space for open collaboration among practitioners and policymakers.',
    );
  });

  it('blanks a first-person department-appointment opener on a LAB entity with no research content (#1745)', () => {
    const lab = {
      entityType: 'LAB',
      kind: 'lab',
      fullDescription:
        'I am an Instructor in the Department of Medicine, Section of Infectious Diseases.',
    };
    const sanitized = sanitizeResearchEntityPublicDescriptionFields(lab);

    expect(sanitized.fullDescription).toBe('');
  });

  it('blanks a name-lead degree-receipt CV opener on a FACULTY_RESEARCH_AREA entity with no research content (#1745)', () => {
    const fra = {
      entityType: 'FACULTY_RESEARCH_AREA',
      kind: 'individual',
      fullDescription:
        'Robin Fixture received her PhD in Linguistics from the University of Pennsylvania in 1991.',
    };
    const sanitized = sanitizeResearchEntityPublicDescriptionFields(fra);

    expect(sanitized.fullDescription).toBe('');
  });

  it('blanks a pronoun-lead awards/fellowship CV opener on a FACULTY_RESEARCH_AREA entity with no research content (#1745)', () => {
    const fra = {
      entityType: 'FACULTY_RESEARCH_AREA',
      kind: 'individual',
      fullDescription:
        'He has received the Best Economics PhD Advisor Award at Yale University in 2022 and 2023, and was a runner-up in 2024. Fixture is a fellow of the Econometric Society and has received several prestigious awards.',
    };
    const sanitized = sanitizeResearchEntityPublicDescriptionFields(fra);

    expect(sanitized.fullDescription).toBe('');
  });

  it('strips only a degree-receipt opener, keeping surviving research content (#1745)', () => {
    const fra = {
      entityType: 'FACULTY_RESEARCH_AREA',
      kind: 'individual',
      fullDescription:
        'Robin Fixture received her PhD in Linguistics from the University of Pennsylvania in 1991. Her research examines syntactic variation in Romance languages.',
    };
    const sanitized = sanitizeResearchEntityPublicDescriptionFields(fra);

    expect(sanitized.fullDescription).toBe(
      'Her research examines syntactic variation in Romance languages.',
    );
  });

  it('does not blank a first-person specialization lead with no department anchor (#1745)', () => {
    const lab = {
      entityType: 'LAB',
      kind: 'lab',
      fullDescription:
        'I am a physician-scientist with specialized training in immunology, molecular biology, genetics, and clinical dermatology.',
    };
    const sanitized = sanitizeResearchEntityPublicDescriptionFields(lab);

    expect(sanitized.fullDescription).toBe(
      'This researcher is a physician-scientist with specialized training in immunology, molecular biology, genetics, and clinical dermatology.',
    );
  });
});

describe('isDeceasedOrEmeritusLeadBiography', () => {
  it('flags a name-lead opening with a parenthetical death-date range (#1638)', () => {
    expect(
      isDeceasedOrEmeritusLeadBiography(
        'Pierre R. Demarque (1932 - 2025), Munson Professor Emeritus of Natural Philosophy and Astronomy, came to Yale in 1968.',
      ),
    ).toBe(true);
  });

  it('flags a name-lead opening that states emeritus status (#1638)', () => {
    expect(
      isDeceasedOrEmeritusLeadBiography(
        'Jose Costa, MD, FACP, is Professor Emeritus of Pathology at Yale University School of Medicine.',
      ),
    ).toBe(true);
  });

  it('does not flag ordinary research prose with no name lead', () => {
    expect(
      isDeceasedOrEmeritusLeadBiography(
        'Studies the mechanics of soft robotic materials using bio-inspired actuators.',
      ),
    ).toBe(false);
  });

  it('does not flag a first-person research description', () => {
    expect(
      isDeceasedOrEmeritusLeadBiography(
        'I am a physician-scientist with specialized training in immunology and clinical dermatology.',
      ),
    ).toBe(false);
  });

  it('returns false for blank input', () => {
    expect(isDeceasedOrEmeritusLeadBiography('')).toBe(false);
    expect(isDeceasedOrEmeritusLeadBiography(undefined)).toBe(false);
  });
});

describe('isCredentialOrTitleLeadBiography', () => {
  it('flags a name-lead opening with a lowercase "professor" title (#1638)', () => {
    expect(
      isCredentialOrTitleLeadBiography(
        'Matthew Kotchen is the Langdon K. Storm professor of economics in the Yale School of the Environment.',
      ),
    ).toBe(true);
  });

  it('flags a name-lead opening naming a director/lecturer/fellow title (#1638)', () => {
    expect(
      isCredentialOrTitleLeadBiography('William Casey King is a senior lecturer at the Jackson School.'),
    ).toBe(true);
    expect(
      isCredentialOrTitleLeadBiography('Stephen R. Latham, JD, PhD is Director of the Yale Center for Bioethics.'),
    ).toBe(true);
  });

  it('flags a "Dr. X, a graduate of ..." lead behind a leading title fragment (#1638)', () => {
    expect(
      isCredentialOrTitleLeadBiography(
        'Senior Research Scientist in Medicine Dr. Wisnewski, a graduate of the University of California, is a widely experienced research scientist.',
      ),
    ).toBe(true);
  });

  it('does not treat a leading pronoun as a name lead (#1638)', () => {
    expect(
      isCredentialOrTitleLeadBiography(
        'She is excited to be the inaugural director of a research program space.',
      ),
    ).toBe(false);
  });

  it('does not flag ordinary research prose with no name lead', () => {
    expect(
      isCredentialOrTitleLeadBiography('Studies the mechanics of soft robotic materials.'),
    ).toBe(false);
  });

  it('returns false for blank input', () => {
    expect(isCredentialOrTitleLeadBiography('')).toBe(false);
    expect(isCredentialOrTitleLeadBiography(undefined)).toBe(false);
  });
});

describe('isCredentialOrAwardLeadBiography (#1745)', () => {
  it('flags a name-lead degree-receipt CV line', () => {
    expect(
      isCredentialOrAwardLeadBiography(
        'Robin Fixture received her PhD in Linguistics from the University of Pennsylvania in 1991.',
      ),
    ).toBe(true);
  });

  it('flags a possessive name-lead degree-list CV line', () => {
    expect(
      isCredentialOrAwardLeadBiography(
        "Dr. Fixture's received degrees from UCLA, the University of Notre Dame and the University of Oklahoma.",
      ),
    ).toBe(true);
  });

  it('flags a pronoun-lead awards/fellowship credential opener', () => {
    expect(
      isCredentialOrAwardLeadBiography(
        'He has received the Best Economics PhD Advisor Award at Yale University in 2022 and 2023, and was a runner-up in 2024.',
      ),
    ).toBe(true);
  });

  it('flags a first-person appointment lead anchored to a department', () => {
    expect(
      isCredentialOrAwardLeadBiography(
        'I am an Instructor in the Department of Medicine, Section of Infectious Diseases.',
      ),
    ).toBe(true);
  });

  it('does not flag a first-person specialization lead with no department anchor', () => {
    expect(
      isCredentialOrAwardLeadBiography(
        'I am a physician-scientist with specialized training in immunology, molecular biology, genetics, and clinical dermatology.',
      ),
    ).toBe(false);
  });

  it('does not flag ordinary research prose with no credential/award lead', () => {
    expect(
      isCredentialOrAwardLeadBiography('Studies the mechanics of soft robotic materials.'),
    ).toBe(false);
  });

  it('returns false for blank input', () => {
    expect(isCredentialOrAwardLeadBiography('')).toBe(false);
    expect(isCredentialOrAwardLeadBiography(undefined)).toBe(false);
  });
});

describe('revoiceFirstPersonResearchLead', () => {
  it('re-voices a bare first-person bio opener to third person', () => {
    expect(
      revoiceFirstPersonResearchLead('I am an immunologist studying tumor microenvironments.'),
    ).toBe('This researcher is an immunologist studying tumor microenvironments.');
    expect(revoiceFirstPersonResearchLead("I'm a chemist who studies catalysis.")).toBe(
      'This researcher is a chemist who studies catalysis.',
    );
  });

  it('re-voices first-person possessive leads at any sentence boundary', () => {
    expect(revoiceFirstPersonResearchLead('My research focuses on coral reefs.')).toBe(
      'This research focuses on coral reefs.',
    );
    expect(
      revoiceFirstPersonResearchLead('Studies coral reefs. My work builds ocean sensors.'),
    ).toBe('Studies coral reefs. This work builds ocean sensors.');
    expect(revoiceFirstPersonResearchLead('My career spans two decades of fieldwork.')).toBe(
      "This researcher's career spans two decades of fieldwork.",
    );
  });

  it('re-voices first-person plural possessive lab self-references to third person', () => {
    expect(
      revoiceFirstPersonResearchLead('Our research focuses on pneumococcal disease and RSV.'),
    ).toBe('This research focuses on pneumococcal disease and RSV.');
    expect(
      revoiceFirstPersonResearchLead(
        'Decreases preventable blindness. Our team employs quantitative and qualitative methods.',
      ),
    ).toBe(
      'Decreases preventable blindness. This team employs quantitative and qualitative methods.',
    );
    expect(
      revoiceFirstPersonResearchLead('Our research group seeks to understand autoimmune processes.'),
    ).toBe('This research group seeks to understand autoimmune processes.');
    expect(revoiceFirstPersonResearchLead('Our laboratory develops in vivo imaging.')).toBe(
      'This laboratory develops in vivo imaging.',
    );
    expect(
      revoiceFirstPersonResearchLead("My laboratory's research concerns cortical mechanisms."),
    ).toBe("This laboratory's research concerns cortical mechanisms.");
  });

  it('re-voices a first-person "I am the" role opener at a sentence boundary', () => {
    expect(revoiceFirstPersonResearchLead('I am the director of the imaging core.')).toBe(
      'This researcher is the director of the imaging core.',
    );
  });

  it('leaves unconjugated subject clauses that are not a sentence-initial pronoun untouched', () => {
    expect(
      revoiceFirstPersonResearchLead('This work advances our understanding of neurodegeneration.'),
    ).toBe('This work advances our understanding of neurodegeneration.');
  });

  it('re-voices a sentence-initial "We <verb>" opener to third person (#1526)', () => {
    expect(revoiceFirstPersonResearchLead('We study gene expression in lung disease.')).toBe(
      'This group studies gene expression in lung disease.',
    );
    expect(
      revoiceFirstPersonResearchLead('We investigate the brain changes in movement disorders.'),
    ).toBe('This group investigates the brain changes in movement disorders.');
  });

  it('re-voices a residual "I <verb>" clause mid-sentence, lower-cased (#1745)', () => {
    expect(
      revoiceFirstPersonResearchLead(
        'This primary research focus is mechanisms of disease. In particular, I am interested in the role of a specific pathway.',
      ),
    ).toBe(
      'This primary research focus is mechanisms of disease. In particular, this researcher is interested in the role of a specific pathway.',
    );
  });

  it('re-voices a residual "I have <verb>" clause regardless of sentence position (#1745)', () => {
    expect(
      revoiceFirstPersonResearchLead(
        'Since 1996 I have worked and partnered with public health systems. I have also taught seminars on epidemiology.',
      ),
    ).toBe(
      'Since 1996 this researcher has worked and partnered with public health systems. This researcher has also taught seminars on epidemiology.',
    );
  });

  it('re-voices "I\'m"/"I\'ve" contractions, capitalized only at a true sentence start (#1745)', () => {
    expect(revoiceFirstPersonResearchLead("I'm a chemist, and I've published widely on catalysis.")).toBe(
      "This researcher is a chemist, and this researcher has published widely on catalysis.",
    );
  });

  it('drops a leading personal-page greeting only when substantive copy remains', () => {
    expect(
      revoiceFirstPersonResearchLead(
        'Welcome to our lab website. This research studies quantum materials at low temperature.',
      ),
    ).toBe('This research studies quantum materials at low temperature.');
    expect(revoiceFirstPersonResearchLead('Welcome to my web page!')).toBe(
      'Welcome to my web page!',
    );
  });

  it('leaves third-person research copy untouched', () => {
    expect(
      revoiceFirstPersonResearchLead('Studies immune checkpoints in cutaneous malignancies.'),
    ).toBe('Studies immune checkpoints in cutaneous malignancies.');
    expect(revoiceFirstPersonResearchLead('')).toBe('');
    expect(revoiceFirstPersonResearchLead(undefined)).toBe('');
  });
});

describe('repairSubjectlessResearchLead', () => {
  it('rewrites each subject-less "Research {verb}" lead to the verb-led canonical form (#999)', () => {
    expect(repairSubjectlessResearchLead('Research examines X.')).toBe('Examines X.');
    expect(repairSubjectlessResearchLead('Research investigates X.')).toBe('Investigates X.');
    expect(repairSubjectlessResearchLead('Research focuses on X.')).toBe('Studies X.');
    expect(repairSubjectlessResearchLead('Research studies X.')).toBe('Studies X.');
    expect(repairSubjectlessResearchLead('Research explores X.')).toBe('Explores X.');
  });

  it('rewrites a bare "Focuses on" or "Research on" headless lead to "Studies" (#1658)', () => {
    expect(repairSubjectlessResearchLead('Focuses on DNA repair and gene function.')).toBe(
      'Studies DNA repair and gene function.',
    );
    expect(
      repairSubjectlessResearchLead(
        'Research on cortical mechanisms of behavior through single neuron activity.',
      ),
    ).toBe('Studies cortical mechanisms of behavior through single neuron activity.');
  });

  it('only repairs the leading fragment, leaving later "Research interests include" sentences intact', () => {
    expect(
      repairSubjectlessResearchLead(
        'Research focuses on econometric theory. Research interests include inference under partial identification.',
      ),
    ).toBe(
      'Studies econometric theory. Research interests include inference under partial identification.',
    );
  });

  it('does not touch a noun-led "Research interests..." lead or a subjected sentence', () => {
    expect(repairSubjectlessResearchLead('Research interests include machine learning.')).toBe(
      'Research interests include machine learning.',
    );
    expect(
      repairSubjectlessResearchLead("The Kramer-Bottiglio Lab's research investigates soft robots."),
    ).toBe("The Kramer-Bottiglio Lab's research investigates soft robots.");
    expect(repairSubjectlessResearchLead('Research in the Altman Lab centers on catalysis.')).toBe(
      'Research in the Altman Lab centers on catalysis.',
    );
  });
});

describe('isPersonBiographyOrAdvisingDescription', () => {
  it('flags a first-person graduate-admissions/advising note', () => {
    expect(
      isPersonBiographyOrAdvisingDescription(
        'I only consider doctoral student applicants with a strong background in climate communication.',
      ),
    ).toBe(true);
    expect(
      isPersonBiographyOrAdvisingDescription('I advise masters students focused on perceptions.'),
    ).toBe(true);
  });

  it('flags a third-person personal appointment biography', () => {
    expect(
      isPersonBiographyOrAdvisingDescription(
        'Jane Doe, PhD is the Sterling Professor of Physics and Director of the Center. She founded the group in 2005 and leads its experimental program.',
      ),
    ).toBe(true);
  });

  it('flags a biography with a slash-separated title', () => {
    expect(
      isPersonBiographyOrAdvisingDescription('Jane Doe is the Founding/Senior Professor of Genetics.'),
    ).toBe(true);
  });

  it('does not flag a genuine program or center description', () => {
    expect(
      isPersonBiographyOrAdvisingDescription(
        'The Center for Infectious Disease Modeling studies epidemic dynamics and develops models to inform vaccination policy.',
      ),
    ).toBe(false);
    expect(
      isPersonBiographyOrAdvisingDescription(
        'We offer paid summer research fellowships to undergraduates. We welcome applicants from all majors.',
      ),
    ).toBe(false);
    expect(isPersonBiographyOrAdvisingDescription('')).toBe(false);
    expect(isPersonBiographyOrAdvisingDescription(undefined)).toBe(false);
  });
});

describe('sanitizeResearchHomeSelfReferenceText', () => {
  it('rewrites stray "the lab" body copy to the center noun for CENTER entities (#807)', () => {
    const center = { name: 'Yale Center for Genome Analysis', entityType: 'CENTER', kind: 'center' };
    expect(
      sanitizeResearchHomeSelfReferenceText(
        'The Yale Center for Genome Analysis specializes in genomics. The lab offers DNA sequencing services.',
        center,
      ),
    ).toBe(
      'The Yale Center for Genome Analysis specializes in genomics. The center offers DNA sequencing services.',
    );
    expect(
      sanitizeResearchHomeSelfReferenceText('this lab provides research opportunities.', center),
    ).toBe('this center provides research opportunities.');
    expect(
      sanitizeResearchHomeSelfReferenceText("the lab's members present findings.", center),
    ).toBe("the center's members present findings.");
  });

  it('uses the correct noun for other non-lab entity types', () => {
    expect(
      sanitizeResearchHomeSelfReferenceText('The lab convenes annually.', {
        name: 'Some Institute',
        entityType: 'INSTITUTE',
        kind: 'institute',
      }),
    ).toBe('The institute convenes annually.');
    expect(
      sanitizeResearchHomeSelfReferenceText('The lab trains fellows.', {
        name: 'Some Program',
        entityType: 'PROGRAM',
        kind: 'program',
      }),
    ).toBe('The program trains fellows.');
    expect(
      sanitizeResearchHomeSelfReferenceText('The lab runs shared instruments.', {
        name: 'Some Core',
        entityType: 'CORE_FACILITY',
      }),
    ).toBe('The core facility runs shared instruments.');
    expect(
      sanitizeResearchHomeSelfReferenceText('The lab digitizes manuscripts.', {
        name: 'A DH Project',
        entityType: 'DIGITAL_HUMANITIES_PROJECT',
      }),
    ).toBe('The project digitizes manuscripts.');
    expect(
      sanitizeResearchHomeSelfReferenceText('The lab catalogs the archive.', {
        name: 'A Museum Project',
        entityType: 'ARCHIVE_OR_MUSEUM_PROJECT',
      }),
    ).toBe('The project catalogs the archive.');
  });

  it('leaves LAB and faculty-research entities untouched', () => {
    const labText = 'The lab studies neurons. The lab offers rotations.';
    expect(
      sanitizeResearchHomeSelfReferenceText(labText, { name: 'Smith Lab', entityType: 'LAB', kind: 'lab' }),
    ).toBe(labText);
    expect(
      sanitizeResearchHomeSelfReferenceText(labText, {
        name: 'Jane Doe Faculty Research',
        entityType: 'FACULTY_RESEARCH_AREA',
        kind: 'individual',
      }),
    ).toBe(labText);
  });

  it('does not rewrite a named lab embedded inside a center description', () => {
    const center = { name: 'A Center', entityType: 'CENTER', kind: 'center' };
    expect(
      sanitizeResearchHomeSelfReferenceText('The center collaborates with the Smith Lab.', center),
    ).toBe('The center collaborates with the Smith Lab.');
  });
});

describe('sanitizeResearchHomeSelfReferenceCopyFields', () => {
  it('normalizes shortDescription and fullDescription for CENTER entities', () => {
    const sanitized = sanitizeResearchHomeSelfReferenceCopyFields({
      entityType: 'CENTER',
      kind: 'center',
      shortDescription: 'The lab offers sequencing.',
      fullDescription: 'Yale Forests manages forestland. The lab provides educational opportunities.',
    });
    expect(sanitized.shortDescription).toBe('The center offers sequencing.');
    expect(sanitized.fullDescription).toBe(
      'Yale Forests manages forestland. The center provides educational opportunities.',
    );
  });

  it('returns the entity unchanged for LAB entities', () => {
    const entity = {
      entityType: 'LAB',
      kind: 'lab',
      fullDescription: 'The lab studies neurons.',
    };
    expect(sanitizeResearchHomeSelfReferenceCopyFields(entity)).toBe(entity);
  });
});

describe('isResearchEntitySourceChromeText breadcrumb / page-dump detection (#1249)', () => {
  const FRANKS_PAGE_DUMP =
    'You are hereHome » Who We Are » Faculty & Affiliates » Paul Franks Paul Franks Areas of Interest: Kant, German Idealism. Education: Ph.D. 1993, Harvard. Recent Courses Taught: Post-Kantian Themes in Analytic Philosophy. Books: All or Nothing. Selected Articles: Divided by Common Sense.';

  it('flags a "You are here" breadcrumb page dump as source chrome', () => {
    expect(isResearchEntitySourceChromeText(FRANKS_PAGE_DUMP)).toBe(true);
  });

  it('flags a chained breadcrumb-chevron trail as source chrome', () => {
    expect(
      isResearchEntitySourceChromeText('Home » Research » Labs » Smith Lab studies immunology.'),
    ).toBe(true);
  });

  it('blanks the breadcrumb page dump through publicResearchEntityDescriptionText', () => {
    expect(publicResearchEntityDescriptionText(FRANKS_PAGE_DUMP)).toBe('');
  });

  it('leaves clean research prose without a breadcrumb trail untouched', () => {
    const prose = 'The lab studies German Idealism and post-Kantian philosophy.';
    expect(isResearchEntitySourceChromeText(prose)).toBe(false);
    expect(publicResearchEntityDescriptionText(prose)).toBe(prose);
  });
});

describe('sanitizeServedResearchEntityCopyFields "Studies <chips>" area echo (#1466)', () => {
  it('blanks a served fullDescription/shortDescription that only echoes researchAreas', () => {
    const served = sanitizeServedResearchEntityCopyFields({
      fullDescription: 'Studies economic theory, financial economics, and macroeconomics.',
      shortDescription: 'Studies economic theory, financial economics, and macroeconomics.',
      researchAreas: ['Economic Theory', 'Financial Economics', 'Macroeconomics'],
    });
    expect(served.fullDescription).toBe('');
    expect(served.shortDescription).toBe('');
  });

  it('blanks a profileSynthesisDescription echo of profileResearchAreas', () => {
    const served = sanitizeServedResearchEntityCopyFields({
      profileSynthesisDescription: 'Studies economic theory and macroeconomics.',
      profileResearchAreas: ['Economic Theory', 'Macroeconomics'],
    });
    expect(served.profileSynthesisDescription).toBe('');
  });

  it('leaves a genuine research-focus summary untouched even when it opens with a synthesis verb', () => {
    const entity = {
      fullDescription:
        'The Mammalian Evolutionary Morphology Lab studies mammalian functional morphology, systematics, and evolution across living and fossil groups.',
      shortDescription:
        'Studies mammalian functional morphology, systematics, and evolution across living and fossil groups.',
      researchAreas: ['Mammalian evolutionary morphology', 'Functional morphology', 'Primate evolution'],
    };
    expect(sanitizeServedResearchEntityCopyFields(entity)).toBe(entity);
  });
});

describe('isSyntheticResearchHomeMetadataDescription "is connected to <chips>" stub (#1511)', () => {
  it('flags the keyword-list-fallback stub even when a chip label ends in a bare research-activity noun', () => {
    expect(
      isSyntheticResearchHomeMetadataDescription(
        'Example Lab is connected to health disparities and outcomes, posttraumatic stress disorder, suicide and self-harm studies, and schizophrenia.',
      ),
    ).toBe(true);
    expect(
      isSyntheticResearchHomeMetadataDescription(
        'Example Research is connected to genetic neurodegenerative diseases, mitochondrial function and pathology, and developmental biology and gene regulation.',
      ),
    ).toBe(true);
  });

  it('keeps a genuine "is connected to" sentence whose verb takes a real object', () => {
    expect(
      isSyntheticResearchHomeMetadataDescription(
        'Example Lab is connected to a broader effort that investigates how neurons in the hippocampus encode memory.',
      ),
    ).toBe(false);
  });

  it('blanks the served fullDescription for the keyword-list "is connected to" stub', () => {
    const served = sanitizeServedResearchEntityCopyFields({
      fullDescription:
        'Example Lab is connected to health disparities and outcomes, posttraumatic stress disorder, suicide and self-harm studies, and schizophrenia.',
      shortDescription:
        'Research connected to health disparities and outcomes, posttraumatic stress disorder, and schizophrenia.',
    });
    expect(served.fullDescription).toBe('');
  });
});
