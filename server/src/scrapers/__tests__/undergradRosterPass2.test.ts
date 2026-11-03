import { describe, expect, it } from 'vitest';
import {
  extractOfficialResearchHomeRoster,
  listedEntryIsFromAnotherSchool,
  type OfficialRosterConfig,
} from '../sources/officialResearchHomeRosterScraper';
import { proposeUndergradRosterConfig } from '../undergradRosterDerivation';

const observedAt = new Date('2026-11-03T12:00:00Z');
const page = (main: string) =>
  `<html><head><title>People</title></head><body><main>${main}</main></body></html>`;
const config = (overrides: Partial<OfficialRosterConfig> = {}): OfficialRosterConfig => ({
  researchEntityKey: 'dept-fixture-roster',
  url: 'https://fixturelab.yale.edu/people',
  template: 'heading-list',
  currentSectionLabels: ['Undergraduate Students'],
  pastSectionLabels: [],
  ...overrides,
});
const listed = (html: string, rosterConfig = config()) =>
  extractOfficialResearchHomeRoster(html, rosterConfig, observedAt).undergraduates.map(
    ({ name, status }) => `${name}:${status}`,
  );

describe('second lane pass (#5433)', () => {
  it('keeps a Yale undergraduate who held a summer internship', () => {
    expect(
      listedEntryIsFromAnotherSchool(
        {
          name: 'Avery Quill',
          title: 'Avery Quill, Yale Undergraduate, 2022 Summer Internship',
          years: '',
        },
        false,
      ),
    ).toBe(false);
  });

  it('never opens a section at a heading that holds only a photo', () => {
    expect(
      listed(
        page(`<h2>Undergraduate Students</h2><h2><img alt="" /></h2>
          <div><strong>Avery Quill</strong><span>, class of 2028</span></div>`),
      ),
    ).toEqual(['Avery Quill:current']);
  });

  it("never proposes a postgraduate heading because its members hold a bachelor's", () => {
    const outcome = proposeUndergradRosterConfig(
      page(`<h2>Postgraduate Associates</h2><div><strong>Harper Wren</strong><span> B.S. Biochemistry University of Elsewhere, WA</span></div>
        <h2>Undergraduate Students</h2><div><strong>Avery Quill</strong><span>, class of 2028</span></div>`),
      'fixture-lab',
      'https://fixturelab.yale.edu/people',
      observedAt,
    );
    expect(outcome.kind).toBe('proposed');
    if (outcome.kind !== 'proposed') return;
    expect(outcome.proposal.config.currentSectionLabels).toEqual(['Undergraduate Students']);
  });

  it("keeps a former undergraduate's bachelor's under a heading that also names students", () => {
    expect(
      listed(
        page(
          `<h2>former students and postdocs</h2><p>Avery Quill, '24 B.S. Biology, Yale. Now a fixture analyst</p>`,
        ),
        config({ currentSectionLabels: [], pastSectionLabels: ['former students and postdocs'] }),
      ),
    ).toEqual(['Avery Quill:past']);
  });

  it('reads a date range set across table cells as one range', () => {
    expect(
      listed(
        page(`<h2>Mentoring</h2><table>
          <tr><td>Avery Quill</td><td>Undergraduate Student</td><td>2025</td><td>-</td><td>2025</td></tr>
          <tr><td>Harper Wren</td><td>Undergraduate Student</td><td>2025</td><td>-</td><td>2029</td></tr>
          <tr><td>Rowan Thistle</td><td>Undergraduate Student</td><td>2024</td><td>-</td><td>Present</td></tr>
        </table>`),
        config({ currentSectionLabels: ['Mentoring'] }),
      ),
    ).toEqual(['Avery Quill:past', 'Harper Wren:current', 'Rowan Thistle:current']);
  });
});
