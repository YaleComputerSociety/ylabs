import { describe, expect, it } from 'vitest';
import { listedEntryIsFromAnotherSchool } from '../sources/officialResearchHomeRosterScraper';
import {
  deriveUndergradRosterForCandidate,
  labSitePageLinks,
  type DerivedRosterCandidate,
} from '../undergradRosterDerivation';

const observedAt = new Date('2026-11-04T12:00:00Z');
const site = 'https://examplelab.example.org/';
const candidate: DerivedRosterCandidate = {
  researchEntityKey: 'example-lab',
  websiteUrl: site,
  citedUrls: [],
  hasDerivedRoster: false,
};
const page = (main: string) =>
  `<html><head><title>Example Lab</title></head><body><main>${main}</main></body></html>`;
const undergraduateSection = (heading: string) =>
  `<h2>${heading}</h2><div><strong>Avery Quill</strong><span>, Yale College class of 2028</span></div>`;
const readFrom =
  (pages: Record<string, string>) =>
  async (url: string): Promise<string> => {
    const html = pages[url];
    if (html === undefined) throw new Error(`no fixture for ${url}`);
    return html;
  };

describe('third lane pass (#5466)', () => {
  it('follows a people link by its label when its address is not a people word', () => {
    const links = labSitePageLinks(
      `<nav><a href="/partners"><span>THE TEAM</span></a><a href="/projects">Projects</a></nav>`,
      site,
    );
    expect(links.peoplePages).toEqual(['https://examplelab.example.org/partners']);
    expect(links.aboutPages).toEqual([]);
  });

  it('falls back to the about page only when the site links no people page', () => {
    expect(labSitePageLinks(`<a href="/about">About Us</a>`, site).aboutPages).toEqual([
      'https://examplelab.example.org/about',
    ]);
    expect(
      labSitePageLinks(`<a href="/about">About Us</a><a href="/people">People</a>`, site)
        .aboutPages,
    ).toEqual([]);
  });

  it('never follows a labelled link outside the lab section of a shared host', () => {
    const links = labSitePageLinks(
      `<a href="/genetics/staff">The Team</a><a href="/lab/example/partners">The Team</a>`,
      'https://medicine.yale.edu/lab/example/',
    );
    expect(links.peoplePages).toEqual(['https://medicine.yale.edu/lab/example/partners']);
  });

  it('derives a roster from the about page when that is where the lab lists its people', async () => {
    const outcome = await deriveUndergradRosterForCandidate(
      candidate,
      readFrom({
        [site]: page(`<a href="/about">About Us</a><p>We study fixtures.</p>`),
        'https://examplelab.example.org/about': page(undergraduateSection('Undergraduates')),
      }),
      observedAt,
    );
    expect(outcome.kind).toBe('derived');
    if (outcome.kind !== 'derived') return;
    expect(outcome.roster.undergraduates.map(({ name }) => name)).toEqual(['Avery Quill']);
  });

  it('never lists the person who teaches undergraduates as one', async () => {
    const outcome = await deriveUndergradRosterForCandidate(
      candidate,
      readFrom({
        [site]: page(`<a href="/about">About</a>`),
        'https://examplelab.example.org/about': page(
          `<h2>About</h2><div><strong>Harper Wren</strong><span>, I teach undergraduate and graduate courses on fixture history.</span></div>`,
        ),
      }),
      observedAt,
    );
    expect(outcome.kind).not.toBe('derived');
  });

  it('treats a former member who is now an undergraduate at another school as from that school', () => {
    expect(
      listedEntryIsFromAnotherSchool({
        name: 'Avery Quill',
        title:
          'Undergraduate Student (Summer, 2024) Current Position: Undergraduate student, UFIXTURE, Storrs, CT',
        years: '',
      }),
    ).toBe(true);
    expect(
      listedEntryIsFromAnotherSchool({
        name: 'Avery Quill',
        title:
          'Undergraduate Student 2019-2022 Current Position: MD/MBA Program, University of Elsewhere',
        years: '',
      }),
    ).toBe(false);
  });

  it('reads the alumni page the site links to', async () => {
    const outcome = await deriveUndergradRosterForCandidate(
      candidate,
      readFrom({
        [site]: page(`<a href="/people">People</a><a href="/alumni">Alumni</a>`),
        'https://examplelab.example.org/people': page('<h2>Graduate Students</h2><p>None</p>'),
        'https://examplelab.example.org/alumni': page(
          undergraduateSection('Former Undergraduate Researchers'),
        ),
      }),
      observedAt,
    );
    expect(outcome.kind).toBe('derived');
    if (outcome.kind !== 'derived') return;
    expect(outcome.roster.undergraduates.map(({ name, status }) => `${name}:${status}`)).toEqual([
      'Avery Quill:past',
    ]);
  });
});
