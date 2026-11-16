import { describe, expect, it } from 'vitest';
import { isYalePeoplePageForNetid } from '../yalePeoplePageNetid';

describe('isYalePeoplePageForNetid (#6316, #6389)', () => {
  it('matches a Yale profile or people page whose segment is exactly a lead netid, any case', () => {
    expect(isYalePeoplePageForNetid('https://medicine.yale.edu/profile/AQ123/', ['aq123'])).toBe(
      true,
    );
    expect(isYalePeoplePageForNetid('https://physics.yale.edu/people/aq123', ['AQ123'])).toBe(true);
  });

  it('refuses a prefix, a longer netid, a dotted local part and another parent path', () => {
    expect(isYalePeoplePageForNetid('https://medicine.yale.edu/profile/aq1234/', ['aq123'])).toBe(
      false,
    );
    expect(isYalePeoplePageForNetid('https://medicine.yale.edu/profile/aq12/', ['aq123'])).toBe(
      false,
    );
    expect(
      isYalePeoplePageForNetid('https://medicine.yale.edu/profile/avery.quill/', ['avery.quill']),
    ).toBe(false);
    expect(isYalePeoplePageForNetid('https://medicine.yale.edu/news/aq123/', ['aq123'])).toBe(
      false,
    );
  });

  it('refuses a page off Yale hosts and a row with no lead netid', () => {
    expect(isYalePeoplePageForNetid('https://example.org/profile/aq123/', ['aq123'])).toBe(false);
    expect(isYalePeoplePageForNetid('https://medicine.yale.edu/profile/aq123/', [])).toBe(false);
  });
});
