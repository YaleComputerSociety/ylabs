import { describe, expect, it } from 'vitest';
import {
  DEPARTMENT_RESEARCH_AREA_PAGES,
  DepartmentResearchAreasScraper,
  aggregateFacultyThemeAreas,
  buildDeptAreaMatchIndex,
  deptAreaGraftObservations,
  isFacultyProfileUrl,
  isResearchAreaThemeLabel,
  nextThemePageUrl,
  parseDepartmentResearchThemes,
  parseOverviewThemeLinks,
  parseThemePageListing,
  resolveDeptFacultyHome,
  type DeptAreaCandidateEntity,
  type DeptFacultyThemeAreas,
  type DepartmentResearchAreaPage,
} from '../sources/departmentResearchAreasScraper';
import type { ObservationInput, ScraperContext } from '../types';

const PHYSICS_URL = 'https://physics.yale.edu/research';

function themeHtml(
  themes: Array<{
    heading: string;
    prose?: string;
    faculty: Array<{ name: string; slug: string }>;
  }>,
  host = 'physics.yale.edu',
): string {
  const blocks = themes
    .map((theme) => {
      const links = theme.faculty
        .map((f) => `<li><a href="https://${host}/people/${f.slug}">${f.name}</a></li>`)
        .join('');
      const prose = theme.prose ? `<p>${theme.prose}</p>` : '';
      return `<h2>${theme.heading}</h2>${prose}<ul>${links}</ul>`;
    })
    .join('');
  return `<html><body><main>${blocks}</main></body></html>`;
}

function makeContext(options: Partial<ScraperContext['options']> = {}): {
  ctx: ScraperContext;
  emitted: ObservationInput[];
  logs: string[];
} {
  const emitted: ObservationInput[] = [];
  const logs: string[] = [];
  return {
    emitted,
    logs,
    ctx: {
      scrapeRunId: 'test-run',
      sourceId: 'source-1',
      sourceName: 'department-research-areas',
      sourceWeight: 0.65,
      options: { dryRun: true, useCache: false, release: false, ...options },
      emit: async (obs) => {
        emitted.push(...(Array.isArray(obs) ? obs : [obs]));
      },
      log: (msg) => logs.push(msg),
    },
  };
}

describe('DEPARTMENT_RESEARCH_AREA_PAGES registry', () => {
  it('wires only departments that publish a research-overview URL distinct from the people index', () => {
    const keys = DEPARTMENT_RESEARCH_AREA_PAGES.map((page) => page.deptKey);
    expect(keys).toEqual(['physics', 'chemistry', 'mcdb', 'astronomy']);
    expect(
      DEPARTMENT_RESEARCH_AREA_PAGES.find((page) => page.deptKey === 'chemistry')?.overviewUrl,
    ).toBe('https://chem.yale.edu/research-areas');
    for (const page of DEPARTMENT_RESEARCH_AREA_PAGES) {
      expect(page.overviewUrl).toMatch(/^https:\/\//);
      expect(page.peopleIndexUrl).toMatch(/^https:\/\//);
      expect(page.overviewUrl).not.toBe(page.peopleIndexUrl);
      expect(page.deptName.length).toBeGreaterThan(0);
    }
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('isResearchAreaThemeLabel', () => {
  it('accepts concise topic headings', () => {
    expect(isResearchAreaThemeLabel('Atomic, Molecular & Optical Physics')).toBe(true);
    expect(isResearchAreaThemeLabel('Astrophysics & Cosmology')).toBe(true);
    expect(isResearchAreaThemeLabel('Research Areas: Condensed Matter')).toBe(true);
  });

  it('rejects bare section labels, page furniture, and prose', () => {
    expect(isResearchAreaThemeLabel('Research Areas')).toBe(false);
    expect(isResearchAreaThemeLabel('In the News')).toBe(false);
    expect(isResearchAreaThemeLabel('Selected Publications')).toBe(false);
    expect(isResearchAreaThemeLabel('Our faculty study a wide range of topics.')).toBe(false);
    expect(isResearchAreaThemeLabel('Overview:')).toBe(false);
    expect(isResearchAreaThemeLabel('')).toBe(false);
  });
});

describe('isFacultyProfileUrl', () => {
  it('accepts individual profile paths and rejects index roots', () => {
    expect(isFacultyProfileUrl('https://physics.yale.edu/people/jane-doe')).toBe(true);
    expect(isFacultyProfileUrl('https://chem.yale.edu/profile/sam-lee')).toBe(true);
    expect(isFacultyProfileUrl('https://physics.yale.edu/people/faculty')).toBe(false);
    expect(isFacultyProfileUrl('https://physics.yale.edu/people')).toBe(false);
    expect(isFacultyProfileUrl('https://physics.yale.edu/research')).toBe(false);
    expect(isFacultyProfileUrl('mailto:jane@yale.edu')).toBe(false);
  });
});

describe('parseDepartmentResearchThemes', () => {
  it('extracts topic themes with their faculty, dropping non-topic headings and empty themes', () => {
    const html = themeHtml([
      {
        heading: 'Atomic, Molecular & Optical Physics',
        prose: 'This theme studies light-matter interaction across many regimes of physics.',
        faculty: [
          { name: 'Jane Doe', slug: 'jane-doe' },
          { name: 'Sam Lee', slug: 'sam-lee' },
        ],
      },
      { heading: 'In the News', faculty: [{ name: 'Press Office', slug: 'press' }] },
      { heading: 'Astrophysics & Cosmology', faculty: [] },
    ]);
    const themes = parseDepartmentResearchThemes(html, PHYSICS_URL);
    expect(themes).toHaveLength(1);
    expect(themes[0].label).toBe('Atomic, Molecular & Optical Physics');
    expect(themes[0].faculty.map((f) => f.name)).toEqual(['Jane Doe', 'Sam Lee']);
    expect(themes[0].prose).toMatch(/light-matter interaction/);
  });

  it('ignores the bare people-index link and other non-profile anchors', () => {
    const html =
      `<html><body><main><h2>Condensed Matter Physics</h2>` +
      `<ul><li><a href="https://physics.yale.edu/people/faculty">All Faculty</a></li>` +
      `<li><a href="https://physics.yale.edu/people/ada-byron">Ada Byron</a></li></ul>` +
      `</main></body></html>`;
    const themes = parseDepartmentResearchThemes(html, PHYSICS_URL);
    expect(themes).toHaveLength(1);
    expect(themes[0].faculty.map((f) => f.profileUrl)).toEqual([
      'https://physics.yale.edu/people/ada-byron',
    ]);
  });
});

const YALESITES_OVERVIEW = 'https://dept.yale.edu/research';

function yaleSitesOverviewHtml(): string {
  return (
    `<html><body><header><nav><h2>Research</h2><a href="/research/header-theme">Header</a></nav></header>` +
    `<main>` +
    `<div class="text-with-image__content"><h2 class="text-with-image__heading">Quantum Physics</h2>` +
    `<div class="text-with-image__text"><p>Theme prose.</p></div>` +
    `<div class="text-with-image__ctas"><a class="link" href="/research/quantum-physics">Research Page</a></div></div>` +
    `<div class="text-with-image__content"><h2 class="text-with-image__heading">Nuclear Physics</h2>` +
    `<div class="text-with-image__ctas"><a href="/nuclear-experimental">Experimental</a>` +
    `<a href="/nuclear-theoretical#top">Theoretical</a></div></div>` +
    `<ul><li class="custom-card"><h2 class="custom-card__heading"><a href="/research/cell-biology">Cell Biology</a></h2></li>` +
    `<li class="custom-card"><h2 class="custom-card__heading"><a href="/research">Genetics</a></h2></li>` +
    `<li class="custom-card"><h2 class="custom-card__heading"><a href="https://elsewhere.edu/theme">Offsite Theme</a></h2></li></ul>` +
    `<h2>Our Research in the News</h2><a href="/posts/2026-01-01-a-story">Story</a>` +
    `</main>` +
    `<footer><h2>Helpful Links</h2><a href="/academics">Academics</a></footer>` +
    `</body></html>`
  );
}

const PROFESSOR = 'Professor of Physics';

type Card = string | { slug: string; role: string };

function titleCase(slug: string): string {
  return slug
    .split('-')
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ');
}

function collectionHtml(heading: string, cards: Card[]): string {
  const items = cards
    .map((card) => (typeof card === 'string' ? { slug: card, role: PROFESSOR } : card))
    .map(
      ({ slug, role }) =>
        `<li class="directory-listing-card"><h3 class="directory-listing-card__heading">` +
        `<a class="directory-listing-card__heading-link" href="/profile/${slug}">${titleCase(slug)}</a></h3>` +
        `<div class="directory-listing-card__subheading"><div>${role}</div></div>` +
        `<a class="directory-listing-card__link" href="mailto:${slug}@example.edu">Email</a></li>`,
    )
    .join('');
  return (
    `<div class="component-wrapper__inner"><h2 class="component-wrapper__heading">${heading}</h2>` +
    `<section><div class="card-collection" data-collection-source="profile"><ul>${items}</ul></div></section></div>`
  );
}

function profileCollectionHtml(cards: Card[], nextHref?: string, extra = ''): string {
  const pager = nextHref
    ? `<nav class="pager"><ul><li class="pager__item pager__item--next"><a class="pager__link" href="${nextHref}" rel="next">Next</a></li></ul></nav>`
    : '';
  return (
    `<html><body><main>` +
    `<p>Mentioned in prose: <a href="/profile/prose-mention">Prose Mention</a></p>` +
    collectionHtml('Group Members', cards) +
    extra +
    pager +
    `<a href="https://social.example/profile/dept-account">Dept Account</a>` +
    `</main></body></html>`
  );
}

describe('parseOverviewThemeLinks', () => {
  it('follows each topic heading to its same-host theme pages and skips chrome, self links, offsite and news', () => {
    const links = parseOverviewThemeLinks(yaleSitesOverviewHtml(), {
      overviewUrl: YALESITES_OVERVIEW,
      peopleIndexUrl: 'https://dept.yale.edu/people/faculty',
    });
    expect(links).toEqual([
      { label: 'Quantum Physics', themeUrls: ['https://dept.yale.edu/research/quantum-physics'] },
      {
        label: 'Nuclear Physics',
        themeUrls: [
          'https://dept.yale.edu/nuclear-experimental',
          'https://dept.yale.edu/nuclear-theoretical',
        ],
      },
      { label: 'Cell Biology', themeUrls: ['https://dept.yale.edu/research/cell-biology'] },
    ]);
  });

  it('reads legacy Drupal h4 theme headings', () => {
    const html =
      `<html><body><div id="block-system-main"><table><tr>` +
      `<td><h4><a href="/research/research-home/exoplanets">Exoplanets</a></h4></td>` +
      `</tr></table></div><div class="region sidebar"><nav><h2>Research</h2>` +
      `<a href="/research/research-home/exoplanets">Exoplanets</a></nav></div></body></html>`;
    expect(
      parseOverviewThemeLinks(html, {
        overviewUrl: 'https://astro.yale.edu/research',
        peopleIndexUrl: 'https://astro.yale.edu/people/faculty',
      }),
    ).toEqual([
      {
        label: 'Exoplanets',
        themeUrls: ['https://astro.yale.edu/research/research-home/exoplanets'],
      },
    ]);
  });
});

describe('parseThemePageListing', () => {
  it('reads only faculty-titled cards in the structured profile listing on the department host', () => {
    const listing = parseThemePageListing(
      profileCollectionHtml([
        'jane-doe',
        { slug: 'sam-lee', role: 'Assistant Professor of Physics' },
        { slug: 'grad-one', role: 'Graduate Student' },
        { slug: 'postdoc-one', role: 'Postdoctoral Associate' },
        { slug: 'untitled-one', role: '' },
      ]),
      'https://dept.yale.edu/research/quantum-physics',
    );
    expect(listing.faculty).toEqual([
      { name: 'Jane Doe', profileUrl: 'https://dept.yale.edu/profile/jane-doe' },
      { name: 'Sam Lee', profileUrl: 'https://dept.yale.edu/profile/sam-lee' },
    ]);
    expect(listing.listedProfileUrls).toHaveLength(5);
  });

  it('skips staff and cross-reference collections even when a card carries a faculty title', () => {
    const listing = parseThemePageListing(
      profileCollectionHtml(
        ['jane-doe'],
        undefined,
        collectionHtml('Support Staff', [
          { slug: 'admin-one', role: 'Senior Administrative Assistant' },
        ]) + collectionHtml('See Also', ['other-dept-professor']),
      ),
      'https://dept.yale.edu/research/quantum-physics',
    );
    expect(listing.faculty.map((ref) => ref.name)).toEqual(['Jane Doe']);
  });

  it('reads a Drupal faculty reference field', () => {
    const html =
      `<html><body><p><a href="/people/prose-mention">Prose Mention</a></p>` +
      `<div class="field field-name-field-faculty"><div class="field-label">Faculty:</div>` +
      `<div class="field-items"><div class="field-item"><a href="/people/ada-byron">Ada Byron</a></div></div></div>` +
      `</body></html>`;
    expect(
      parseThemePageListing(html, 'https://astro.yale.edu/research/research-home/exoplanets')
        .faculty,
    ).toEqual([{ name: 'Ada Byron', profileUrl: 'https://astro.yale.edu/people/ada-byron' }]);
  });

  it('emits nothing from a page with no faculty listing', () => {
    expect(
      parseThemePageListing(
        '<html><body><main><a href="/profile/jane-doe">Jane Doe</a></main></body></html>',
        'https://dept.yale.edu/research/quantum-physics',
      ).faculty,
    ).toEqual([]);
  });
});

describe('nextThemePageUrl', () => {
  it('follows a same-host rel=next pager link', () => {
    expect(
      nextThemePageUrl(
        profileCollectionHtml(['jane-doe'], '?page=1'),
        'https://dept.yale.edu/research/quantum-physics',
      ),
    ).toBe('https://dept.yale.edu/research/quantum-physics?page=1');
    expect(
      nextThemePageUrl(
        profileCollectionHtml(['jane-doe']),
        'https://dept.yale.edu/research/quantum-physics',
      ),
    ).toBeNull();
  });
});

describe('aggregateFacultyThemeAreas', () => {
  it('unions the labels of every theme a faculty member appears under', () => {
    const areas = aggregateFacultyThemeAreas([
      {
        label: 'Biophysics',
        prose: '',
        faculty: [{ name: 'Jane Doe', profileUrl: 'https://mcdb.yale.edu/people/jane-doe' }],
      },
      {
        label: 'Genetics',
        prose: '',
        faculty: [{ name: 'Jane Doe', profileUrl: 'https://mcdb.yale.edu/people/jane-doe/' }],
      },
    ]);
    const entries = [...areas.values()];
    expect(entries).toHaveLength(1);
    expect(entries[0].researchAreas).toEqual(['Biophysics', 'Genetics']);
  });
});

function candidate(overrides: Partial<DeptAreaCandidateEntity>): DeptAreaCandidateEntity {
  return {
    _id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    slug: 'jane-doe-lab',
    name: 'Jane Doe Lab',
    matchUrls: [],
    nameKey: 'jane-doe',
    ...overrides,
  };
}

const FACULTY = (overrides: Partial<DeptFacultyThemeAreas> = {}): DeptFacultyThemeAreas => ({
  name: 'Jane Doe',
  profileUrl: 'https://physics.yale.edu/people/jane-doe',
  researchAreas: ['Astrophysics & Cosmology'],
  ...overrides,
});

describe('resolveDeptFacultyHome', () => {
  it('matches by the faculty profile URL', () => {
    const index = buildDeptAreaMatchIndex([
      candidate({
        _id: '111111111111111111111111',
        matchUrls: ['https://physics.yale.edu/people/jane-doe'],
        nameKey: 'zzz',
      }),
    ]);
    expect(resolveDeptFacultyHome(FACULTY(), index)).toEqual({
      status: 'matched',
      entityId: '111111111111111111111111',
    });
  });

  it('falls back to a unique department-scoped name-key when no URL matches', () => {
    const index = buildDeptAreaMatchIndex([
      candidate({ _id: '222222222222222222222222', matchUrls: [], nameKey: 'jane-doe' }),
    ]);
    expect(resolveDeptFacultyHome(FACULTY(), index)).toEqual({
      status: 'matched',
      entityId: '222222222222222222222222',
    });
  });

  it('holds when the name key maps to more than one home', () => {
    const index = buildDeptAreaMatchIndex([
      candidate({ _id: '333333333333333333333333', slug: 'a', nameKey: 'jane-doe' }),
      candidate({ _id: '444444444444444444444444', slug: 'b', nameKey: 'jane-doe' }),
    ]);
    expect(resolveDeptFacultyHome(FACULTY(), index)).toEqual({ status: 'ambiguous' });
  });

  it('is unmatched when nothing resolves', () => {
    const index = buildDeptAreaMatchIndex([
      candidate({ _id: '555555555555555555555555', matchUrls: [], nameKey: 'someone-else' }),
    ]);
    expect(resolveDeptFacultyHome(FACULTY(), index)).toEqual({ status: 'unmatched' });
  });
});

describe('deptAreaGraftObservations', () => {
  it('emits a deduped, hygiene-filtered researchAreas graft cited to the faculty profile URL', () => {
    const obs = deptAreaGraftObservations(
      '777777777777777777777777',
      ['Astrophysics & Cosmology', 'Astrophysics & Cosmology', 'Research Areas'],
      'https://physics.yale.edu/people/jane-doe',
    );
    expect(obs).toEqual([
      {
        entityType: 'researchEntity',
        entityId: '777777777777777777777777',
        sourceUrl: 'https://physics.yale.edu/people/jane-doe',
        field: 'researchAreas',
        value: ['Astrophysics & Cosmology'],
        confidenceOverride: 0.7,
      },
    ]);
  });

  it('emits nothing without a citable source URL', () => {
    expect(deptAreaGraftObservations('777777777777777777777777', ['Biophysics'], '')).toEqual([]);
  });
});

describe('DepartmentResearchAreasScraper.run', () => {
  const page: DepartmentResearchAreaPage = {
    deptKey: 'physics',
    deptName: 'Physics',
    schoolName: 'Yale Faculty of Arts and Sciences',
    overviewUrl: PHYSICS_URL,
    peopleIndexUrl: 'https://physics.yale.edu/people/faculty',
  };

  it('grafts onto a resolved home, holds an ambiguous one, and never cites the overview page', async () => {
    const html = themeHtml([
      {
        heading: 'Astrophysics & Cosmology',
        faculty: [
          { name: 'Jane Doe', slug: 'jane-doe' },
          { name: 'Sam Lee', slug: 'sam-lee' },
        ],
      },
      {
        heading: 'Quantum Information',
        faculty: [{ name: 'Jane Doe', slug: 'jane-doe' }],
      },
    ]);
    const scraper = new DepartmentResearchAreasScraper(
      {
        fetchPage: async (url) => (url === PHYSICS_URL ? html : ''),
        entityFinder: async () => [
          candidate({
            _id: '111111111111111111111111',
            matchUrls: ['https://physics.yale.edu/people/jane-doe'],
            nameKey: 'jane-doe',
          }),
          candidate({ _id: 'aaaaaaaaaaaaaaaaaaaaaaa1', slug: 'sam-a', nameKey: 'sam-lee' }),
          candidate({ _id: 'aaaaaaaaaaaaaaaaaaaaaaa2', slug: 'sam-b', nameKey: 'sam-lee' }),
        ],
      },
      [page],
    );

    const { ctx, emitted } = makeContext({ only: ['physics'] });
    const result = await scraper.run(ctx);

    expect(result.entitiesObserved).toBe(1);
    const graft = emitted.find((o) => o.field === 'researchAreas');
    expect(graft?.entityId).toBe('111111111111111111111111');
    expect(graft?.value).toEqual(['Astrophysics & Cosmology', 'Quantum Information']);
    expect(graft?.sourceUrl).toBe('https://physics.yale.edu/people/jane-doe');
    expect(emitted.every((o) => o.sourceUrl !== PHYSICS_URL)).toBe(true);
    expect(result.notes).toMatch(/1 held \(ambiguous home\)/);
  });

  it('crawls linked theme pages across pagination and labels faculty with the overview heading', async () => {
    const themeUrl = 'https://dept.yale.edu/research/quantum-physics';
    const pages: Record<string, string> = {
      [YALESITES_OVERVIEW]: yaleSitesOverviewHtml(),
      [themeUrl]: profileCollectionHtml(['jane-doe'], '?page=1'),
      [`${themeUrl}?page=1`]: profileCollectionHtml(
        [{ slug: 'grad-one', role: 'Graduate Student' }],
        '?page=2',
      ),
      [`${themeUrl}?page=2`]: profileCollectionHtml(['sam-lee'], '?page=3'),
      [`${themeUrl}?page=3`]: profileCollectionHtml(['sam-lee'], '?page=4'),
      'https://dept.yale.edu/research/cell-biology': profileCollectionHtml(['jane-doe']),
    };
    const fetched: string[] = [];
    const scraper = new DepartmentResearchAreasScraper(
      {
        fetchPage: async (url) => {
          fetched.push(url);
          if (!(url in pages)) throw new Error('Request failed with status code 404');
          return pages[url];
        },
        entityFinder: async () => [
          candidate({
            _id: '111111111111111111111111',
            matchUrls: ['https://dept.yale.edu/profile/jane-doe'],
          }),
          candidate({ _id: '222222222222222222222222', slug: 'sam', nameKey: 'sam-lee' }),
          candidate({ _id: '333333333333333333333333', slug: 'grad', nameKey: 'grad-one' }),
        ],
      },
      [
        {
          ...page,
          deptKey: 'dept',
          overviewUrl: YALESITES_OVERVIEW,
          peopleIndexUrl: 'https://dept.yale.edu/people/faculty',
        },
      ],
    );
    const { ctx, emitted, logs } = makeContext();
    const result = await scraper.run(ctx);

    expect(fetched).toContain(`${themeUrl}?page=3`);
    expect(fetched).not.toContain(`${themeUrl}?page=4`);
    const byEntity = Object.fromEntries(emitted.map((o) => [o.entityId, o]));
    expect(byEntity['111111111111111111111111']?.value).toEqual([
      'Quantum Physics',
      'Cell Biology',
    ]);
    expect(byEntity['111111111111111111111111']?.sourceUrl).toBe(
      'https://dept.yale.edu/profile/jane-doe',
    );
    expect(byEntity['222222222222222222222222']?.value).toEqual(['Quantum Physics']);
    expect(byEntity['333333333333333333333333']).toBeUndefined();
    expect(
      emitted.every((o) => o.sourceUrl !== YALESITES_OVERVIEW && o.sourceUrl !== themeUrl),
    ).toBe(true);
    expect(result.notes).toMatch(/2 page fetches failed/);
    expect(logs.some((line) => line.includes('theme page fetch failed'))).toBe(true);
  });

  it('skips a department whose overview cannot be fetched and still reports the failure', async () => {
    const scraper = new DepartmentResearchAreasScraper(
      {
        fetchPage: async () => {
          throw new Error('Request failed with status code 403');
        },
        entityFinder: async () => [],
      },
      [page],
    );
    const { ctx, emitted, logs } = makeContext();
    const result = await scraper.run(ctx);
    expect(emitted).toHaveLength(0);
    expect(result.notes).toMatch(/1 page fetches failed/);
    expect(logs[0]).toMatch(/\[physics\] overview page fetch failed/);
  });

  it('emits nothing when no listed faculty resolves', async () => {
    const html = themeHtml([
      { heading: 'Biophysics', faculty: [{ name: 'Nobody Here', slug: 'nobody-here' }] },
    ]);
    const scraper = new DepartmentResearchAreasScraper(
      {
        fetchPage: async () => html,
        entityFinder: async () => [candidate({ nameKey: 'someone-else', matchUrls: [] })],
      },
      [page],
    );
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);
    expect(emitted).toHaveLength(0);
    expect(result.entitiesObserved).toBe(0);
  });
});
