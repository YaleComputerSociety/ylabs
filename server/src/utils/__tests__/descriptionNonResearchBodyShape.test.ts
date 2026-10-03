import { describe, expect, it } from 'vitest';
import { nonResearchBodyShape } from '../descriptionNonResearchBodyShape';
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
