import { describe, expect, it } from 'vitest';

import {
  isWorkforceDevelopmentPracticeSentence,
  withoutOrganizationFocusAppositive,
} from '../../utils/careerBiographyDescription';
import {
  buildResearchEntityPublicDescriptionRepresentation,
  servedBodyIsCareerBiographyWithoutResearch,
} from '../researchEntityPublicDescription';

const row = (fullDescription: string, shortDescription: string): Record<string, any> => ({
  slug: 'fixture-administrator-biography',
  name: 'Synthetic Administrator Faculty Research',
  kind: 'individual',
  entityType: 'FACULTY_RESEARCH_AREA',
  researchAreas: ['Public Health'],
  sourceUrls: ['https://example.edu/fixture-administrator-biography'],
  fullDescription,
  shortDescription,
});

const careerHold = (fullDescription: string, shortDescription: string): boolean =>
  servedBodyIsCareerBiographyWithoutResearch(
    buildResearchEntityPublicDescriptionRepresentation({
      entity: row(fullDescription, shortDescription),
    }),
  );

const operationsOfficerBody = [
  'Mr. Example is the Chief Operating Officer of Synthetic Behavioral Health and the Synthetic Group on Workforce Development.',
  'He is also an Assistant Clinical Professor in the Department of Psychiatry.',
  'His responsibilities include administering a large services contract, crisis services and vocational programming.',
  'He has long focused on the development of the behavioral health workforce and how to help staff translate administrative requirements into clinical practice.',
  'Over the past four years, Mr. Example has worked on developing a supervision model for the public sector.',
].join(' ');

const operationsOfficerCard =
  'Mr. Example has long focused on the development of the behavioral health workforce and how to help staff translate administrative requirements into clinical practice.';

const managingDirectorBody = [
  'Sam currently serves as the Managing Director of Synthetic Health Ventures at Example University, where she leads initiatives to support ventures in global health innovation.',
  'With over a decade of expertise in these sectors, she is a passionate advocate for social change, mentoring the next generation of social entrepreneurs.',
  'At Example University, she works closely with students, faculty, and staff to develop and scale innovations that address pressing societal needs.',
  'She has been a recognized voice on national platforms and co-founded Example Rise, a community organization focused on educational equity.',
].join(' ');

const managingDirectorCard =
  'Leads venture development and mentoring in global health innovation by supporting and scaling student, faculty, and staff-driven ventures.';

describe('an administrator biography beside a card that names no research', () => {
  it('holds an operations officer whose only focus is developing a workforce', () => {
    expect(careerHold(operationsOfficerBody, operationsOfficerCard)).toBe(true);
  });

  it('holds a managing director whose only focus phrase belongs to an organization she founded', () => {
    expect(careerHold(managingDirectorBody, managingDirectorCard)).toBe(true);
  });

  it('still serves the same biography once it states research of its own', () => {
    expect(
      careerHold(
        `${operationsOfficerBody} His research examines how supervision models change treatment planning outcomes in public agencies.`,
        operationsOfficerCard,
      ),
    ).toBe(false);
  });

  it('still serves a biography whose own sentence states the research beside a founded organization', () => {
    expect(
      careerHold(
        managingDirectorBody.replace(
          'co-founded Example Rise, a community organization focused on educational equity.',
          'co-founded Example Rise, a community organization focused on educational equity, and her research focuses on school finance reform.',
        ),
        managingDirectorCard,
      ),
    ).toBe(false);
  });
});

describe('isWorkforceDevelopmentPracticeSentence', () => {
  it('reads developing a workforce or helping staff as practice', () => {
    expect(isWorkforceDevelopmentPracticeSentence(operationsOfficerCard)).toBe(true);
    expect(
      isWorkforceDevelopmentPracticeSentence(
        'Focuses on workforce development for community health agencies.',
      ),
    ).toBe(true);
  });

  it('keeps a sentence that studies or evaluates the practice', () => {
    expect(
      isWorkforceDevelopmentPracticeSentence(
        'Studies workforce development policy and its effect on rural hospital staffing.',
      ),
    ).toBe(false);
    expect(
      isWorkforceDevelopmentPracticeSentence(
        'Evaluates the training of community health volunteers in low-income countries.',
      ),
    ).toBe(false);
  });

  it('does not read research on development that names no workforce', () => {
    expect(
      isWorkforceDevelopmentPracticeSentence('Focuses on the development of the zebrafish heart.'),
    ).toBe(false);
  });
});

describe('withoutOrganizationFocusAppositive', () => {
  it("drops an organization's focus phrase and keeps the rest of the sentence", () => {
    expect(
      withoutOrganizationFocusAppositive(
        'She co-founded Example Rise, a community organization focused on educational equity.',
      ),
    ).not.toMatch(/focused on/);
  });

  it("leaves a person's own focus untouched", () => {
    const sentence = 'Her research has focused on educational equity in urban schools.';
    expect(withoutOrganizationFocusAppositive(sentence)).toBe(sentence);
  });
});
