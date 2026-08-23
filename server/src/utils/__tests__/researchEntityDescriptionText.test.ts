import { describe, expect, it } from 'vitest';

import {
  isDirectoryIndexChromeText,
  isPersonBiographyOrAdvisingDescription,
  isResearchEntitySourceChromeText,
  publicResearchEntityDescriptionText,
  repairSubjectlessResearchLead,
  revoiceFirstPersonResearchLead,
  sanitizeFacultyResearchEntityText,
  sanitizeResearchEntityPublicDescriptionFields,
  sanitizeResearchHomeSelfReferenceCopyFields,
  sanitizeResearchHomeSelfReferenceText,
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

  it('does not apply the non-person biography guard to faculty-research entities', () => {
    const facultyResearch = {
      entityType: 'FACULTY_RESEARCH_AREA',
      kind: 'individual',
      fullDescription: PROGRAM_DIRECTOR_BIO,
    };
    const sanitized = sanitizeResearchEntityPublicDescriptionFields(facultyResearch);

    expect(sanitized.fullDescription).toBe(PROGRAM_DIRECTOR_BIO);
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

  it('does not re-voice first-person advising notes into third person (#964 stays scoped)', () => {
    const facultyResearch = {
      entityType: 'FACULTY_RESEARCH_AREA',
      kind: 'individual',
      fullDescription: PROGRAM_DIRECTOR_BIO,
    };
    const sanitized = sanitizeResearchEntityPublicDescriptionFields(facultyResearch);

    expect(sanitized.fullDescription).toBe(PROGRAM_DIRECTOR_BIO);
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

  it('leaves idiomatic first-person-plural phrasing and unconjugated subject clauses untouched', () => {
    expect(
      revoiceFirstPersonResearchLead('This work advances our understanding of neurodegeneration.'),
    ).toBe('This work advances our understanding of neurodegeneration.');
    expect(revoiceFirstPersonResearchLead('We study gene expression in lung disease.')).toBe(
      'We study gene expression in lung disease.',
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
    expect(repairSubjectlessResearchLead('Research focuses on X.')).toBe('Focuses on X.');
    expect(repairSubjectlessResearchLead('Research studies X.')).toBe('Studies X.');
    expect(repairSubjectlessResearchLead('Research explores X.')).toBe('Explores X.');
  });

  it('only repairs the leading fragment, leaving later "Research interests include" sentences intact', () => {
    expect(
      repairSubjectlessResearchLead(
        'Research focuses on econometric theory. Research interests include inference under partial identification.',
      ),
    ).toBe(
      'Focuses on econometric theory. Research interests include inference under partial identification.',
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
