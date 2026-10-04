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
