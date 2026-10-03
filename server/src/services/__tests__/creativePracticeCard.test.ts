import { describe, expect, it } from 'vitest';
import { decideCreativePracticeCard } from '../creativePracticeCard';

const BODY =
  'Born into a family of musicians, she trained at a conservatory in Vienna. The violinist has performed with orchestras across Europe and appears in recital at chamber music festivals each summer. She also coaches graduate ensembles.';

describe('decideCreativePracticeCard (#4519)', () => {
  it('keeps a card that does not speak in the research voice', () => {
    const card = 'A violinist who appears in recital at chamber music festivals each summer.';

    expect(decideCreativePracticeCard(card, BODY)).toEqual({ card, withheldBy: null });
  });

  it('replaces a research-voice chip summary with the body’s first practice sentence', () => {
    expect(decideCreativePracticeCard('Studies chamber music.', BODY)).toEqual({
      card: 'The violinist has performed with orchestras across Europe and appears in recital at chamber music festivals each summer.',
      withheldBy: 'researchVoiceCardReplacedByPracticeSentence',
    });
  });

  it('replaces a card that claims research in the middle of the sentence', () => {
    expect(
      decideCreativePracticeCard(
        'The violinist studies kidney stones and pelvic floor disorders.',
        BODY,
      ).withheldBy,
    ).toBe('researchVoiceCardReplacedByPracticeSentence');
  });

  it('withholds the card when the body has no practice sentence to offer', () => {
    expect(
      decideCreativePracticeCard(
        'Studies architectural education.',
        'The exhibition was open in May.',
      ),
    ).toEqual({ card: '', withheldBy: 'researchVoiceCardWithoutPracticeSentence' });
  });

  it('reads an office name and an artwork subject as no research claim', () => {
    for (const card of [
      'She also teaches in the Theatre Studies Program at a conservatory in New York.',
      'His sculpture is work that examines failure and success through machines and sound.',
    ]) {
      expect(decideCreativePracticeCard(card, BODY).withheldBy).toBeNull();
    }
  });

  it('never opens the replacement mid-clause after a company abbreviation', () => {
    const body =
      'As a screenwriter he has written for Example Bros. Studios and other companies, and has presented television projects. The writer recently completed a novel and a collection of stories set in the Midwest.';

    expect(decideCreativePracticeCard('Studies television.', body).card).toBe(
      'The writer recently completed a novel and a collection of stories set in the Midwest.',
    );
  });
});
