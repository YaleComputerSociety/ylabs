import { describe, expect, it } from 'vitest';

import {
  filterProseResearchAreaChips,
  isProseResearchAreaChip,
  sanitizeProfileResearchTerms,
} from '../profileResearchTerms';

describe('sanitizeProfileResearchTerms', () => {
  it('drops prose fragments from scraped profile research fields', () => {
    expect(
      sanitizeProfileResearchTerms([
        'Condensed Matter PhysicsTheoristWe study the physics of condensed matter systems',
        'usually the solid state',
        'using first principles or ab initio methods. We solve the quantum mechanical many-body problem of interacting electrons and ions to the best of our abilities',
        'with the fewest approximations possible',
        'and with no adjustable parameters or fitting',
        'clarify',
        'and even predict observed physical phenomena.',
        'Research Areas: Condensed Matter Physics',
        'Condensed Matter Physics',
      ]),
    ).toEqual(['Condensed Matter Physics']);
  });
});

describe('filterProseResearchAreaChips', () => {
  it('drops prose-sentence and heading fragments while keeping clean tags (#816)', () => {
    expect(
      filterProseResearchAreaChips([
        'Machine Learning',
        'Graph Learning',
        'which shape the behavior of interacting agents over time',
        'We develop geometric deep learning methods for structured data.',
        'research areas:',
        'Geometric Learning',
      ]),
    ).toEqual(['Machine Learning', 'Graph Learning', 'Geometric Learning']);
  });

  it('classifies prose fragments and clean multi-word tags correctly', () => {
    expect(
      isProseResearchAreaChip('and cultural otherness in contemporary Buddhist thought.'),
    ).toBe(true);
    expect(isProseResearchAreaChip('research interests')).toBe(true);
    expect(isProseResearchAreaChip('Scientific Data Visualization')).toBe(false);
    expect(isProseResearchAreaChip('Human-Robot Interaction')).toBe(false);
  });
});
