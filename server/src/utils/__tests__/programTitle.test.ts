import { describe, expect, it } from 'vitest';
import {
  andConcatenationComponentKeys,
  normalizedProgramTitleKey,
  shareAndConcatenatedTitleComponent,
} from '../programTitle';

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

describe('andConcatenationComponentKeys', () => {
  it('splits a literal all-caps "AND" join into normalized component keys', () => {
    expect(
      andConcatenationComponentKeys(
        'Alpha Research Fellowship for Emerging Scholars AND the Beta Summer Fellowship',
      ),
    ).toEqual([
      normalizedProgramTitleKey('Alpha Research Fellowship for Emerging Scholars'),
      normalizedProgramTitleKey('the Beta Summer Fellowship'),
    ]);
  });

  it('does not split on the lowercase word "and" inside an ordinary title', () => {
    expect(andConcatenationComponentKeys('Research and Travel Grant')).toEqual([]);
  });

  it('returns an empty array for titles with no AND join', () => {
    expect(andConcatenationComponentKeys('Wu Tsai Undergraduate Fellowships')).toEqual([]);
  });
});

describe('shareAndConcatenatedTitleComponent', () => {
  it('recognizes the Tetelman/Bates repro shape: shared trailing component, drifted leading qualifier', () => {
    const titleA = 'Alpha Research Fellowship for Emerging Scholars AND the Beta Summer Fellowship';
    const titleB =
      'Marcus J. Alpha 1962 Research Fellowships for Emerging Scholars AND the Beta Summer Fellowship';
    expect(shareAndConcatenatedTitleComponent(titleA, titleB)).toBe(true);
  });

  it('returns false when neither AND-concatenated title shares a component', () => {
    const titleA = 'Alpha Research Fellowship AND the Beta Summer Fellowship';
    const titleB = 'Gamma Travel Grant AND the Delta Winter Fellowship';
    expect(shareAndConcatenatedTitleComponent(titleA, titleB)).toBe(false);
  });

  it('returns false when either title is not AND-concatenated', () => {
    expect(shareAndConcatenatedTitleComponent('Wu Tsai Undergraduate Fellowships', 'Undergraduate Fellowships')).toBe(
      false,
    );
  });

  it('returns false for identical AND-concatenated titles, which the exact-key lever already handles', () => {
    const title = 'Alpha Research Fellowship AND the Beta Summer Fellowship';
    expect(shareAndConcatenatedTitleComponent(title, title)).toBe(false);
  });
});
