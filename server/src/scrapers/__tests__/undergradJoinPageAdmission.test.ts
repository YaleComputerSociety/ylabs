import { describe, expect, it } from 'vitest';
import { joinPageAnchorTextRefusal, joinPageUrlRefusal } from '../undergradJoinPageAdmission';

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
    ).toBe('programme-page-offered-as-a-person-route');
  });

  it('keeps the same programme page for an organizational row', () => {
    expect(
      joinPageUrlRefusal(
        'https://medicine.yale.edu/cancer/collaborative-excellence/training-opportunities/',
        centerRow,
      ),
    ).toBeNull();
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
