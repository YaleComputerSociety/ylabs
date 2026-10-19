import { describe, expect, it } from 'vitest';
import {
  extractProfile,
  facultyToResearchEntityObservations,
  type RawYsmFaculty,
} from '../sources/ysmFacultyDirectoryScraper';
import { NO_SURNAME_ROSTER } from '../../utils/researchHomeNameIdentityAuthority';

const MEMBER: RawYsmFaculty = {
  name: 'Quillfixture, Avery',
  profileUrl: 'https://medicine.yale.edu/profile/avery-quillfixture/',
  slug: 'avery-quillfixture',
};

function profilePage(labWebsite: { name: string; url: string }): string {
  const sections = [
    { sectionType: 'about', bio: '', workdayTitle: 'Associate Professor', appointments: [] },
    {
      sectionType: 'research',
      researchDescription: '<p>Studies coastal fixture ecology.</p>',
      meshKeywords: [],
      labWebsite,
      orcids: [],
    },
    { sectionType: 'getInTouch', email: '' },
  ];
  const pageData = {
    mainComponents: [
      { key: 'ProfileDetails', model: { fullName: 'Avery Quillfixture', sections } },
    ],
  };
  return `<html><body><script id='page-data' type='application/json'>${JSON.stringify(
    pageData,
  )}</script></body></html>`;
}

const fieldsFor = (labWebsite: { name: string; url: string }) =>
  Object.fromEntries(
    facultyToResearchEntityObservations(
      extractProfile(profilePage(labWebsite), MEMBER)!,
      'ysm:avery-quillfixture',
      NO_SURNAME_ROSTER,
    ).map((observation) => [observation.field, observation.value]),
  );

describe('a YSM lab slot that links an organization the person leads (#5283)', () => {
  it.each([
    [
      'a clinical-research effort',
      'Fixture Coastal Pediatrics',
      'https://medicine.yale.edu/fixture-pediatrics/',
    ],
    ['a project', 'Fixture Imaging Suite Project', 'https://fixtureimaging.example.org/'],
    ['an acronym initiative', 'Kids in Fixture Danger (KIFD)', 'https://medicine.yale.edu/kifd/'],
  ])('keeps the person row and its website for %s', (_shape, name, url) => {
    const fields = fieldsFor({ name, url });
    expect(fields.name).toBe('Avery Quillfixture Faculty Research');
    expect(fields.entityType).toBe('FACULTY_RESEARCH_AREA');
    expect(fields.kind).toBe('individual');
    expect(fields.websiteUrl).toBe(url);
  });

  it.each([
    ['a lab name', 'Fixture Ecology Lab', 'https://fixtureecology.example.org/'],
    ['a group name', 'Coastal Fixture Group', 'https://coastalfixture.example.org/'],
    ['a lab url', 'Coastal Fixture Ecology', 'https://medicine.yale.edu/lab/quillfixture/'],
    ['the person name', 'Quillfixture Research', 'https://quillfixture.example.org/'],
  ])('still names the row after its own lab for %s', (_shape, name, url) => {
    const fields = fieldsFor({ name, url });
    expect(fields.name).toBe(name);
    expect(fields.entityType).toBe('LAB');
  });
});
