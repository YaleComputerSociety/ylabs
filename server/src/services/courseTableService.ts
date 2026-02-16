/**
 * CourseTable integration service.
 * Fetches course data via the public CourseTable REST API.
 * Caches results for 1 hour to avoid excessive API calls.
 */

interface CourseTableCourse {
  course_code: string;
  title: string;
  season_code: string;
  description?: string;
  credits?: number;
  areas?: string[];
  skills?: string[];
  professor_names: string[];
}

const cache = new Map<
  string,
  { data: CourseTableCourse[]; timestamp: number }
>();
const CACHE_TTL = 60 * 60 * 1000;

const COURSETABLE_API = "https://coursetable.com/api/catalog/public";

/**
 * Get recent season codes (last 3 semesters).
 * Season code format: YYYYSS where SS is 01=Spring, 03=Fall
 */
function getRecentSeasonCodes(): string[] {
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
 * Fetch course data for a professor from CourseTable's public API.
 * Returns null if the API is unreachable or no data is found.
 */
export async function fetchCourseTableData(
  professorName: string
): Promise<CourseTableCourse[] | null> {
  if (!professorName || professorName === "NA NA") return null;

  const cacheKey = professorName.toLowerCase();
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

      const response = await fetch(`${COURSETABLE_API}/${season}`, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });

      clearTimeout(timeout);

      if (!response.ok) continue;

      const data = await response.json();

      if (!Array.isArray(data)) continue;

      const nameParts = professorName.toLowerCase().split(" ");
      const lastName = nameParts[nameParts.length - 1];

      for (const course of data) {
        const profs = course.course_professors || [];
        const match = profs.some((p: any) => {
          const pName = (p.professor_name || "").toLowerCase();
          return pName.includes(lastName);
        });

        if (match) {
          const listings = course.listings || [];
          const courseCode =
            listings.length > 0
              ? `${listings[0].subject} ${listings[0].number}`
              : course.course_code || "";

          allCourses.push({
            course_code: courseCode,
            title: course.title || "",
            season_code: season,
            description: course.description || "",
            credits: course.credits,
            areas: course.areas ? course.areas.split("") : [],
            skills: course.skills ? course.skills.split("") : [],
            professor_names: profs.map(
              (p: any) => p.professor_name || ""
            ),
          });
        }
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        console.error(
          `CourseTable: Failed to fetch season ${season}:`,
          err.message
        );
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
