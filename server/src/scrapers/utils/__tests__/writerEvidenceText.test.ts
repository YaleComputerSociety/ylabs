import { describe, expect, it } from 'vitest';
import {
  isResearchPageHeadingLine,
  normalizeWriterText,
  researchPageHeadings,
  writerContentTerms,
  writerEvidenceSentenceHashes,
  writerEvidenceSentences,
} from '../writerEvidenceText';

describe('normalizeWriterText (#5537)', () => {
  it('folds width, case, quotes, dashes and whitespace to one form', () => {
    expect(
      normalizeWriterText(
        '  \uFF2B\uFF45\uFF4C\uFF50 \u201Cforest\u201D   recovery \u2014\tthe lab\u2019s  focus ',
      ),
    ).toBe('kelp "forest" recovery - the lab\'s focus');
  });

  it('reads two copies of a page that differ only in typography as the same text', () => {
    const fetched = 'The lab studies coral\u2010reef recovery \u2013 \u201Cafter\u201D bleaching.';
    const refetched = 'The lab studies coral-reef recovery - "after"   bleaching.';
    expect(normalizeWriterText(fetched)).toBe(normalizeWriterText(refetched));
    expect(writerEvidenceSentenceHashes(fetched)).toEqual(writerEvidenceSentenceHashes(refetched));
  });

  it('keeps a page line apart from the next one when splitting sentences', () => {
    expect(
      writerEvidenceSentences('Coral Reef Recovery\nWe study bleaching. Reefs recover slowly.'),
    ).toEqual(['Coral Reef Recovery', 'We study bleaching.', 'Reefs recover slowly.']);
  });
});

describe('research page headings', () => {
  it('reads a short unpunctuated line as a heading and a sentence as not one', () => {
    expect(isResearchPageHeadingLine('Coral Reef Recovery')).toBe(true);
    expect(isResearchPageHeadingLine('We study how coral reefs recover after bleaching.')).toBe(
      false,
    );
    expect(isResearchPageHeadingLine('continued from the previous line')).toBe(false);
    expect(researchPageHeadings('Coral Reef Recovery\nWe study reefs.\nMarine Heatwaves')).toEqual([
      'Coral Reef Recovery',
      'Marine Heatwaves',
    ]);
  });
});

describe('writerContentTerms', () => {
  it('drops function words and generic research vocabulary', () => {
    expect(writerContentTerms('The lab studies kelp-forest recovery using novel methods')).toEqual([
      'kelp',
      'forest',
      'recovery',
    ]);
  });
});
