import { describe, expect, it } from 'vitest';
import {
  isOwnDepartmentUndergraduateResearchProgramme,
  isProgrammePageAdmittedAsJoinRoute,
  isSameJoinRoutePage,
  joinPageAnchorTextRefusal,
  joinPageUrlRefusal,
  joinRouteKind,
  joinRouteNamesAnUndergraduateAudience,
  joinRouteTextAdmits,
  joinRouteUrlRefusal,
  textInvitesUndergraduates,
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

describe("a programme-shaped page admitted as the row's own join route (#4430)", () => {
  const ownOpportunities = 'https://examplelab.yale.edu/job-opportunities/research-opportunities';

  it("admits a lab's own research-opportunities page on a person row whose website it sits under", () => {
    const row = { ...facultyRow, websiteUrl: 'https://examplelab.yale.edu/' };
    expect(isProgrammePageAdmittedAsJoinRoute(ownOpportunities, row)).toBe(true);
    expect(joinPageUrlRefusal(ownOpportunities, row)).toBeNull();
  });

  it('does not admit the same page on a row whose website is elsewhere', () => {
    const row = { ...facultyRow, websiteUrl: 'https://otherlab.yale.edu/' };
    expect(isProgrammePageAdmittedAsJoinRoute(ownOpportunities, row)).toBe(false);
    expect(joinPageUrlRefusal(ownOpportunities, row)).toBe('programme-page-of-another-entity');
  });

  it("admits a department's own undergraduate research page on that department's row", () => {
    expect(
      isProgrammePageAdmittedAsJoinRoute(
        'https://psychology.yale.edu/undergraduate/research-opportunities',
        { ...facultyRow, departments: ['Department of Psychology'] },
      ),
    ).toBe(true);
  });

  it('is not a programme exemption for an ordinary join page', () => {
    expect(
      isProgrammePageAdmittedAsJoinRoute('https://examplelab.yale.edu/join-us', {
        ...facultyRow,
        websiteUrl: 'https://examplelab.yale.edu/',
      }),
    ).toBe(false);
  });
});

describe('join-route URL shapes a hand-read found standing in for a join page (#4543)', () => {
  it("refuses a department's job listings offered as a faculty row's join page", () => {
    for (const url of [
      'https://physics.yale.edu/opportunities',
      'https://earth.yale.edu/opportunities-0',
    ]) {
      expect(
        joinRouteUrlRefusal(url, { ...facultyRow, departments: ['Earth and Planetary Sciences'] }),
      ).toBe('department-jobs-page');
    }
  });

  it("refuses another department's undergraduate employment page and keeps it for its own", () => {
    const economicsPage = 'https://economics.yale.edu/undergraduate/employment-opportunities';
    expect(joinRouteUrlRefusal(economicsPage, { ...facultyRow, departments: ['Nursing'] })).toBe(
      'department-jobs-page',
    );
    expect(
      joinRouteUrlRefusal(economicsPage, { ...facultyRow, departments: ['Economics'] }),
    ).toBeNull();
  });

  it("leaves a lab's own jobs page, and a host named for a lab, to the page text", () => {
    expect(joinRouteUrlRefusal('https://examplelab.yale.edu/jobs', facultyRow)).toBeNull();
    expect(
      joinRouteUrlRefusal('https://wlab.yale.edu/opportunities', {
        ...centerRow,
        departments: [],
      }),
    ).toBeNull();
  });

  it("refuses a page in another lab's section of a shared host", () => {
    const otherLab = 'https://medicine.yale.edu/lab/quillfeather/';
    expect(
      joinRouteUrlRefusal(otherLab, {
        ...facultyRow,
        name: 'Avery Example',
        slug: 'avery-example',
      }),
    ).toBe('page-of-another-lab');
    expect(
      joinRouteUrlRefusal(`${otherLab}join/`, {
        entityType: 'LAB',
        kind: 'lab',
        websiteUrl: 'https://medicine.yale.edu/lab/example/',
      }),
    ).toBe('page-of-another-lab');
  });

  it("keeps the row's own lab section", () => {
    expect(
      joinRouteUrlRefusal('https://medicine.yale.edu/lab/example/join/', {
        ...facultyRow,
        name: 'Avery Example',
      }),
    ).toBeNull();
    expect(
      joinRouteUrlRefusal('https://medicine.yale.edu/lab/example/join/', {
        entityType: 'LAB',
        kind: 'lab',
        websiteUrl: 'https://medicine.yale.edu/lab/example/',
      }),
    ).toBeNull();
  });
});

describe('pages that are a join route only when they invite undergraduates by name (#4543)', () => {
  const labRow = { entityType: 'LAB', kind: 'lab', websiteUrl: 'https://examplelab.yale.edu/' };

  it('reads a profile, the row home page and a lab section root as a home or profile', () => {
    for (const url of [
      'https://physics.yale.edu/profile/avery-example',
      'https://examplelab.yale.edu',
      'https://medicine.yale.edu/lab/example/',
    ]) {
      expect(joinRouteKind(url, labRow)).toBe('home-or-profile');
    }
  });

  it('reads a people, members or team page as a member listing', () => {
    for (const url of [
      'https://examplelab.yale.edu/people',
      'https://examplelab.yale.edu/current-members/',
      'https://examplelab.yale.edu/team',
    ]) {
      expect(joinRouteKind(url, labRow)).toBe('member-listing');
    }
  });

  it('reads a join page as a join page', () => {
    for (const url of [
      'https://examplelab.yale.edu/join-us',
      'https://medicine.yale.edu/lab/example/join/',
    ]) {
      expect(joinRouteKind(url, labRow)).toBe('join-page');
    }
  });

  it('asks a member listing for a recruiting sentence, not a roster heading', () => {
    expect(
      joinRouteTextAdmits('member-listing', 'Undergraduate Students Jordan Example Riley Example'),
    ).toBe(false);
    expect(
      joinRouteTextAdmits('member-listing', 'I am actively looking for students and postdocs.'),
    ).toBe(true);
    expect(
      joinRouteTextAdmits('home-or-profile', 'I am actively looking for students and postdocs.'),
    ).toBe(false);
  });

  it('matches a page across scheme, www and a trailing slash', () => {
    expect(
      isSameJoinRoutePage('http://www.examplelab.org/join/', 'https://examplelab.org/join'),
    ).toBe(true);
    expect(isSameJoinRoutePage('https://examplelab.org/join', 'https://examplelab.org/')).toBe(
      false,
    );
  });
});

describe('join-route text (#4543)', () => {
  it('reads a generic recruiting line as inviting no undergraduate', () => {
    for (const text of [
      'We are hiring at all levels! Please check our open positions!',
      'Positions Available',
      'We welcome inquiries from people of all backgrounds. If you are interested in joining, please contact the PI.',
      'Interested personnel should send their CV directly to the PI.',
      'The team has a long history of mentoring Yale undergraduate students and residents.',
    ]) {
      expect(textInvitesUndergraduates(text)).toBe(false);
    }
  });

  it('reads an invitation that names undergraduates as one', () => {
    for (const text of [
      'Undergraduate and graduate students interested in joining my research group should contact me directly.',
      'For Yale undergraduates I have research project ideas, so please feel free to contact me.',
      'Interested undergraduate students are encouraged to contact the PI.',
    ]) {
      expect(textInvitesUndergraduates(text)).toBe(true);
    }
  });

  it('names no undergraduate audience for a page that recruits individuals or personnel', () => {
    for (const text of [
      'We are always looking for enthusiastic individuals to join our group! Applications should be made through the PhD program.',
      'WELCOME TO JOIN IN THE LAB! Interested personnel should send their CV.',
      'We welcome inquiries from people of all backgrounds.',
    ]) {
      expect(joinRouteNamesAnUndergraduateAudience(text)).toBe(false);
    }
  });

  it('names an audience for a page that recruits students, undergraduates or every level', () => {
    for (const text of [
      'I am actively looking for students and postdocs.',
      'The lab has one research position available to a student with an interest in biochemistry.',
      'Undergraduate Students: please reach out with your CV.',
      'We are currently seeking new members at all levels!',
      'We are always looking for enthusiastic Bachelor/Master/PhD students and Postdocs to join our group.',
    ]) {
      expect(joinRouteNamesAnUndergraduateAudience(text)).toBe(true);
    }
  });

  it("does not read a bachelor's degree requirement as an undergraduate audience", () => {
    expect(
      textInvitesUndergraduates(
        "We are hiring a research technician with a bachelor's degree in biology.",
      ),
    ).toBe(false);
  });
});
