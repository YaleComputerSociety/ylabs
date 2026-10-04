import { describe, expect, it } from 'vitest';

import {
  MAX_CARD_SHORT_DESCRIPTION_LENGTH,
  sanitizeResearchEntityShortDescription,
} from '../descriptionHygiene';
import { shortDescriptionQuality } from '../researchEntityDescriptionQuality';

const LONG_SINGLE_SENTENCE =
  'Studies development of systematically improvable electronic structure and quantum embedding methods that combine many-body quantum chemistry, materials modeling, and artificial intelligence to describe strongly correlated electron systems and molecule-solid interfaces; applies these computational techniques to design heterogeneous solid-state materials for quantum technology, explore transition metal catalyst design, and investigate charge transfer and light-matter interactions in molecule-solid materials.';

describe('a card identical to its whole body', () => {
  it('is a usable card when the shared text is one research sentence', () => {
    const sentence =
      'Studies computational oncology by analyzing genomic and transcriptomic sequencing data (ATAC-seq, bisulfite seq, RNA-seq, single-cell RNA-seq) to identify biomarkers and improve cancer therapies.';
    expect(
      shortDescriptionQuality(sentence, sentence, ['Computational Biology'], {
        entityType: 'FACULTY_RESEARCH_AREA',
      }).flags,
    ).not.toContain('topic-label-list');
  });

  it('is a usable card when the shared text is a thin topics sentence', () => {
    const sentence =
      'Studies diaspora studies, decolonial theory, transnational feminisms, visual culture, and race and technology.';
    expect(
      shortDescriptionQuality(sentence, sentence, [], { entityType: 'FACULTY_RESEARCH_AREA' })
        .flags,
    ).not.toContain('topic-label-list');
  });
});

describe('a card whose only sentence is past the card ceiling', () => {
  it('is cut at a clause boundary instead of being dropped', () => {
    const card = sanitizeResearchEntityShortDescription(LONG_SINGLE_SENTENCE);
    expect(card).toBe(
      'Studies development of systematically improvable electronic structure and quantum embedding methods that combine many-body quantum chemistry, materials modeling, and artificial intelligence to describe strongly correlated electron systems and molecule-solid interfaces.',
    );
    expect(card.length).toBeLessThanOrEqual(MAX_CARD_SHORT_DESCRIPTION_LENGTH);
  });

  it('is never cut to a head that ends on a dangling word', () => {
    const card = sanitizeResearchEntityShortDescription(
      `${'Studies the regulation of '.repeat(14)}gene expression in cells.`,
    );
    expect(card).not.toMatch(/\b(?:of|the|and)\.$/);
  });
});
