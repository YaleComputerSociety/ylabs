import { describe, expect, it } from 'vitest';
import { normalizedProgramTitleKey } from '../programTitle';

describe('normalizedProgramTitleKey', () => {
  it('is case-, whitespace-, and punctuation-insensitive', () => {
    expect(normalizedProgramTitleKey('  STARS  Summer   Research Program ')).toBe(
      normalizedProgramTitleKey('stars summer research program'),
    );
  });

  it('folds curly and straight apostrophes to the same key', () => {
    expect(normalizedProgramTitleKey("Yale College Dean's Research Fellowship")).toBe(
      normalizedProgramTitleKey('Yale College Dean’s Research Fellowship'),
    );
  });

  it('folds an ampersand to the word "and" so & and and titles collide (#655)', () => {
    expect(
      normalizedProgramTitleKey('First-Year Summer Research Fellowship in the Sciences & Engineering'),
    ).toBe(
      normalizedProgramTitleKey('First-Year Summer Research Fellowship in the Sciences and Engineering'),
    );
  });

  it('does not collapse genuinely distinct titles', () => {
    expect(normalizedProgramTitleKey('Wu Tsai Undergraduate Fellowships')).not.toBe(
      normalizedProgramTitleKey('Undergraduate Fellowships'),
    );
    expect(normalizedProgramTitleKey('Mellon Fellowship Berkeley College')).not.toBe(
      normalizedProgramTitleKey('Mellon Fellowship Branford College'),
    );
  });

  it('returns an empty string for blank titles', () => {
    expect(normalizedProgramTitleKey('')).toBe('');
    expect(normalizedProgramTitleKey('   ')).toBe('');
  });
});
