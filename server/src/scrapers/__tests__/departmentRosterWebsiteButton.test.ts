import { describe, expect, it, vi } from 'vitest';

vi.mock('../../utils/ssrfGuard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/ssrfGuard')>()),
  assertPublicHttpUrl: vi.fn(async (rawUrl: string) => new URL(rawUrl)),
}));

import {
  DepartmentRosterScraper,
  profileEnrichmentFromHtml,
  rosterResearchEntityMint,
  withoutSharedGroupWebsites,
  type DeptConfig,
  type FacultyEntry,
} from '../sources/departmentRosterScraper';
import type { ObservationInput, ScraperContext } from '../types';

const PROFILE_URL = 'https://publichealth.yale.edu/profile/ada-fixture/';

const profilePage = (body: string): string => `
  <html><head><link rel="canonical" href="${PROFILE_URL}"></head><body>
    <main id="page-container">
      <article class="profile-details" aria-label="Ada Fixture's profile">
        <h1 class="person-title">Ada Fixture</h1>
        <div class="professional-title">Associate Professor of Fixture Studies</div>
        <div class="profile-details__content">${body}</div>
      </article>
    </main>
  </body></html>`;

const enrich = (body: string) => profileEnrichmentFromHtml(profilePage(body), PROFILE_URL);

const button = (href: string, label: string): string =>
  `<a href="${href}" tabindex="0" class="link link--size--small"><span class="link__label">${label}</span><span class="link__icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M0 0"></path></svg></span></a>`;

const newsAndLinksSidebar = (link: string): string => `
  <section id="links-details-section" aria-label="News &amp; Links">
    <div class="profile-details-section-content">
      <div class="profile-details-section-content__sidebar">
        <ul class="content-layout-column-list"><li class="content-layout-column-list-item">
          <section class="profile-details-related-link-list" aria-label="List of related links">
            <h3 class="profile-details-related-link-list__heading">Related Links</h3>
            <ul class="profile-details-related-link-list__items">
              <li class="profile-details-related-link-list__item">${link}</li>
            </ul>
          </section>
        </li></ul>
      </div>
    </div>
  </section>`;

const linksSectionList = (link: string): string => `
  <section id="links-details-section" aria-label="Links">
    <div class="profile-details-section-content"><div class="profile-details-section-content__main">
      <section id="links-related-links" class="profile-details-content-section" aria-label="Related Links">
        <div class="profile-details-content-section__content">
          <section class="link-list"><ul class="link-items-list">
            <li class="link-items-list__item"><div class="link-list__link-container">
              <div class="link-with-description">${link}</div>
            </div></li>
          </ul></section>
        </div>
      </section>
    </div></div>
  </section>`;

const researchLabCard = (link: string): string => `
  <section id="research-details-section" aria-label="Research">
    <div class="profile-details-section-content__sidebar">
      <article class="profile-details-lab" aria-label="Lab Website">
        <div class="profile-details-lab__header"><h3 class="profile-details-lab__title">Coastal Dynamics Lab</h3></div>
        ${link}
      </article>
    </div>
  </section>`;

const headerLabCard = (link: string): string => `
  <div class="profile-details-header-static-card-list">
    <article class="card" aria-label="Fixture and Partner Labs">
      <div class="profile-details-header-card__content">
        <div class="profile-details-lab-header-card">${link}</div>
      </div>
    </article>
  </div>`;

const newsList = (link: string): string => `
  <section id="links-details-section" aria-label="News &amp; Links">
    <section class="profile-details-content-section" id="links-news">
      <div class="profile-details-news-list"><article class="article-post">${link}</article></div>
    </section>
  </section>`;

const PERSONAL_SITE = 'https://www.adafixture.example.com/';
const LAB_SITE = 'https://www.fixturedynamicslab.example.org/';

describe('a website button the profile exposes is a candidate', () => {
  it.each([
    ['a personal page button in the news-and-links sidebar', newsAndLinksSidebar, 'Personal Page'],
    ['a personal website button in the links section list', linksSectionList, 'Personal Website'],
    [
      'a lower-case personal website button in the sidebar',
      newsAndLinksSidebar,
      'Personal website',
    ],
  ])('adopts %s', (_label, wrap, label) => {
    const result = enrich(wrap(button(PERSONAL_SITE, label)));

    expect(result.labUrl).toBe(PERSONAL_SITE);
    expect(result.labSlotAttestation).toBeUndefined();
  });

  it.each([['View Lab Website'], ['Visit Lab Website']])(
    'adopts a lab card button labelled %s',
    (label) => {
      const result = enrich(researchLabCard(button(LAB_SITE, label)));

      expect(result.labUrl).toBe(LAB_SITE);
    },
  );

  it('reads a header lab card button with the lab the card names', () => {
    const result = enrich(headerLabCard(button(LAB_SITE, 'Visit Lab Website')));

    expect(result.labUrl).toBe(LAB_SITE);
    expect(result.labWebsiteButton).toEqual({ cardTitle: 'Fixture and Partner Labs' });
  });

  it('still ignores a news item in the same region, whatever its label says', () => {
    const result = enrich(newsList(button(LAB_SITE, 'Lab website')));

    expect(result.labUrl).toBeUndefined();
  });

  it('still ignores a related link that is not labelled as a website', () => {
    const result = enrich(newsAndLinksSidebar(button(PERSONAL_SITE, 'Fixture Lab news')));

    expect(result.labUrl).toBeUndefined();
    expect(result.labSlotAttestation).toBe('refused');
  });

  it('leaves the slot claimable as empty when a related link carries no website signal', () => {
    const result = enrich(
      newsAndLinksSidebar(button('https://scholar.example.org/citations', 'Publications')),
    );

    expect(result.labUrl).toBeUndefined();
    expect(result.labSlotAttestation).toBe('empty');
  });

  it('reads no card title from the profile itself when the header card carries none', () => {
    const result = enrich(
      `<div class="profile-details-lab-header-card">${button(LAB_SITE, 'Visit Lab Website')}</div>`,
    );

    expect(result.labUrl).toBe(LAB_SITE);
    expect(result.labWebsiteButton).toEqual({ cardTitle: '' });
  });

  it('refuses a directions link even when the list labels it as a page', () => {
    const result = enrich(
      newsAndLinksSidebar(
        button('https://www.google.com/maps?directionsMode=driving&amp;daddr=1.5,-2.5', 'Lab page'),
      ),
    );

    expect(result.labUrl).toBeUndefined();
    expect(result.labSlotAttestation).toBe('refused');
  });
});

describe('an inline link whose path names a website but whose label names something else', () => {
  const ORG_HOMEPAGE = 'https://www.fixture-foundation.example.org/en/homepage/';
  const SERIES_HOMEPAGE =
    'https://oversea.fixture.example.net/index/marketing/FixtureEconomy/en/homepage.html';

  it('refuses an organisation named inline in a talks list', () => {
    const result = enrich(
      `<details class="expandable"><summary>Talks</summary><div class="wysiwyg">
         <p>Keynote, annual meeting of <a href="${ORG_HOMEPAGE}">FIXFOUND</a>, 2024.</p>
       </div></details>`,
    );

    expect(result.labUrl).toBeUndefined();
    expect(result.labSlotAttestation).toBe('refused');
  });

  it('refuses a lecture series linked from a biography sentence', () => {
    const result = enrich(
      `<section id="about-biography"><div class="profile-details-bio-content-section__bio">
         <p>Ada Fixture serves on the committee of <a href="${SERIES_HOMEPAGE}">the Global Lecture Series on Fixture Economy</a>.</p>
       </div></section>`,
    );

    expect(result.labUrl).toBeUndefined();
    expect(result.labSlotAttestation).toBe('refused');
  });
});

describe('a seen and refused link never yields an absence claim (#3135)', () => {
  const dept = {
    deptKey: 'fixture-health',
    deptName: 'Fixture Health',
    schoolName: 'Yale School of Fixtures',
    rosterUrl: 'https://publichealth.yale.edu/faculty/',
  } as never;

  const absenceClaimsFor = (body: string) => {
    const { labUrl, labSlotAttestation } = enrich(body);
    return rosterResearchEntityMint(
      {
        name: 'Ada Fixture',
        profileUrl: PROFILE_URL,
        researchHomeDescription:
          'The group studies how fixture exposures shape population health, using cohort data and field surveys across several states.',
        researchHomeShortDescription: 'Studies how fixture exposures shape population health.',
        topics: ['Fixture Epidemiology'],
        labUrl,
        labSlotAttestation,
      } as never,
      dept,
      'https://publichealth.yale.edu/faculty/',
      'dept-fixture-health-ada-fixture',
    )
      .observations.filter((observation) => observation.assertsNoValueFor)
      .map((observation) => observation.assertsNoValueFor);
  };

  it.each([
    [
      'an organisation named inline',
      '<p>Advises <a href="https://www.fixture-foundation.example.org/en/homepage/">FIXFOUND</a>.</p>',
    ],
    [
      'a national laboratory link',
      '<p>Runs at the <a href="https://www.fixture-national-lab.example.gov/">Fixture National Laboratory</a>.</p>',
    ],
    [
      'a directions link in the related links list',
      newsAndLinksSidebar(
        button('https://www.google.com/maps?directionsMode=driving&amp;daddr=1.5,-2.5', 'Lab page'),
      ),
    ],
  ])('asserts no absence for %s', (_label, body) => {
    expect(absenceClaimsFor(body)).toEqual([]);
  });

  it('asserts no absence when the only website is a personal page button', () => {
    expect(absenceClaimsFor(newsAndLinksSidebar(button(PERSONAL_SITE, 'Personal Page')))).toEqual(
      [],
    );
  });

  it('still asserts the absence for a page that offers no candidate at all', () => {
    expect(absenceClaimsFor('<p><a href="https://orcid.org/0000">ORCID</a></p>')).toEqual([
      ['websiteUrl'],
    ]);
  });
});

describe('reading the same roster twice', () => {
  const rosterConfig = (): DeptConfig[] => [
    {
      deptKey: 'fixture-health',
      deptName: 'Fixture Health',
      schoolName: 'Yale School of Fixtures',
      url: 'https://publichealth.yale.edu/faculty/',
      paginated: false,
      extractor: vi.fn((): FacultyEntry[] => [{ name: 'Ada Fixture', profileUrl: PROFILE_URL }]),
    },
  ];

  const harvest = async (profileBody: string): Promise<ObservationInput[]> => {
    const html = profilePage(profileBody);
    const scraper = new DepartmentRosterScraper(rosterConfig(), null, async (url: string) =>
      url === PROFILE_URL ? html : '<html><body></body></html>',
    );
    const emitted: ObservationInput[] = [];
    const ctx: ScraperContext = {
      scrapeRunId: 'test-run',
      sourceId: 'test-source',
      sourceName: 'dept-faculty-roster',
      sourceWeight: 0.7,
      options: { dryRun: true, useCache: false, release: false },
      emit: async (obs) => {
        emitted.push(...(Array.isArray(obs) ? obs : [obs]));
      },
      log: () => {},
    };
    await scraper.run(ctx);
    return emitted.filter((o) => o.entityType === 'researchEntity' || o.entityType === 'user');
  };

  it('re-derives the same website and the same absence claims', async () => {
    const body = newsAndLinksSidebar(button(PERSONAL_SITE, 'Personal Page'));
    const first = await harvest(body);
    const second = await harvest(body);

    expect(second).toEqual(first);
    expect(first.filter((o) => o.field === 'websiteUrl').map((o) => o.value)).toEqual([
      PERSONAL_SITE,
    ]);
    expect(first.some((o) => o.assertsNoValueFor)).toBe(false);
  });
});

describe('a lab site the roster lists for several people', () => {
  const SHARED_LAB = 'https://www.fixturesharedlab.example.org/';

  const profileOf = (personSlug: string, personName: string, title: string, body: string) => {
    const url = `https://publichealth.yale.edu/profile/${personSlug}/`;
    const html = `<html><head><link rel="canonical" href="${url}"></head><body><main>
        <article class="profile-details" aria-label="${personName}'s profile">
          <h1 class="person-title">${personName}</h1>
          <div class="professional-title">${title}</div>
          ${body}
        </article></main></body></html>`;
    return {
      personKey: `dept:fixture-health:${personSlug}`,
      entry: { ...profileEnrichmentFromHtml(html, url), name: personName, title } as FacultyEntry,
    };
  };

  const keptBy = (items: ReturnType<typeof profileOf>[]) =>
    withoutSharedGroupWebsites(items).map(({ personKey, entry }) => [
      personKey,
      entry.labUrl ?? entry.labSlotAttestation,
    ]);

  it('keeps it for the lead whose lab card names them, not for a member linking it inline', () => {
    expect(
      keptBy([
        profileOf(
          'ada-fixture',
          'Ada Fixture',
          'Associate Professor of Fixture Studies',
          researchLabCard(button(SHARED_LAB, 'View Lab Website')).replace(
            'Coastal Dynamics Lab',
            'Fixture Lab',
          ),
        ),
        profileOf(
          'bo-member',
          'Bo Member',
          'Postdoctoral Associate',
          `<ul><li><a href="${SHARED_LAB}">Fixture Lab</a></li></ul>`,
        ),
      ]),
    ).toEqual([
      ['dept:fixture-health:ada-fixture', SHARED_LAB],
      ['dept:fixture-health:bo-member', 'refused'],
    ]);
  });

  it('keeps it for a lead who also lists the lab as an appointment before the button', () => {
    expect(
      keptBy([
        profileOf(
          'ada-fixture',
          'Ada Fixture',
          'Professor of Fixture Studies',
          `<ul><li><a href="${SHARED_LAB}">Fixture Lab</a></li></ul>${researchLabCard(
            button(SHARED_LAB, 'View Lab Website'),
          ).replace('Coastal Dynamics Lab', 'Fixture Lab')}`,
        ),
        profileOf(
          'bo-member',
          'Bo Member',
          'Professor of Fixture Studies',
          `<ul><li><a href="${SHARED_LAB}">Fixture Lab</a></li></ul>`,
        ),
      ]),
    ).toEqual([
      ['dept:fixture-health:ada-fixture', SHARED_LAB],
      ['dept:fixture-health:bo-member', 'refused'],
    ]);
  });

  it('keeps it for the one faculty sharer when every other sharer owns no research row', () => {
    expect(
      keptBy([
        profileOf(
          'ada-fixture',
          'Ada Fixture',
          'Associate Professor of Fixture Studies',
          researchLabCard(button(SHARED_LAB, 'View Lab Website')),
        ),
        profileOf(
          'bo-member',
          'Bo Member',
          'Postdoctoral Associate',
          researchLabCard(button(SHARED_LAB, 'View Lab Website')),
        ),
      ]),
    ).toEqual([
      ['dept:fixture-health:ada-fixture', SHARED_LAB],
      ['dept:fixture-health:bo-member', 'refused'],
    ]);
  });

  it('keeps a joint lab for each lead its card names', () => {
    const jointCard = (label: string) =>
      researchLabCard(button(SHARED_LAB, label)).replace(
        'Coastal Dynamics Lab',
        'Fixture and Partner Labs',
      );
    expect(
      keptBy([
        profileOf(
          'ada-fixture',
          'Ada Fixture',
          'Professor of Fixture Studies',
          jointCard('View Lab Website'),
        ),
        profileOf(
          'cy-partner',
          'Cy Partner',
          'Professor of Fixture Studies',
          jointCard('Visit Lab Website'),
        ),
      ]),
    ).toEqual([
      ['dept:fixture-health:ada-fixture', SHARED_LAB],
      ['dept:fixture-health:cy-partner', SHARED_LAB],
    ]);
  });

  it('refuses a labelled group site whose card names none of its faculty sharers', () => {
    expect(
      keptBy([
        profileOf(
          'ada-fixture',
          'Ada Fixture',
          'Professor of Fixture Studies',
          researchLabCard(button(SHARED_LAB, 'View Lab Website')),
        ),
        profileOf(
          'cy-partner',
          'Cy Partner',
          'Professor of Fixture Studies',
          researchLabCard(button(SHARED_LAB, 'View Lab Website')),
        ),
      ]),
    ).toEqual([
      ['dept:fixture-health:ada-fixture', 'refused'],
      ['dept:fixture-health:cy-partner', 'refused'],
    ]);
  });

  it('refuses a shared link no profile labels as its website button', () => {
    const inline = `<p>Member of the <a href="${SHARED_LAB}">Fixture Lab</a>.</p>`;
    expect(
      keptBy([
        profileOf('ada-fixture', 'Ada Fixture', 'Professor of Fixture Studies', inline),
        profileOf('bo-member', 'Bo Member', 'Postdoctoral Associate', inline),
      ]),
    ).toEqual([
      ['dept:fixture-health:ada-fixture', 'refused'],
      ['dept:fixture-health:bo-member', 'refused'],
    ]);
  });
});

describe('a lab site the roster card and the profile button both carry', () => {
  const SHARED_LAB = 'https://www.fixturesharedlab.example.org/';
  const LEAD_URL = 'https://publichealth.yale.edu/profile/ada-fixture/';
  const MEMBER_URL = 'https://publichealth.yale.edu/profile/bo-member/';

  const pageFor = (url: string, personName: string, title: string, body: string): string =>
    `<html><head><link rel="canonical" href="${url}"></head><body><main>
      <article class="profile-details" aria-label="${personName}'s profile">
        <h1 class="person-title">${personName}</h1>
        <div class="professional-title">${title}</div>
        ${body}
      </article></main></body></html>`;

  const pages: Record<string, string> = {
    [LEAD_URL]: pageFor(
      LEAD_URL,
      'Ada Fixture',
      'Associate Professor of Fixture Studies',
      researchLabCard(button(SHARED_LAB, 'View Lab Website')).replace(
        'Coastal Dynamics Lab',
        'Fixture Lab',
      ),
    ),
    [MEMBER_URL]: pageFor(
      MEMBER_URL,
      'Bo Member',
      'Postdoctoral Associate',
      `<ul><li><a href="${SHARED_LAB}">Fixture Lab</a></li></ul>`,
    ),
  };

  it('keeps it for the lead whose profile button claims it', async () => {
    const scraper = new DepartmentRosterScraper(
      [
        {
          deptKey: 'fixture-health',
          deptName: 'Fixture Health',
          schoolName: 'Yale School of Fixtures',
          url: 'https://publichealth.yale.edu/faculty/',
          paginated: false,
          extractor: vi.fn((): FacultyEntry[] => [
            { name: 'Ada Fixture', profileUrl: LEAD_URL, labUrl: SHARED_LAB },
            { name: 'Bo Member', profileUrl: MEMBER_URL, labUrl: SHARED_LAB },
          ]),
        },
      ],
      null,
      async (url: string) => pages[url] ?? '<html><body></body></html>',
    );
    const emitted: ObservationInput[] = [];
    await scraper.run({
      scrapeRunId: 'test-run',
      sourceId: 'test-source',
      sourceName: 'dept-faculty-roster',
      sourceWeight: 0.7,
      options: { dryRun: true, useCache: false, release: false },
      emit: async (obs) => {
        emitted.push(...(Array.isArray(obs) ? obs : [obs]));
      },
      log: () => {},
    });

    const websites = emitted.filter(
      (o) =>
        (o.entityType === 'researchEntity' || o.entityType === 'user') && o.field === 'websiteUrl',
    );
    expect(websites.map((o) => o.value)).toEqual([SHARED_LAB]);
    expect(websites[0].entityKey).toContain('ada-fixture');
  });
});
