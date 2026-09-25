import { describe, expect, it } from 'vitest';
import {
  isDirectoryGraftCitation,
  isRosterPageCitedByPerson,
  planDirectoryGraftCitationRetraction,
} from '../directoryGraftCitations';

const DEPARTMENT_FACULTY_ROSTER = 'https://applied.math.yale.edu/people/faculty';
const SCHOOL_FACULTY_DIRECTORY =
  'https://ysph.yale.edu/school-of-public-health-faculty/directory-name/';
const LAB_WEBSITE_INDEX = 'https://medicine.yale.edu/about/a-to-z-index/lab-websites/';
const CMS_LOADER = 'https://medicine.yale.edu/views/ajax?view_name=faculty_directory';
const UNDERGRAD_PROGRAMME = 'https://physics.yale.edu/academics/undergraduate-research';
const OWN_PROFILE = 'https://medicine.yale.edu/profile/synthetic-person/';

const person = { entityType: 'LAB', kind: 'lab' };
const facultyResearch = { entityType: 'FACULTY_RESEARCH_AREA', kind: 'individual' };
const department = { entityType: 'DEPARTMENT', kind: 'department' };

describe('isRosterPageCitedByPerson', () => {
  it('recognises the roster shapes the corpus actually stores', () => {
    for (const url of [DEPARTMENT_FACULTY_ROSTER, SCHOOL_FACULTY_DIRECTORY, LAB_WEBSITE_INDEX]) {
      expect(isRosterPageCitedByPerson(url, person)).toBe(true);
    }
  });

  it('leaves the same page standing on the organization that publishes it', () => {
    for (const url of [DEPARTMENT_FACULTY_ROSTER, SCHOOL_FACULTY_DIRECTORY, LAB_WEBSITE_INDEX]) {
      expect(isRosterPageCitedByPerson(url, department)).toBe(false);
    }
  });

  it('does not condemn a person own profile page', () => {
    expect(isRosterPageCitedByPerson(OWN_PROFILE, person)).toBe(false);
    expect(isDirectoryGraftCitation(OWN_PROFILE, facultyResearch)).toBe(false);
  });

  it('scopes by kind when the row carries no entityType', () => {
    expect(isRosterPageCitedByPerson(DEPARTMENT_FACULTY_ROSTER, { kind: 'individual' })).toBe(true);
    expect(isRosterPageCitedByPerson(DEPARTMENT_FACULTY_ROSTER, { kind: 'department' })).toBe(
      false,
    );
  });
});

describe('planDirectoryGraftCitationRetraction', () => {
  it('retracts the roster and keeps the row own page', () => {
    const plan = planDirectoryGraftCitationRetraction({
      entity: facultyResearch,
      sourceUrls: [DEPARTMENT_FACULTY_ROSTER, OWN_PROFILE],
    });
    expect(plan.next).toEqual([OWN_PROFILE]);
    expect(plan.removed).toEqual([DEPARTMENT_FACULTY_ROSTER]);
    expect(plan.refused).toBeNull();
  });

  it('retracts a programme page cited by a person and not by the department', () => {
    expect(
      planDirectoryGraftCitationRetraction({
        entity: facultyResearch,
        sourceUrls: [UNDERGRAD_PROGRAMME, OWN_PROFILE],
      }).removed,
    ).toEqual([UNDERGRAD_PROGRAMME]);
    expect(
      planDirectoryGraftCitationRetraction({
        entity: department,
        sourceUrls: [UNDERGRAD_PROGRAMME, OWN_PROFILE],
      }).removed,
    ).toEqual([]);
  });

  it('refuses to leave a row citing nothing on the roster arm alone (#2630)', () => {
    const plan = planDirectoryGraftCitationRetraction({
      entity: person,
      sourceUrls: [LAB_WEBSITE_INDEX],
    });
    expect(plan.refused).toBe('would-leave-the-row-citing-nothing');
    expect(plan.removed).toEqual([]);
    expect(plan.next).toEqual([LAB_WEBSITE_INDEX]);
  });

  it('strands a row whose only citation is a CMS loader, which was never a readable page', () => {
    const plan = planDirectoryGraftCitationRetraction({
      entity: person,
      sourceUrls: [CMS_LOADER],
    });
    expect(plan.refused).toBeNull();
    expect(plan.removed).toEqual([CMS_LOADER]);
    expect(plan.next).toEqual([]);
  });

  it('plans nothing on a second pass, because the list is clean rather than marked', () => {
    const first = planDirectoryGraftCitationRetraction({
      entity: person,
      sourceUrls: [DEPARTMENT_FACULTY_ROSTER, SCHOOL_FACULTY_DIRECTORY, OWN_PROFILE],
    });
    expect(first.removed).toHaveLength(2);
    const second = planDirectoryGraftCitationRetraction({
      entity: person,
      sourceUrls: first.next,
    });
    expect(second.removed).toEqual([]);
    expect(second.next).toEqual(first.next);
  });

  it('reports a no-op rather than an empty plan when the row cites no roster', () => {
    const plan = planDirectoryGraftCitationRetraction({
      entity: person,
      sourceUrls: [OWN_PROFILE],
    });
    expect(plan).toEqual({ next: [OWN_PROFILE], removed: [], refused: null });
  });

  it('ignores non-string entries rather than throwing on them', () => {
    const plan = planDirectoryGraftCitationRetraction({
      entity: person,
      sourceUrls: [null, undefined, 42, '   ', DEPARTMENT_FACULTY_ROSTER, OWN_PROFILE],
    });
    expect(plan.next).toEqual([OWN_PROFILE]);
  });
});
