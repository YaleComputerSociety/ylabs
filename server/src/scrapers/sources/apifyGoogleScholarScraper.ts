/**
 * ApifyGoogleScholarScraper
 *
 * Pulls Google Scholar author profiles via the Apify platform's
 * `solidcode/google-scholar-scraper` actor. Targets the gap left by OpenAlex:
 * humanities + qualitative-social-science Yale faculty whose monograph- and
 * essay-heavy outputs are poorly indexed there but show up well on Scholar.
 *
 * Source choice: Google Scholar has no public API. Apify's hosted actor
 * handles the headless-browser scraping + IP rotation; we just POST a list of
 * Scholar author IDs and read back structured author profiles plus their
 * recent publications.
 *
 * Scoping (v1):
 *   - User.userType in ['professor', 'faculty']
 *   - User.googleScholarId is non-empty (no auto-discovery in v1; admins set
 *     this manually, or a future scraper will).
 *   - User.manuallyLockedFields does NOT include 'hIndex' (don't trample
 *     hand-curated values).
 *   - Optionally restrict to humanities/social-sciences departments by
 *     resolving Department rows whose `primaryCategory` is HUMANITIES_ARTS or
 *     SOCIAL_SCIENCES, then matching User.primaryDepartment against those
 *     names. This keeps the dollar spend focused on the cohort that needs
 *     enrichment most. The filter is best-effort — STEM faculty whose admin
 *     set their Scholar ID will still be enriched.
 *
 * For each returned author profile we emit:
 *   - User observations (entityKey = netid):
 *       googleScholarId, hIndex, imageUrl (only if existing is empty),
 *       topics, googleScholarMetricsUpdatedAt
 *   - Paper observations (entityKey = `gs:<authorId>:<paperHash>`):
 *       title, year, venue, citationCount, authors,
 *       yaleAuthorIds, yaleAuthorNetIds, sources=['google-scholar']
 *
 * Honors:
 *   - ctx.options.useCache: per-scholarId cache of the actor response.
 *   - ctx.options.limit: caps faculty processed.
 *
 * Failure modes:
 *   - APIFY_API_TOKEN missing → log + return zero observations (no throw).
 *   - Apify call errors → log, skip the affected batch, continue.
 *
 * Pricing: actor charges $4 / 1,000 results. A "result" is a single author
 * profile object (not per publication). 500 humanities faculty ≈ 500 results
 * ≈ $2.00. Run quarterly = ~$8/year for the full humanities cohort.
 *
 * Performance: the sync endpoint
 * (`/v2/acts/.../run-sync-get-dataset-items`) blocks until the run finishes;
 * very large batches can hit the Apify request timeout (~5 min). For larger
 * sweeps, switch to the async pattern: POST to `/v2/acts/.../runs` to start
 * the run, poll `/v2/actor-runs/<id>` until status is SUCCEEDED, then GET
 * `/v2/datasets/<defaultDatasetId>/items`. We use sync mode here because
 * batches of 10 finish in seconds.
 *
 * I/O is fully injectable (`callApify`, `userFinder`, `userModel`) so the
 * runtime can be exercised in tests without ever touching the network or DB.
 */
import axios from 'axios';
import crypto from 'crypto';
import { User } from '../../models/user';
import { Department, DepartmentCategory } from '../../models/department';
import { getCached, setCached } from '../snapshotCache';
import type {
  IScraper,
  ObservationInput,
  ScraperContext,
  ScraperResult,
} from '../types';

const USER_AGENT = 'ylabs-scraper/1.0 (+https://yalelabs.io)';
const APIFY_ACTOR_ID = 'solidcode~google-scholar-scraper';
const APIFY_SYNC_ENDPOINT = `https://api.apify.com/v2/acts/${APIFY_ACTOR_ID}/run-sync-get-dataset-items`;
const APIFY_TIMEOUT_MS = 5 * 60_000; // sync endpoint can run up to ~5 min
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_MAX_RESULTS_PER_AUTHOR = 200;
const SOURCE_KEY = 'apify-google-scholar';
export const PAPER_SOURCE_TAG = 'google-scholar';

/**
 * Department categories whose faculty are the core target cohort. Defined as
 * a constant array so the scraper and any callers (analytics, dashboards)
 * agree on what "humanities enrichment" means.
 */
export const TARGET_CATEGORIES: DepartmentCategory[] = [
  DepartmentCategory.HUMANITIES_ARTS,
  DepartmentCategory.SOCIAL_SCIENCES,
];

// ---------------------------------------------------------------------------
// Apify actor I/O types
// ---------------------------------------------------------------------------

export interface ApifyPublication {
  title?: string;
  authors?: string;
  venue?: string;
  year?: number | string;
  citationCount?: number;
  url?: string;
}

export interface ApifyAuthorProfile {
  recordType?: string;
  authorId?: string;
  name?: string;
  affiliation?: string;
  hIndex?: number;
  i10Index?: number;
  totalCitations?: number;
  citationHistogram?: Record<string, number>;
  interests?: string[];
  publications?: ApifyPublication[];
  coAuthors?: { name?: string; authorId?: string }[];
  homepageUrl?: string;
  profileImageUrl?: string;
}

export interface ApifyInput {
  authorIds: string[];
  maxResults: number;
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-testable, no I/O)
// ---------------------------------------------------------------------------

/**
 * Pure: build the JSON body the Apify actor expects.
 */
export function buildApifyInput(
  scholarIds: string[],
  maxResults: number = DEFAULT_MAX_RESULTS_PER_AUTHOR,
): ApifyInput {
  return {
    authorIds: scholarIds.filter((id) => typeof id === 'string' && id.trim() !== ''),
    maxResults,
  };
}

/**
 * Pure: Mongo query object for "users this scraper considers eligible". Kept
 * as a pure function so we can assert the shape in tests without hitting
 * Mongoose.
 *
 * `categoryDeptNames` is the resolved list of department `name` strings whose
 * `primaryCategory` falls in TARGET_CATEGORIES. When omitted (or empty), the
 * department filter is dropped — useful for tests and for a "first run /
 * everyone with a Scholar ID" sweep.
 */
export function eligibleFacultyQuery(categoryDeptNames?: string[]): Record<string, unknown> {
  const base: Record<string, unknown> = {
    userType: { $in: ['professor', 'faculty'] },
    googleScholarId: { $exists: true, $nin: [null, ''] },
    manuallyLockedFields: { $nin: ['hIndex'] },
  };
  if (categoryDeptNames && categoryDeptNames.length > 0) {
    base.$or = [
      { primaryDepartment: { $in: categoryDeptNames } },
      { secondaryDepartments: { $in: categoryDeptNames } },
      { departments: { $in: categoryDeptNames } },
    ];
  }
  return base;
}

/**
 * Pure: deterministic hash of a paper's title + year. Used as the entityKey
 * suffix so the same publication observed twice (from the same Scholar
 * profile in two runs) lands on the same Paper row.
 */
export function paperHash(title: string | undefined | null, year: number | undefined | null): string {
  const t = (title || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const y = year === undefined || year === null ? '' : String(year);
  return crypto.createHash('sha1').update(`${t}|${y}`).digest('hex').slice(0, 16);
}

/**
 * Pure: split an array into chunks of fixed size. We batch faculty IDs into
 * groups of 10 per Apify call to balance per-call latency vs total runs.
 */
export function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 0) throw new Error('chunk size must be positive');
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Coerce a possibly-string year into a number; returns undefined if not numeric. */
function coerceYear(v: number | string | undefined | null): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(String(v).match(/\d{4}/)?.[0] ?? NaN);
  return Number.isFinite(n) ? n : undefined;
}

/** Coerce a "First Last, Other Name" string into a string[] of authors. */
function splitAuthors(authors: string | undefined | null): string[] {
  if (!authors) return [];
  return String(authors)
    .split(/,| and /i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Inputs needed to map an author profile to observations. Kept as a
 * dedicated type so test fixtures stay small.
 */
export interface MapTargetUser {
  _id: string | { toString(): string };
  netid: string;
  /** Existing imageUrl on the user; used to suppress overwrite when set. */
  imageUrl?: string;
  /** Existing manually-locked fields; never overwrite a locked field. */
  manuallyLockedFields?: string[];
}

/**
 * Pure: turn one Apify author-profile record into the ObservationInput list
 * the materializer will consume.
 *
 * Rules:
 *   - User obs are keyed by `netid` (User entity's keyField).
 *   - hIndex is skipped if `manuallyLockedFields` includes 'hIndex' — the
 *     Mongo query already drops these users, but we belt-and-braces here
 *     since callers can pass any user.
 *   - imageUrl is only emitted when the existing user.imageUrl is empty
 *     (don't trample hand-uploaded headshots).
 *   - topics is emitted only when interests is a non-empty array.
 *   - Paper obs are keyed by `gs:<authorId>:<paperHash>` so re-runs are
 *     idempotent and the same paper from two Scholar profiles dedupes per
 *     authorId pair (which is the granularity Scholar exposes anyway).
 */
/**
 * Defense-in-depth: Scholar profiles must mention Yale in their affiliation,
 * OR the user must have manually locked their googleScholarId (admin override).
 * Catches the homonym case (e.g., the climate scientist David H. Bromwich at
 * Office of Polar Programs vs. the Yale English prof) even when the wrong ID
 * was somehow assigned upstream.
 */
export function profilePassesYaleAffiliationGuard(
  profile: ApifyAuthorProfile,
  user: MapTargetUser,
): boolean {
  if ((user.manuallyLockedFields || []).includes('googleScholarId')) return true;
  const aff = (profile.affiliation || '').toLowerCase();
  if (aff.includes('yale')) return true;
  return false;
}

export function mapAuthorProfileToObservations(
  profile: ApifyAuthorProfile,
  user: MapTargetUser,
  observedAt: Date = new Date(),
): ObservationInput[] {
  if (!profilePassesYaleAffiliationGuard(profile, user)) {
    return [];
  }
  const out: ObservationInput[] = [];
  const locked = new Set(user.manuallyLockedFields || []);
  const yaleUserId = typeof user._id === 'string' ? user._id : String(user._id);
  const sourceUrl = profile.authorId
    ? `https://scholar.google.com/citations?user=${profile.authorId}`
    : undefined;

  const userBase = {
    entityType: 'user' as const,
    entityKey: user.netid,
    sourceUrl,
  };

  // googleScholarId — record what we observed (matches what we queried with).
  if (profile.authorId) {
    out.push({ ...userBase, field: 'googleScholarId', value: profile.authorId });
  }

  // hIndex — skip if locked or not a number.
  if (typeof profile.hIndex === 'number' && Number.isFinite(profile.hIndex) && !locked.has('hIndex')) {
    out.push({ ...userBase, field: 'hIndex', value: profile.hIndex });
  }

  // imageUrl — only emit when user has no existing image. We never overwrite
  // a manually uploaded photo with Scholar's auto-generated thumbnail.
  if (
    profile.profileImageUrl &&
    typeof profile.profileImageUrl === 'string' &&
    !locked.has('imageUrl') &&
    !(user.imageUrl && user.imageUrl.trim() !== '')
  ) {
    out.push({ ...userBase, field: 'imageUrl', value: profile.profileImageUrl });
  }

  // topics — Scholar's "interests" field. Conservative: only when non-empty.
  if (Array.isArray(profile.interests) && profile.interests.length > 0 && !locked.has('topics')) {
    const cleaned = profile.interests.map((t) => String(t).trim()).filter((t) => t.length > 0);
    if (cleaned.length > 0) {
      out.push({ ...userBase, field: 'topics', value: cleaned });
    }
  }

  // Freshness clock — always emit when we got a profile back.
  out.push({ ...userBase, field: 'googleScholarMetricsUpdatedAt', value: observedAt });

  // Publications → Paper observations.
  const publications = Array.isArray(profile.publications) ? profile.publications : [];
  for (const pub of publications) {
    const title = pub.title ? String(pub.title).trim() : '';
    if (!title) continue;
    const year = coerceYear(pub.year);
    const entityKey = `gs:${profile.authorId || 'unknown'}:${paperHash(title, year)}`;
    const paperBase = {
      entityType: 'paper' as const,
      entityKey,
      sourceUrl,
    };
    out.push({ ...paperBase, field: 'title', value: title });
    if (year !== undefined) out.push({ ...paperBase, field: 'year', value: year });
    if (pub.venue) out.push({ ...paperBase, field: 'venue', value: String(pub.venue).trim() });
    if (typeof pub.citationCount === 'number' && Number.isFinite(pub.citationCount)) {
      out.push({ ...paperBase, field: 'citationCount', value: pub.citationCount });
    }
    const authors = splitAuthors(pub.authors);
    if (authors.length > 0) {
      out.push({ ...paperBase, field: 'authors', value: authors });
    }
    out.push({ ...paperBase, field: 'yaleAuthorIds', value: [yaleUserId] });
    out.push({ ...paperBase, field: 'yaleAuthorNetIds', value: [user.netid] });
    out.push({ ...paperBase, field: 'sources', value: [PAPER_SOURCE_TAG] });
  }

  return out;
}

// ---------------------------------------------------------------------------
// I/O hooks (default implementations)
// ---------------------------------------------------------------------------

/** Default Apify caller. Keeps things SDK-free (matches the LLM extractor's
 *  pattern of bypassing vendor SDKs). */
export type CallApifyFn = (input: {
  apiToken: string;
  body: ApifyInput;
}) => Promise<ApifyAuthorProfile[]>;

export const defaultCallApify: CallApifyFn = async ({ apiToken, body }) => {
  const res = await axios.post(APIFY_SYNC_ENDPOINT, body, {
    params: { token: apiToken },
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
    },
    timeout: APIFY_TIMEOUT_MS,
    // Apify can return large arrays; let axios buffer the whole thing.
    maxContentLength: 50 * 1024 * 1024,
    maxBodyLength: 50 * 1024 * 1024,
  });
  const data = res.data;
  if (!Array.isArray(data)) {
    throw new Error(`Apify response was not an array (got ${typeof data})`);
  }
  return data as ApifyAuthorProfile[];
};

/** Shape the scraper needs from each candidate user. Distinct from the
 *  Mongoose document so tests can inject plain objects. */
export interface CandidateFaculty {
  _id: string | { toString(): string };
  netid: string;
  fname?: string;
  lname?: string;
  googleScholarId: string;
  imageUrl?: string;
  manuallyLockedFields?: string[];
}

export type UserFinderFn = (
  query: Record<string, unknown>,
  limit?: number,
) => Promise<CandidateFaculty[]>;

/** Default Mongo-backed user finder. */
export const defaultUserFinder: UserFinderFn = async (query, limit) => {
  let q = User.find(query, {
    _id: 1,
    netid: 1,
    fname: 1,
    lname: 1,
    googleScholarId: 1,
    imageUrl: 1,
    manuallyLockedFields: 1,
  }).lean();
  if (limit && limit > 0) q = q.limit(limit);
  const docs = (await q) as any[];
  return docs.map((d) => ({
    _id: d._id,
    netid: d.netid,
    fname: d.fname,
    lname: d.lname,
    googleScholarId: d.googleScholarId,
    imageUrl: d.imageUrl,
    manuallyLockedFields: d.manuallyLockedFields || [],
  }));
};

/** Resolves Department names whose primaryCategory is one of TARGET_CATEGORIES.
 *  Returned strings are matched against User.primaryDepartment / departments
 *  / secondaryDepartments in eligibleFacultyQuery. */
export type DepartmentNameResolverFn = (categories: DepartmentCategory[]) => Promise<string[]>;

export const defaultDepartmentNameResolver: DepartmentNameResolverFn = async (categories) => {
  const docs = await Department.find(
    { primaryCategory: { $in: categories } },
    { name: 1, displayName: 1, abbreviation: 1 },
  ).lean();
  const names = new Set<string>();
  for (const d of docs as any[]) {
    if (d.name) names.add(d.name);
    if (d.displayName) names.add(d.displayName);
    if (d.abbreviation) names.add(d.abbreviation);
  }
  return Array.from(names);
};

// ---------------------------------------------------------------------------
// Scraper class
// ---------------------------------------------------------------------------

export interface ApifyGoogleScholarScraperDeps {
  callApify?: CallApifyFn;
  userFinder?: UserFinderFn;
  departmentResolver?: DepartmentNameResolverFn;
  apiToken?: string;
  /** Override the batch size for tests. Defaults to 10. */
  batchSize?: number;
  /** Pass `false` to disable the humanities/social-sci department filter. */
  filterByCategory?: boolean;
  /** Override clock for deterministic observedAt in tests. */
  now?: () => Date;
}

export class ApifyGoogleScholarScraper implements IScraper {
  readonly name = 'apify-google-scholar';
  readonly displayName = 'Apify Google Scholar (humanities enrichment)';

  private readonly callApify: CallApifyFn;
  private readonly userFinder: UserFinderFn;
  private readonly departmentResolver: DepartmentNameResolverFn;
  private readonly apiToken: string | undefined;
  private readonly batchSize: number;
  private readonly filterByCategory: boolean;
  private readonly now: () => Date;

  constructor(deps: ApifyGoogleScholarScraperDeps = {}) {
    this.callApify = deps.callApify ?? defaultCallApify;
    this.userFinder = deps.userFinder ?? defaultUserFinder;
    this.departmentResolver = deps.departmentResolver ?? defaultDepartmentNameResolver;
    this.apiToken = deps.apiToken ?? process.env.APIFY_API_TOKEN;
    this.batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE;
    this.filterByCategory = deps.filterByCategory ?? true;
    this.now = deps.now ?? (() => new Date());
  }

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    if (!this.apiToken) {
      ctx.log(
        'APIFY_API_TOKEN missing — cannot call Apify; emitting zero observations.',
      );
      return {
        observationCount: 0,
        entitiesObserved: 0,
        notes: 'APIFY_API_TOKEN missing — skipping',
      };
    }

    // Resolve department names by category (best-effort). If this fails or
    // returns nothing, drop the filter rather than the whole run.
    let categoryDeptNames: string[] | undefined;
    if (this.filterByCategory) {
      try {
        const names = await this.departmentResolver(TARGET_CATEGORIES);
        if (names.length > 0) categoryDeptNames = names;
      } catch (err: any) {
        ctx.log(`departmentResolver failed (${err?.message || err}); skipping category filter.`);
      }
    }

    const query = eligibleFacultyQuery(categoryDeptNames);
    ctx.log(
      `Eligible-faculty query: ${JSON.stringify(query)} (limit=${ctx.options.limit ?? 'none'})`,
    );

    const faculty = await this.userFinder(query, ctx.options.limit);
    ctx.log(`Faculty eligible for Apify Scholar enrichment: ${faculty.length}`);

    if (faculty.length === 0) {
      return {
        observationCount: 0,
        entitiesObserved: 0,
        notes: 'No eligible faculty found',
      };
    }

    // Index by scholarId so we can pair returned profiles back to users.
    const byScholarId = new Map<string, CandidateFaculty>();
    for (const f of faculty) {
      if (f.googleScholarId) byScholarId.set(f.googleScholarId, f);
    }

    const batches = chunk(Array.from(byScholarId.keys()), this.batchSize);
    let totalObs = 0;
    let entitiesObserved = 0;
    let processedBatches = 0;
    let cacheHits = 0;
    let apifyCalls = 0;

    for (const batch of batches) {
      processedBatches++;

      // Per-scholarId cache: if every ID in the batch is cached, we can skip
      // the Apify call entirely. Otherwise we still call Apify for the full
      // batch (cheaper than splitting), and re-cache. This keeps reruns of
      // `--use-cache` runs free of charge.
      let profiles: ApifyAuthorProfile[] | null = null;
      if (ctx.options.useCache) {
        const cached: ApifyAuthorProfile[] = [];
        let allHit = true;
        for (const id of batch) {
          try {
            const c = await getCached<ApifyAuthorProfile>(SOURCE_KEY, `apify-gs:${id}`);
            if (c) cached.push(c);
            else {
              allHit = false;
              break;
            }
          } catch {
            allHit = false;
            break;
          }
        }
        if (allHit && cached.length === batch.length) {
          profiles = cached;
          cacheHits += batch.length;
        }
      }

      if (!profiles) {
        try {
          const body = buildApifyInput(batch);
          profiles = await this.callApify({ apiToken: this.apiToken!, body });
          apifyCalls++;
        } catch (err: any) {
          ctx.log(
            `Apify call failed for batch ${processedBatches}/${batches.length} (${batch.length} ids): ${err?.message || err}`,
          );
          continue;
        }
        if (ctx.options.useCache && profiles) {
          for (const p of profiles) {
            if (!p.authorId) continue;
            try {
              await setCached(SOURCE_KEY, `apify-gs:${p.authorId}`, p);
            } catch {
              /* ignore cache write failures */
            }
          }
        }
      }

      const observedAt = this.now();
      for (const profile of profiles) {
        if (profile.recordType && profile.recordType !== 'authorProfile') continue;
        if (!profile.authorId) continue;
        const user = byScholarId.get(profile.authorId);
        if (!user) {
          ctx.log(`Apify returned authorId ${profile.authorId} with no matching Yale user; skipping.`);
          continue;
        }
        const obs = mapAuthorProfileToObservations(profile, user, observedAt);
        if (obs.length > 0) {
          await ctx.emit(obs);
          totalObs += obs.length;
          entitiesObserved++;
        }
      }

      ctx.log(
        `progress: batch ${processedBatches}/${batches.length} | ${entitiesObserved} authors observed | ${totalObs} obs | ${apifyCalls} apify calls | ${cacheHits} cache hits`,
      );
    }

    return {
      observationCount: totalObs,
      entitiesObserved,
      notes: `Apify Scholar enrichment for ${entitiesObserved}/${faculty.length} faculty (${apifyCalls} actor calls, ${cacheHits} cached)`,
    };
  }
}
