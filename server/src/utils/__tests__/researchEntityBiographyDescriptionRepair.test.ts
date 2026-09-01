import { describe, expect, it } from 'vitest';

import {
  hasMultipleCareerTimelineSentences,
  hasProfileFieldLabelChromeSignal,
  isEducationOrCareerTimelineSentence,
  isProfileBiographyChromeOpener,
  protectedSentenceList,
  repairPersonBiographyLeakedDescription,
  stripLeadingDegreeListPrefix,
  stripProfileBiographyChromeOpener,
  stripProfileFieldLabelChrome,
  stripTrailingProfileChromeFooter,
} from '../researchEntityBiographyDescriptionRepair';

describe('isEducationOrCareerTimelineSentence', () => {
  it('flags personal-life and education-timeline sentences (#1456)', () => {
    expect(
      isEducationOrCareerTimelineSentence(
        'Satinder was born in Boston, MA and moved, as a teenager, to Minneapolis, MN, with her family.',
      ),
    ).toBe(true);
    expect(
      isEducationOrCareerTimelineSentence(
        'She received her doctoral degree in Biochemistry & Molecular Biophysics from the University of Minnesota.',
      ),
    ).toBe(true);
    expect(
      isEducationOrCareerTimelineSentence(
        'Next, he completed his graduate studies on cell cytoskeleton and protein trafficking under the direction of John V. Cox.',
      ),
    ).toBe(true);
  });

  it('does not flag a sentence describing what the lab studies, even if it mentions "studies" as a noun', () => {
    expect(
      isEducationOrCareerTimelineSentence(
        'Dr. Ghosh and Dr. Carla Rothlin co-direct a lab studying the regulation of inflammation.',
      ),
    ).toBe(false);
  });

  it('flags a career-timeline sentence naming a non-Yale institution (#1791: Holly Rushmeier)', () => {
    expect(
      isEducationOrCareerTimelineSentence(
        'In 1988 she joined the Mechanical Engineering faculty at Georgia Tech.',
      ),
    ).toBe(true);
    expect(
      isEducationOrCareerTimelineSentence(
        'Holly Rushmeier received the BS, MS and PhD degrees in Mechanical Engineering from Cornell University.',
      ),
    ).toBe(true);
    expect(
      isEducationOrCareerTimelineSentence(
        'From 1996 to early 2004 Dr. Rushmeier was a research staff member at the IBM T.J. Watson Research Center.',
      ),
    ).toBe(true);
    expect(
      isEducationOrCareerTimelineSentence(
        'In 1996 she served as the papers chair for the ACM SIGGRAPH conference.',
      ),
    ).toBe(true);
    expect(
      isEducationOrCareerTimelineSentence(
        'Dr. Rushmeier was Editor-in-Chief of ACM Transactions on Graphics from 1996-99.',
      ),
    ).toBe(true);
  });
});

describe('isEducationOrCareerTimelineSentence: humanities CV markers (#1533)', () => {
  it('flags award/honorary-degree/teaching-history/editorial CV sentences with no research-topic signal', () => {
    expect(
      isEducationOrCareerTimelineSentence(
        'Professor Benhabib is the recipient of the Ernst Bloch prize for 2009.',
      ),
    ).toBe(true);
    expect(
      isEducationOrCareerTimelineSentence(
        'She has previously taught at the New School for Social Research and Harvard Universities.',
      ),
    ).toBe(true);
    expect(
      isEducationOrCareerTimelineSentence(
        'Professor Benhabib holds Honorary Degrees from the Universities of Utrecht (2004) and Valencia (2010).',
      ),
    ).toBe(true);
    expect(
      isEducationOrCareerTimelineSentence(
        "She is the author of several influential works including 'Critique, Norm and Utopia'.",
      ),
    ).toBe(true);
    expect(
      isEducationOrCareerTimelineSentence('Earlier, he was CEO of the Clinton Foundation.'),
    ).toBe(true);
  });

  it('flags an appositive "born in" clause without "was" (#1533: benhabib-sb422)', () => {
    expect(
      isEducationOrCareerTimelineSentence(
        'Seyla Benhabib, born in Istanbul, Turkey, is the Eugene Meyer Professor of Political Science.',
      ),
    ).toBe(true);
  });
});

describe('stripLeadingDegreeListPrefix (#1533)', () => {
  it('strips a spaced degree-year list before a name-lead sentence', () => {
    expect(
      stripLeadingDegreeListPrefix(
        'B.A., Yale University, 2003 M.A., Harvard University, 2006 Ph.D., Harvard University, 2011 Marisa Bass is a scholar of early modern art.',
      ),
    ).toBe('Marisa Bass is a scholar of early modern art.');
  });

  it('strips a no-space-glued degree-year list (#1533: brisman-brisman)', () => {
    expect(
      stripLeadingDegreeListPrefix(
        'Ph.D., Cornell University, 1969M.A., Cornell University, 1966B.A., Columbia University, 1965 Brisman’s interests include Spenser and Milton.',
      ),
    ).toBe('Brisman’s interests include Spenser and Milton.');
  });

  it('strips a degree list with no year at all (#1533: bare institution names)', () => {
    expect(
      stripLeadingDegreeListPrefix(
        'B.A., Stanford University Ph.D., Yale University Jennifer Raab specializes in the arts of the United States.',
      ),
    ).toBe('Jennifer Raab specializes in the arts of the United States.');
  });

  it('leaves ordinary research prose untouched', () => {
    expect(stripLeadingDegreeListPrefix('Studies chromatin dynamics in stem cells.')).toBe(
      'Studies chromatin dynamics in stem cells.',
    );
  });

  it('does not strip a degree list that has nothing usable left afterward', () => {
    const bareDegreeList = 'B.A., Yale University, 2003 M.A., Harvard University, 2006.';
    expect(stripLeadingDegreeListPrefix(bareDegreeList)).toBe(bareDegreeList);
  });
});

describe('stripProfileFieldLabelChrome (#1533)', () => {
  it('strips leading "Specializations:" and a later "About:" form-field label (Music dept)', () => {
    expect(
      stripProfileFieldLabelChrome(
        'Specializations: History of theory. About: My scholarship focuses on the global history of music theory.',
      ),
    ).toBe('History of theory. My scholarship focuses on the global history of music theory.');
  });

  it('strips the labels even with no period between the specialization list and "About:"', () => {
    expect(
      stripProfileFieldLabelChrome(
        'Specializations: opera staging; media archaeology About: Gundula Kreuzer studied musicology at Oxford.',
      ),
    ).toBe('opera staging; media archaeology Gundula Kreuzer studied musicology at Oxford.');
  });

  it('leaves ordinary research prose untouched', () => {
    expect(stripProfileFieldLabelChrome('Studies chromatin dynamics in stem cells.')).toBe(
      'Studies chromatin dynamics in stem cells.',
    );
  });
});

describe('hasProfileFieldLabelChromeSignal (#1533)', () => {
  it('detects the "Specializations:"/"About:" scaffold regardless of research-focus content elsewhere', () => {
    expect(
      hasProfileFieldLabelChromeSignal(
        'Specializations: opera staging; media archaeology About: Gundula Kreuzer studied musicology at Oxford. Her current research interests include contemporary experimental opera.',
      ),
    ).toBe(true);
  });

  it('does not flag ordinary research prose', () => {
    expect(hasProfileFieldLabelChromeSignal('Studies chromatin dynamics in stem cells.')).toBe(
      false,
    );
  });
});

describe('isEducationOrCareerTimelineSentence: recruiting-note sentence (#1533)', () => {
  it('flags a "who we recruit" note as a non-research sentence (faculty-research-area-francis-lee)', () => {
    expect(
      isEducationOrCareerTimelineSentence(
        'My research group is committed to engaging undergraduate students, Yale medical students for Thesis, M.D.-Ph.D. Students, other graduate students, and visiting fellows for research opportunities and career advancement.',
      ),
    ).toBe(true);
    expect(
      isEducationOrCareerTimelineSentence(
        '-Ph.D. Students, other graduate students, and visiting fellows for research opportunities and career advancement.',
      ),
    ).toBe(true);
  });
});

describe('isEducationOrCareerTimelineSentence: first-person CV/credential facts (#1638)', () => {
  it('flags first-person career/administrative-role facts', () => {
    expect(
      isEducationOrCareerTimelineSentence(
        'Previously as Director of Biostatistics at the Yale Program on Aging for 12 years, I founded the field of Gerontological Biostatistics.',
      ),
    ).toBe(true);
    expect(
      isEducationOrCareerTimelineSentence(
        'I previously chaired the Alzheimer’s Disease Research Center’s Data Cores Steering Committee.',
      ),
    ).toBe(true);
    expect(
      isEducationOrCareerTimelineSentence(
        'I have a wealth of experience conducting epidemiologic studies and am a recognized authority on longitudinal statistical methods.',
      ),
    ).toBe(true);
    expect(
      isEducationOrCareerTimelineSentence(
        'With over 300 peer-reviewed articles and continuous NIH funding since 2000, my research has focused on issues related to older adults.',
      ),
    ).toBe(true);
  });

  it('does not flag first-person sentences describing ongoing research content', () => {
    expect(
      isEducationOrCareerTimelineSentence(
        'My laboratory has completed several epidemiological studies in well-defined populations of individuals with and without AMD.',
      ),
    ).toBe(false);
    expect(
      isEducationOrCareerTimelineSentence(
        'We combined microscopy, biochemistry, biophysics, molecular genetics and mathematical modeling to formulate a detailed molecular explanation.',
      ),
    ).toBe(false);
  });
});

describe('hasMultipleCareerTimelineSentences (#1638)', () => {
  it('flags a first-person CV/bio dump with several career-timeline sentences', () => {
    const allore =
      "Previously as Director of Biostatistics at the Yale Program on Aging for 12 years, I founded the field of Gerontological Biostatistics. I previously chaired the Alzheimer's Disease Research Center's Data Cores Steering Committee. I have a wealth of experience conducting epidemiologic studies and am a recognized authority on longitudinal statistical methods.";
    expect(hasMultipleCareerTimelineSentences(allore)).toBe(true);
  });

  it('does not flag a legitimate first-person research description (Hoh Lab)', () => {
    const hoh =
      'My research goals are to understand the principle of interactions among genes, environmental exposures as well as stochastic random effects in relationship to the disease expression and pathogenesis. In collaboration with epidemiologists, statisticians, computer scientists, molecular biologists and physicians, our strategy is to develop an organized and systematic approach to tackle the problem through the analysis of several chronic diseases. At the moment we are investigating age-related macular degeneration. My laboratory has completed several epidemiological studies in well-defined populations of individuals with and without AMD.';
    expect(hasMultipleCareerTimelineSentences(hoh)).toBe(false);
  });

  it('does not flag a legitimate first-person research-history description (Pollard Lab)', () => {
    const pollard =
      'Starting in the 1960s, I have investigated along with members of my laboratory the molecular basis of cellular movements and cytokinesis using a combination of biochemistry, biophysics, microscopy and computational modeling. My laboratory discovered and characterized many proteins that produce forces for cells to move including the first unconventional myosin. We combined microscopy, biochemistry, biophysics, molecular genetics and mathematical modeling to provide the quantitative evidence required to formulate a detailed molecular explanation.';
    expect(hasMultipleCareerTimelineSentences(pollard)).toBe(false);
  });

  it('does not flag a single incidental career-fact sentence', () => {
    expect(
      hasMultipleCareerTimelineSentences(
        'Studies chromatin dynamics in stem cells. In 1988 she joined the Mechanical Engineering faculty at Georgia Tech before returning to this line of research.',
      ),
    ).toBe(false);
  });

  it('returns false for blank input', () => {
    expect(hasMultipleCareerTimelineSentences('')).toBe(false);
    expect(hasMultipleCareerTimelineSentences(undefined)).toBe(false);
  });
});

describe('isProfileBiographyChromeOpener / stripProfileBiographyChromeOpener', () => {
  it('detects and strips a leading "Welcome!" / "Bio:" / "Titles...Biography" opener', () => {
    expect(
      isProfileBiographyChromeOpener('Welcome! We are part of the Yale School of Medicine.'),
    ).toBe(true);
    expect(
      stripProfileBiographyChromeOpener('Welcome! We are part of the Yale School of Medicine.'),
    ).toBe('We are part of the Yale School of Medicine.');
    expect(
      stripProfileBiographyChromeOpener(
        'TitlesAssistant Professor of Medicine (General Medicine)BiographyDavid Fink is a social epidemiologist.',
      ),
    ).toBe('David Fink is a social epidemiologist.');
  });

  it('leaves ordinary research prose untouched', () => {
    expect(isProfileBiographyChromeOpener('Studies chromatin dynamics in stem cells.')).toBe(false);
  });
});

describe('stripTrailingProfileChromeFooter', () => {
  it('strips a profile-page "Departments & Organizations" footer glued onto the last sentence', () => {
    expect(
      stripTrailingProfileChromeFooter(
        'He is funded by NIDA to investigate telehealth guidelines.Last Updated on June 02, 2026.Departments & OrganizationsInternal MedicinePhDColumbia University, Epidemiology (2020)',
      ),
    ).toBe('He is funded by NIDA to investigate telehealth guidelines.');
  });
});

describe('protectedSentenceList', () => {
  it('does not drop text around an unspaced abbreviation like "Ph.D studies" (#1456)', () => {
    const sentences = protectedSentenceList(
      'He then came to the U.S. to pursue Ph.D studies with Carl Nathan in the Immunology program.',
    );
    expect(sentences).toEqual([
      'He then came to the U.S. to pursue Ph.D studies with Carl Nathan in the Immunology program.',
    ]);
  });

  it('does not drop text around a sentence whose interior period sits before a closing parenthesis (#1791)', () => {
    const sentences = protectedSentenceList(
      'She has lectured at many meetings, including three invited keynote presentations (Eurographics Rendering Workshop 94, 3DIM 01, Eurographics Conference 2001.) Dr. Rushmeier has also served on program committees.',
    );
    expect(sentences).toEqual([
      'She has lectured at many meetings, including three invited keynote presentations (Eurographics Rendering Workshop 94, 3DIM 01, Eurographics Conference 2001.) Dr. Rushmeier has also served on program committees.',
    ]);
  });
});

describe('repairPersonBiographyLeakedDescription', () => {
  it('strips a personal-life narrative and keeps the genuine research content (singh-lab-sks4, #1456)', () => {
    const result = repairPersonBiographyLeakedDescription({
      fullDescription:
        'Satinder was born in Boston, MA and moved, as a teenager, to Minneapolis, MN, with her family. She received her doctoral degree in Biochemistry & Molecular Biophysics from the University of Minnesota, supported by an HHMI Predoctoral Fellowship. She has had a long-standing interest in the molecular mechanisms of neuropsychiatric disease. As a postdoctoral fellow, she combined her knowledge of neuropsychopharmacology and enzymology with X-ray crystallography to develop molecular models of transport and inhibition for LeuT.',
      shortDescription:
        'As a postdoctoral fellow, she combined her knowledge of neuropsychopharmacology and enzymology with X-ray crystallography to develop molecular models of transport and inhibition for LeuT.',
      researchAreas: [],
    });
    expect(result.outcome).toBe('resynthesized');
    expect(result.fullDescription).not.toMatch(/was born in/i);
    expect(result.fullDescription).not.toMatch(/received her doctoral degree/i);
    expect(result.fullDescription).toMatch(/long-standing interest/i);
    expect(result.shortDescription).toBe(
      'As a postdoctoral fellow, she combined her knowledge of neuropsychopharmacology and enzymology with X-ray crystallography to develop molecular models of transport and inhibition for LeuT.',
    );
  });

  it('strips profile chrome (leading + trailing) while keeping a good short description untouched (nih-pi-david-fink, #1456)', () => {
    const result = repairPersonBiographyLeakedDescription({
      fullDescription:
        'TitlesAssistant Professor of Medicine (General Medicine)BiographyDavid Fink, PhD, MPH is a social epidemiologist whose research applies a multi-level life course perspective, coupled with rigorous causal inference methodologies, to understand the causes of addiction and mental illness and estimate the effects of policies and programs. His research in mental health, substance use, and health policy are united by a desire to understand and address structural, societal, and interpersonal factors that shape health and well-being over the life course. He received his Masters in Public Health in epidemiology and biostatistics from San Diego State University and his PhD from Columbia University where his research focused on understanding the effects of cannabis legalization and prescription drug monitoring programs on drug-related morbidity and mortality. He is currently an assistant professor in Department of Internal Medicine at Yale, where he is funded by NIDA to investigate the effects of more flexible telehealth guidelines for buprenorphine prescribing for opioid use disorder.Last Updated on June 02, 2026.Departments & OrganizationsInternal MedicineJaneway SocietyEducation & TrainingPostdoctoral research fellowNew York State Psychiatric Institute (2025)PhDColumbia University, Epidemiology (2020)',
      shortDescription:
        'Investigates the effects of flexible telehealth guidelines for buprenorphine prescribing on opioid use disorder.',
      researchAreas: ['Substance-Related Disorders', 'Mental Health'],
    });
    expect(result.outcome).toBe('resynthesized');
    expect(result.fullDescription.startsWith('TitlesAssistant')).toBe(false);
    expect(result.fullDescription).not.toMatch(/Departments\s*&\s*Organizations/);
    expect(result.shortDescription).toBe(
      'Investigates the effects of flexible telehealth guidelines for buprenorphine prescribing on opioid use disorder.',
    );
  });

  it('reports unchanged for a description with no biography/CV/chrome signature', () => {
    const result = repairPersonBiographyLeakedDescription({
      fullDescription:
        'Our lab studies how microbes defend themselves against stress at the host-pathogen interface.',
      shortDescription: 'Studies host-pathogen stress response.',
      researchAreas: ['Microbiology'],
    });
    expect(result.outcome).toBe('unchanged');
  });

  it('falls back to a researchAreas card summary when nothing research-focused survives stripping', () => {
    const result = repairPersonBiographyLeakedDescription({
      fullDescription:
        'Jane Doe was born in Boston, MA. She received her doctoral degree from Harvard University. She completed her postdoctoral training at MIT. She joined the Yale faculty in 2015.',
      shortDescription: 'She received her doctoral degree from Harvard University.',
      researchAreas: ['Cell Biology', 'Genetics'],
    });
    expect(result.outcome).toBe('resynthesized');
    expect(result.fullDescription).toBe('Studies Cell Biology and Genetics.');
    expect(result.shortDescription).toBe('Studies Cell Biology and Genetics.');
  });

  it('strips a multi-institution career chronology, keeping past-employer research topics and dropping degree/faculty/service facts (rushmeier-lab-hr77, #1791)', () => {
    const result = repairPersonBiographyLeakedDescription({
      fullDescription:
        'Holly Rushmeier received the BS, MS and PhD degrees in Mechanical Engineering from Cornell University in 1977, 1986 and 1988 respectively. Between receiving the BS and returning to graduate school in 1983 she worked as an engineer at the Boeing Commercial Airplane Company. In 1988 she joined the Mechanical Engineering faculty at Georgia Tech. While there she conducted sponsored research in the area of computer graphics image synthesis. From 1996 to early 2004 Dr. Rushmeier was a research staff member at the IBM T.J. Watson Research Center. At IBM she worked on a variety of data visualization problems in applications ranging from engineering to finance. Dr. Rushmeier was Editor-in-Chief of ACM Transactions on Graphics from 1996-99. In 1996 she served as the papers chair for the ACM SIGGRAPH conference.',
      shortDescription:
        'Studies Computer Graphics and Visualization Techniques, 3D Shape Modeling and Analysis, and 3D Surveying and Cultural Heritage.',
      researchAreas: ['Computer Graphics', 'Image Synthesis', 'Scientific Data Visualization'],
    });
    expect(result.outcome).toBe('resynthesized');
    expect(result.fullDescription).not.toMatch(/received the BS, MS and PhD degrees/i);
    expect(result.fullDescription).not.toMatch(/joined the Mechanical Engineering faculty/i);
    expect(result.fullDescription).not.toMatch(/was a research staff member/i);
    expect(result.fullDescription).not.toMatch(/was Editor-in-Chief/i);
    expect(result.fullDescription).not.toMatch(/served as the papers chair/i);
    expect(result.fullDescription).toMatch(
      /conducted sponsored research in the area of computer graphics/i,
    );
    expect(result.shortDescription).toBe(
      'Studies Computer Graphics and Visualization Techniques, 3D Shape Modeling and Analysis, and 3D Surveying and Cultural Heritage.',
    );
  });

  it('strips a leading degree-list and rebuilds the research-focused remainder (bass-mab84, #1533)', () => {
    const result = repairPersonBiographyLeakedDescription({
      fullDescription:
        'B.A., Yale University, 2003 M.A., Harvard University, 2006 Ph.D., Harvard University, 2011 Marisa Bass is a scholar of early modern art whose research explores the intersections between creative and intellectual culture in northern Europe.',
      shortDescription: '',
      researchAreas: ['Art History'],
    });
    expect(result.outcome).toBe('resynthesized');
    expect(result.fullDescription.startsWith('B.A.,')).toBe(false);
    expect(result.fullDescription).toMatch(/^Marisa Bass is a scholar/);
  });

  it('falls back to a researchAreas summary for a humanities CV/bio with no research-topic sentence at all (benhabib-sb422, #1533)', () => {
    const result = repairPersonBiographyLeakedDescription({
      fullDescription:
        'Seyla Benhabib, born in Istanbul, Turkey, is the Eugene Meyer Professor of Political Science and Philosophy at Yale University. Professor Benhabib is the recipient of the Ernst Bloch prize for 2009. She has previously taught at the New School for Social Research and Harvard Universities. Professor Benhabib holds Honorary Degrees from the Universities of Utrecht (2004) and Valencia (2010).',
      shortDescription:
        'She has previously taught at the New School for Social Research and Harvard Universities.',
      researchAreas: ['Philosophy', 'Critical Theory', 'Democracy', 'Human Rights'],
    });
    expect(result.outcome).toBe('resynthesized');
    expect(result.fullDescription).toBe(
      'Studies Philosophy, Critical Theory, Democracy, and Human Rights.',
    );
    expect(result.shortDescription).toBe(
      'Studies Philosophy, Critical Theory, Democracy, and Human Rights.',
    );
  });

  it('blanks an executive-résumé description with no research signal and no researchAreas (braverman-lab-ericb, #1533)', () => {
    const result = repairPersonBiographyLeakedDescription({
      fullDescription:
        "Earlier, he was CEO of the Clinton Foundation, where he strengthened governance, transparency, and strategic management, and a partner at McKinsey & Company, where he co-founded the firm's government practice.",
      shortDescription:
        'He has also led organizations in philanthropy, technology, and public service.',
      researchAreas: [],
    });
    expect(result.outcome).toBe('blanked');
    expect(result.fullDescription).toBe('');
    expect(result.shortDescription).toBe('');
  });

  it('blanks the description when nothing usable can be derived at all', () => {
    const result = repairPersonBiographyLeakedDescription({
      fullDescription:
        'Jane Doe was born in Boston, MA. She received her doctoral degree from Harvard University. She completed her postdoctoral training at MIT. She joined the Yale faculty in 2015.',
      shortDescription: 'She received her doctoral degree from Harvard University.',
      researchAreas: [],
    });
    expect(result.outcome).toBe('blanked');
    expect(result.fullDescription).toBe('');
    expect(result.shortDescription).toBe('');
  });
});
