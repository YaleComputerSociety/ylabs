import { describe, expect, it } from 'vitest';
import {
  DEPARTMENT_RESEARCH_AREA_PAGES,
  DepartmentResearchAreasScraper,
  aggregateFacultyThemeAreas,
  buildDeptAreaMatchIndex,
  deptAreaGraftObservations,
  isFacultyProfileUrl,
  isResearchAreaThemeLabel,
  parseDepartmentResearchThemes,
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
  it('wires at least the initial STEM set with a research-overview URL distinct from the people index', () => {
    const keys = DEPARTMENT_RESEARCH_AREA_PAGES.map((page) => page.deptKey);
    for (const expected of [
      'physics',
      'chemistry',
      'mcdb',
      'mbb',
      'astronomy',
      'applied-physics',
      'statistics',
      'eeb',
    ]) {
      expect(keys).toContain(expected);
    }
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
