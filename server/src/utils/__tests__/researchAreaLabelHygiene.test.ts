import { describe, expect, it } from 'vitest';
import {
  isNarrativeProseResearchAreaLabel,
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

  it('drops narrative-prose fragments that are not topic tags', () => {
    expect(
      sanitizeResearchAreaLabel('I have been applying techniques drawn from probability theory and statistics'),
    ).toBe('');
    expect(
      sanitizeResearchAreaLabel('The study of problems at the interface of optical and condensed matter physics'),
    ).toBe('');
    expect(
      sanitizeResearchAreaLabel('Research in the group is currently focused on three general themes'),
    ).toBe('');
    expect(sanitizeResearchAreaLabel('My main teaching interests lie in Experimental Physics')).toBe('');
    expect(sanitizeResearchAreaLabel('How do core developmental patterns emerge during language learning')).toBe('');
  });

  it('keeps short tags whose leading letter is glued to punctuation', () => {
    expect(sanitizeResearchAreaLabel('I/O Systems')).toBe('I/O Systems');
    expect(sanitizeResearchAreaLabel('I-V characteristics')).toBe('I-V characteristics');
  });

  it('keeps legitimate multi-word topic phrases even when long', () => {
    expect(sanitizeResearchAreaLabel('Quantum Physics')).toBe('Quantum Physics');
    expect(
      sanitizeResearchAreaLabel('Magnetic and transport properties of perovskites and related materials'),
    ).toBe('Magnetic and transport properties of perovskites and related materials');
    expect(
      sanitizeResearchAreaLabel('Cultural and Political Aspects of Natural Hazards, Disasters, and Resource Degradation'),
    ).toBe('Cultural and Political Aspects of Natural Hazards, Disasters, and Resource Degradation');
  });
});

describe('isNarrativeProseResearchAreaLabel', () => {
  it('flags run-on concatenations longer than a real topic tag', () => {
    expect(
      isNarrativeProseResearchAreaLabel(
        'Quantum Matter Fractons from polarons Light bipolarons stabilized by Peierls electron-electron coupling Non-equilibrium quantum dynamics',
      ),
    ).toBe(true);
  });

  it('does not flag concise noun-phrase topics', () => {
    expect(isNarrativeProseResearchAreaLabel('Condensed Matter Physics')).toBe(false);
    expect(isNarrativeProseResearchAreaLabel('Artificial Intelligence (AI)')).toBe(false);
    expect(isNarrativeProseResearchAreaLabel('Studies on Chitinases and Chitosanases')).toBe(false);
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
