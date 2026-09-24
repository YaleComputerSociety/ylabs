/**
 * A Yale profile page's "News & Links" region and its Locations card contribute no
 * harvested data (#3184).
 *
 * The HTML below is synthetic but structurally faithful to the School of Medicine
 * template that serves `/profile/<slug>/` and `/cancer/profile/<slug>/`: the region ids,
 * the item classes, and the `aria-label` wording are what the live pages emit, because
 * those are exactly what the guard reads.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/ssrfGuard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/ssrfGuard')>()),
  assertPublicHttpUrl: vi.fn(async (rawUrl: string) => new URL(rawUrl)),
}));

import {
  DepartmentRosterScraper,
  type DeptConfig,
  type FacultyEntry,
} from '../sources/departmentRosterScraper';
import { collectVisibleDescriptionCandidates } from '../../utils/officialResearchDescription';
import type { ScraperContext, ObservationInput } from '../types';

const PROFILE_URL = 'https://medicine.yale.edu/cancer/profile/avery-fixture/';

const profilePage = (body: string): string => `
  <html><body>
    <main>
      <h1 class="person-title">Avery Fixture</h1>
      <div class="professional-title">Associate Professor of Surgery (Oncology)</div>
    </main>
    ${body}
  </body></html>`;

const NEWS_AND_LINKS_REGION = `
  <section id="links-details-section" aria-label="News &amp; Links">
    <header class="profile-details-section-header">
      <h2 class="profile-details-section-header__heading" id="news-and-links">News &amp; Links</h2>
    </header>
    <section class="profile-details-content-section" id="links-media">
      <h3 class="profile-details-content-section__heading">Media</h3>
      <ul>
        <li>
          <article class="digital-asset-media-list-item digital-asset-media-list-item--right"
                   aria-label="Cellular Repair - The Fixture Lab at Yale School of Medicine">
            <h4>
              <a href="/media-player/fixture-lab-yale-school-of-medicine/"
                 class="digital-asset-media-list-item__title-link"
                 aria-label="Watch the Cellular Repair - The Fixture Lab at Yale School of Medicine video"
                 tabindex="-1">Cellular Repair - The Fixture Lab at Yale School of Medicine</a>
            </h4>
            <div class="digital-asset-media-list-item__description">
              <p>A video about the laboratory's research into cellular response to DNA damage,
              produced by the school's communications office for a general audience.</p>
            </div>
            <div class="digital-asset-media-list-item__button">
              <a href="/media-player/fixture-lab-yale-school-of-medicine/" tabindex="0"
                 aria-label="Watch the Cellular Repair - The Fixture Lab video">
                <span class="link__label">Watch the video</span>
              </a>
            </div>
          </article>
        </li>
      </ul>
    </section>
    <section class="profile-details-content-section" id="links-news">
      <h3 class="profile-details-content-section__heading">News</h3>
      <div class="profile-details-news-list">
        <div class="article-list">
          <ul class="article-list__post-container">
            <li class="article-list__post">
              <article class="article-post" aria-label="New funding supports the Fixture Lab">
                <a href="/news-article/new-funding-supports-the-fixture-lab/"
                   class="article-post-content-link"
                   aria-label="New funding supports the Fixture Lab" tabindex="-1">
                  New funding supports the Fixture Lab
                </a>
                <p>A new award will expand the laboratory's work on tumour metabolism over the
                next four years, the school announced this week in its own newsroom.</p>
              </article>
            </li>
          </ul>
        </div>
      </div>
    </section>
  </section>`;

const NEWS_SUBSECTION_ONLY = NEWS_AND_LINKS_REGION.slice(
  NEWS_AND_LINKS_REGION.indexOf('<section class="profile-details-content-section" id="links-news"'),
);

const LOCATIONS_CARD = `
  <section id="get-in-touch-details-section" aria-label="Get In Touch">
    <section class="profile-details-content-section" id="get-in-touch-locations">
      <h3 class="profile-details-content-section__heading">Locations</h3>
      <article class="card profile-details-location-card" aria-label="Location Card">
        <p class="profile-details-location-card__address">1 Example Street, Fl 6th</p>
        <div class="profile-details-location-card__link">
          <a href="https://www.google.com/maps?directionsMode=driving&amp;daddr=1.5,-2.5"
             tabindex="0" target="_blank" aria-label="Get Fixture Lab directions">
            <span class="link__label">Get Directions</span>
          </a>
        </div>
      </article>
    </section>
  </section>`;

const GENUINE_LAB_LINK = `
  <main>
    <p>Visit the <a href="https://fixturelab.example.org/">Fixture Lab website</a>.</p>
  </main>`;

function makeContext() {
  const emitted: ObservationInput[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'test-run',
    sourceId: 'test-source',
    sourceName: 'dept-faculty-roster',
    sourceWeight: 0.7,
    options: { dryRun: true, useCache: false, release: false },
    emit: async (obs) => {
      if (Array.isArray(obs)) emitted.push(...obs);
      else emitted.push(obs);
    },
    log: () => {},
  };
  return { ctx, emitted };
}

const rosterConfig = (): DeptConfig[] => [
  {
    deptKey: 'surgery',
    deptName: 'Surgery',
    schoolName: 'Yale School of Medicine',
    url: 'https://medicine.yale.edu/surgery/faculty/',
    paginated: false,
    extractor: vi.fn((): FacultyEntry[] => [{ name: 'Avery Fixture', profileUrl: PROFILE_URL }]),
  },
];

const harvest = async (profileBody: string) => {
  const html = profilePage(profileBody);
  const scraper = new DepartmentRosterScraper(rosterConfig(), null, async (url: string) =>
    url === PROFILE_URL ? html : '<html><body></body></html>',
  );
  const { ctx, emitted } = makeContext();
  await scraper.run(ctx);
  return emitted;
};

const websiteValues = (emitted: ObservationInput[]): string[] =>
  emitted
    .filter((o) => o.field === 'website' || o.field === 'websiteUrl')
    .map((o) => String(o.value ?? ''));

describe("a profile page's News & Links region is never harvested (#3184)", () => {
  it('does not lift a media-player page from the region into a website', async () => {
    const emitted = await harvest(NEWS_AND_LINKS_REGION);

    expect(websiteValues(emitted)).toEqual([]);
    expect(emitted.some((o) => JSON.stringify(o.value ?? '').includes('media-player'))).toBe(false);
  });

  // Scoped to the news subsection alone. Against the whole region the media item wins
  // the slot first, so the assertion would hold with no guard at all.
  it('does not lift a news article from the region into a website', async () => {
    const emitted = await harvest(NEWS_SUBSECTION_ONLY);

    expect(websiteValues(emitted)).toEqual([]);
    expect(emitted.some((o) => JSON.stringify(o.value ?? '').includes('news-article'))).toBe(false);
  });

  // Pins the region guard on its own: this destination passes every URL-shape check, so
  // only its placement inside the news region can refuse it.
  it('refuses a news item link whose destination looks like a genuine lab site', async () => {
    const emitted = await harvest(`
      <section id="links-details-section" aria-label="News &amp; Links">
        <section class="profile-details-content-section" id="links-news">
          <h3 class="profile-details-content-section__heading">News</h3>
          <div class="profile-details-news-list">
            <article class="article-post">
              <a href="https://someotherlab.example.org/" tabindex="0"
                 aria-label="Read more about the laboratory">Lab website</a>
            </article>
          </div>
        </section>
      </section>`);

    expect(websiteValues(emitted)).toEqual([]);
  });

  it("does not let a news item's own prose become a served description", () => {
    const candidates = collectVisibleDescriptionCandidates(profilePage(NEWS_AND_LINKS_REGION));

    expect(candidates.some((candidate) => /tumour metabolism/i.test(candidate))).toBe(false);
    expect(candidates.some((candidate) => /communications office/i.test(candidate))).toBe(false);
  });

  it('still lifts a genuine lab link that is real page content', async () => {
    const emitted = await harvest(`${NEWS_AND_LINKS_REGION}${GENUINE_LAB_LINK}`);

    expect(websiteValues(emitted)).toContain('https://fixturelab.example.org/');
  });
});

describe("a profile page's directions link is never a website (#3184)", () => {
  // The aria-label spells the lab's own name, so the website signal fires and only the
  // destination's own shape can refuse it.
  it('does not lift a driving-directions link into a website', async () => {
    const emitted = await harvest(LOCATIONS_CARD);

    expect(websiteValues(emitted)).toEqual([]);
    expect(emitted.some((o) => JSON.stringify(o.value ?? '').includes('google.com/maps'))).toBe(
      false,
    );
  });

  it('prefers the genuine lab link over a directions link on the same page', async () => {
    const emitted = await harvest(`${LOCATIONS_CARD}${GENUINE_LAB_LINK}`);

    expect(websiteValues(emitted)).toContain('https://fixturelab.example.org/');
  });
});
