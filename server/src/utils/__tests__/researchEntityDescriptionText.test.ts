import { describe, expect, it } from 'vitest';

import {
  publicResearchEntityDescriptionText,
  sanitizeResearchEntityPublicDescriptionFields,
} from '../researchEntityDescriptionText';

describe('publicResearchEntityDescriptionText', () => {
  it('suppresses scraped sentence fragments that should not display as descriptions', () => {
    expect(
      publicResearchEntityDescriptionText(
        'focuses in identifying ecological thresholds beyond which global changes cause abrupt ecosystem degradation.',
      ),
    ).toBe('');
    expect(
      publicResearchEntityDescriptionText(
        'of post-colonialism, South Asian cultural studies, mobility and modernity.',
      ),
    ).toBe('');
    expect(
      publicResearchEntityDescriptionText(
        'is in experimental particle physics: The energy frontier at the Large Hadron Collider.',
      ),
    ).toBe('');
  });

  it('suppresses incomplete source snippets that end mid-name or mid-title', () => {
    expect(
      publicResearchEntityDescriptionText(
        'A Comment on descriptive statistics by Isaiah Andrews, Matthew Gentzkow, and Jesse M.',
      ),
    ).toBe('');
    expect(
      publicResearchEntityDescriptionText(
        'Two primary projects use MRI images in collaboration with Dr.',
      ),
    ).toBe('');
  });

  it('suppresses copied profile contact chrome', () => {
    expect(
      publicResearchEntityDescriptionText(
        'eduHQ 323203-432-4669 Zareena Grewal is a historical anthropologist.',
      ),
    ).toBe('');
  });

  it('keeps complete research descriptions with abbreviations', () => {
    expect(
      publicResearchEntityDescriptionText(
        'Dr. Jones studies U.S. health policy and vaccination programs.',
      ),
    ).toBe('Dr. Jones studies U.S. health policy and vaccination programs.');
  });

  it('strips Yale Medicine copied section chrome while preserving research substance', () => {
    expect(
      publicResearchEntityDescriptionText(
        'INFORMATION FOR Copy Link Throughout our bodies, human cells coexist with diverse and abundant bacteria.They exchange metabolites. To identify, understand, and modulate signaling at the human:microbe interface,our laboratory integratesleading-edge chemical biology and immunology. Copy Link We welcome enthusiastic and curious scientists from diverse backgrounds. Department of Microbial Pathogenesis, 295 Congress Ave. New Haven, CT 06519, United States',
      ),
    ).toBe(
      'Throughout our bodies, human cells coexist with diverse and abundant bacteria. They exchange metabolites. To identify, understand, and modulate signaling at the human:microbe interface, our laboratory integrates leading-edge chemical biology and immunology.',
    );
  });

  it('clears copied truncated short descriptions so full descriptions can render', () => {
    expect(
      sanitizeResearchEntityPublicDescriptionFields({
        shortDescription:
          'Throughout our bodies, human cells coexist with diverse and abundant bacteria. To identify, understand, and modulate signaling at the human:microbe interface, our laboratory integrates chem',
        fullDescription:
          'Throughout our bodies, human cells coexist with diverse and abundant bacteria. To identify, understand, and modulate signaling at the human:microbe interface, our laboratory integrates chemical biology and immunology.',
      }),
    ).toEqual({
      shortDescription: '',
      fullDescription:
        'Throughout our bodies, human cells coexist with diverse and abundant bacteria. To identify, understand, and modulate signaling at the human:microbe interface, our laboratory integrates chemical biology and immunology.',
    });
  });
});
