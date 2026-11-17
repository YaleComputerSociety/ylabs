import { describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/ssrfGuard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/ssrfGuard')>()),
  assertPublicHttpUrl: vi.fn(async (rawUrl: string) => new URL(rawUrl)),
}));

import { profileEnrichmentFromHtml } from '../sources/departmentRosterScraper';

const PROFILE_URLS = [
  'https://ysph.yale.edu/profile/ada-fixture/',
  'https://medicine.yale.edu/profile/ada-fixture/',
];

const profilePage = (url: string, interests: string): string => `
  <html><head><link rel="canonical" href="${url}"></head><body>
    <main id="page-container">
      <article class="profile-details" aria-label="Ada Fixture's profile">
        <h1 class="person-title">Ada Fixture</h1>
        <div class="professional-title">Associate Professor of Fixture Studies</div>
        <div class="research-interests">${interests}</div>
      </article>
    </main>
  </body></html>`;

const topicsOf = (url: string, interests: string): string[] =>
  profileEnrichmentFromHtml(profilePage(url, interests), url).topics ?? [];

describe('YSM and YSPH topic tiles (#6438)', () => {
  it.each(PROFILE_URLS)(
    'splits glued tiles into their topics and drops the tile chrome (%s)',
    (url) => {
      const topics = topicsOf(
        url,
        'Proteasome Endopeptidase Complex2 YSM ResearchersView 19 Related PublicationsUbiquitinYSM ResearcherView 3 Related PublicationsScrub TyphusYSPH ResearcherView Related Publication',
      );
      expect(topics).toEqual(
        expect.arrayContaining(['Proteasome Endopeptidase Complex', 'Ubiquitin', 'Scrub Typhus']),
      );
      expect(topics.some((topic) => /Researcher|Related Publication/i.test(topic))).toBe(false);
    },
  );

  it.each(PROFILE_URLS)('keeps the topic of a single tile and drops its chrome (%s)', (url) => {
    expect(
      topicsOf(url, 'Magnetic Resonance SpectroscopyYSPH ResearcherView 2 Related Publications'),
    ).toEqual(['Magnetic Resonance Spectroscopy']);
  });

  it('keeps a plain topic with no tile chrome', () => {
    expect(topicsOf(PROFILE_URLS[1], 'Magnetic Resonance Spectroscopy')).toEqual([
      'Magnetic Resonance Spectroscopy',
    ]);
  });

  it('keeps a topic that names researchers in its own words', () => {
    expect(topicsOf(PROFILE_URLS[0], 'Training of early-career researchers')).toEqual([
      'Training of early-career researchers',
    ]);
  });
});
