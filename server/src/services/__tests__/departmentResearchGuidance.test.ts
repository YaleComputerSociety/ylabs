import { describe, expect, it } from 'vitest';
import {
  isDepartmentResearchGuidance,
  isDepartmentResearchGuidancePage,
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
