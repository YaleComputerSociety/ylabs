import { describe, expect, it } from 'vitest';
import {
  isOfficialResearchHomeCandidate,
  isGraduatedGrantShellCandidate,
  hasIneligibleLeadMembership,
  resolveCanonicalResearchHome,
  selectCanonicalResearchHomeSlug,
} from '../canonicalResearchHomeResolver';

describe('canonicalResearchHomeResolver', () => {
  it('rejects archived and non-current lead memberships', () => {
    expect(hasIneligibleLeadMembership([{ archived: true, isCurrentMember: true }])).toBe(true);
    expect(hasIneligibleLeadMembership([{ archived: false, isCurrentMember: false }])).toBe(true);
    expect(hasIneligibleLeadMembership([{ archived: false, isCurrentMember: true }])).toBe(false);
  });

  it('selects one official non-grant research home', () => {
    expect(
      selectCanonicalResearchHomeSlug([
        { slug: 'nih-pi-ada-lovelace', sourceUrls: ['https://reporter.nih.gov/project/1'] },
        { slug: 'dept-cs-ada-lovelace', websiteUrl: 'https://cs.yale.edu/ada-lab' },
      ]),
    ).toBe('dept-cs-ada-lovelace');
  });

  it('fails closed when multiple official research homes exist', () => {
    expect(
      selectCanonicalResearchHomeSlug([
        { slug: 'ada-lab', websiteUrl: 'https://ada.yale.edu/' },
        { slug: 'analytical-engine', websiteUrl: 'https://engine.yale.edu/' },
      ]),
    ).toBeNull();
  });

  it('rejects archived, grant-only, and synthetic shell candidates', () => {
    expect(
      isOfficialResearchHomeCandidate({ slug: 'nih-pi-ada', websiteUrl: 'https://ada.yale.edu/' }),
    ).toBe(false);
    expect(
      isOfficialResearchHomeCandidate({
        slug: 'ada-lab',
        archived: true,
        websiteUrl: 'https://ada.yale.edu/',
      }),
    ).toBe(false);
    expect(
      isOfficialResearchHomeCandidate({
        slug: 'ada-lab',
        sourceUrls: ['https://reporter.nih.gov/project/1'],
      }),
    ).toBe(false);
  });

  it('distinguishes safe shell creation from ineligible and ambiguous homes', () => {
    expect(resolveCanonicalResearchHome([])).toEqual({ status: 'safe-shell' });
    expect(resolveCanonicalResearchHome([{ slug: 'nih-pi-ada' }])).toEqual({
      status: 'ineligible',
    });
    expect(
      resolveCanonicalResearchHome([
        { slug: 'ada-lab', websiteUrl: 'https://ada.yale.edu/' },
        { slug: 'engine-lab', websiteUrl: 'https://engine.yale.edu/' },
      ]),
    ).toEqual({ status: 'ambiguous' });
  });

  it('recognizes a graduated grant shell carrying a real official website', () => {
    expect(
      isGraduatedGrantShellCandidate({
        slug: 'nih-pi-ada-lovelace',
        websiteUrl: 'https://medicine.yale.edu/profile/ada-lovelace',
      }),
    ).toBe(true);
    expect(
      isGraduatedGrantShellCandidate({
        slug: 'nih-pi-ada-lovelace',
        archived: true,
        websiteUrl: 'https://medicine.yale.edu/profile/ada-lovelace',
      }),
    ).toBe(false);
    expect(
      isGraduatedGrantShellCandidate({
        slug: 'nih-pi-ada-lovelace',
        sourceUrls: ['https://reporter.nih.gov/project/1'],
      }),
    ).toBe(false);
    expect(
      isGraduatedGrantShellCandidate({ slug: 'ada-lab', websiteUrl: 'https://ada.yale.edu/' }),
    ).toBe(false);
  });

  it('promotes a lone graduated grant shell to canonical when no non-grant home exists', () => {
    const graduated = { slug: 'nih-pi-ada-lovelace', websiteUrl: 'https://ysph.yale.edu/profile' };
    expect(resolveCanonicalResearchHome([graduated])).toEqual({
      status: 'canonical',
      slug: 'nih-pi-ada-lovelace',
    });
    expect(selectCanonicalResearchHomeSlug([graduated])).toBe('nih-pi-ada-lovelace');
  });

  it('prefers a non-grant official home over a graduated grant shell', () => {
    const candidates = [
      { slug: 'nih-pi-ada-lovelace', websiteUrl: 'https://medicine.yale.edu/profile/ada' },
      { slug: 'dept-cs-ada-lovelace', websiteUrl: 'https://cs.yale.edu/ada-lab' },
    ];
    expect(resolveCanonicalResearchHome(candidates)).toEqual({
      status: 'canonical',
      slug: 'dept-cs-ada-lovelace',
    });
    expect(selectCanonicalResearchHomeSlug(candidates)).toBe('dept-cs-ada-lovelace');
  });

  it('fails closed when multiple graduated grant shells compete', () => {
    const candidates = [
      { slug: 'nih-pi-ada-lovelace', websiteUrl: 'https://medicine.yale.edu/profile/ada' },
      { slug: 'nsf-pi-ada-lovelace', websiteUrl: 'https://ysph.yale.edu/profile/ada' },
    ];
    expect(resolveCanonicalResearchHome(candidates)).toEqual({ status: 'ambiguous' });
    expect(selectCanonicalResearchHomeSlug(candidates)).toBeNull();
  });
});
