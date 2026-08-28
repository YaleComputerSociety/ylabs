import { describe, expect, it } from 'vitest';
import {
  isCorruptResearchAreaLabel,
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
    expect(
      stripProfileRoleLabelSuffix('Demyelinating Autoimmune Diseases, CNSYSM Researcher'),
    ).toBe('Demyelinating Autoimmune Diseases, CNS');
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
      sanitizeResearchAreaLabel(
        'I have been applying techniques drawn from probability theory and statistics',
      ),
    ).toBe('');
    expect(
      sanitizeResearchAreaLabel(
        'The study of problems at the interface of optical and condensed matter physics',
      ),
    ).toBe('');
    expect(
      sanitizeResearchAreaLabel(
        'Research in the group is currently focused on three general themes',
      ),
    ).toBe('');
    expect(
      sanitizeResearchAreaLabel('My main teaching interests lie in Experimental Physics'),
    ).toBe('');
    expect(
      sanitizeResearchAreaLabel(
        'How do core developmental patterns emerge during language learning',
      ),
    ).toBe('');
  });

  it('keeps short tags whose leading letter is glued to punctuation', () => {
    expect(sanitizeResearchAreaLabel('I/O Systems')).toBe('I/O Systems');
    expect(sanitizeResearchAreaLabel('I-V characteristics')).toBe('I-V characteristics');
  });

  it('fails closed on symbol-only continuation-token chips', () => {
    expect(sanitizeResearchAreaLabel('···')).toBe('');
    expect(sanitizeResearchAreaLabel('...')).toBe('');
    expect(sanitizeResearchAreaLabel('---')).toBe('');
  });

  it('fails closed on citation-tail fragments', () => {
    expect(sanitizeResearchAreaLabel('Smith 1989b)')).toBe('');
    expect(sanitizeResearchAreaLabel('reviewed in Jones 2003)')).toBe('');
  });

  it('fails closed on verb-lead clause fragments and number-word phrases', () => {
    expect(sanitizeResearchAreaLabel('three and four')).toBe('');
    expect(sanitizeResearchAreaLabel('has occupied morphologists')).toBe('');
    expect(sanitizeResearchAreaLabel('is currently investigating')).toBe('');
  });

  it('fails closed on leaked research-area label phrases', () => {
    expect(sanitizeResearchAreaLabel('Research areas include immunology and genomics')).toBe('');
    expect(sanitizeResearchAreaLabel('Research Areas: cardiovascular health')).toBe('');
    expect(sanitizeResearchAreaLabel('research area of interest')).toBe('');
  });

  it('keeps lowercase-initial topics that faculty enter in lower case', () => {
    expect(sanitizeResearchAreaLabel('mRNA vaccines')).toBe('mRNA vaccines');
    expect(sanitizeResearchAreaLabel('de novo protein design')).toBe('de novo protein design');
    expect(sanitizeResearchAreaLabel('in vivo imaging')).toBe('in vivo imaging');
    expect(sanitizeResearchAreaLabel('cell biology')).toBe('cell biology');
    expect(sanitizeResearchAreaLabel('mapping class groups')).toBe('mapping class groups');
    expect(sanitizeResearchAreaLabel('high entropy alloys')).toBe('high entropy alloys');
    expect(sanitizeResearchAreaLabel('literature and science')).toBe('literature and science');
    expect(sanitizeResearchAreaLabel('history of photography')).toBe('history of photography');
    expect(sanitizeResearchAreaLabel('physics beyond the standard model')).toBe(
      'physics beyond the standard model',
    );
  });

  it('keeps topics that carry a balanced parenthetical', () => {
    expect(sanitizeResearchAreaLabel('Magnetic Resonance Imaging (MRI)')).toBe(
      'Magnetic Resonance Imaging (MRI)',
    );
  });

  it('keeps legitimate multi-word topic phrases even when long', () => {
    expect(sanitizeResearchAreaLabel('Quantum Physics')).toBe('Quantum Physics');
    expect(
      sanitizeResearchAreaLabel(
        'Magnetic and transport properties of perovskites and related materials',
      ),
    ).toBe('Magnetic and transport properties of perovskites and related materials');
    expect(
      sanitizeResearchAreaLabel(
        'Cultural and Political Aspects of Natural Hazards, Disasters, and Resource Degradation',
      ),
    ).toBe(
      'Cultural and Political Aspects of Natural Hazards, Disasters, and Resource Degradation',
    );
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

describe('isCorruptResearchAreaLabel', () => {
  it('flags symbol-only, citation-tail, lowercase-fragment, and label-leak values', () => {
    expect(isCorruptResearchAreaLabel('···')).toBe(true);
    expect(isCorruptResearchAreaLabel('Smith 1989b)')).toBe(true);
    expect(isCorruptResearchAreaLabel('has occupied morphologists')).toBe(true);
    expect(isCorruptResearchAreaLabel('Research areas include genomics')).toBe(true);
  });

  it('does not flag clean topic tags or lowercase noun-phrase topics', () => {
    expect(isCorruptResearchAreaLabel('Cardiac Imaging and Diagnostics')).toBe(false);
    expect(isCorruptResearchAreaLabel('mRNA vaccines')).toBe(false);
    expect(isCorruptResearchAreaLabel('in vivo imaging')).toBe(false);
    expect(isCorruptResearchAreaLabel('cell biology')).toBe(false);
    expect(isCorruptResearchAreaLabel('mapping class groups')).toBe(false);
    expect(isCorruptResearchAreaLabel('high entropy alloys')).toBe(false);
    expect(isCorruptResearchAreaLabel('Magnetic Resonance Imaging (MRI)')).toBe(false);
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

  it('drops a symbol-only continuation token but keeps the surrounding clean topics', () => {
    expect(
      sanitizeResearchAreaLabelList([
        'Atherosclerosis and Cardiovascular Diseases',
        '···',
        'Internal Medicine',
      ]),
    ).toEqual(['Atherosclerosis and Cardiovascular Diseases', 'Internal Medicine']);
  });

  it('collapses an all-junk area list to empty', () => {
    expect(
      sanitizeResearchAreaLabelList([
        'Smith 1989b)',
        'three and four',
        'has occupied morphologists',
      ]),
    ).toEqual([]);
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
