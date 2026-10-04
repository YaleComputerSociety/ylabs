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
      'Studies how developing neurons in the mammalian retina form their first synapses; examines the guidance cues and activity patterns in the visual cortex to which young neurons respond as circuits mature and are later refined by sensory experience across many developmental stages in mice, ferrets, and primates, using imaging.',
    );
    expect(card).toBe(
      'Studies how developing neurons in the mammalian retina form their first synapses.',
    );
  });

  it('does not double the period of a head that ends on an abbreviation', () => {
    const card = sanitizeResearchEntityShortDescription(
      'Studies how mechanical forces shape developing tissues across the embryo, including the heart, the gut, the limb buds, the neural tube, etc. using live imaging, genetic perturbation, and computational models of cell mechanics to explain how organs reach their final size and form during development in zebrafish and mice.',
    );
    expect(card).toMatch(/etc\.$/);
    expect(card).not.toMatch(/\.\.$/);
  });
});

describe('a long card refused as a whole page dump', () => {
  it('is not served through its clamped head', () => {
    const card = sanitizeResearchEntityShortDescription(
      'Welcome! The Coastal Ecology Lab investigates how salt marsh plant communities respond to sea level rise and nutrient loading along the Atlantic coast and in the estuaries of the Gulf of Maine. Field crews combine long-term plots with greenhouse experiments. Get involved in the summer field program and help with sampling.',
    );
    expect(card).toBe('');
  });
});
