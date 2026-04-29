/**
 * IndependentStudyCourseScraper
 *
 * Identifies Yale faculty who supervise undergraduate independent-study /
 * directed-research courses. This is the *primary coverage signal* for
 * humanities and social-science departments where there are typically no labs
 * and few NIH/NSF grants — but every department has a "Senior Essay" or
 * `<DEPT> 491 Independent Research` course.
 *
 * Strategy:
 *   1. Pull every CourseTable course offering across the recent 3 semesters
 *      (the same window `fetchCourseTableData` uses for per-professor lookup).
 *   2. Filter to "independent study" courses by either:
 *        a. Course-number heuristic: code matches `^[A-Z]+ (29[0-9]|47[0-9]|48[0-9]|49[0-9])$`
 *        b. Title heuristic: title matches /independent (study|research|project)|
 *           directed (reading|study)|senior (essay|thesis|project)|tutorial/i
 *      A course qualifies if EITHER matches.
 *   3. Group surviving courses by instructor (one course can have co-instructors;
 *      one instructor can teach multiple indep-study courses).
 *   4. For each instructor, look up the matching Yale User (lname + fname,
 *      falling back to lname + first initial). Skip un-matched names.
 *   5. For each matched faculty, route observations through the per-PI
 *      ResearchGroup created by `findOrCreateForOwner` (slug-keyed). Emit:
 *        - offersIndependentStudy = true
 *        - independentStudyCourses = full [{ code, title }] array
 *        - acceptingUndergrads = true (with confidenceOverride 0.7 — moderate,
 *          since teaching the course implies they take undergrads but doesn't
 *          prove current openness)
 *        - lastObservedAt = now
 *
 * Honors:
 *   - ctx.options.useCache: passed through to fetchAllSeasonCourses
 *   - ctx.options.limit: caps the number of *matched faculty* processed
 *
 * Failure modes:
 *   - CourseTable unreachable → fetchAllSeasonCourses returns []; we log and
 *     return zero observations. Never throws.
 */
import {
  fetchAllSeasonCourses,
  getRecentSeasonCodes,
  type CourseTableCourse,
} from '../../services/courseTableService';
import { User } from '../../models/user';
import { findOrCreateForOwner } from '../../services/researchGroupService';
import { normalizeName, splitName } from '../utils/scraperHelpers';
import type {
  IScraper,
  ObservationInput,
  ScraperContext,
  ScraperResult,
} from '../types';

const SOURCE_URL = 'https://coursetable.com/';

const INDEP_NUMBER_RE = /^[A-Z]+ (29[0-9]|47[0-9]|48[0-9]|49[0-9])$/;
const INDEP_TITLE_RE =
  /independent (study|research|project)|directed (reading|study)|senior (essay|thesis|project)|tutorial/i;

// ---------------------------------------------------------------------------
// Pure helpers (no I/O, unit-testable)
// ---------------------------------------------------------------------------

/**
 * Pure: does a (course_code, title) pair represent an independent-study /
 * directed-research course? True if EITHER the number heuristic or the title
 * heuristic matches.
 */
export function isIndependentStudyCourse(
  code: string | undefined | null,
  title: string | undefined | null,
): boolean {
  const codeStr = (code || '').trim().toUpperCase();
  const titleStr = (title || '').trim();
  if (codeStr && INDEP_NUMBER_RE.test(codeStr)) return true;
  if (titleStr && INDEP_TITLE_RE.test(titleStr)) return true;
  return false;
}

/** Internal: minimal projection of a course used for grouping/observation. */
export interface IndepCourseRef {
  code: string;
  title: string;
}

/**
 * Pure: invert the (course → [instructors]) map into (instructor → [courses]).
 *
 * Co-instructors produce one entry per instructor pointing at the same course.
 * Repeat offerings of the same course code by the same instructor are de-duped
 * (we keep the first observed title for stability).
 */
export function groupCoursesByInstructor(
  courses: CourseTableCourse[],
): Map<string, IndepCourseRef[]> {
  const out = new Map<string, IndepCourseRef[]>();
  for (const course of courses) {
    const code = (course.course_code || '').trim();
    const title = (course.title || '').trim();
    if (!code) continue;
    for (const rawName of course.professor_names || []) {
      const name = normalizeName(rawName);
      if (!name) continue;
      const list = out.get(name) || [];
      if (!list.some((c) => c.code === code)) {
        list.push({ code, title });
      }
      out.set(name, list);
    }
  }
  return out;
}

/** Lightweight User shape returned by `findUserForInstructor`. */
export interface UserMatch {
  _id: any;
  netid: string;
  fname: string;
  lname: string;
  primary_department?: string;
}

/**
 * Look up the Yale User most likely to be `instructorName`.
 *
 * Strategy (in order, return on first hit):
 *   1. Exact case-insensitive match on lname AND fname.
 *   2. lname + first-initial of fname (handles "J. Smith" or "John" vs "Jonathan").
 *   3. lname only — but only if exactly one faculty user has that lname.
 *
 * `userFinder` is injected so the function is unit-testable without a real
 * Mongo connection. The default implementation queries the User collection.
 */
export async function findUserForInstructor(
  instructorName: string,
  userFinder: (filter: Record<string, unknown>) => Promise<UserMatch[]> = defaultUserFinder,
): Promise<UserMatch | null> {
  const cleaned = normalizeName(instructorName);
  const { first, last } = splitName(cleaned);
  if (!last) return null;

  const lnameRe = new RegExp(`^${escapeRegex(last)}$`, 'i');
  const facultyTypes = { $in: ['professor', 'faculty'] };

  if (first) {
    const fnameRe = new RegExp(`^${escapeRegex(first)}$`, 'i');
    const exact = await userFinder({
      lname: lnameRe,
      fname: fnameRe,
      userType: facultyTypes,
    });
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) return exact[0]; // ambiguous, take first deterministic hit

    const initial = first.charAt(0);
    if (initial) {
      const initRe = new RegExp(`^${escapeRegex(initial)}`, 'i');
      const initMatches = await userFinder({
        lname: lnameRe,
        fname: initRe,
        userType: facultyTypes,
      });
      if (initMatches.length === 1) return initMatches[0];
    }
  }

  const lnameOnly = await userFinder({ lname: lnameRe, userType: facultyTypes });
  if (lnameOnly.length === 1) return lnameOnly[0];

  return null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function defaultUserFinder(
  filter: Record<string, unknown>,
): Promise<UserMatch[]> {
  const docs = await User.find(filter, {
    _id: 1,
    netid: 1,
    fname: 1,
    lname: 1,
    primary_department: 1,
  })
    .limit(10)
    .lean();
  return (docs as any[]).map((d) => ({
    _id: d._id,
    netid: d.netid,
    fname: d.fname,
    lname: d.lname,
    primary_department: d.primary_department,
  }));
}

/**
 * Pure: build the ObservationInput list for one matched faculty member.
 *
 * All observations are keyed by the ResearchGroup's `slug` (resolved upstream
 * via findOrCreateForOwner). The materializer routes by entityKey → slug.
 */
export function buildObservationsForFaculty(
  groupSlug: string,
  courses: IndepCourseRef[],
): ObservationInput[] {
  const base = {
    entityType: 'researchGroup' as const,
    entityKey: groupSlug,
    sourceUrl: SOURCE_URL,
  };
  const sortedCourses = [...courses].sort((a, b) => a.code.localeCompare(b.code));
  return [
    { ...base, field: 'offersIndependentStudy', value: true },
    { ...base, field: 'independentStudyCourses', value: sortedCourses },
    {
      ...base,
      field: 'acceptingUndergrads',
      value: true,
      confidenceOverride: 0.7,
    },
    { ...base, field: 'lastObservedAt', value: new Date() },
  ];
}

// ---------------------------------------------------------------------------
// Scraper class
// ---------------------------------------------------------------------------

/** Hooks injectable for testing. Production defaults talk to CourseTable + Mongo. */
export interface IndependentStudyScraperDeps {
  fetchSeason?: (season: string) => Promise<CourseTableCourse[]>;
  getSeasons?: () => string[];
  userFinder?: (filter: Record<string, unknown>) => Promise<UserMatch[]>;
  ownerToGroupSlug?: (owner: UserMatch) => Promise<string | null>;
}

async function defaultOwnerToGroupSlug(owner: UserMatch): Promise<string | null> {
  try {
    const { group } = await findOrCreateForOwner({
      _id: owner._id,
      netid: owner.netid,
      fname: owner.fname,
      lname: owner.lname,
      primary_department: owner.primary_department,
    });
    return group?.slug || null;
  } catch {
    return null;
  }
}

export class IndependentStudyCourseScraper implements IScraper {
  readonly name = 'yale-course-catalog';
  readonly displayName = 'Yale course catalog (independent study)';

  private readonly fetchSeason: (season: string) => Promise<CourseTableCourse[]>;
  private readonly getSeasons: () => string[];
  private readonly userFinder: (
    filter: Record<string, unknown>,
  ) => Promise<UserMatch[]>;
  private readonly ownerToGroupSlug: (owner: UserMatch) => Promise<string | null>;

  constructor(deps: IndependentStudyScraperDeps = {}) {
    this.fetchSeason = deps.fetchSeason ?? fetchAllSeasonCourses;
    this.getSeasons = deps.getSeasons ?? getRecentSeasonCodes;
    this.userFinder = deps.userFinder ?? defaultUserFinder;
    this.ownerToGroupSlug = deps.ownerToGroupSlug ?? defaultOwnerToGroupSlug;
  }

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    const seasons = this.getSeasons();
    ctx.log(`Fetching CourseTable for seasons: ${seasons.join(', ')}`);

    const allIndepCourses: CourseTableCourse[] = [];
    for (const season of seasons) {
      let seasonCourses: CourseTableCourse[];
      try {
        seasonCourses = await this.fetchSeason(season);
      } catch (err: any) {
        ctx.log(
          `[${season}] fetch failed: ${err?.message || err}; degrading gracefully`,
        );
        continue;
      }
      const indep = seasonCourses.filter((c) =>
        isIndependentStudyCourse(c.course_code, c.title),
      );
      ctx.log(
        `[${season}] ${seasonCourses.length} courses → ${indep.length} independent study`,
      );
      allIndepCourses.push(...indep);
    }

    if (allIndepCourses.length === 0) {
      ctx.log(
        'No independent-study courses found (CourseTable unreachable or empty); returning zero observations.',
      );
      return {
        observationCount: 0,
        entitiesObserved: 0,
        notes: 'No independent-study courses found',
      };
    }

    const byInstructor = groupCoursesByInstructor(allIndepCourses);
    ctx.log(
      `Grouped ${allIndepCourses.length} indep-study offerings by ${byInstructor.size} unique instructors`,
    );

    const limit =
      ctx.options.limit && ctx.options.limit > 0 ? ctx.options.limit : Infinity;

    let totalObs = 0;
    let matchedFaculty = 0;
    let unmatched = 0;

    for (const [instructorName, courses] of byInstructor) {
      if (matchedFaculty >= limit) break;

      let user: UserMatch | null;
      try {
        user = await findUserForInstructor(instructorName, this.userFinder);
      } catch (err: any) {
        ctx.log(
          `lookup failed for "${instructorName}": ${err?.message || err}; skipping`,
        );
        continue;
      }
      if (!user) {
        unmatched++;
        continue;
      }

      const slug = await this.ownerToGroupSlug(user);
      if (!slug) {
        ctx.log(
          `could not resolve research-group slug for ${user.netid}; skipping`,
        );
        continue;
      }

      const obs = buildObservationsForFaculty(slug, courses);
      await ctx.emit(obs);
      totalObs += obs.length;
      matchedFaculty++;
    }

    ctx.log(
      `Done. Matched ${matchedFaculty} faculty, unmatched ${unmatched}, emitted ${totalObs} observations.`,
    );

    return {
      observationCount: totalObs,
      entitiesObserved: matchedFaculty,
      notes: `${matchedFaculty} faculty offering independent study; ${unmatched} instructors unmatched against User collection`,
    };
  }
}
