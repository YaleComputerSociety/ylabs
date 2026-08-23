import { describe, expect, it } from 'vitest';
import {
  sanitizeResearchAreaFacetDistribution,
  sanitizeResearchAreaLabel,
  sanitizeResearchAreaLabelList,
  stripProfileRoleLabelSuffix,
} from '../researchAreaLabelHygiene';

describe('stripProfileRoleLabelSuffix', () => {
  it('removes a glued YSM Researcher role label and keeps the topic', () => {
    expect(stripProfileRoleLabelSuffix('MedicareYSM Researcher')).toBe('Medicare');
    expect(stripProfileRoleLabelSuffix('Sarcoma, KaposiYSM Researcher')).toBe('Sarcoma, Kaposi');
    expect(stripProfileRoleLabelSuffix('Demyelinating Autoimmune Diseases, CNSYSM Researcher')).toBe(
      'Demyelinating Autoimmune Diseases, CNS',
    );
  });

  it('handles the plural role label and a space-separated glue', () => {
    expect(stripProfileRoleLabelSuffix('HistonesYSM Researchers')).toBe('Histones');
    expect(stripProfileRoleLabelSuffix('Sodium YSM Researcher')).toBe('Sodium');
  });

  it('leaves a clean topic untouched', () => {
    expect(stripProfileRoleLabelSuffix('Immunology')).toBe('Immunology');
    expect(stripProfileRoleLabelSuffix('Public Health')).toBe('Public Health');
  });
});

describe('sanitizeResearchAreaLabel', () => {
  it('collapses whitespace and strips the role label', () => {
    expect(sanitizeResearchAreaLabel('  Blockchain   YSM Researcher ')).toBe('Blockchain');
  });

  it('returns an empty string for a bare role label or non-string', () => {
    expect(sanitizeResearchAreaLabel('YSM Researcher')).toBe('');
    expect(sanitizeResearchAreaLabel(undefined)).toBe('');
    expect(sanitizeResearchAreaLabel(42)).toBe('');
  });
});

describe('sanitizeResearchAreaLabelList', () => {
  it('repairs, drops empties, and dedupes case-insensitively', () => {
    expect(
      sanitizeResearchAreaLabelList([
        'MedicareYSM Researcher',
        'Medicare',
        'YSM Researcher',
        'HistonesYSM Researcher',
      ]),
    ).toEqual(['Medicare', 'Histones']);
  });
});

describe('sanitizeResearchAreaFacetDistribution', () => {
  it('repairs keys and merges counts, dropping empty keys', () => {
    expect(
      sanitizeResearchAreaFacetDistribution({
        'MedicareYSM Researcher': 1,
        Medicare: 3,
        'YSM Researcher': 2,
        Histones: 5,
      }),
    ).toEqual({ Medicare: 4, Histones: 5 });
  });

  it('passes through undefined unchanged', () => {
    expect(sanitizeResearchAreaFacetDistribution(undefined)).toBeUndefined();
  });
});
