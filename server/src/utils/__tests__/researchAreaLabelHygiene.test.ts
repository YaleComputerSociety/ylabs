import { describe, expect, it } from 'vitest';
import {
  endsWithChipSentenceStop,
  isCorruptResearchAreaLabel,
  isNarrativeProseResearchAreaLabel,
  isSentenceShapedChip,
  sanitizeMethodChipLabel,
  sanitizeResearchAreaFacetDistribution,
  sanitizeResearchAreaLabel,
  sanitizeResearchAreaLabelList,
  stripChipSentenceStop,
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

describe('isSentenceShapedChip', () => {
  it('refuses a clause-length chip that closes with terminal punctuation', () => {
    expect(
      isSentenceShapedChip('Providing, or arranging for, other kinds of data collection.'),
    ).toBe(true);
    expect(
      isSentenceShapedChip(
        'Serving as an honest broker for studies, identifying, requesting, and obtaining radiology films.',
      ),
    ).toBe(true);
  });

  it('refuses a clause-length sentence whose last token is an abbreviation', () => {
    expect(
      isSentenceShapedChip(
        'Managing the collection, transportation, and shipment of specimens (blood, stool, CSF, etc.).',
      ),
    ).toBe(true);
    expect(
      isSentenceShapedChip(
        'Explore barriers and facilitators to quality care for patients with Limited English Proficiency in the US.',
      ),
    ).toBe(true);
  });

  it('keeps a tag-shaped chip that merely carries a stray stop', () => {
    expect(isSentenceShapedChip('Polymorphic Drug Metabolizing Enzymes.')).toBe(false);
    expect(isSentenceShapedChip('Concentration.')).toBe(false);
    expect(isSentenceShapedChip('Bisulfite seq.')).toBe(false);
  });

  it('keeps a clause-length technique that closes with no terminal punctuation', () => {
    expect(
      isSentenceShapedChip('human induced pluripotent stem cell (iPSC) derived neuronal models'),
    ).toBe(false);
    expect(
      isSentenceShapedChip(
        'gene trajectory inference for single-cell data by optimal transport metrics',
      ),
    ).toBe(false);
  });
});

describe('stripChipSentenceStop', () => {
  it('removes a stray stop from a tag-shaped chip', () => {
    expect(stripChipSentenceStop('Polymorphic Drug Metabolizing Enzymes.')).toBe(
      'Polymorphic Drug Metabolizing Enzymes',
    );
    expect(stripChipSentenceStop('Concentration.')).toBe('Concentration');
    expect(stripChipSentenceStop('The GLUT4-tethering protein, TUG.')).toBe(
      'The GLUT4-tethering protein, TUG',
    );
  });

  it('leaves an abbreviation-shaped ending intact', () => {
    expect(stripChipSentenceStop('Bisulfite seq.')).toBe('Bisulfite seq.');
    expect(stripChipSentenceStop('Roster et al.')).toBe('Roster et al.');
    expect(stripChipSentenceStop('Centers for Disease Control and Prevention, U.S.')).toBe(
      'Centers for Disease Control and Prevention, U.S.',
    );
  });

  it('leaves an initial and bibliographic numbering intact', () => {
    expect(stripChipSentenceStop('Roster X.')).toBe('Roster X.');
    expect(stripChipSentenceStop('59.1 (Spring 2013) 30-41.')).toBe('59.1 (Spring 2013) 30-41.');
  });

  it('leaves a chip with no terminal punctuation untouched', () => {
    expect(stripChipSentenceStop('Immunology')).toBe('Immunology');
    expect(stripChipSentenceStop("Women's Health")).toBe("Women's Health");
  });
});

describe('sanitizeResearchAreaLabel sentence-shaped chips', () => {
  it('trims a stray stop so a real topic survives the serve-time prose filter', () => {
    expect(sanitizeResearchAreaLabel('Electrophysiological pattern formation.')).toBe(
      'Electrophysiological pattern formation',
    );
    expect(sanitizeResearchAreaLabel('information theory and turbulence.')).toBe(
      'information theory and turbulence',
    );
  });

  it('keeps an abbreviation-ending topic exactly as stored', () => {
    expect(sanitizeResearchAreaLabel('Centers for Disease Control and Prevention, U.S.')).toBe(
      'Centers for Disease Control and Prevention, U.S.',
    );
  });

  it('refuses a page-section caption captured as a topic', () => {
    expect(
      sanitizeResearchAreaLabel('Research topics this faculty member is interested in exploring.'),
    ).toBe('');
  });
});

describe('sanitizeMethodChipLabel', () => {
  it('refuses a sentence captured as a method chip', () => {
    expect(
      sanitizeMethodChipLabel(
        'Providing feedback of all published results of research to participating institutions; acknowledgment of participating institutions in print.',
      ),
    ).toBe('');
  });

  it('keeps an abbreviation-ending method chip', () => {
    expect(sanitizeMethodChipLabel('Bisulfite seq.')).toBe('Bisulfite seq.');
    expect(sanitizeMethodChipLabel('whole genome seq.')).toBe('whole genome seq.');
  });

  it('keeps a long concrete technique with no terminal punctuation', () => {
    expect(
      sanitizeMethodChipLabel('human induced pluripotent stem cell (iPSC) derived neuronal models'),
    ).toBe('human induced pluripotent stem cell (iPSC) derived neuronal models');
  });

  it('trims a stray stop from a tag-shaped method chip', () => {
    expect(sanitizeMethodChipLabel('immunohistochemistry.')).toBe('immunohistochemistry');
  });

  it('returns an empty string for a non-string or blank value', () => {
    expect(sanitizeMethodChipLabel(undefined)).toBe('');
    expect(sanitizeMethodChipLabel('   ')).toBe('');
  });
});

describe('endsWithChipSentenceStop', () => {
  it('reads a whole word before the stop as a sentence ending', () => {
    expect(endsWithChipSentenceStop('Electrophysiological pattern formation.')).toBe(true);
    expect(endsWithChipSentenceStop('where necessary).')).toBe(true);
  });

  it('reads an abbreviation, an initial, or numbering as no sentence ending', () => {
    expect(endsWithChipSentenceStop('Bisulfite seq.')).toBe(false);
    expect(endsWithChipSentenceStop('Roster et al.')).toBe(false);
    expect(endsWithChipSentenceStop('Roster X.')).toBe(false);
    expect(endsWithChipSentenceStop('Centers for Disease Control and Prevention, U.S.')).toBe(
      false,
    );
    expect(endsWithChipSentenceStop('59.1 (Spring 2013) 30-41.')).toBe(false);
    expect(endsWithChipSentenceStop('(blood, stool, CSF, etc.).')).toBe(false);
  });

  it('reads a chip with no terminal punctuation as no sentence ending', () => {
    expect(endsWithChipSentenceStop('Immunology')).toBe(false);
    expect(endsWithChipSentenceStop(undefined)).toBe(false);
  });
});
