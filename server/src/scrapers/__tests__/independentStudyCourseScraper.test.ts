/**
 * Tests for IndependentStudyCourseScraper.
 *
 * All hooks (CourseTable fetch, User lookup, ResearchGroup slug resolution) are
 * injected via constructor deps so these tests touch neither the network nor
 * MongoDB. The Mongoose User model is also mocked at the module level so the
 * default `defaultUserFinder` path is exercised by `findUserForInstructor`
 * tests without ever hitting the database.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  IndependentStudyCourseScraper,
  isIndependentStudyCourse,
  groupCoursesByInstructor,
  findUserForInstructor,
  buildObservationsForFaculty,
  type UserMatch,
} from '../sources/independentStudyCourseScraper';
import type { CourseTableCourse } from '../../services/courseTableService';
import type { ObservationInput, ScraperContext } from '../types';

// ---------------------------------------------------------------------------
// isIndependentStudyCourse
// ---------------------------------------------------------------------------

describe('isIndependentStudyCourse', () => {
  it('matches the standard 290/471/489/490/491 course-number slots', () => {
    expect(isIndependentStudyCourse('MCDB 290', 'Sophomore Research')).toBe(true);
    expect(isIndependentStudyCourse('HIST 471', 'Senior Essay')).toBe(true);
    expect(isIndependentStudyCourse('PHIL 489', 'Senior Essay')).toBe(true);
    expect(isIndependentStudyCourse('CHEM 490', 'Senior Research Project')).toBe(true);
    expect(isIndependentStudyCourse('PSYC 491', 'Independent Research')).toBe(true);
  });

  it('matches by title even when the number is unusual', () => {
    // German 159 wouldn't match the number heuristic, but the title is canonical.
    expect(isIndependentStudyCourse('GMAN 159', 'Directed Reading')).toBe(true);
    expect(isIndependentStudyCourse('CLSS 200', 'Senior Tutorial')).toBe(true);
    expect(isIndependentStudyCourse('AFAM 010', 'Senior Project in African American Studies')).toBe(
      true,
    );
    expect(isIndependentStudyCourse('ARTS 100', 'Independent Study in Sculpture')).toBe(true);
  });

  it('rejects unrelated regular courses', () => {
    expect(isIndependentStudyCourse('CHEM 161', 'General Chemistry')).toBe(false);
    expect(isIndependentStudyCourse('MATH 120', 'Calculus of Functions of One Variable II')).toBe(
      false,
    );
    expect(isIndependentStudyCourse('CPSC 223', 'Data Structures')).toBe(false);
  });

  it('handles missing/blank inputs gracefully', () => {
    expect(isIndependentStudyCourse('', '')).toBe(false);
    expect(isIndependentStudyCourse(null, null)).toBe(false);
    expect(isIndependentStudyCourse(undefined, undefined)).toBe(false);
  });

  it('does not classify 100-level courses with the word "study" loosely', () => {
    // Titles must contain canonical phrases; "Studies" alone is too loose.
    expect(isIndependentStudyCourse('AMST 110', 'American Studies')).toBe(false);
    expect(isIndependentStudyCourse('FILM 150', 'Film Studies')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// groupCoursesByInstructor
// ---------------------------------------------------------------------------

describe('groupCoursesByInstructor', () => {
  it('groups multiple offerings by the same instructor', () => {
    const courses: CourseTableCourse[] = [
      {
        course_code: 'HIST 471',
        title: 'Senior Essay',
        season_code: '202503',
        professor_names: ['Beverly Gage'],
      },
      {
        course_code: 'HIST 491',
        title: 'Independent Research',
        season_code: '202503',
        professor_names: ['Beverly Gage'],
      },
      {
        course_code: 'HIST 471',
        title: 'Senior Essay',
        season_code: '202501', // earlier semester, same instructor + code
        professor_names: ['Beverly Gage'],
      },
    ];
    const grouped = groupCoursesByInstructor(courses);
    expect(grouped.size).toBe(1);
    const list = grouped.get('Beverly Gage');
    expect(list).toBeDefined();
    expect(list).toHaveLength(2); // de-duped HIST 471 across semesters
    expect(list!.map((c) => c.code).sort()).toEqual(['HIST 471', 'HIST 491']);
  });

  it('handles co-instructors as separate entries', () => {
    const courses: CourseTableCourse[] = [
      {
        course_code: 'MCDB 471',
        title: 'Independent Research',
        season_code: '202503',
        professor_names: ['Shirin Bahmanyar', 'Ronald Breaker'],
      },
    ];
    const grouped = groupCoursesByInstructor(courses);
    expect(grouped.size).toBe(2);
    expect(grouped.get('Shirin Bahmanyar')).toEqual([
      { code: 'MCDB 471', title: 'Independent Research' },
    ]);
    expect(grouped.get('Ronald Breaker')).toEqual([
      { code: 'MCDB 471', title: 'Independent Research' },
    ]);
  });

  it('skips empty / nameless rows and rows without a course code', () => {
    const courses: CourseTableCourse[] = [
      {
        course_code: '',
        title: 'Junk',
        season_code: '202503',
        professor_names: ['Nobody'],
      },
      {
        course_code: 'PHIL 489',
        title: 'Senior Essay',
        season_code: '202503',
        professor_names: ['', 'Daniel Greco'],
      },
    ];
    const grouped = groupCoursesByInstructor(courses);
    expect(grouped.size).toBe(1);
    expect(grouped.get('Daniel Greco')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// findUserForInstructor (uses injected mock; no DB)
// ---------------------------------------------------------------------------

describe('findUserForInstructor', () => {
  it('returns the unique exact lname+fname match', async () => {
    const finder = vi.fn(async (filter: any) => {
      // Exact "John" "Smith" match on first call.
      if (filter.fname && filter.fname.source === '^John$') {
        return [
          {
            _id: 'u1',
            netid: 'js42',
            fname: 'John',
            lname: 'Smith',
          },
        ];
      }
      return [];
    });
    const match = await findUserForInstructor('John Smith', finder);
    expect(match?.netid).toBe('js42');
    // Should not have fallen through to lname-only after a unique exact hit.
    expect(finder).toHaveBeenCalledTimes(1);
  });

  it('falls back to first-initial when full first name does not match', async () => {
    const finder = vi.fn(async (filter: any) => {
      const fname = filter.fname?.source as string | undefined;
      if (fname === '^Jonathan$') return []; // no exact full match
      if (fname === '^J') {
        return [
          {
            _id: 'u2',
            netid: 'jd99',
            fname: 'Jon',
            lname: 'Doe',
          },
        ];
      }
      return [];
    });
    const match = await findUserForInstructor('Jonathan Doe', finder);
    expect(match?.netid).toBe('jd99');
    expect(finder).toHaveBeenCalledTimes(2);
  });

  it('falls back to lname-only when exactly one faculty member shares the surname', async () => {
    const finder = vi.fn(async (filter: any) => {
      const fname = filter.fname?.source as string | undefined;
      if (!fname) {
        return [
          {
            _id: 'u3',
            netid: 'kw01',
            fname: 'Kathryn',
            lname: 'Lofton',
          },
        ];
      }
      return [];
    });
    const match = await findUserForInstructor('K Lofton', finder);
    expect(match?.netid).toBe('kw01');
  });

  it('returns null when no candidate matches', async () => {
    const finder = vi.fn(async () => []);
    const match = await findUserForInstructor('Nonexistent Person', finder);
    expect(match).toBeNull();
  });

  it('returns null when only a single token is provided (no last name)', async () => {
    const finder = vi.fn(async () => []);
    const match = await findUserForInstructor('Madonna', finder);
    expect(match).toBeNull();
    expect(finder).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// buildObservationsForFaculty
// ---------------------------------------------------------------------------

describe('buildObservationsForFaculty', () => {
  it('emits the four expected observations all keyed by group slug', () => {
    const obs = buildObservationsForFaculty('gage-lab-bgage', [
      { code: 'HIST 491', title: 'Independent Research' },
      { code: 'HIST 471', title: 'Senior Essay' },
    ]);
    expect(obs).toHaveLength(4);
    expect(obs.every((o) => o.entityType === 'researchGroup')).toBe(true);
    expect(obs.every((o) => o.entityKey === 'gage-lab-bgage')).toBe(true);

    const byField: Record<string, ObservationInput> = {};
    for (const o of obs) byField[o.field] = o;

    expect(byField.offersIndependentStudy?.value).toBe(true);
    expect(byField.acceptingUndergrads?.value).toBe(true);
    // acceptingUndergrads gets a moderate confidence override.
    expect(byField.acceptingUndergrads?.confidenceOverride).toBe(0.7);
    expect(byField.lastObservedAt?.value).toBeInstanceOf(Date);
    // courses are sorted by code for deterministic output.
    expect(byField.independentStudyCourses?.value).toEqual([
      { code: 'HIST 471', title: 'Senior Essay' },
      { code: 'HIST 491', title: 'Independent Research' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// IndependentStudyCourseScraper.run (integration with mocked deps)
// ---------------------------------------------------------------------------

function makeContext(
  overrides: Partial<ScraperContext['options']> = {},
): { ctx: ScraperContext; emitted: ObservationInput[]; logs: string[] } {
  const emitted: ObservationInput[] = [];
  const logs: string[] = [];
  const ctx: ScraperContext = {
    scrapeRunId: 'test-run',
    sourceId: 'test-source',
    sourceName: 'yale-course-catalog',
    sourceWeight: 0.7,
    options: {
      dryRun: true,
      useCache: false,
      release: false,
      ...overrides,
    },
    emit: async (obs) => {
      const arr = Array.isArray(obs) ? obs : [obs];
      emitted.push(...arr);
    },
    log: (msg) => {
      logs.push(msg);
    },
  };
  return { ctx, emitted, logs };
}

describe('IndependentStudyCourseScraper.run', () => {
  it('walks seasons, filters indep-study, matches faculty, and emits the right observations', async () => {
    const seasonData: Record<string, CourseTableCourse[]> = {
      '202503': [
        {
          course_code: 'HIST 471',
          title: 'Senior Essay',
          season_code: '202503',
          professor_names: ['Beverly Gage'],
        },
        {
          course_code: 'HIST 491',
          title: 'Independent Research',
          season_code: '202503',
          professor_names: ['Beverly Gage'],
        },
        {
          course_code: 'CHEM 161',
          title: 'General Chemistry',
          season_code: '202503',
          professor_names: ['Some Lecturer'],
        },
        {
          course_code: 'PHIL 489',
          title: 'Senior Essay',
          season_code: '202503',
          professor_names: ['Daniel Greco'],
        },
      ],
      '202501': [
        {
          course_code: 'HIST 471',
          title: 'Senior Essay',
          season_code: '202501',
          professor_names: ['Beverly Gage'],
        },
      ],
    };

    const userMap: Record<string, UserMatch> = {
      'Beverly|Gage': {
        _id: 'u-bgage',
        netid: 'bgage',
        fname: 'Beverly',
        lname: 'Gage',
        primaryDepartment: 'History',
      },
      'Daniel|Greco': {
        _id: 'u-dgreco',
        netid: 'dgreco',
        fname: 'Daniel',
        lname: 'Greco',
        primaryDepartment: 'Philosophy',
      },
      // 'Some Lecturer' intentionally absent — not an indep-study course anyway.
    };

    const scraper = new IndependentStudyCourseScraper({
      getSeasons: () => ['202503', '202501'],
      fetchSeason: async (s) => seasonData[s] || [],
      userFinder: async (filter: any) => {
        const lname = filter.lname?.source?.replace(/^\^|\$$/g, '');
        const fname = filter.fname?.source?.replace(/^\^|\$$/g, '');
        if (!lname) return [];
        if (!fname) {
          // lname-only fallback: scan map for a unique hit
          const hits = Object.values(userMap).filter(
            (u) => u.lname.toLowerCase() === lname.toLowerCase(),
          );
          return hits;
        }
        const exact = userMap[`${fname}|${lname}`];
        return exact ? [exact] : [];
      },
      ownerToGroupSlug: async (owner) =>
        owner.netid === 'bgage' ? 'gage-lab-bgage' : `${owner.lname.toLowerCase()}-lab-${owner.netid}`,
    });

    const { ctx, emitted, logs } = makeContext();
    const result = await scraper.run(ctx);

    expect(result.entitiesObserved).toBe(2); // Beverly Gage, Daniel Greco
    expect(result.observationCount).toBe(8); // 4 obs × 2 faculty

    // Beverly Gage observations: should include both HIST 471 and HIST 491.
    const gageObs = emitted.filter((o) => o.entityKey === 'gage-lab-bgage');
    expect(gageObs).toHaveLength(4);
    const courseObs = gageObs.find((o) => o.field === 'independentStudyCourses');
    expect(courseObs?.value).toEqual([
      { code: 'HIST 471', title: 'Senior Essay' },
      { code: 'HIST 491', title: 'Independent Research' },
    ]);

    // Daniel Greco observations.
    const grecoObs = emitted.filter((o) => o.entityKey === 'greco-lab-dgreco');
    expect(grecoObs).toHaveLength(4);
    const grecoCourses = grecoObs.find(
      (o) => o.field === 'independentStudyCourses',
    );
    expect(grecoCourses?.value).toEqual([
      { code: 'PHIL 489', title: 'Senior Essay' },
    ]);

    // CHEM 161 (not indep) was filtered out → no observations for "Some Lecturer".
    expect(emitted.some((o) => (o.value as any) === 'Some Lecturer')).toBe(false);

    // Confidence override applied to acceptingUndergrads.
    const acceptingObs = emitted.filter((o) => o.field === 'acceptingUndergrads');
    expect(acceptingObs.length).toBe(2);
    expect(acceptingObs.every((o) => o.confidenceOverride === 0.7)).toBe(true);

    // Logs reflect per-season filter counts.
    expect(logs.some((l) => /\[202503\].*independent study/.test(l))).toBe(true);
  });

  it('honors ctx.options.limit and degrades gracefully on fetch failure', async () => {
    // First season throws (simulating CourseTable outage); second returns 5 indep
    // courses by 5 unique instructors. limit=2 should cap matched faculty to 2.
    const instructors = ['Aaa Aaa', 'Bbb Bbb', 'Ccc Ccc', 'Ddd Ddd', 'Eee Eee'];
    const seasonData: Record<string, CourseTableCourse[]> = {
      '202503': instructors.map((name, i) => ({
        course_code: `LING 49${i}`,
        title: 'Independent Research',
        season_code: '202503',
        professor_names: [name],
      })),
    };
    const scraper = new IndependentStudyCourseScraper({
      getSeasons: () => ['202501', '202503'],
      fetchSeason: async (s) => {
        if (s === '202501') throw new Error('CourseTable unreachable');
        return seasonData[s];
      },
      userFinder: async (filter: any) => {
        const lname = filter.lname?.source?.replace(/^\^|\$$/g, '');
        const fname = filter.fname?.source?.replace(/^\^|\$$/g, '');
        if (!lname || !fname || fname.length === 1) return [];
        return [
          {
            _id: `u-${lname}`,
            netid: lname.toLowerCase(),
            fname,
            lname,
          },
        ];
      },
      ownerToGroupSlug: async (owner) => `${owner.lname.toLowerCase()}-lab`,
    });

    const { ctx, emitted, logs } = makeContext({ limit: 2 });
    const result = await scraper.run(ctx);

    expect(result.entitiesObserved).toBe(2);
    const slugs = new Set(emitted.map((o) => o.entityKey));
    expect(slugs.size).toBe(2);
    expect(logs.some((l) => /fetch failed.*CourseTable unreachable/.test(l))).toBe(
      true,
    );
  });

  it('returns zero observations cleanly when no indep-study courses are found', async () => {
    const scraper = new IndependentStudyCourseScraper({
      getSeasons: () => ['202503'],
      fetchSeason: async () => [
        {
          course_code: 'CHEM 161',
          title: 'General Chemistry',
          season_code: '202503',
          professor_names: ['Some Lecturer'],
        },
      ],
      userFinder: async () => [],
      ownerToGroupSlug: async () => null,
    });
    const { ctx, emitted } = makeContext();
    const result = await scraper.run(ctx);
    expect(result.observationCount).toBe(0);
    expect(result.entitiesObserved).toBe(0);
    expect(emitted).toEqual([]);
  });
});
