import { describe, expect, it } from 'vitest';
import { formatTitleCaseLabel } from '../displayText';

describe('formatTitleCaseLabel', () => {
  it('title-cases plain words', () => {
    expect(formatTitleCaseLabel('molecular biology')).toBe('Molecular Biology');
    expect(formatTitleCaseLabel('tumorigenesis')).toBe('Tumorigenesis');
    expect(formatTitleCaseLabel('Cancer Biology')).toBe('Cancer Biology');
  });

  it('preserves acronyms present in the source instead of mangling them', () => {
    expect(formatTitleCaseLabel('DNA repair')).toBe('DNA Repair');
    expect(formatTitleCaseLabel('DNA Double Strand Break (DSB)')).toBe(
      'DNA Double Strand Break (DSB)',
    );
    expect(formatTitleCaseLabel('EEG signal analysis')).toBe('EEG Signal Analysis');
    expect(formatTitleCaseLabel('PET imaging')).toBe('PET Imaging');
  });

  it('upper-cases known acronyms that arrive lower-cased', () => {
    expect(formatTitleCaseLabel('ai ethics')).toBe('AI Ethics');
    expect(formatTitleCaseLabel('crispr screening')).toBe('CRISPR Screening');
  });

  it('capitalizes after hyphen and slash boundaries', () => {
    expect(formatTitleCaseLabel('single-cell genomics')).toBe('Single-Cell Genomics');
    expect(formatTitleCaseLabel('in vivo/in vitro')).toBe('In Vivo/In Vitro');
  });

  it('preserves apostrophes within a word', () => {
    expect(formatTitleCaseLabel("parkinson's disease")).toBe("Parkinson's Disease");
  });

  it('down-cases screaming enum labels once they are lower-cased by the caller', () => {
    expect(formatTitleCaseLabel('core facility')).toBe('Core Facility');
    expect(formatTitleCaseLabel('lab')).toBe('Lab');
  });

  it('collapses whitespace and trims', () => {
    expect(formatTitleCaseLabel('  cancer   biology  ')).toBe('Cancer Biology');
  });
});
