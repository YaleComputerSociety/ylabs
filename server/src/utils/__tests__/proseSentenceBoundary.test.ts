import { describe, expect, it } from 'vitest';

import {
  hasLostProseSentenceBoundarySpace,
  restoreLostProseSentenceBoundarySpaces,
  withProseSentenceBoundariesRestored,
} from '../proseSentenceBoundary';

describe('restoreLostProseSentenceBoundarySpaces', () => {
  it('separates two sentences a block-boundary harvest welded into one word', () => {
    expect(
      restoreLostProseSentenceBoundarySpaces(
        'These account for 10% of all cancers in adults.To prevent the production of harmful autoantibodies, the lab studies tolerance.',
      ),
    ).toBe(
      'These account for 10% of all cancers in adults. To prevent the production of harmful autoantibodies, the lab studies tolerance.',
    );
  });

  it('separates a lost space after a title abbreviation, which is the same lost separator', () => {
    expect(
      restoreLostProseSentenceBoundarySpaces('Working with Dr.Gonzalez on wound healing.'),
    ).toBe('Working with Dr. Gonzalez on wound healing.');
  });

  it('leaves a URL, an email and a bare domain whole', () => {
    for (const value of [
      'Details at https://medicine.Yale.edu/lab/example for prospective students.',
      'Write to Example.Person@yale.edu for details.',
      'The group site is gonzalezlab.Yale.edu and lists openings.',
    ]) {
      expect(restoreLostProseSentenceBoundarySpaces(value)).toBe(value);
    }
  });

  it('leaves an initial or a short abbreviation alone, where the missing space is ambiguous', () => {
    for (const value of ['Studies E.Coli metabolism.', 'A U.S.Government grant funds the work.']) {
      expect(restoreLostProseSentenceBoundarySpaces(value)).toBe(value);
    }
  });

  it('is idempotent and leaves already-separated prose untouched', () => {
    const clean = 'Studies tolerance. The lab uses mouse models.';
    expect(restoreLostProseSentenceBoundarySpaces(clean)).toBe(clean);
    expect(hasLostProseSentenceBoundarySpace(clean)).toBe(false);
    const once = restoreLostProseSentenceBoundarySpaces('Studies tolerance.The lab uses models.');
    expect(restoreLostProseSentenceBoundarySpaces(once)).toBe(once);
  });
});

describe('withProseSentenceBoundariesRestored', () => {
  it('restores prose leaves and leaves a URL field alone even when it matches the shape', () => {
    expect(
      withProseSentenceBoundariesRestored(
        'fullDescription',
        'Studies tolerance.The lab uses mice.',
      ),
    ).toBe('Studies tolerance. The lab uses mice.');
    expect(withProseSentenceBoundariesRestored('imageUrl', 'assets.Yale.edu/x.jpg')).toBe(
      'assets.Yale.edu/x.jpg',
    );
    expect(withProseSentenceBoundariesRestored('websiteUrl', 'medicine.Yale.edu/lab/example')).toBe(
      'medicine.Yale.edu/lab/example',
    );
  });

  it('reaches a grant abstract nested in recentGrants without touching the grant title', () => {
    expect(
      withProseSentenceBoundariesRestored('recentGrants', [
        { title: 'Mechanisms.Of transport', abstract: 'Studies transport.The award funds mice.' },
      ]),
    ).toEqual([
      { title: 'Mechanisms.Of transport', abstract: 'Studies transport. The award funds mice.' },
    ]);
  });

  it('preserves key order, which the projection diff-skip compares by JSON.stringify', () => {
    const value = { abstract: 'A.Bcd', title: 'T', url: 'https://example.com' };
    expect(
      Object.keys(withProseSentenceBoundariesRestored('recentGrants', value) as object),
    ).toEqual(['abstract', 'title', 'url']);
  });

  it('returns a Date untouched rather than rebuilding it from its entries', () => {
    const date = new Date('2026-09-23T00:00:00.000Z');
    expect(withProseSentenceBoundariesRestored('lastObservedAt', date)).toBe(date);
  });
});
