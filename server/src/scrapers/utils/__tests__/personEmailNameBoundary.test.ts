import { describe, expect, it } from 'vitest';
import { isLikelyPersonSpecificYaleEmail } from '../scraperHelpers';

const NAME = 'Robin Fixture';

describe('a person email whose local part is the whole name (#5730)', () => {
  it.each([
    'biologyrobin.fixture@yale.edu',
    'biologyrobinfixture@yale.edu',
    'chemfixturerobin@yale.edu',
  ])('refuses %s, a word fused before the name', (email) => {
    expect(isLikelyPersonSpecificYaleEmail(email, NAME)).toBe(false);
  });

  it.each([
    'robin.fixture@yale.edu',
    'robinfixture@yale.edu',
    'fixture.robin@yale.edu',
    'robin.fixture2@yale.edu',
    'robinfixture17@yale.edu',
    'robin.fixturejr@yale.edu',
    'robin.fixture.iii@yale.edu',
  ])('keeps %s', (email) => {
    expect(isLikelyPersonSpecificYaleEmail(email, NAME)).toBe(true);
  });

  it('keeps a compound surname whose particle precedes the stored last name', () => {
    expect(isLikelyPersonSpecificYaleEmail('robin.delafixture@yale.edu', NAME)).toBe(true);
  });

  it('keeps a second surname after the stored last name', () => {
    expect(isLikelyPersonSpecificYaleEmail('robin.fixtureexample@yale.edu', NAME)).toBe(true);
  });
});
