import { describe, expect, it } from 'vitest';
import {
  extractProfile,
  facultyToResearchEntityObservations,
  type RawYsmFaculty,
} from '../sources/ysmFacultyDirectoryScraper';
import { NO_SURNAME_ROSTER } from '../../utils/researchHomeNameIdentityAuthority';
import { isPersonalNameDomainWebsite } from '../../utils/personalNameWebsite';

const RIVERS: RawYsmFaculty = {
  name: 'Rivers, Jordan',
  profileUrl: 'https://medicine.yale.edu/profile/jordan-rivers/',
  slug: 'jordan-rivers',
};

function profilePage(labWebsite: { name: string; url: string }): string {
  const sections = [
    { sectionType: 'about', bio: '', workdayTitle: 'Clinical Professor', appointments: [] },
    {
      sectionType: 'research',
      researchDescription: '<p>Writes about families and identity.</p>',
      meshKeywords: [],
      labWebsite,
      orcids: [],
    },
    { sectionType: 'getInTouch', email: '' },
  ];
  const pageData = {
    mainComponents: [{ key: 'ProfileDetails', model: { fullName: 'Jordan Rivers', sections } }],
  };
  return `<html><body><script id='page-data' type='application/json'>${JSON.stringify(
    pageData,
  )}</script></body></html>`;
}

const fieldsFor = (labWebsite: { name: string; url: string }) =>
  Object.fromEntries(
    facultyToResearchEntityObservations(
      extractProfile(profilePage(labWebsite), RIVERS)!,
      'ysm:jordan-rivers',
      NO_SURNAME_ROSTER,
    ).map((observation) => [observation.field, observation.value]),
  );

describe('a lab slot linking the person own name-domain site (#4552)', () => {
  it('seeds faculty research with the site as its website, not a lab', () => {
    const fields = fieldsFor({ name: 'author website', url: 'https://www.jordanrivers.com/' });
    expect(fields.entityType).toBe('FACULTY_RESEARCH_AREA');
    expect(fields.kind).toBe('individual');
    expect(fields.name).toBe('Jordan Rivers Faculty Research');
    expect(fields.websiteUrl).toBe('https://www.jordanrivers.com/');
    expect(fields.sourceUrls).toEqual([RIVERS.profileUrl, 'https://www.jordanrivers.com/']);
  });

  it('keeps a lab when the slot names one or the address carries a research-unit word', () => {
    expect(fieldsFor({ name: 'Rivers Lab', url: 'https://www.jordanrivers.com/' }).entityType).toBe(
      'LAB',
    );
    expect(
      fieldsFor({ name: 'Visit Website', url: 'https://www.jordanriverslab.org/' }).entityType,
    ).toBe('LAB');
    expect(
      fieldsFor({ name: 'Visit Website', url: 'https://medicine.yale.edu/lab/rivers/' }).entityType,
    ).toBe('LAB');
  });
});

describe('isPersonalNameDomainWebsite', () => {
  it('reads a name-domain site as personal in either name order or with an initial', () => {
    for (const url of [
      'https://jordanrivers.com',
      'http://www.riversjordan.net/',
      'https://jrivers.org/bio',
      'https://jordan-rivers.info/',
    ]) {
      expect(isPersonalNameDomainWebsite(url, 'Jordan Rivers')).toBe(true);
    }
  });

  it('never reads a Yale host, a lab address, a deep path or another name as personal', () => {
    for (const url of [
      'https://jordanrivers.yale.edu/',
      'https://jordanriverslab.com/',
      'https://jordanrivers.com/research/group',
      'https://averysloan.com/',
      'not a url',
    ]) {
      expect(isPersonalNameDomainWebsite(url, 'Jordan Rivers')).toBe(false);
    }
  });
});
