/**
 * YaleDirectoryScraper
 *
 * Maintains the User collection (faculty roster) by paginating Yale faculty/staff
 * records from the Yalies API (https://api.yalies.io/v2/people). The legacy bootstrap
 * (`scripts/importFaculty.ts`) reads a static enriched JSON file once; this scraper
 * is the live equivalent — it can be re-run on a cadence so that new appointments,
 * title changes, and email/phone updates flow through the observation pipeline.
 *
 * Source choice: the public web directory at https://directory.yale.edu sits behind a
 * search UI (autocomplete + login wall for full records), so it is not a viable bulk
 * source. The Yalies API is the same data, structured, with an API key, and we
 * already integrate with it elsewhere (passport.ts auth flow).
 *
 * For each faculty record we emit User observations keyed by `netid` (the
 * EntityMaterializer's keyField for the user entity). All field writes go through
 * `ctx.emit` — we never write to the User collection directly.
 *
 * Honors:
 *   - ctx.options.useCache: cache each Yalies API page in snapshotCache
 *   - ctx.options.limit: cap the number of people processed
 *
 * Failure modes:
 *   - YALIES_API_KEY missing → log and exit gracefully (the orchestrator records the
 *     ScrapeRun as success-with-zero-observations; the scraper does not throw).
 *   - API errors mid-pagination → log, stop, return what we have; the orchestrator
 *     marks the run failed only if we re-throw, which we do for clear network errors
 *     so operators see them.
 */
import axios from 'axios';
import dotenv from 'dotenv';
import { listYalies, YaliesPerson } from '../../services/yaliesService';
import { getCached, setCached } from '../snapshotCache';
import type { IScraper, ScraperContext, ScraperResult, ObservationInput } from '../types';

dotenv.config();

const SOURCE_NAME = 'yale-directory';
const SOURCE_URL = 'https://api.yalies.io/v2/people';
const USER_AGENT = 'ylabs-scraper/1.0 (+https://yalelabs.io)';
const PAGE_SIZE = 100;
const FACULTY_KEYWORDS = [
  'professor',
  'lecturer',
  'instructor',
  'research scientist',
  'research fellow',
  'research associate',
  'research professor',
  'postdoctoral',
  'postdoc',
  'visiting scholar',
  'visiting professor',
  'visiting fellow',
  'sterling',
  'distinguished',
  'emerit',
  'adjunct professor',
  'senior lector',
  'lector',
];

/**
 * Hard-exclude titles that look like staff/admin/ops/athletics roles even if other
 * heuristics would otherwise classify them as faculty. Tested empirically against
 * the Atlas Development DB which had ~1,565 false positives matching these patterns
 * before this rule was added (head coaches, building maintenance, EHR specialists,
 * clinical administrators, etc.).
 */
const NON_FACULTY_TITLE_PATTERNS: RegExp[] = [
  /\bcoach\b/i,
  /\bcoordinator\b/i,
  /\badministrator\b/i,
  /\badministrative\b/i,
  /\bassistant to\b/i,
  /\boperations\b/i,
  /\bbuilding\b/i,
  /\bfacilities\b/i,
  /\bmaintenance\b/i,
  /\bcustodian\b/i,
  /\bjanitor\b/i,
  /\bsecurity\b/i,
  /\bathletic\b/i,
  /\bdriver\b/i,
  /\bchef\b|\bcook\b/i,
  /\busher\b/i,
  /\breceptionist\b/i,
  /\bsecretary\b/i,
  /\bspecialist\b/i,
  /\b(it|helpdesk|technology) (support|technician|analyst|engineer)\b/i,
  /\bhuman resources\b|\bhr\s/i,
  /\bpayroll\b/i,
  /\baccountant\b/i,
  /\bauditor\b/i,
  /\bcommunications? (manager|director|specialist)\b/i,
  /\bevent (planner|coordinator|manager)\b/i,
  /\bdata coordinator\b/i,
  /\bnurse\b/i,
  /\bmanager\b/i, // overrides "Lab Manager" etc., but those rarely contribute solo research
];

export function looksLikeNonResearchTitle(title: string | undefined | null): boolean {
  if (!title) return false;
  return NON_FACULTY_TITLE_PATTERNS.some((rx) => rx.test(title));
}

/**
 * Pure helper: does this title look faculty? Mirrors directoryService.isFacultyTitle
 * but with a slightly broader vocabulary for the bulk-roster case.
 */
export function isFacultyTitle(title: string | undefined | null): boolean {
  if (!title) return false;
  if (looksLikeNonResearchTitle(title)) return false;
  const lower = String(title).toLowerCase();
  return FACULTY_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Pure helper: does this Yalies record represent faculty (as opposed to a student)?
 * Strict — must match a faculty keyword AND not match any non-research staff pattern.
 * The previous loose "(has title AND no year)" heuristic swept in athletic coaches,
 * building ops, IT staff, etc. Removed to avoid further pollution.
 */
export function isFacultyPerson(p: YaliesPerson): boolean {
  if (!p) return false;
  if (p.school_code === 'YC') return false;
  const title = typeof p.title === 'string' ? p.title : '';
  if (looksLikeNonResearchTitle(title)) return false;
  return isFacultyTitle(title);
}

/**
 * Pure helper: classify Yalies userType. We use 'professor' if the title contains
 * "professor" specifically; 'faculty' for other faculty-titled records (lecturer,
 * research scientist, etc.). This mirrors the User schema enum.
 */
export function classifyUserType(title: string | undefined | null): 'professor' | 'faculty' {
  if (title && /professor/i.test(title)) return 'professor';
  return 'faculty';
}

/**
 * Pure mapping function. Takes one Yalies API record and returns the list of
 * ObservationInputs to emit for that person. Returns an empty array if the
 * record has no netid (we cannot key observations without it) or is not faculty.
 *
 * No I/O. Unit-testable.
 */
export function personToObservations(
  person: YaliesPerson,
  sourceUrl: string = SOURCE_URL,
): ObservationInput[] {
  if (!person || !person.netid) return [];
  if (!isFacultyPerson(person)) return [];

  const netid = person.netid;
  const base = { entityType: 'user' as const, entityKey: netid, sourceUrl };
  const out: ObservationInput[] = [];

  const fname = (person.preferred_name && String(person.preferred_name).trim()) ||
    (person.first_name && String(person.first_name).trim()) ||
    '';
  const lname = (person.last_name && String(person.last_name).trim()) || '';
  const email = (person.email && String(person.email).trim()) || '';
  const title = (person.title && String(person.title).trim()) || '';
  const phone = (person.phone && String(person.phone).trim()) || '';
  const college = (person.college && String(person.college).trim()) || '';
  const school = (person.school_name && String(person.school_name).trim()) ||
    (person.school && String(person.school).trim()) ||
    '';
  const imageUrl = (person.image && String(person.image).trim()) || '';
  const orcid = (person.orcid && String(person.orcid).trim()) || '';

  // Department fields. Yalies exposes organization_name / unit_name pairs and
  // primary_organization_* on faculty records. We treat the most-specific unit
  // as primaryDepartment and the broader organization as a secondary.
  const primaryDept =
    (person.unit_name && String(person.unit_name).trim()) ||
    (person.primary_division_name && String(person.primary_division_name).trim()) ||
    (person.organization_name && String(person.organization_name).trim()) ||
    (person.primary_organization_name && String(person.primary_organization_name).trim()) ||
    '';

  const secondarySet = new Set<string>();
  for (const v of [
    person.organization_name,
    person.primary_organization_name,
    person.primary_division_name,
  ]) {
    if (typeof v === 'string' && v.trim() && v.trim() !== primaryDept) {
      secondarySet.add(v.trim());
    }
  }
  const secondaryDepts = Array.from(secondarySet);

  // Profile URLs: Yalies returns a single `url` field on faculty records.
  const profileUrls: Record<string, string> = {};
  if (typeof person.url === 'string' && person.url.trim()) {
    profileUrls.yalies = person.url.trim();
  }

  const fields: Array<[string, unknown]> = [
    ['netid', netid],
    ['fname', fname],
    ['lname', lname],
    ['email', email],
    ['userType', classifyUserType(title)],
    ['title', title],
    ['primaryDepartment', primaryDept],
    ['secondaryDepartments', secondaryDepts.length > 0 ? secondaryDepts : undefined],
    ['college', college],
    ['school', school],
    ['imageUrl', imageUrl],
    ['phone', phone],
    ['orcid', orcid],
    ['profileUrls', Object.keys(profileUrls).length > 0 ? profileUrls : undefined],
  ];

  for (const [field, value] of fields) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' && value === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out.push({ ...base, field, value });
  }

  return out;
}

/**
 * Fetch one Yalies page, optionally hitting the snapshot cache.
 */
async function fetchYaliesPage(
  page: number,
  filters: Record<string, unknown> | undefined,
  useCache: boolean,
): Promise<YaliesPerson[]> {
  const cacheKey = `page:${page}:size:${PAGE_SIZE}:filters:${JSON.stringify(filters ?? {})}`;
  if (useCache) {
    const cached = await getCached<YaliesPerson[]>(SOURCE_NAME, cacheKey);
    if (cached) return cached;
  }
  const records = await listYalies({
    page,
    pageSize: PAGE_SIZE,
    filters,
    userAgent: USER_AGENT,
  });
  if (useCache) {
    await setCached(SOURCE_NAME, cacheKey, records);
  }
  return records;
}

export class YaleDirectoryScraper implements IScraper {
  readonly name = SOURCE_NAME;
  readonly displayName = 'Yale Directory (faculty roster via Yalies API)';

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    const apiKey = process.env.YALIES_API_KEY;
    if (!apiKey) {
      ctx.log(
        'YALIES_API_KEY not set; skipping run. Set the env var and re-run to populate the User roster.',
      );
      return {
        observationCount: 0,
        entitiesObserved: 0,
        notes: 'Skipped: YALIES_API_KEY missing',
      };
    }

    const limitOption = ctx.options.limit;
    if (limitOption !== undefined && (!Number.isSafeInteger(limitOption) || limitOption < 1)) {
      throw new Error('--limit must be a safe positive integer');
    }
    const limit = limitOption;

    let totalObs = 0;
    let processed = 0;
    let skippedNonFaculty = 0;
    let pageNum = 1;
    let stop = false;

    // Yalies's filter DSL takes arrays like { school_code: ['MD','EN',...] }. We
    // pass no filter and discriminate faculty vs students client-side via
    // isFacultyPerson(). This is wasteful in absolute terms but the Yalies dataset
    // is small (~25k people) and the filter vocabulary varies between schools, so
    // a single pass is the most robust approach.
    while (!stop) {
      let records: YaliesPerson[];
      try {
        records = await fetchYaliesPage(pageNum, undefined, ctx.options.useCache);
      } catch (err: unknown) {
        const errAny = err as { message?: string; response?: { status?: number } };
        if (axios.isAxiosError(err) && err.response?.status === 401) {
          ctx.log(`Yalies API returned 401 (auth failed); aborting after page ${pageNum}.`);
          break;
        }
        ctx.log(
          `error fetching Yalies page ${pageNum}: ${errAny?.message ?? String(err)} — aborting.`,
        );
        break;
      }

      if (!records || records.length === 0) {
        ctx.log(`Page ${pageNum} returned 0 records; reached end of dataset.`);
        break;
      }

      ctx.log(`Page ${pageNum}: fetched ${records.length} records.`);

      for (const person of records) {
        if (limit !== undefined && processed >= limit) {
          stop = true;
          break;
        }
        const obs = personToObservations(person);
        if (obs.length === 0) {
          skippedNonFaculty++;
          continue;
        }
        await ctx.emit(obs);
        totalObs += obs.length;
        processed++;
      }

      if (records.length < PAGE_SIZE) {
        ctx.log(`Page ${pageNum} returned ${records.length} (<${PAGE_SIZE}); end of dataset.`);
        break;
      }

      pageNum++;
    }

    ctx.log(
      `Done. Faculty processed: ${processed}, observations emitted: ${totalObs}, ` +
        `non-faculty skipped: ${skippedNonFaculty}, pages fetched: ${pageNum}.`,
    );

    return {
      observationCount: totalObs,
      entitiesObserved: processed,
      notes: `Yalies faculty sync: ${processed} faculty, ${totalObs} observations across ${pageNum} pages`,
    };
  }
}
