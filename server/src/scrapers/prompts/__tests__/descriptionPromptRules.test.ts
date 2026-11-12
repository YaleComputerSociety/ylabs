import { describe, expect, it } from 'vitest';
import { CARD_SYNTHESIS_PROMPT, COVERAGE_SYNTHESIS_PROMPT } from '..';

describe('the v2 writer prompt states its rules (#5961)', () => {
  it('opens with what the work studies rather than a list header', () => {
    expect(COVERAGE_SYNTHESIS_PROMPT).toContain('Start with what the work studies');
    expect(COVERAGE_SYNTHESIS_PROMPT).toContain(
      'Never open with a list header such as "Research interests include ...", "Interests are in ..."',
    );
  });

  it('keeps the field or discipline noun and an established method name', () => {
    expect(COVERAGE_SYNTHESIS_PROMPT).toContain('Keep the field or discipline noun');
    expect(COVERAGE_SYNTHESIS_PROMPT).toContain('the name of an established method');
  });

  it('names current projects when the evidence names them', () => {
    expect(COVERAGE_SYNTHESIS_PROMPT).toContain(
      'when the snippets name specific current projects, studies or questions, add a sentence that names two or three of them',
    );
    expect(COVERAGE_SYNTHESIS_PROMPT).toContain('"Current projects include how ..., whether ...');
  });

  it('never joins two separate items into one claim', () => {
    expect(COVERAGE_SYNTHESIS_PROMPT).toContain('Never join two separate items into one claim.');
  });

  it('keeps the tense and the past framing the evidence uses', () => {
    expect(COVERAGE_SYNTHESIS_PROMPT).toContain(
      'Keep the tense and the "previously" or "earlier" framing the snippets use.',
    );
  });
});

describe('the v2 card prompt states its rules (#5961)', () => {
  it('keeps the main method the body names', () => {
    expect(CARD_SYNTHESIS_PROMPT).toContain(
      'When the description names a main method, keep that method in the card.',
    );
  });

  it('does not turn a flat expertise list into a research framing', () => {
    expect(CARD_SYNTHESIS_PROMPT).toContain(
      'never turn a flat list into a research framing such as "examines intersections of ..."',
    );
  });
});
