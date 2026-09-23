import { describe, expect, it } from 'vitest';
import {
  isPlausibleUndergradEvidenceQuote,
  quoteExplicitlyDeclinesUndergraduates,
} from '../undergradEvidenceQuoteValidation';

describe('isPlausibleUndergradEvidenceQuote (#1387)', () => {
  it('accepts genuine undergrad-access quotes', () => {
    const plausible = [
      'Undergraduates are welcome to join the lab.',
      'We invite undergraduate students to apply each semester.',
      'Yale College students conduct independent research projects in the lab.',
    ];
    for (const quote of plausible) {
      expect(isPlausibleUndergradEvidenceQuote(quote)).toBe(true);
    }
  });

  it('rejects empty or missing quotes', () => {
    expect(isPlausibleUndergradEvidenceQuote('')).toBe(false);
    expect(isPlausibleUndergradEvidenceQuote('   ')).toBe(false);
    expect(isPlausibleUndergradEvidenceQuote(undefined)).toBe(false);
    expect(isPlausibleUndergradEvidenceQuote(null)).toBe(false);
  });

  it('rejects page-chrome/mission-blurb text with no undergrad-population token (#1387 wrong-entity graft)', () => {
    expect(
      isPlausibleUndergradEvidenceQuote(
        'The Department of Chemistry maintains a glassblowing facility to benefit the research community.',
      ),
    ).toBe(false);
    expect(
      isPlausibleUndergradEvidenceQuote(
        'We foster a rigorous, collaborative, and inclusive environment where curiosity thrives.',
      ),
    ).toBe(false);
  });

  it('rejects a high-school population disguised as a college "senior" (#1387)', () => {
    expect(
      isPlausibleUndergradEvidenceQuote('Sahil is a senior in high school working in the lab.'),
    ).toBe(false);
  });

  it('rejects decline/unavailability phrasing stored as positive evidence (#1387)', () => {
    expect(
      isPlausibleUndergradEvidenceQuote(
        'I do not have bandwidth to respond to inquiries about undergraduate positions.',
      ),
    ).toBe(false);
    expect(
      isPlausibleUndergradEvidenceQuote('We are not taking undergraduate researchers this year.'),
    ).toBe(false);
  });

  it('rejects a PI or staff member describing their own historical undergraduate degree (#1387)', () => {
    expect(
      isPlausibleUndergradEvidenceQuote(
        "Taylor completed her undergraduate degree at Yale before earning a Master's in Biology.",
      ),
    ).toBe(false);
    expect(isPlausibleUndergradEvidenceQuote('EducationBS, Harvey Mudd College, 2023')).toBe(false);
  });
});

describe('quoteExplicitlyDeclinesUndergraduates', () => {
  it('reads a direct non-acceptance policy as a decline', () => {
    expect(quoteExplicitlyDeclinesUndergraduates('not accepting undergraduates')).toBe(true);
    expect(
      quoteExplicitlyDeclinesUndergraduates(
        'We are not currently accepting undergraduate researchers.',
      ),
    ).toBe(true);
    expect(
      quoteExplicitlyDeclinesUndergraduates(
        'I do not have bandwidth to respond to inquiries about undergraduate research opportunities.',
      ),
    ).toBe(false);
    expect(
      quoteExplicitlyDeclinesUndergraduates('We are now accepting undergraduate applications.'),
    ).toBe(false);
  });

  it('recognizes a bare research-assistant role title without a literal student token', () => {
    expect(
      quoteExplicitlyDeclinesUndergraduates(
        'The Leonard Learning Lab is not currently accepting Research Assistant applications.',
      ),
    ).toBe(true);
    expect(
      quoteExplicitlyDeclinesUndergraduates(
        'We are not currently accepting Research Aide applications.',
      ),
    ).toBe(true);
    expect(
      quoteExplicitlyDeclinesUndergraduates(
        'The lab is not currently accepting Lab Assistant applications.',
      ),
    ).toBe(true);
  });
});
