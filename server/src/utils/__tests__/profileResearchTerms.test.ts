import { describe, expect, it } from 'vitest';

import { sanitizeProfileResearchTerms } from '../profileResearchTerms';

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
