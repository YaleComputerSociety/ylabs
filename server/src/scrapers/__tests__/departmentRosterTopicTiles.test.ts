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

const tile = (keyword: string, researchers: string, publications: string): string => `
  <li><article class="profile-details-interest" aria-label="Research Interest ${keyword}">
    <div class="profile-details-glance-figure"></div>
    <h5 class="profile-details-interest__keyword">${keyword}</h5>
    <div class="profile-details-interest__researcher-link-wrapper">
      <a href="/research-profiles/?meshId=1"><span class="link__label">${researchers}</span></a>
    </div>
    <div class="profile-details-interest__publication-link-wrapper">
      <a class="hyperlink profile-details-interest__publication-link" href="/publications/">${publications}</a>
    </div>
  </article></li>`;

const profilePage = (url: string, section: string): string => `
  <html><head><link rel="canonical" href="${url}"></head><body>
    <main id="page-container">
      <article class="profile-details" aria-label="Ada Fixture's profile">
        <h1 class="person-title">Ada Fixture</h1>
        <div class="professional-title">Associate Professor of Fixture Studies</div>
        ${section}
      </article>
    </main>
  </body></html>`;

const glance = (tiles: string): string => `
  <section class="profile-details-interests-glance">
    <div class="profile-details-interests-glance__content"><ul>${tiles}</ul></div>
  </section>`;

const topicsOf = (url: string, section: string): string[] =>
  profileEnrichmentFromHtml(profilePage(url, section), url).topics ?? [];

const carriesTileChrome = (topic: string): boolean =>
  /Researchers?\b|Related Publication/i.test(topic);

describe('YSM and YSPH topic tiles (#6438)', () => {
  it.each(PROFILE_URLS)(
    'reads each tile topic from its keyword, with no tile chrome (%s)',
    (url) => {
      const topics = topicsOf(
        url,
        glance(
          tile(
            'Proteasome Endopeptidase Complex',
            '2 YSM Researchers',
            'View 19 Related Publications',
          ) +
            tile('Ubiquitin', 'YSM Researcher', 'View 3 Related Publications') +
            tile('Scrub Typhus', 'YSPH Researcher', 'View Related Publication'),
        ),
      );
      expect(topics).toEqual(
        expect.arrayContaining(['Proteasome Endopeptidase Complex', 'Ubiquitin', 'Scrub Typhus']),
      );
      expect(topics.some(carriesTileChrome)).toBe(false);
    },
  );

  it.each(PROFILE_URLS)('keeps a topic whose own name ends in digits (%s)', (url) => {
    const topics = topicsOf(
      url,
      glance(
        tile('COVID-19', '15 YSM Researchers', 'View 3 Related Publications') +
          tile('BRCA1 Protein', 'YCC Researcher', 'View 2 Related Publications'),
      ),
    );
    expect(topics).toEqual(expect.arrayContaining(['COVID-19', 'BRCA1 Protein']));
    expect(topics.some(carriesTileChrome)).toBe(false);
  });

  it('refuses glued tile text whole rather than storing a truncated topic', () => {
    const topics = topicsOf(
      PROFILE_URLS[1],
      '<div class="research-interests">COVID-1915 YSM ResearchersView 3 Related Publications</div>',
    );
    expect(topics.some(carriesTileChrome)).toBe(false);
    expect(topics.some((topic) => /-$/.test(topic))).toBe(false);
  });

  it('keeps a plain research-interests topic with no tile chrome', () => {
    expect(
      topicsOf(
        PROFILE_URLS[1],
        '<div class="research-interests">Magnetic Resonance Spectroscopy</div>',
      ),
    ).toEqual(['Magnetic Resonance Spectroscopy']);
  });

  it('keeps a topic that names researchers in its own words', () => {
    expect(
      topicsOf(
        PROFILE_URLS[0],
        '<div class="research-interests">Training of early-career researchers</div>',
      ),
    ).toEqual(['Training of early-career researchers']);
  });
});
