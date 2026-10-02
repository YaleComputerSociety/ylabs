import { describe, expect, it } from 'vitest';
import { withBalancedLeadingQuotation } from '../cardLeadingQuotation';

describe('withBalancedLeadingQuotation', () => {
  it('drops a closing quote left at the start of a card by a sentence split', () => {
    expect(
      withBalancedLeadingQuotation('” The studies identified pathways that drive coral bleaching.'),
    ).toBe('The studies identified pathways that drive coral bleaching.');
    expect(withBalancedLeadingQuotation('”The lab studies reef recovery.')).toBe(
      'The lab studies reef recovery.',
    );
    expect(withBalancedLeadingQuotation('’ Studies in Reef Ecology, 2019.')).toBe(
      'Studies in Reef Ecology, 2019.',
    );
  });

  it('drops a lone straight quote that closed the previous sentence', () => {
    expect(withBalancedLeadingQuotation('" The group studies reef recovery.')).toBe(
      'The group studies reef recovery.',
    );
    expect(withBalancedLeadingQuotation("' The group studies reef recovery.")).toBe(
      'The group studies reef recovery.',
    );
  });

  it('restores the closing quote a split moved off the end of a quoted sentence', () => {
    expect(withBalancedLeadingQuotation('“We want every reef survey to count.')).toBe(
      '“We want every reef survey to count.”',
    );
    expect(withBalancedLeadingQuotation('"We want every reef survey to count.')).toBe(
      '"We want every reef survey to count."',
    );
  });

  it('drops an unclosed opening quote when the card does not end a sentence', () => {
    expect(withBalancedLeadingQuotation('“We want every reef survey to count…')).toBe(
      'We want every reef survey to count…',
    );
  });

  it('leaves balanced quotations and apostrophes untouched', () => {
    for (const card of [
      '“Reef Recovery: Studies in Coral Settlement”, 57 Journal of Reefs 405 (1996).',
      '"Coral Settlement Assays," Reef Methods, ed.',
      '“Every survey counts,” the group says.',
      '‘Reef Recovery’ and the women’s survey project.',
      'Studies reef recovery and coral settlement.',
      '',
    ]) {
      expect(withBalancedLeadingQuotation(card)).toBe(card);
    }
  });

  it('judges a straight opener by the mark that closes its span, not by the count of marks', () => {
    expect(withBalancedLeadingQuotation('"Deep Reef" surveys use 12" coring tubes')).toBe(
      '"Deep Reef" surveys use 12" coring tubes',
    );
    expect(withBalancedLeadingQuotation('"Deep Reef" surveys use 12" coring tubes.')).toBe(
      '"Deep Reef" surveys use 12" coring tubes.',
    );
  });

  it('keeps a leading elision written with a closing curly mark', () => {
    expect(withBalancedLeadingQuotation('’90s bleaching events shaped the reef survey.')).toBe(
      '’90s bleaching events shaped the reef survey.',
    );
  });

  it('keeps an opener whose only later curly mark is an apostrophe inside a word unbalanced', () => {
    expect(withBalancedLeadingQuotation('‘The group’s reef survey counts.')).toBe(
      '‘The group’s reef survey counts.’',
    );
  });
});
