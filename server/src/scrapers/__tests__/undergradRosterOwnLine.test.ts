import { describe, expect, it } from 'vitest';
import {
  extractOfficialResearchHomeRoster,
  listedEntryIsFromAnotherSchool,
  mapOfficialRosterRole,
  type OfficialRosterConfig,
} from '../sources/officialResearchHomeRosterScraper';
import {
  derivedRosterWithheldReason,
  proposeUndergradRosterConfig,
} from '../undergradRosterDerivation';

const observedAt = new Date('2026-10-26T12:00:00Z');
const url = 'https://fixturelab.yale.edu/people';
const body = (main: string): string =>
  `<html><head><title>People</title></head><body><main>${main}</main></body></html>`;

const config = (overrides: Partial<OfficialRosterConfig> = {}): OfficialRosterConfig => ({
  researchEntityKey: 'dept-fixture-roster',
  url,
  template: 'heading-list',
  currentSectionLabels: ['People'],
  pastSectionLabels: [],
  ...overrides,
});

const listed = (html: string, rosterConfig: OfficialRosterConfig): string[] =>
  extractOfficialResearchHomeRoster(html, rosterConfig, observedAt).undergraduates.map(
    ({ name, status }) => `${name}:${status}`,
  );

const proposed = (html: string): string[] => {
  const outcome = proposeUndergradRosterConfig(html, 'fixture-lab', url, observedAt);
  return outcome.kind === 'proposed'
    ? outcome.roster.undergraduates.map(({ name, status }) => `${name}:${status}`)
    : [outcome.kind];
};

describe('tables a roster page captions by group (#5433)', () => {
  const captioned = (caption: string, rows: string) => `
    <h2>People</h2>
    <table><caption><a>${caption}</a></caption><tbody>${rows}</tbody></table>`;
  const row = (name: string, role: string) =>
    `<tr><td><img alt="" /></td><td><a>${name}</a><br />${role}</td><td></td></tr>`;

  it('reads the caption as the group and the line under the name as the role', () => {
    expect(
      listed(
        body(
          captioned('Undergraduate Students', row('Avery Quill', 'Undergraduate Student')) +
            captioned('Graduate Students', row('Rowan Thistle', 'Graduate Student')),
        ),
        config(),
      ),
    ).toEqual(['Avery Quill:current']);
  });

  it('lists a former-undergraduates caption as past', () => {
    expect(
      listed(
        body(
          captioned('Former Undergraduate Students', row('Avery Quill', 'Undergraduate Student')),
        ),
        config(),
      ),
    ).toEqual(['Avery Quill:past']);
  });

  it('takes the role from its own cell in a table with no header row', () => {
    expect(
      listed(
        body(`<h2>People</h2><table>
          <tr><td><p>Avery Quill</p></td><td><p>Undergraduate Student</p></td><td><p>203.555.0100</p></td></tr>
          <tr><td><p>Rowan Thistle</p></td><td><p>Graduate Student</p></td><td><p>203.555.0101</p></td></tr>
        </table>`),
        config({ undergraduatesByOwnLine: true }),
      ),
    ).toEqual(['Avery Quill:current']);
  });
});

describe('lines that pair a name with a class year (#5433)', () => {
  it('splits the name from "Class of" on one line', () => {
    expect(
      listed(
        body(`<h3><strong>Undergraduate Alumni</strong></h3>
          <p>Avery Quill Class of 2025</p><p>Harper Wren Class of 2019</p>`),
        config({ currentSectionLabels: [], pastSectionLabels: ['Undergraduate Alumni'] }),
      ),
    ).toEqual(['Avery Quill:past', 'Harper Wren:past']);
  });
});

describe('a page with no undergraduate section (#5433)', () => {
  const people = body(`<h2>Lab Member</h2>
    <h3>Avery Quill</h3><p>Undergraduate Researcher, Yale College, class of 2028</p>
    <h3>Rowan Thistle</h3><p>Postdoctoral Associate</p>`);

  it('proposes an own-line config and lists only people whose own line says undergraduate', () => {
    const outcome = proposeUndergradRosterConfig(people, 'fixture-lab', url, observedAt);
    expect(outcome.kind).toBe('proposed');
    if (outcome.kind !== 'proposed') return;
    expect(outcome.proposal.config.undergraduatesByOwnLine).toBe(true);
    expect(outcome.roster.undergraduates.map((u) => u.name)).toEqual(['Avery Quill']);
  });

  it('does not count a heading as evidence in own-line mode', () => {
    expect(
      listed(
        body(`<h2>Undergraduate Students</h2><h3>Avery Quill</h3><p>Lab member</p>`),
        config({ currentSectionLabels: ['Undergraduate Students'], undergraduatesByOwnLine: true }),
      ),
    ).toEqual([]);
  });

  it('does not count a title another section heading gives its people in own-line mode', () => {
    expect(
      listed(
        body(`<h2>Undergraduate Research</h2><h3>Avery Quill</h3><p>Summer Researcher</p>
          <h2>Lab Members</h2><h3>Rowan Thistle</h3><p>Summer Researcher</p>
          <h3>Harper Wren</h3><p>Undergraduate Researcher</p>`),
        config({ currentSectionLabels: ['Lab Members'], undergraduatesByOwnLine: true }),
      ),
    ).toEqual(['Harper Wren:current']);
  });

  it('still withholds an own-line roster listed under a visiting or program heading', () => {
    const roster = extractOfficialResearchHomeRoster(
      people,
      config({ currentSectionLabels: ['Visiting Researcher'], undergraduatesByOwnLine: true }),
      observedAt,
    );
    expect(
      derivedRosterWithheldReason(
        config({ currentSectionLabels: ['Visiting Researcher'], undergraduatesByOwnLine: true }),
        roster,
        'https://fixturelab.yale.edu/',
      ),
    ).toBe('combined-section-label');
  });

  it('skips the mixed-level publish check for an own-line roster only', () => {
    const roster = extractOfficialResearchHomeRoster(
      people,
      config({ currentSectionLabels: ['Graduate and Undergraduate Students'] }),
      observedAt,
    );
    const mixed = config({ currentSectionLabels: ['Graduate and Undergraduate Students'] });
    expect(derivedRosterWithheldReason(mixed, roster, 'https://fixturelab.yale.edu/')).toBe(
      'combined-section-label',
    );
    expect(
      derivedRosterWithheldReason(
        { ...mixed, undergraduatesByOwnLine: true },
        roster,
        'https://fixturelab.yale.edu/',
      ),
    ).not.toBe('combined-section-label');
  });
});

describe('a name on one line and the role on the next (#5433)', () => {
  const lines = (main: string) => body(`<h2>Our Team</h2><div><span>${main}</span></div>`);

  it('reads the pair when no template finds an undergraduate', () => {
    expect(
      proposed(
        lines('Avery Quill<br/>Undergraduate Student<br/>Rowan Thistle<br/>Postdoctoral Fellow'),
      ),
    ).toEqual(['Avery Quill:current']);
  });

  it('never reads a group heading or a first-person sentence as the role', () => {
    expect(
      proposed(
        lines(
          'Rowan Thistle<br/>Undergraduates<br/>Harper Wren<br/>Yale Undergrad Students<br/>Jordan Alder<br/>My undergraduate research involved fixtures',
        ),
      ),
    ).toEqual(['no-undergraduate-section']);
  });

  it('never reads an undergraduate program title as the role', () => {
    expect(
      proposed(
        lines(
          'Rowan Thistle<br/>Undergraduate Program Director<br/>Harper Wren<br/>Undergraduate Program Coordinator',
        ),
      ),
    ).toEqual(['no-undergraduate-section']);
  });
});

describe('people who serve undergraduates or visit for a summer (#5433)', () => {
  it('reads an undergraduate research contact as not an undergraduate', () => {
    expect(mapOfficialRosterRole('Undergraduate Research Contact', '')).toBeNull();
    expect(mapOfficialRosterRole('Undergraduate Program Director', '')).not.toBe('undergrad');
    expect(mapOfficialRosterRole('Undergraduate Program Coordinator', '')).not.toBe('undergrad');
    expect(mapOfficialRosterRole('Undergraduate Research Assistant', '')).toBe('undergrad');
  });

  it('withholds every listing of a person any listing names as the undergraduate contact', () => {
    expect(
      listed(
        body(`<h2>People</h2>
          <h3>Avery Quill</h3><p>Undergraduate Research Contact</p>
          <h3>Avery Quill</h3><p>Undergraduate Research</p>
          <h3>Harper Wren</h3><p>Undergraduate Researcher</p>`),
        config({ undergraduatesByOwnLine: true }),
      ),
    ).toEqual(['Harper Wren:current']);
  });

  it('reads a named summer program with a summer term as a visitor', () => {
    expect(
      listedEntryIsFromAnotherSchool(
        {
          name: 'Avery Quill',
          title: 'Fixture Program Undergraduate student | Summer 2024',
          years: '',
        },
        false,
      ),
    ).toBe(true);
    expect(
      listedEntryIsFromAnotherSchool(
        { name: 'Avery Quill', title: 'Undergraduate student | Summer 2024', years: '' },
        false,
      ),
    ).toBe(false);
  });
});
