import { describe, expect, it } from 'vitest';
import {
  departmentGuidanceKindOf,
  departmentGuidanceReason,
  isDepartmentResearchGuidance,
  isDepartmentResearchGuidancePage,
  isDepartmentSeniorEssayGuidancePage,
  pageTitleNamesSeniorEssayGuidance,
  pageTitleNamesUndergraduateResearchGuidance,
} from '../departmentResearchGuidance';

describe('department research guidance page titles (#4285)', () => {
  it.each([
    'Undergraduate Research',
    'Undergraduate Research Opportunities',
    'What undergraduate research opportunities are available?',
    'Undergraduate Engineering Research',
    'Undergraduate Research in Fixture Studies',
    'Research Opportunities',
  ])('admits a page titled %s', (title) => {
    expect(pageTitleNamesUndergraduateResearchGuidance(title)).toBe(true);
  });

  it.each([
    'Undergraduate Program',
    'Introduction to the Undergraduate Program',
    'The Senior Essay',
    'Senior Project',
    'Undergraduate Capstone Faculty',
    'Labs & Reading Groups',
    'Fixture Undergraduate Research Assistantship Application',
    'Research Internship Program',
    'Fixture Scholars',
    'Graduate Research Opportunities',
    'Summer Undergraduate Research Fellowships',
    'Student Grants and Fellowships',
    'Fellowships in the News',
    'Research Opportunities Flyer Series',
    '',
  ])('refuses a page titled %s', (title) => {
    expect(pageTitleNamesUndergraduateResearchGuidance(title)).toBe(false);
  });

  it('refuses a guidance page that states an application cycle', () => {
    const page = { sourcePageTitle: 'Undergraduate Research' };
    expect(isDepartmentResearchGuidancePage(page)).toBe(true);
    expect(isDepartmentResearchGuidancePage({ ...page, deadline: new Date() })).toBe(false);
    expect(isDepartmentResearchGuidancePage({ ...page, applicationOpenDate: new Date() })).toBe(
      false,
    );
    expect(isDepartmentResearchGuidancePage({ ...page, isAcceptingApplications: true })).toBe(
      false,
    );
  });

  it('requires the stored guide kind as well as the page evidence', () => {
    const page = { sourcePageTitle: 'Undergraduate Research' };
    expect(
      isDepartmentResearchGuidance({ ...page, programKind: 'DEPARTMENT_RESEARCH_GUIDE' }),
    ).toBe(true);
    expect(isDepartmentResearchGuidance({ ...page, programKind: 'FELLOWSHIP_FUNDING' })).toBe(
      false,
    );
    expect(isDepartmentResearchGuidance({ programKind: 'DEPARTMENT_RESEARCH_GUIDE' })).toBe(false);
  });
});

describe('department senior essay guidance page titles (#5298)', () => {
  it.each([
    'The Senior Essay',
    'Senior Essay',
    'Senior Essay Requirement',
    'Senior Project',
    'The Senior Requirement',
    'Fixture Senior Essay',
    '4910/4920 Senior Essay',
  ])('admits a page titled %s', (title) => {
    expect(pageTitleNamesSeniorEssayGuidance(title)).toBe(true);
  });

  it.each([
    'Single-Term Senior Essay Instructions and Registration Form',
    'Senior Essay Application',
    'Apply to Write a Senior Essay',
    'Senior Essay Deadlines',
    'Senior Essay Prospectus',
    'Senior Essay Grants',
    'Senior Project Funding',
    'Senior Essay Prize',
    'Fixture Senior Essay Fellowship',
    'Summer Senior Project Support',
    'Undergraduate Capstone Faculty',
    'Undergraduate Research',
    'Undergraduate Program',
    'Senior Colloquium',
    'Graduate Senior Essay Workshop',
    '',
  ])('refuses a page titled %s', (title) => {
    expect(pageTitleNamesSeniorEssayGuidance(title)).toBe(false);
  });

  it('never admits one page as both kinds', () => {
    for (const title of ['The Senior Essay', 'Undergraduate Research', 'Senior Project']) {
      expect(
        pageTitleNamesSeniorEssayGuidance(title) &&
          pageTitleNamesUndergraduateResearchGuidance(title),
      ).toBe(false);
    }
  });

  it('refuses a senior essay page that states an application cycle', () => {
    const page = { sourcePageTitle: 'The Senior Essay' };
    expect(isDepartmentSeniorEssayGuidancePage(page)).toBe(true);
    expect(isDepartmentSeniorEssayGuidancePage({ ...page, deadline: new Date() })).toBe(false);
    expect(isDepartmentSeniorEssayGuidancePage({ ...page, applicationOpenDate: new Date() })).toBe(
      false,
    );
    expect(isDepartmentSeniorEssayGuidancePage({ ...page, isAcceptingApplications: true })).toBe(
      false,
    );
  });
});

describe('department guidance kind (#5298)', () => {
  it('names the kind the stored guide kind and its page evidence earn together', () => {
    expect(
      departmentGuidanceKindOf({
        programKind: 'DEPARTMENT_RESEARCH_GUIDE',
        sourcePageTitle: 'Undergraduate Research',
      }),
    ).toBe('research');
    expect(
      departmentGuidanceKindOf({
        programKind: 'DEPARTMENT_SENIOR_ESSAY_GUIDE',
        sourcePageTitle: 'The Senior Essay',
      }),
    ).toBe('senior_essay');
  });

  it('earns no kind when the stored kind and the page title disagree', () => {
    expect(
      departmentGuidanceKindOf({
        programKind: 'DEPARTMENT_RESEARCH_GUIDE',
        sourcePageTitle: 'The Senior Essay',
      }),
    ).toBeNull();
    expect(
      departmentGuidanceKindOf({
        programKind: 'DEPARTMENT_SENIOR_ESSAY_GUIDE',
        sourcePageTitle: 'Undergraduate Research',
      }),
    ).toBeNull();
    expect(
      departmentGuidanceKindOf({
        programKind: 'SENIOR_THESIS_FUNDING',
        sourcePageTitle: 'The Senior Essay',
      }),
    ).toBeNull();
    expect(departmentGuidanceKindOf({ programKind: 'DEPARTMENT_SENIOR_ESSAY_GUIDE' })).toBeNull();
  });

  it('keeps research guidance research-only and counts both kinds as department guidance', () => {
    const seniorEssay = {
      programKind: 'DEPARTMENT_SENIOR_ESSAY_GUIDE',
      sourcePageTitle: 'Senior Project',
    };
    expect(isDepartmentResearchGuidance(seniorEssay)).toBe(false);
    expect(departmentGuidanceKindOf(seniorEssay)).toBe('senior_essay');
    expect(departmentGuidanceKindOf({ ...seniorEssay, deadline: new Date() })).toBeNull();
  });

  it('records each kind under its own gate reason', () => {
    expect(departmentGuidanceReason('research')).toBe('department_research_guidance');
    expect(departmentGuidanceReason('senior_essay')).toBe('department_senior_essay_guidance');
  });
});
