import { describe, expect, it } from 'vitest';
import {
  extractOfficialResearchHomeRoster,
  type OfficialRosterConfig,
} from '../sources/officialResearchHomeRosterScraper';
import {
  derivedRosterWithheldReason,
  proposeUndergradRosterConfig,
} from '../undergradRosterDerivation';

const observedAt = new Date('2026-10-29T12:00:00Z');
const page = (title: string, main: string) =>
  `<html><head><title>${title}</title></head><body><main>${main}</main></body></html>`;
const config = (overrides: Partial<OfficialRosterConfig> = {}): OfficialRosterConfig => ({
  researchEntityKey: 'dept-fixture-roster',
  url: 'https://fixturelab.yale.edu/people',
  template: 'heading-list',
  currentSectionLabels: ['Lab Members'],
  pastSectionLabels: [],
  ...overrides,
});
const listed = (html: string, rosterConfig = config()) =>
  extractOfficialResearchHomeRoster(html, rosterConfig, observedAt).undergraduates.map(
    ({ name, status }) => `${name}:${status}`,
  );

describe("a lab page named for the row's own compound surname (#5433)", () => {
  it('is not read as another lab', () => {
    const html = page(
      'People | van Quill Lab',
      `<h2>People</h2><h3>Avery van Quill</h3><p>Principal Investigator</p>
       <h3>Harper Wren</h3><p>Undergraduate Researcher, Yale College, class of 2028</p>`,
    );
    const outcome = proposeUndergradRosterConfig(
      html,
      'ysm-faculty-avery-vanquill',
      'https://vanquilllab.org/people',
      observedAt,
    );
    expect(outcome.kind).toBe('proposed');
  });

  it('matches a title surname with its particle to a compound-surname key', () => {
    const html = page(
      'People | Dal Quill Lab',
      `<h2>People</h2><h3>Avery Dal Quill</h3><p>Principal Investigator</p>
       <h3>Harper Wren</h3><p>Undergraduate Researcher, Yale College, class of 2028</p>`,
    );
    expect(
      proposeUndergradRosterConfig(
        html,
        'ysm-faculty-avery-dalquill',
        'https://dalquilllab.com/people',
        observedAt,
      ).kind,
    ).toBe('proposed');
  });

  it("still refuses a lab named after a shorter surname inside the row person's", () => {
    const html = page(
      'People | Quillan Lab',
      `<h2>People</h2><h3>Rowan Quillan</h3><p>Principal Investigator</p>
       <h3>Harper Wren</h3><p>Undergraduate Researcher, Yale College, class of 2028</p>`,
    );
    const outcome = proposeUndergradRosterConfig(
      html,
      'ysm-faculty-avery-quillanson',
      'https://quillanlab.org/people',
      observedAt,
    );
    expect(outcome.kind).toBe('page-of-another-lab');
  });
});

describe('a row with no website on record (#5433)', () => {
  const roster = (html: string, key: string, url: string) => {
    const outcome = proposeUndergradRosterConfig(html, key, url, observedAt);
    if (outcome.kind !== 'proposed') return outcome.kind;
    return (
      derivedRosterWithheldReason(
        outcome.proposal.config,
        outcome.roster,
        '',
        outcome.proposal.listsRowPerson,
      ) ?? 'publish'
    );
  };
  const people = `<h2>Lab Members</h2><h3>Harper Wren</h3><p>Undergraduate Researcher, Yale College, class of 2028</p>`;

  it("publishes from a Yale page titled with the row person's full name", () => {
    expect(
      roster(
        page('Avery Quill Lab | Yale School of Medicine', people),
        'ysm-faculty-avery-quill',
        'https://medicine.yale.edu/lab/quill/people/',
      ),
    ).toBe('publish');
  });

  it('publishes from a page that lists the row person by full name and names Yale', () => {
    expect(
      roster(
        page(
          'Team',
          `<h2>Lab Members</h2><h3>Avery Quill</h3><p>Associate Professor, Yale</p>${people.slice(people.indexOf('<h3>'))}`,
        ),
        'ysm-faculty-avery-quill',
        'https://fixtures.example.org/team',
      ),
    ).toBe('publish');
  });

  it('withholds when only a shared first name appears', () => {
    expect(
      roster(
        page(
          'Team | Yale',
          `<h2>Lab Members</h2><h3>Avery Thistle</h3><p>Associate Professor</p>${people.slice(people.indexOf('<h3>'))}`,
        ),
        'ysm-faculty-avery-quill',
        'https://fixtures.example.org/team',
      ),
    ).toBe('no-website');
  });

  it('withholds an off-Yale page that names the row person but names Yale only elsewhere', () => {
    expect(
      roster(
        page(
          'Team',
          `<h2>Lab Members</h2><h3>Avery Quill</h3><p>Associate Professor</p>${people.slice(people.indexOf('<h3>'))}<p>Avery has since moved to Yale.</p>`,
        ),
        'ysm-faculty-avery-quill',
        'https://fixtures.example.org/team',
      ),
    ).toBe('no-website');
  });
});

describe('biographies the page sets under or into a name (#5433)', () => {
  it('folds a biography paragraph into the person above it', () => {
    expect(
      listed(
        page(
          'People',
          `<h2>Lab Members</h2><p>Harper Wren</p>
          <p>Harper is an undergraduate student (class of 2027) in Saybrook College at Yale University.</p>
          <p>Rowan Thistle</p><p>Rowan is a postdoctoral fellow in the lab.</p>`,
        ),
      ),
    ).toEqual(['Harper Wren:current']);
  });

  it('splits a name glued to its biography', () => {
    expect(
      listed(
        page(
          'People',
          `<h2>Lab Members</h2><p>Harper WrenHarper is a junior in Yale College majoring in Chemistry.</p>`,
        ),
      ),
    ).toEqual(['Harper Wren:current']);
  });

  it('splits a biography that opens with the full name', () => {
    expect(
      listed(
        page(
          'People',
          `<h2>Lab Members</h2><p>Harper Wren is an undergraduate senior studying Cognitive Science in Yale College.</p>`,
        ),
      ),
    ).toEqual(['Harper Wren:current']);
  });

  it('keeps the whole surname when it has a capital inside it', () => {
    expect(
      listed(
        page(
          'People',
          `<h2>Lab Members</h2><p>Harper McWren is an undergraduate senior studying Cognitive Science in Yale College.</p>`,
        ),
      ),
    ).toEqual(['Harper McWren:current']);
  });

  it('never reads a senior or junior staff biography as an undergraduate', () => {
    expect(
      listed(
        page(
          'People',
          `<h2>Lab Members</h2>
          <h3>Harper Wren</h3><p>Research Assistant</p><p>Harper is a senior research associate at Yale.</p>
          <h3>Rowan Thistle</h3><p>Rowan is a senior research scientist at Yale.</p>
          <h3>Jordan Alder</h3><p>Jordan is a junior faculty member at Yale.</p>`,
        ),
      ),
    ).toEqual([]);
  });

  it("lets a research assistant's Yale undergraduate biography decide, but not a graduate's", () => {
    expect(
      listed(
        page(
          'People',
          `<h2>Lab Members</h2>
          <h3>Harper Wren</h3><p>Research Assistant</p><p>Harper is a rising junior in Yale College.</p>
          <h3>Rowan Thistle</h3><p>Research Assistant</p><p>Rowan received a B.A. from Elsewhere University and manages the lab.</p>
          <h3>Jordan Alder</h3><p>Jordan is a second-year PhD student at Yale.</p>`,
        ),
      ),
    ).toEqual(['Harper Wren:current']);
  });
});
