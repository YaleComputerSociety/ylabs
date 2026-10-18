import { describe, expect, it } from 'vitest';
import {
  isEventNarrationText,
  isJoiningInstructionsText,
  isRoleBiographyWithoutResearchOrPractice,
  nonResearchBodyShape,
} from '../descriptionNonResearchBodyShape';
import {
  fullDescriptionQuality,
  shortDescriptionQuality,
} from '../researchEntityDescriptionQuality';

const careerOfficeBiography =
  'The staff member joined the Career Management Center as Associate Director in 2023 and became Senior Associate Director in 2026. In the center, the associate director plans student engagement programming, manages the career platform, and advises students and alumni individually.';

const lectorBiography =
  'The lector teaches Modern Hebrew at every level and is known for innovative classroom methods. Courses use technological tools to help students think independently, and the lector shares an appreciation for the arts with every class.';

const submissionCall =
  'Artist Collaboration & Image Selection: Artists interested in collaborating will receive an overview of the season, including the themes of each play. Usage & Rights: The artist retains all ownership and copyright of submitted work and grants the company a non-exclusive license to display it.';

const eventPage =
  'The Example Architecture Biennale 2023 was open from 20 May to 26 November, curated by a visiting architect who has written widely on design and the city.';

const sectionBlurbs =
  'Research goals, types of research the agency funds, and its scientific priorities. Highlights of recently published studies funded by the agency. Documentation from the agency on proper research procedures. Lists of research and training grants funded by the agency.';

const instructionOffering =
  'Example culinary medicine provides opportunities for medical education through hands-on lessons in preparing meals that promote wellness. Taught at a teaching kitchen in the hospital, classes focus on how cooking can help prevent chronic disease.';

describe('nonResearchBodyShape (#4528)', () => {
  it('reads an administrative biography with no research as a role biography', () => {
    expect(nonResearchBodyShape(careerOfficeBiography)).toBe('role-biography');
  });

  it('does not read an instrument or design word with an ordinary meaning as practice (#4551)', () => {
    expect(
      nonResearchBodyShape(
        `${careerOfficeBiography} The office also supports the organ transplant program and the brand identity of the center.`,
      ),
    ).toBe('role-biography');
  });

  it('reads a teaching-only biography as a role biography', () => {
    expect(nonResearchBodyShape(lectorBiography)).toBe('role-biography');
  });

  it('reads a call for submissions, an event page and section blurbs as another page', () => {
    expect(nonResearchBodyShape(submissionCall)).toBe('third-party-page');
    expect(nonResearchBodyShape(eventPage)).toBe('third-party-page');
    expect(nonResearchBodyShape(sectionBlurbs)).toBe('third-party-page');
  });

  it('reads an education program description filed as a lab as an instruction offering', () => {
    expect(nonResearchBodyShape(instructionOffering, 'LAB')).toBe('instruction-offering');
  });

  it('keeps training and workshops as the service of a core facility or a center', () => {
    const coreFacilityService =
      'The example core provides hands-on training on shared instruments for campus users. Workshops cover sample preparation and instrument scheduling.';
    expect(nonResearchBodyShape(coreFacilityService, 'CORE_FACILITY')).toBeNull();
    expect(nonResearchBodyShape(instructionOffering, 'CORE_FACILITY')).toBeNull();
    expect(nonResearchBodyShape(instructionOffering, 'CENTER')).toBeNull();
    expect(nonResearchBodyShape(instructionOffering)).toBeNull();
  });

  it('keeps a role biography that also states research, practice, care or a faculty rank', () => {
    for (const body of [
      `${lectorBiography} Her research examines second-language acquisition in adult learners.`,
      `${careerOfficeBiography} She has performed with orchestras across Europe.`,
      'The coordinator manages the clinic and oversees patient intake, and treats patients with chronic pain.',
      'The associate professor teaches courses in statistics and coordinates the curriculum for the department.',
    ]) {
      expect(nonResearchBodyShape(body)).toBeNull();
    }
  });

  it('keeps a role biography whose research claim opens a later sentence', () => {
    for (const body of [
      `${lectorBiography} Investigates code-switching in bilingual children.`,
      `${lectorBiography} Research in the lector's group concerns heritage speakers.`,
    ]) {
      expect(nonResearchBodyShape(body)).toBeNull();
    }
  });

  it('keeps an instruction offering on a lab that also states research', () => {
    expect(
      nonResearchBodyShape(
        'The imaging lab provides training on confocal microscopes for researchers. Workshops cover sample preparation and image analysis.',
        'LAB',
      ),
    ).toBeNull();
  });

  it('does not read a department name inside a lowercase opening sentence as research', () => {
    expect(
      nonResearchBodyShape(
        'in 2023 the coordinator joined Research Computing as manager of its user accounts and oversees the help desk.',
      ),
    ).toBe('role-biography');
  });

  it('does not read a department name as a research statement', () => {
    expect(
      nonResearchBodyShape(
        'The inaugural director of diversity, equity, and inclusion holds a degree in Africana Studies and leads the office that supports students, with experience as a coordinator of campus programs.',
      ),
    ).toBe('role-biography');
  });

  it('leaves research prose alone', () => {
    expect(
      nonResearchBodyShape(
        'The lab studies how example tissues repair after injury, combining imaging, genetics and computational modelling of cell behaviour.',
      ),
    ).toBeNull();
  });

  it('refuses each shape as a body and as a card in the quality bar', () => {
    expect(fullDescriptionQuality(careerOfficeBiography).flags).toContain('role-biography');
    expect(fullDescriptionQuality(submissionCall).flags).toContain('third-party-page');
    expect(fullDescriptionQuality(instructionOffering, undefined, 'LAB').isUseful).toBe(false);
    expect(
      shortDescriptionQuality(
        'Taught at a teaching kitchen, classes focus on cooking, and hands-on lessons teach healthy meals.',
        instructionOffering,
        undefined,
        { entityType: 'LAB' },
      ).flags,
    ).toContain('instruction-offering');
    expect(
      fullDescriptionQuality(instructionOffering, undefined, 'CORE_FACILITY').flags,
    ).not.toContain('instruction-offering');
  });
});

describe('a career narrative of past posts only', () => {
  it('is a role biography even when an old post mentions care', () => {
    expect(
      isRoleBiographyWithoutResearchOrPractice(
        'Mx. Fixture was the director of public policy for an example foundation, where they led advocacy for funding. Prior to that, they were a senior policy officer at another foundation, where they focused on treatment access. They have a B.A. from Example University.',
      ),
    ).toBe(true);
  });

  it('is not a role biography when it states a current area of expertise', () => {
    expect(
      isRoleBiographyWithoutResearchOrPractice(
        'An expert in gender, health and human rights, Fixture was faculty director of an example center.',
      ),
    ).toBe(false);
  });
});

const joiningInstructions =
  'Students and researchers interested in joining the Example Lab as an undergraduate research assistant, graduate research assistant, or postdoctoral researcher should contact the lab director directly. The lab will also occasionally post job openings with the Student Employment Office. Prospective doctoral students should apply to the PhD program in Example Biology at the Graduate School.';

const keynoteNarration =
  'Gives keynote presentations on representation learning and foundation models, focusing on representation learning and foundation models.';

const acceptedPapersNews =
  '6 papers accepted at an example conference: four method papers and two on multi-table reasoning. More details to come soon!';

describe('a body that says how to join or narrates events (#5109)', () => {
  it('reads a page of joining instructions as joining instructions', () => {
    expect(nonResearchBodyShape(joiningInstructions, 'LAB')).toBe('joining-instructions');
    expect(
      isJoiningInstructionsText(
        'If you are a prospective graduate student or postdoc interested in working with me, please reach out and describe your interests and background.',
      ),
    ).toBe(true);
  });

  it('keeps research prose that closes with a joining line', () => {
    const researchThenJoin =
      'The lab studies how bacteriophages evolve to infect new hosts and tests phage therapies against resistant infections. Students interested in joining the lab should contact the lab director.';
    expect(isJoiningInstructionsText(researchThenJoin)).toBe(false);
    expect(nonResearchBodyShape(researchThenJoin, 'LAB')).toBeNull();
  });

  it('reads talk, award and accepted-paper narration as event narration', () => {
    expect(nonResearchBodyShape(keynoteNarration, 'LAB')).toBe('event-narration');
    expect(nonResearchBodyShape(acceptedPapersNews, 'LAB')).toBe('event-narration');
    expect(
      isEventNarrationText(
        'The lab director received the example society award for young investigators.',
      ),
    ).toBe(true);
  });

  it('keeps research whose object is an award or a talk, and a talk named after other work', () => {
    expect(
      isEventNarrationText(
        'Examines how evaluation processes shape organizational and market opportunities, who gets hired, which startups are funded, who wins awards, and how workers are rated.',
      ),
    ).toBe(false);
    expect(
      isEventNarrationText(
        'Writes fiction and nonfiction on industrial farming and national politics; develops screenplays for television; gives talks and workshops internationally.',
      ),
    ).toBe(false);
  });

  it('keeps service, outreach and funding prose that shares a verb with joining or event lines', () => {
    expect(
      nonResearchBodyShape(
        'Researchers can submit samples for sequencing through the online portal; the core provides library preparation and data analysis.',
        'CORE_FACILITY',
      ),
    ).toBeNull();
    expect(
      isEventNarrationText(
        'The program delivers community health interventions and addresses tobacco disparities.',
      ),
    ).toBe(false);
    expect(
      isEventNarrationText(
        'The center receives support from federal awards to study coastal flooding.',
      ),
    ).toBe(false);
  });

  it('keeps research prose whose wording overlaps an application, a naming or an acceptance', () => {
    expect(
      isJoiningInstructionsText(
        'We are interested in how cells can apply mechanical forces to their surroundings.',
      ),
    ).toBe(false);
    expect(
      nonResearchBodyShape(
        'Researchers can contact the facility manager to arrange training on the confocal microscopes.',
        'CORE_FACILITY',
      ),
    ).toBeNull();
    expect(
      isEventNarrationText(
        'Our group works on how new social norms become accepted in communities.',
      ),
    ).toBe(false);
    expect(
      isEventNarrationText(
        'Our work examines why some practices are accepted in rural clinics.',
      ),
    ).toBe(false);
    expect(
      isEventNarrationText(
        'The center was named in honor of its founder and studies coastal flooding.',
      ),
    ).toBe(false);
    expect(
      isEventNarrationText('Two papers from the lab have been accepted at an example conference.'),
    ).toBe(true);
  });

  it('fails the quality bar for both the body and the card', () => {
    expect(fullDescriptionQuality(joiningInstructions, undefined, 'LAB').flags).toContain(
      'joining-instructions',
    );
    expect(fullDescriptionQuality(keynoteNarration, undefined, 'LAB').isUseful).toBe(false);
    expect(
      shortDescriptionQuality(keynoteNarration, joiningInstructions, undefined, {
        entityType: 'LAB',
      }).flags,
    ).toContain('event-narration');
  });
});
