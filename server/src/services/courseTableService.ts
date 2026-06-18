/**
 * CourseTable integration service.
 * Fetches course data via the public CourseTable REST API.
 * Caches results for 1 hour to avoid excessive API calls.
 */
import { sanitizeLogValue } from '../utils/logSanitizer';
import { redactDirectContactInfo } from '../utils/contactRedaction';

export interface CourseTableCourse {
  course_code: string;
  title: string;
  season_code: string;
  description?: string;
  credits?: number;
  areas?: string[];
  skills?: string[];
  professor_names: string[];
}

const cache = new Map<string, { data: CourseTableCourse[]; timestamp: number }>();
const CACHE_TTL = 60 * 60 * 1000;

const COURSETABLE_API = 'https://coursetable.com/api/catalog/public';
const COURSETABLE_SEASON_RE = /^\d{4}(?:01|03)$/;
const MAX_COURSETABLE_PROFESSOR_NAME_LENGTH = 120;
const MAX_COURSETABLE_PROFESSOR_LAST_NAME_LENGTH = 80;
const MAX_COURSETABLE_COURSES = 100;
const MAX_COURSETABLE_TEXT_LENGTH = 500;
const MAX_COURSETABLE_DESCRIPTION_LENGTH = 2000;
const MAX_COURSETABLE_ARRAY_ITEMS = 50;
const MAX_COURSETABLE_ARRAY_TEXT_LENGTH = 120;

const normalizeCourseTableSeason = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const season = value.trim();
  return COURSETABLE_SEASON_RE.test(season) ? season : undefined;
};

const normalizeCourseTableProfessorName = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const name = value.trim().replace(/\s+/g, ' ').slice(0, MAX_COURSETABLE_PROFESSOR_NAME_LENGTH);
  return name && name !== 'NA NA' ? name : undefined;
};

const publicCourseTableText = (value: unknown, maxLength = MAX_COURSETABLE_TEXT_LENGTH): string => {
  if (typeof value !== 'string') return '';
  return redactDirectContactInfo(value.trim().replace(/\s+/g, ' ')).slice(0, maxLength);
};

const publicCourseTableTextArray = (value: unknown): string[] => {
  const values = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split('')
      : [];
  return values
    .slice(0, MAX_COURSETABLE_ARRAY_ITEMS)
    .flatMap((item) => {
      const text = publicCourseTableText(item, MAX_COURSETABLE_ARRAY_TEXT_LENGTH);
      return text ? [text] : [];
    });
};

const publicCourseTableCredits = (value: unknown): number | undefined => {
  const credits = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(credits) || credits < 0 || credits > 20) return undefined;
  return credits;
};

const publicCourseTableCourse = (
  course: any,
  safeSeason: string,
  professorFilter?: string,
): CourseTableCourse | undefined => {
  const profs = Array.isArray(course.course_professors) ? course.course_professors : [];
  if (professorFilter) {
    const match = profs.some((p: any) => {
      const pName = publicCourseTableText(p?.professor_name).toLowerCase();
      return pName.includes(professorFilter);
    });
    if (!match) return undefined;
  }

  const listings = Array.isArray(course.listings) ? course.listings : [];
  const listing = listings[0] || {};
  const courseCode =
    listings.length > 0
      ? publicCourseTableText(`${listing.subject || ''} ${listing.number || ''}`)
      : publicCourseTableText(course.course_code);

  return {
    course_code: courseCode,
    title: publicCourseTableText(course.title),
    season_code: safeSeason,
    description: publicCourseTableText(course.description, MAX_COURSETABLE_DESCRIPTION_LENGTH),
    credits: publicCourseTableCredits(course.credits),
    areas: publicCourseTableTextArray(course.areas),
    skills: publicCourseTableTextArray(course.skills),
    professor_names: publicCourseTableTextArray(profs.map((p: any) => p?.professor_name)),
  };
};

/**
 * Get recent season codes (last 3 semesters).
 * Season code format: YYYYSS where SS is 01=Spring, 03=Fall
 */
export function getRecentSeasonCodes(): string[] {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  const seasons: string[] = [];

  if (month >= 8) {
    seasons.push(`${year}03`);
    seasons.push(`${year}01`);
    seasons.push(`${year - 1}03`);
  } else {
    seasons.push(`${year}01`);
    seasons.push(`${year - 1}03`);
    seasons.push(`${year - 1}01`);
  }

  return seasons;
}

/**
 * Fetch all catalog courses for one CourseTable season.
 * This is used by the independent-study scraper, which needs a season-wide
 * scan instead of a per-professor lookup.
 */
export async function fetchAllSeasonCourses(
  season: string,
): Promise<CourseTableCourse[]> {
  const safeSeason = normalizeCourseTableSeason(season);
  if (!safeSeason) return [];

  const cacheKey = `season:${safeSeason}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(`${COURSETABLE_API}/${safeSeason}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });

    clearTimeout(timeout);

    if (!response.ok) return [];

    const data = await response.json();
    if (!Array.isArray(data)) return [];

    const courses = data
      .slice(0, MAX_COURSETABLE_COURSES)
      .flatMap((course: any) => publicCourseTableCourse(course, safeSeason) ?? []);

    cache.set(cacheKey, { data: courses, timestamp: Date.now() });
    return courses;
  } catch (err: any) {
    if (err.name !== 'AbortError') {
      console.error('CourseTable: Failed to fetch season:', sanitizeLogValue(err));
    }
    return [];
  }
}

/**
 * Fetch course data for a professor from CourseTable's public API.
 * Returns null if the API is unreachable or no data is found.
 */
export async function fetchCourseTableData(
  professorName: string,
): Promise<CourseTableCourse[] | null> {
  const safeProfessorName = normalizeCourseTableProfessorName(professorName);
  if (!safeProfessorName) return null;

  const cacheKey = safeProfessorName.toLowerCase();
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  const seasonCodes = getRecentSeasonCodes();
  const allCourses: CourseTableCourse[] = [];

  for (const season of seasonCodes) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const safeSeason = normalizeCourseTableSeason(season);
      if (!safeSeason) continue;

      const response = await fetch(`${COURSETABLE_API}/${safeSeason}`, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });

      clearTimeout(timeout);

      if (!response.ok) continue;

      const data = await response.json();

      if (!Array.isArray(data)) continue;

      const nameParts = safeProfessorName.toLowerCase().split(' ');
      const lastName = (nameParts[nameParts.length - 1] || '').slice(
        0,
        MAX_COURSETABLE_PROFESSOR_LAST_NAME_LENGTH,
      );
      if (!lastName) continue;

      for (const course of data.slice(0, MAX_COURSETABLE_COURSES)) {
        const publicCourse = publicCourseTableCourse(course, safeSeason, lastName);
        if (publicCourse) allCourses.push(publicCourse);
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('CourseTable: Failed to fetch season:', sanitizeLogValue(err));
      }
    }
  }

  const seen = new Set<string>();
  const unique = allCourses.filter((c) => {
    const key = `${c.course_code}-${c.season_code}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  cache.set(cacheKey, { data: unique, timestamp: Date.now() });

  return unique.length > 0 ? unique : null;
}
