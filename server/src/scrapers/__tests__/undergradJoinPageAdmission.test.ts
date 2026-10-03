import { describe, expect, it } from 'vitest';
import {
  isOwnDepartmentUndergraduateResearchProgramme,
  joinPageAnchorTextRefusal,
  joinPageUrlRefusal,
} from '../undergradJoinPageAdmission';

const facultyRow = { entityType: 'FACULTY_RESEARCH_AREA', kind: 'individual' };
const centerRow = { entityType: 'CENTER', kind: 'center' };

describe('joinPageUrlRefusal (#4430)', () => {
  it('refuses a study-recruitment page offered as a join page', () => {
    expect(joinPageUrlRefusal('https://examplelab.yale.edu/participate/')).toBe(
      'participant-recruitment-route',
    );
    expect(joinPageUrlRefusal('https://medicine.yale.edu/lab/example/Participate/')).toBe(
      'participant-recruitment-route',
    );
  });

  it('refuses a route whose path names a graduate, postdoctoral or admissions audience', () => {
    for (const url of [
      'https://example-lab.com/phd-opportunities-in-our-lab-through-a-graduate-track',
      'https://example.yale.edu/for-graduate-students',
      'https://example.yale.edu/graduate/admissions',
      'https://example.yale.edu/postdoctoral-positions',
    ]) {
      expect(joinPageUrlRefusal(url)).toBe('non-undergraduate-audience-route');
    }
  });

  it('keeps a route that names undergraduates even beside a graduate or employment word', () => {
    expect(
      joinPageUrlRefusal('https://economics.yale.edu/undergraduate/employment-opportunities'),
    ).toBeNull();
    expect(
      joinPageUrlRefusal('https://example.yale.edu/graduate-and-undergraduate-opportunities'),
    ).toBeNull();
  });

  it('leaves jobs, careers and volunteer pages to the page text, since labs recruit undergraduates there', () => {
    for (const url of [
      'https://examplelab.yale.edu/jobs',
      'https://medicine.yale.edu/example-center/about/job-opportunities/',
      'https://medicine.yale.edu/dept/research/analytics/careers-opportunities/',
      'https://www.example-lab.org/volunteer',
    ]) {
      expect(joinPageUrlRefusal(url)).toBeNull();
    }
  });

  it('does not read a credential late in a profile slug as an audience', () => {
    expect(
      joinPageUrlRefusal(
        'https://nursing.yale.edu/faculty-research/faculty-directory/example-person-phd-aprn',
      ),
    ).toBeNull();
  });

  it('refuses a bare site root, which is a home page rather than a join page', () => {
    expect(joinPageUrlRefusal('https://www.example-lab.org/')).toBe('site-root-is-not-a-join-page');
    expect(joinPageUrlRefusal('https://examplelab.org')).toBe('site-root-is-not-a-join-page');
  });

  it("refuses a center's programme page offered as a person row's route", () => {
    expect(
      joinPageUrlRefusal(
        'https://medicine.yale.edu/cancer/collaborative-excellence/training-opportunities/',
        facultyRow,
      ),
    ).toBe('programme-page-of-another-entity');
  });

  it('keeps the programme page for the center that publishes it and refuses it for any other row', () => {
    const training =
      'https://medicine.yale.edu/cancer/collaborative-excellence/training-opportunities/';
    expect(
      joinPageUrlRefusal(training, {
        ...centerRow,
        websiteUrl: 'https://medicine.yale.edu/cancer/',
      }),
    ).toBeNull();
    expect(joinPageUrlRefusal(training, centerRow)).toBe('programme-page-of-another-entity');
    expect(
      joinPageUrlRefusal(training, { entityType: 'CORE_FACILITY', kind: 'core_facility' }),
    ).toBe('programme-page-of-another-entity');
  });

  it("keeps a programme-shaped page that sits under the row's own website", () => {
    expect(
      joinPageUrlRefusal('https://medicine.yale.edu/lab/example/training-opportunities/', {
        entityType: 'LAB',
        kind: 'lab',
        websiteUrl: 'https://medicine.yale.edu/lab/example/',
      }),
    ).toBeNull();
  });

  it('keeps an ordinary lab join page and an application form', () => {
    expect(joinPageUrlRefusal('https://examplelab.yale.edu/join-us', facultyRow)).toBeNull();
    expect(joinPageUrlRefusal('https://example-lab.org/opportunities')).toBeNull();
    expect(
      joinPageUrlRefusal('https://yalesurvey.ca1.qualtrics.com/jfe/form/SV_fixture'),
    ).toBeNull();
  });

  it('refuses a value that is not an http URL', () => {
    expect(joinPageUrlRefusal('mailto:someone@example.edu')).toBe('not-an-http-url');
    expect(joinPageUrlRefusal('')).toBe('not-an-http-url');
    expect(joinPageUrlRefusal(undefined)).toBe('not-an-http-url');
  });
});

describe('joinPageAnchorTextRefusal (#4430)', () => {
  it('refuses a graduate-admissions link and keeps an undergraduate application', () => {
    expect(joinPageAnchorTextRefusal('Graduate Admissions Application')).toBe(
      'non-undergraduate-audience-route',
    );
    expect(joinPageAnchorTextRefusal('Information for prospective graduate students')).toBe(
      'non-undergraduate-audience-route',
    );
    expect(joinPageAnchorTextRefusal('Undergraduate research application')).toBeNull();
    expect(joinPageAnchorTextRefusal('Apply here')).toBeNull();
  });
});

describe("a department's own undergraduate research programme (#4430)", () => {
  const economicsFaculty = { ...facultyRow, departments: ['Economics'] };
  const psychologyFaculty = { ...facultyRow, departments: ['Department of Psychology'] };

  it("keeps the department's undergraduate research or RA page on that department's faculty rows", () => {
    expect(
      isOwnDepartmentUndergraduateResearchProgramme(
        'https://economics.yale.edu/undergraduate/employment-opportunities',
        economicsFaculty,
      ),
    ).toBe(true);
    expect(
      joinPageUrlRefusal(
        'https://psychology.yale.edu/undergraduate/research-opportunities',
        psychologyFaculty,
      ),
    ).toBeNull();
  });

  it("still refuses the same programme page on another department's faculty row", () => {
    expect(
      joinPageUrlRefusal('https://psychology.yale.edu/undergraduate/research-opportunities', {
        ...facultyRow,
        departments: ['Philosophy'],
      }),
    ).toBe('programme-page-of-another-entity');
    expect(
      joinPageUrlRefusal(
        'https://psychology.yale.edu/undergraduate/research-opportunities',
        facultyRow,
      ),
    ).toBe('programme-page-of-another-entity');
  });

  it("still refuses a center's training page on a shared medical-campus host", () => {
    expect(
      joinPageUrlRefusal(
        'https://medicine.yale.edu/cancer/collaborative-excellence/training-opportunities/',
        { ...facultyRow, departments: ['Internal Medicine', 'Yale Cancer Center'] },
      ),
    ).toBe('programme-page-of-another-entity');
    expect(
      isOwnDepartmentUndergraduateResearchProgramme(
        'https://medicine.yale.edu/internal-medicine/undergraduate/research-opportunities/',
        { ...facultyRow, departments: ['Internal Medicine'] },
      ),
    ).toBe(false);
  });

  it('does not admit a graduate or postdoctoral page, or a page that names no research', () => {
    expect(
      joinPageUrlRefusal(
        'https://psychology.yale.edu/graduate/research-opportunities',
        psychologyFaculty,
      ),
    ).toBe('non-undergraduate-audience-route');
    expect(
      isOwnDepartmentUndergraduateResearchProgramme(
        'https://psychology.yale.edu/undergraduate/senior-essay',
        psychologyFaculty,
      ),
    ).toBe(false);
  });
});
