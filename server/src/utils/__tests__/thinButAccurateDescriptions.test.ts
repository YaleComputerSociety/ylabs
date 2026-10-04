import { describe, expect, it } from 'vitest';

import { researchStatementSentences } from '../careerBiographyDescription';
import { partitionSentencesForFiltering } from '../descriptionHygiene';
import { resolveServedShortDescription } from '../groundedCardSynthesis';
import {
  deriveShortDescriptionFromFullDescription,
  fullDescriptionQuality,
  shortDescriptionQuality,
} from '../researchEntityDescriptionQuality';

const fra = { entityType: 'FACULTY_RESEARCH_AREA' as const };

describe('a thin but accurate body is usable', () => {
  it('keeps a short accurate research sentence usable while still flagging it thin', () => {
    const quality = fullDescriptionQuality(
      'Studies the history of maritime law and the law of salvage.',
    );
    expect(quality.flags).toContain('too-short');
    expect(quality.isUseful).toBe(true);
  });

  it('keeps a body that restates its own topics usable while still flagging the echo', () => {
    const quality = fullDescriptionQuality(
      'Clinical and basic research on coastal wetlands and estuary ecology including salt marshes, with field and laboratory studies.',
      ['Coastal Wetlands', 'Estuary Ecology', 'Salt Marshes'],
    );
    expect(quality.flags).toContain('area-echo-fallback');
    expect(quality.isUseful).toBe(true);
  });

  it('still refuses a body too short to say anything', () => {
    expect(fullDescriptionQuality('Studies.').isUseful).toBe(false);
  });

  it.each([
    ['a colon before the final period', 'Studies glacier physics, including research areas:.'],
    [
      'a label caption with no sentence',
      'Research Interests Glacier dynamics ice sheet modeling sea level rise remote sensing',
    ],
    [
      'a lone degree sentence',
      'This researcher earned her PhD in Example Studies from Example University.',
    ],
    [
      "the model's evidence rationale",
      'Studies topics associated with the Example Center, as evidenced by inclusion in news about award recipients.',
    ],
  ])('refuses a thin body that is %s', (_shape, text) => {
    expect(fullDescriptionQuality(text, ['Example Studies']).isUseful).toBe(false);
  });

  it('refuses a body that is only past appointments and degrees', () => {
    const body =
      'Mx. Fixture was the director of public policy for an example foundation, where they led advocacy efforts focused on funding. Prior to that, they were a senior policy officer at another example foundation. They have a B.A. from Example University.';
    expect(fullDescriptionQuality(body).isUseful).toBe(false);
  });

  it('keeps a past-appointment body that states an area of expertise', () => {
    const body =
      'An expert in coastal law and maritime trade, Fixture previously taught at Example University, where she was faculty director of an example center.';
    expect(fullDescriptionQuality(body).flags).not.toContain('synthetic-placeholder');
  });
});

describe('a card identical to a good body is a card', () => {
  it('accepts a well-formed "Studies X, including A and B." card that repeats its body', () => {
    const text =
      'Studies glacier physics, including ice sheet dynamics, subglacial hydrology, and sea level projections.';
    expect(shortDescriptionQuality(text, text, undefined, fra).isUseful).toBe(true);
  });

  it('still refuses a topic list that names a role track rather than a topic', () => {
    const text = 'Studies Glacier Physics, Theorist, and Remote Sensing.';
    expect(shortDescriptionQuality(text, text, undefined, fra).flags).toContain('topic-label-list');
  });
});

describe('page-fragment cards are replaced from the body', () => {
  const full =
    "Robin Fixture's current research includes predictive modeling of river floods using machine learning methods and the demography of coastal towns.";

  it('refuses a card that opens on a glued dateline and derives one from the body', () => {
    const stored =
      'May 11, 2021In Defense of Flood Models, using machine learning methods and the demography of coastal towns.';
    expect(shortDescriptionQuality(stored, full, undefined, fra).flags).toContain(
      'source-news-fragment',
    );
    const served = resolveServedShortDescription({
      shortDescription: stored,
      fullDescription: full,
      researchAreas: ['Flood Modeling'],
      entityType: 'FACULTY_RESEARCH_AREA',
    });
    expect(served).not.toMatch(/2021|In Defense/);
    expect(served).not.toBe('');
  });

  it('refuses a card that is a list of book titles', () => {
    const stored =
      'The River Book (2024), Salt and Tide: A History (2019), and Small Harbors (2018).';
    expect(shortDescriptionQuality(stored, full, undefined, fra).flags).toContain('paper-fragment');
  });

  it('refuses a card that drops the discipline of its topic', () => {
    const body =
      'Research focuses on modern Example history and the history of medicine, including work on cholera.';
    const card = 'Studies medicine, including work on cholera.';
    expect(shortDescriptionQuality(card, body, undefined, fra).isUseful).toBe(false);
    expect(
      resolveServedShortDescription({
        shortDescription: card,
        fullDescription: body,
        researchAreas: [],
        entityType: 'FACULTY_RESEARCH_AREA',
      }),
    ).not.toBe(card);
  });

  it.each([
    "Studies Robin Fixture's research concerns rivers, ports, and trade.",
    'Studies Scholar of maritime history and the law of the sea.',
  ])('refuses a Studies template glued onto a sentence with its own subject: %s', (card) => {
    expect(shortDescriptionQuality(card, card, undefined, fra).flags).toContain(
      'malformed-generated-text',
    );
  });

  it('derives a card from a possessive research-interests body', () => {
    const body =
      "Robin Fixture's research and teaching interests span a variety of coastal policy issues including flood insurance, ports, and fisheries.";
    expect(deriveShortDescriptionFromFullDescription(body)).toBe(
      'Studies a variety of coastal policy issues including flood insurance, ports, and fisheries.',
    );
  });

  it.each([
    "Robin Fixture's area of academic research is the history of imagined harbor towns. She studies how port communities organized trade guilds.",
    'Her area of research is the history of imagined harbor towns. She studies how port communities organized trade guilds.',
    "Robin Fixture is Professor of History. Robin Fixture's area of academic research is the history of imagined harbor towns. She studies how port communities organized trade guilds. She received her Ph.D. from Example University in 1995.",
  ])('serves a card that keeps the discipline of an area-of-research statement: %s', (body) => {
    expect(
      resolveServedShortDescription({
        shortDescription: '',
        fullDescription: body,
        researchAreas: [],
        entityType: 'FACULTY_RESEARCH_AREA',
      }),
    ).toBe('Studies the history of imagined harbor towns.');
  });
});

describe('sentence tiling keeps dotted initialisms and titles whole', () => {
  it('does not split inside "U.S." before a lowercase continuation', () => {
    const text =
      'Studies labor in U.S. port cities, including U.S. trade policy and the legal history of U.S. shipping.';
    expect(partitionSentencesForFiltering(text)).toEqual([text]);
  });

  it('does not split at a question mark inside a title followed by a colon', () => {
    const text =
      'She wrote Where Did It Go?: A History of Maps (2010). Her research focuses on maps.';
    expect(partitionSentencesForFiltering(text)).toHaveLength(2);
  });

  it('still splits a glued sentence end', () => {
    expect(
      partitionSentencesForFiltering('The lab studies tides.To read more, see the page.'),
    ).toHaveLength(2);
  });
});

describe('research statements of a biography', () => {
  it('never treats a funding sentence as a research statement', () => {
    const body =
      'Robin Fixture is a professor of dermatology. Her research is supported by an example foundation and an example company.';
    expect(researchStatementSentences(body)).toEqual([]);
  });

  it('keeps research sentences that follow a statement and drops the career ones', () => {
    const body =
      "Robin Fixture's research focuses on industrial organization. She studies how firms respond to public policies. In 2016 she served as chief economist at an example agency. She is a co-editor of an example journal.";
    expect(researchStatementSentences(body)).toEqual([
      "Robin Fixture's research focuses on industrial organization.",
      'She studies how firms respond to public policies.',
    ]);
  });

  it('keeps every research sentence that follows a statement, not only the ones naming a research verb', () => {
    const body =
      'Robin Fixture is Example Professor of Chemistry. Her research focuses on catalysis. Using spectroscopy, her group has uncovered how metal surfaces bind carbon dioxide. These insights guide catalyst design.';
    expect(researchStatementSentences(body)).toEqual([
      'Her research focuses on catalysis.',
      'Using spectroscopy, her group has uncovered how metal surfaces bind carbon dioxide.',
      'These insights guide catalyst design.',
    ]);
  });
});
