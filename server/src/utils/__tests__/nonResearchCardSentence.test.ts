import { describe, expect, it } from 'vitest';

import { sanitizeResearchEntityShortDescription } from '../descriptionHygiene';
import { isNonResearchCardSentence, stripProgramRenameNote } from '../nonResearchCardSentence';

describe('isNonResearchCardSentence', () => {
  it.each([
    [
      'a site tagline',
      'Official site of the film scholar Pat Example, author of many works on cinema.',
    ],
    ['a welcome banner', 'Welcome to the Example Care Innovation Lab!'],
    [
      'a presentation remark',
      'Dr. Example has presented his work at multiple international conferences, with a particular focus on India.',
    ],
    ['a topic that is a prize name', 'Studies Religions Prize.'],
    [
      'an honors list',
      'Example Foundation, the Sample Prize in Translational Research, and others.',
    ],
    [
      'a journal citation',
      'Electoral Studies 78 Legislatures and Legislative Politics without Democracy.',
    ],
    [
      'a recording announcement',
      'Two of the most ambitious recording projects will be released in 2025: The 24 Studies by a composer.',
    ],
  ])('refuses %s', (_label, text) => {
    expect(isNonResearchCardSentence(text)).toBe(true);
  });

  it.each([
    ['a plain topics line', 'Studies Industrial Organization.'],
    [
      'a research sentence that names a prize it won',
      'Studies the modernist poetry movement in Arabic and its Cold War context, which received the Sample International Book Prize.',
    ],
    ['a trial count sentence', 'Conducts 2 Phase III RCTs for pathogen reduced RBCs.'],
    [
      'a research sentence naming a studies department',
      'Explores how American Studies 101 reshaped curricula across New England colleges.',
    ],
    [
      'a research focus sentence',
      "Dr. Example's research focuses on improving health outcomes for tuberculosis and HIV.",
    ],
    ['a lowercase studies sentence ending on prizes', 'Studies the history of literary prizes.'],
    ['a studies sentence about a named prize', 'Studies the economics of the Nobel Prize.'],
    [
      'a research noun phrase naming a disease type',
      'Immune tolerance in Type 1 Diabetes and celiac disease.',
    ],
    ['a research noun phrase naming a trial phase', 'Outcomes of Phase 2 Trials in oncology.'],
    [
      'a research sentence about presented evidence',
      'The lab has presented new evidence that sleep shapes memory.',
    ],
  ])('keeps %s', (_label, text) => {
    expect(isNonResearchCardSentence(text)).toBe(false);
  });
});

describe('stripProgramRenameNote', () => {
  it('drops a trailing rename note naming the successor program', () => {
    expect(stripProgramRenameNote('Studies Antiquity and the Premodern world (now ARCHAIA).')).toBe(
      'Studies Antiquity and the Premodern world.',
    );
  });

  it('keeps an ordinary parenthetical', () => {
    expect(stripProgramRenameNote('Studies trustworthy artificial intelligence (AI).')).toBe(
      'Studies trustworthy artificial intelligence (AI).',
    );
  });
});

describe('sanitizeResearchEntityShortDescription with non-research cards', () => {
  it('refuses a card that is a site tagline so the row falls back to a derived line', () => {
    expect(
      sanitizeResearchEntityShortDescription(
        'Official site of the film scholar Pat Example, author of many works on cinema.',
      ),
    ).toBe('');
  });

  it('serves a research card with its program rename note removed', () => {
    expect(
      sanitizeResearchEntityShortDescription(
        'Studies Antiquity and the Premodern world (now ARCHAIA).',
      ),
    ).toBe('Studies Antiquity and the Premodern world.');
  });
});

describe('isNonResearchCardSentence on fragments and news notes', () => {
  it.each([
    [
      'a fragment opening on a close bracket',
      ') and expansion microscopy techniques, using our new techniques.',
    ],
    [
      'a fragment opening on a hyphen',
      '-E. A. Example Professor of Public Health, whose research focused on outcomes.',
    ],
    ['a website news note', 'New: I added a chapter on diffusion generative models.'],
    ['a first-person update note', 'I added two new datasets to the archive page.'],
    ['a coming-soon banner', 'Coming soon: a new edition of the course notes.'],
    ['a dash-separated news note', 'New - two datasets are now on the archive page.'],
  ])('refuses %s', (_label, text) => {
    expect(isNonResearchCardSentence(text)).toBe(true);
  });

  it.each([
    'New-onset epilepsy in children is the focus of the clinical studies here.',
    'Update-driven memory consolidation is examined in sleeping animals.',
  ])('keeps a research sentence opening on a hyphenated compound: %s', (text) => {
    expect(isNonResearchCardSentence(text)).toBe(false);
  });

  it('keeps a research sentence that mentions news', () => {
    expect(
      isNonResearchCardSentence('Studies how local news coverage shapes civic participation.'),
    ).toBe(false);
  });
});

describe('teaching records in the card slot', () => {
  it.each([
    [
      'a past teaching appointment',
      'Example has previously held teaching appointments at Synthetic College and Sample University, and taught photography at an art school.',
    ],
    [
      'a focus on developing students',
      "Pat Example's work focuses on developing students’ technique and style through play.",
    ],
  ])('refuses %s', (_label, card) => {
    expect(isNonResearchCardSentence(card)).toBe(true);
  });

  it('keeps a focus on developing research methods', () => {
    expect(
      isNonResearchCardSentence('Her work focuses on developing new imaging methods for coral reefs.'),
    ).toBe(false);
  });
});
