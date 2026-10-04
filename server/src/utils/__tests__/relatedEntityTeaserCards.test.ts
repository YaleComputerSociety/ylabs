import { describe, expect, it } from 'vitest';

import { collectVisibleDescriptionCandidates } from '../officialResearchDescription';

const OWN =
  'We test tissues, cells and environmental samples for veterinary pathogens by polymerase chain reaction and serology.';
const OTHER_A =
  'The Fixture Metabolism Core offers targeted and untargeted metabolomics and stable isotope flux analysis for investigators.';
const OTHER_B =
  'The Fixture Screening Center provides assay development and high-throughput screening with small-molecule libraries.';

const page = (body: string) => `<html><head></head><body><main>${body}</main></body></html>`;

const teaserCard = (href: string, title: string, text: string) =>
  `<li><div class="cores-card listing-item card--listing"><div class="card__content"><h2><a href="${href}">${title}</a></h2><p>${text}</p></div></div></li>`;

const hasCandidate = (candidates: string[], text: string): boolean =>
  candidates.some((candidate) => candidate.includes(text.slice(0, 60)));

describe('related-entity teaser cards', () => {
  it("drops a listing of other entities' cards and keeps the page's own prose", () => {
    const candidates = collectVisibleDescriptionCandidates(
      page(
        `<section><p>${OWN}</p></section><ul>${teaserCard('/cores/a', 'Metabolism Core', OTHER_A)}${teaserCard('/cores/b', 'Screening Center', OTHER_B)}</ul>`,
      ),
    );

    expect(hasCandidate(candidates, OWN)).toBe(true);
    expect(hasCandidate(candidates, OTHER_A)).toBe(false);
    expect(hasCandidate(candidates, OTHER_B)).toBe(false);
  });

  it("keeps the page's own single content card even when its heading is a link", () => {
    const candidates = collectVisibleDescriptionCandidates(
      page(`<div class="card card--large"><h2><a href="/about">About</a></h2><p>${OWN}</p></div>`),
    );

    expect(hasCandidate(candidates, OWN)).toBe(true);
  });

  it('never treats the inside of a card as a card', () => {
    const candidates = collectVisibleDescriptionCandidates(
      page(
        `<div class="card__content"><h2><a href="/a">One</a></h2><p>${OWN}</p></div><div class="card__content"><h2><a href="/b">Two</a></h2><p>${OTHER_A}</p></div>`,
      ),
    );

    expect(hasCandidate(candidates, OWN)).toBe(true);
    expect(hasCandidate(candidates, OTHER_A)).toBe(true);
  });

  it('keeps a listing whose headings only jump within the page', () => {
    const candidates = collectVisibleDescriptionCandidates(
      page(
        `<div class="teaser"><h3><a href="#aims">Aims</a></h3><p>${OWN}</p></div><div class="teaser"><h3><a href="#methods">Methods</a></h3><p>${OTHER_A}</p></div>`,
      ),
    );

    expect(hasCandidate(candidates, OWN)).toBe(true);
    expect(hasCandidate(candidates, OTHER_A)).toBe(true);
  });
});
