import { describe, expect, it } from 'vitest';
import {
  extractOfficialResearchHomeRoster,
  listedEntryIsFromAnotherSchool,
  type OfficialRosterConfig,
} from '../sources/officialResearchHomeRosterScraper';

const observedAt = new Date('2026-11-08T12:00:00Z');
const page = (main: string) => `<html><body><main>${main}</main></body></html>`;
const config = (pastSectionLabels: string[]): OfficialRosterConfig => ({
  researchEntityKey: 'fixture-lab',
  url: 'https://fixturelab.yale.edu/people',
  template: 'heading-list',
  currentSectionLabels: ['Undergraduate Researchers'],
  pastSectionLabels,
});
const listed = (html: string, rosterConfig: OfficialRosterConfig) =>
  extractOfficialResearchHomeRoster(html, rosterConfig, observedAt).undergraduates.map(
    ({ name, status }) => `${name}:${status}`,
  );

describe("a lab's earlier home and other schools (#5433, owner rule 2026-11-08)", () => {
  it("counts the past undergraduates of the lab's own earlier university", () => {
    const label = 'Fixture Lab Example State University Alumni';
    expect(
      listed(
        page(`<h2>Undergraduate Researchers</h2><ul><li>Avery Quill</li></ul>
          <h2>${label}</h2><ul><li>Harper Wren, Undergraduate Researcher</li></ul>`),
        config([label]),
      ),
    ).toEqual(['Avery Quill:current', 'Harper Wren:past']);
  });

  it('still withholds a section of visiting students from other universities', () => {
    const label = 'Visiting Students from Other Universities';
    expect(
      listed(
        page(`<h2>Undergraduate Researchers</h2><ul><li>Avery Quill</li></ul>
          <h2>${label}</h2><ul><li>Harper Wren, Undergraduate Researcher</li></ul>`),
        config([label]),
      ),
    ).toEqual(['Avery Quill:current']);
  });

  it('reads a biography that says the degree is being completed at another university', () => {
    expect(
      listedEntryIsFromAnotherSchool(
        {
          name: 'Harper Wren',
          title: 'Undergraduate intern',
          years: '',
          bio: 'Harper is completing her undergraduate degree at the University of Elsewhere, studying piano.',
        },
        true,
      ),
    ).toBe(true);
    expect(
      listedEntryIsFromAnotherSchool(
        {
          name: 'Harper Wren',
          title: 'Undergraduate intern',
          years: '',
          bio: 'Harper is completing her undergraduate degree in psychology at Yale.',
        },
        true,
      ),
    ).toBe(false);
  });
});
