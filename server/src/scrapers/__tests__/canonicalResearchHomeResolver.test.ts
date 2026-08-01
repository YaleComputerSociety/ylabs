import { describe, expect, it } from 'vitest';
import {
  isOfficialResearchHomeCandidate,
  selectCanonicalResearchHomeSlug,
} from '../canonicalResearchHomeResolver';

describe('canonicalResearchHomeResolver', () => {
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
    expect(isOfficialResearchHomeCandidate({ slug: 'nih-pi-ada', websiteUrl: 'https://ada.yale.edu/' })).toBe(false);
    expect(isOfficialResearchHomeCandidate({ slug: 'ada-lab', archived: true, websiteUrl: 'https://ada.yale.edu/' })).toBe(false);
    expect(isOfficialResearchHomeCandidate({ slug: 'ada-lab', sourceUrls: ['https://reporter.nih.gov/project/1'] })).toBe(false);
  });
});
