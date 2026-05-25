import { describe, expect, it } from 'vitest';

import { publicResearchDescriptionText } from '../researchTextNormalization';

describe('publicResearchDescriptionText', () => {
  it('suppresses scraped sentence fragments that should not display as descriptions', () => {
    expect(
      publicResearchDescriptionText(
        'focuses in identifying ecological thresholds beyond which global changes cause abrupt ecosystem degradation.',
      ),
    ).toBe('');
    expect(
      publicResearchDescriptionText(
        'of post-colonialism, South Asian cultural studies, mobility and modernity.',
      ),
    ).toBe('');
    expect(
      publicResearchDescriptionText(
        'is in experimental particle physics: The energy frontier at the Large Hadron Collider.',
      ),
    ).toBe('');
  });

  it('suppresses incomplete source snippets that end mid-name or mid-title', () => {
    expect(
      publicResearchDescriptionText(
        'A Comment on descriptive statistics by Isaiah Andrews, Matthew Gentzkow, and Jesse M.',
      ),
    ).toBe('');
    expect(
      publicResearchDescriptionText(
        'Two primary projects use MRI images in collaboration with Dr.',
      ),
    ).toBe('');
  });

  it('suppresses copied profile contact chrome', () => {
    expect(
      publicResearchDescriptionText(
        'eduHQ 323203-432-4669 Zareena Grewal is a historical anthropologist.',
      ),
    ).toBe('');
  });

  it('keeps complete research descriptions with abbreviations', () => {
    expect(
      publicResearchDescriptionText(
        'Dr. Jones studies U.S. health policy and vaccination programs.',
      ),
    ).toBe('Dr. Jones studies U.S. health policy and vaccination programs.');
  });
});
