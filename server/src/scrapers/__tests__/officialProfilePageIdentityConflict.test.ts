import { describe, expect, it } from 'vitest';
import { personPagesNameDifferentPeople } from '../utils/officialProfilePageIdentityConflict';

const ysm = (path: string) => `https://medicine.yale.edu${path}`;

describe('personPagesNameDifferentPeople (#5324)', () => {
  it('reads two same-site pages with one surname and unrelated given names as two people', () => {
    expect(
      personPagesNameDifferentPeople(
        [ysm('/psychiatry/profile/lo-quennard/')],
        [ysm('/profile/lorvan-tei-quennard/')],
      ),
    ).toBe(true);
    expect(
      personPagesNameDifferentPeople(
        ['https://ysph.yale.edu/profile/mi-quennard/'],
        ['https://ysph.yale.edu/profile/mivaro-quennard/'],
      ),
    ).toBe(true);
  });

  it('reads a section page and the root page of one slug as one person', () => {
    expect(
      personPagesNameDifferentPeople(
        [ysm('/psychiatry/profile/mara-quennard/')],
        [ysm('/Profile/Mara-Quennard')],
      ),
    ).toBe(false);
  });

  it('keeps a middle initial, a short form or a concatenated spelling as one person', () => {
    for (const [observed, stored] of [
      ['/profile/mara-j-quennard/', '/profile/mara-quennard/'],
      ['/profile/robert-quennard/', '/profile/bob-quennard/'],
      ['/profile/weilan-quennard/', '/profile/wei-lan-quennard/'],
    ]) {
      expect(personPagesNameDifferentPeople([ysm(observed)], [ysm(stored)])).toBe(false);
    }
  });

  it('does not decide on a page whose slug names nobody it can read', () => {
    for (const [observed, stored] of [
      ['/profile/lq42/', '/profile/lorvan-quennard/'],
      ['/profile/l-quennard/', '/profile/lorvan-quennard/'],
      ['/profile/lo-quennard-lq42/', '/profile/lorvan-quennard/'],
    ]) {
      expect(personPagesNameDifferentPeople([ysm(observed)], [ysm(stored)])).toBe(false);
    }
  });

  it('does not compare pages on different sites, or with different surnames', () => {
    expect(
      personPagesNameDifferentPeople(
        ['https://ysph.yale.edu/profile/lo-quennard/'],
        [ysm('/profile/lorvan-quennard/')],
      ),
    ).toBe(false);
    expect(
      personPagesNameDifferentPeople(
        [ysm('/profile/min-quennard/')],
        [ysm('/profile/quennard-min/')],
      ),
    ).toBe(false);
  });

  it('only reads canonical CMS person pages', () => {
    expect(
      personPagesNameDifferentPeople(
        ['https://psychiatry.yale.edu/people/lo-quennard'],
        ['https://psychiatry.yale.edu/people/lorvan-quennard'],
      ),
    ).toBe(false);
    expect(personPagesNameDifferentPeople([ysm('/profile/lo-quennard/')], [])).toBe(false);
  });
});
