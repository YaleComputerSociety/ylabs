import { describe, expect, it } from 'vitest';

import { collectVisibleDescriptionCandidates } from '../officialResearchDescription';
import { isRelatedEntityTeaserTextOnPage } from '../relatedEntityTeaserCards';

const OWN =
  'We test tissues, cells and environmental samples for veterinary pathogens by polymerase chain reaction and serology.';
const OTHER_A =
  'The Fixture Metabolism Core offers targeted and untargeted metabolomics and stable isotope flux analysis for investigators.';
const OTHER_B =
  'The Fixture Screening Center provides assay development and high-throughput screening with small-molecule libraries.';

const page = (body: string) => `<html><head></head><body><main>${body}</main></body></html>`;

const teaserCard = (href: string, title: string, text: string) =>
  `<li><div class="cores-card listing-item card--listing"><div class="card__content"><h2><a href="${href}">${title}</a></h2><p>${text}</p></div></div></li>`;

const CORE_PAGE = 'https://fixture.example.edu/cores/a';
const LAB_HOME = 'https://fixture-lab.example.edu/';

const hasCandidate = (candidates: string[], text: string): boolean =>
  candidates.some((candidate) => candidate.includes(text.slice(0, 60)));

describe('related-entity teaser cards', () => {
  it("drops a listing of other entities' cards and keeps the page's own prose", () => {
    const candidates = collectVisibleDescriptionCandidates(
      page(
        `<section><p>${OWN}</p></section><ul>${teaserCard('/cores/b', 'Metabolism Core', OTHER_A)}${teaserCard('/cores/c', 'Screening Center', OTHER_B)}</ul>`,
      ),
      CORE_PAGE,
    );

    expect(hasCandidate(candidates, OWN)).toBe(true);
    expect(hasCandidate(candidates, OTHER_A)).toBe(false);
    expect(hasCandidate(candidates, OTHER_B)).toBe(false);
  });

  it("keeps the page's own single content card even when its heading is a link", () => {
    const candidates = collectVisibleDescriptionCandidates(
      page(`<div class="card card--large"><h2><a href="/about">About</a></h2><p>${OWN}</p></div>`),
      CORE_PAGE,
    );

    expect(hasCandidate(candidates, OWN)).toBe(true);
  });

  it('never treats the inside of a card as a card', () => {
    const candidates = collectVisibleDescriptionCandidates(
      page(
        `<div class="card__content"><h2><a href="/a">One</a></h2><p>${OWN}</p></div><div class="card__content"><h2><a href="/b">Two</a></h2><p>${OTHER_A}</p></div>`,
      ),
      CORE_PAGE,
    );

    expect(hasCandidate(candidates, OWN)).toBe(true);
    expect(hasCandidate(candidates, OTHER_A)).toBe(true);
  });

  it('keeps a listing whose headings only jump within the page', () => {
    const candidates = collectVisibleDescriptionCandidates(
      page(
        `<div class="teaser"><h3><a href="#aims">Aims</a></h3><p>${OWN}</p></div><div class="teaser"><h3><a href="#methods">Methods</a></h3><p>${OTHER_A}</p></div>`,
      ),
      CORE_PAGE,
    );

    expect(hasCandidate(candidates, OWN)).toBe(true);
    expect(hasCandidate(candidates, OTHER_A)).toBe(true);
  });

  it("keeps a lab homepage's cards for its own sections", () => {
    const candidates = collectVisibleDescriptionCandidates(
      page(
        `<ul>${teaserCard('/research', 'Research', OWN)}${teaserCard('/people', 'People', OTHER_A)}</ul>`,
      ),
      LAB_HOME,
    );

    expect(hasCandidate(candidates, OWN)).toBe(true);
    expect(hasCandidate(candidates, OTHER_A)).toBe(true);
  });

  it('removes nothing when the page URL is unknown', () => {
    const candidates = collectVisibleDescriptionCandidates(
      page(
        `<ul>${teaserCard('/cores/b', 'Metabolism Core', OTHER_A)}${teaserCard('/cores/c', 'Screening Center', OTHER_B)}</ul>`,
      ),
    );

    expect(hasCandidate(candidates, OTHER_A)).toBe(true);
    expect(hasCandidate(candidates, OTHER_B)).toBe(true);
  });
});

describe('isRelatedEntityTeaserTextOnPage', () => {
  const PAGE_URL = 'https://research.example.edu/cores/a';
  const corePage = `<html><body><main><section><p>${OWN}</p></section><ul>${teaserCard('/cores/b', 'Metabolism Core', OTHER_A)}${teaserCard('/cores/c', 'Screening Center', OTHER_B)}</ul></main></body></html>`;

  it("recognises another unit's teaser blurb as not this page's own text", () => {
    expect(isRelatedEntityTeaserTextOnPage(corePage, PAGE_URL, OTHER_A)).toBe(true);
  });

  it("never claims the page's own text", () => {
    expect(isRelatedEntityTeaserTextOnPage(corePage, PAGE_URL, OWN)).toBe(false);
  });

  it('claims nothing when the blurb also appears in the page body', () => {
    const quoted = corePage.replace('<section>', `<section><p>${OTHER_A}</p>`);
    expect(isRelatedEntityTeaserTextOnPage(quoted, PAGE_URL, OTHER_A)).toBe(false);
  });
});
