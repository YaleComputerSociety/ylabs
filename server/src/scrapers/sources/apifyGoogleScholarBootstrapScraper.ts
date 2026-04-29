/**
 * ApifyGoogleScholarBootstrapScraper
 *
 * Auto-discovers Google Scholar `authorId`s for Yale faculty so the existing
 * `ApifyGoogleScholarScraper` (which queries by ID) has IDs to work with.
 *
 * The hard problem: name collisions. Searching "David Bromwich" on Scholar
 * surfaces both the Yale English professor and a polar climate scientist. We
 * cannot just pick the first hit. This scraper applies a multi-signal scoring
 * function over candidate profiles and only auto-assigns when the result is
 * unambiguous; otherwise it emits low-confidence observations so an admin can
 * pick from the alternates in the resolver UI.
 *
 * Flow per faculty:
 *   1. Apify search-mode call: `<fname> <lname> Yale <primary_department>`.
 *      Aggregate distinct authorIds from the search results (top 5).
 *   2. Apify profile-mode call: pull the full profile for each candidate.
 *   3. Cross-reference each profile against:
 *        - Yale affiliation string (+ disqualify other-university affils)
 *        - @yale.edu verified email if Scholar exposes one
 *        - interest/department overlap
 *        - co-author overlap with known Yale faculty
 *        - paper-title overlap with the user's existing OpenAlex Papers
 *   4. Score, sort, apply pickWinner thresholds, emit observations.
 *
 * Emission rules:
 *   - Confident win  → emit googleScholarId at confidenceOverride 0.85
 *   - Ambiguous win  → emit winner at 0.3, alternates at 0.2
 *   - No winner      → emit nothing; note in result summary
 *
 * Honors:
 *   - ctx.options.useCache  per-netid cache of the search+profile payloads
 *   - ctx.options.limit     caps faculty processed
 *   - ctx.options.only      list of netids to restrict the run to
 *
 * Failure modes:
 *   - APIFY_API_TOKEN missing → log + return zero observations
 *   - Apify call errors per faculty → log, skip that faculty, continue
 *
 * Pricing: search call ~5 results + profile call ~5 profiles ≈ 10 results per
 * faculty ≈ $0.04 per faculty. 500 humanities faculty ≈ $20 one-time bootstrap.
 *
 * I/O is fully injectable so the runtime is exercised in tests without ever
 * touching the network or the database.
 */
import axios from 'axios';
import { User } from '../../models/user';
import { Paper } from '../../models/paper';
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
const APIFY_TIMEOUT_MS = 5 * 60_000;
const SOURCE_KEY = 'apify-google-scholar-bootstrap';

const DEFAULT_SEARCH_MAX_RESULTS = 10;
const DEFAULT_PROFILE_MAX_RESULTS = 50;
const MAX_CANDIDATES_PER_FACULTY = 5;
const MAX_OPENALEX_PAPERS_PER_USER = 20;

/** Confidence emitted when the scoring rule fires unambiguously. */
export const CONFIDENT_CONFIDENCE = 0.85;
/** Confidence emitted for the leading ambiguous candidate. */
export const AMBIGUOUS_WINNER_CONFIDENCE = 0.3;
/** Confidence emitted for runner-up alternates in an ambiguous result. */
export const ALTERNATE_CONFIDENCE = 0.2;

/** Score thresholds for the pickWinner decision rule. */
export const CONFIDENT_SCORE_THRESHOLD = 1.5;
export const SECOND_PLACE_AMBIGUITY_CEILING = 0.5;
export const MIN_AMBIGUOUS_SCORE = 0.5;

/** Department categories whose faculty most need bootstrap discovery. */
export const BOOTSTRAP_TARGET_CATEGORIES: DepartmentCategory[] = [
  DepartmentCategory.HUMANITIES_ARTS,
  DepartmentCategory.SOCIAL_SCIENCES,
];

/**
 * Major non-Yale universities whose presence in a candidate's affiliation is a
 * hard disqualifier. Lowercased for case-insensitive substring match. We bias
 * toward false negatives — better to miss a Yale-prof-recently-moved-from-X
 * than to assign a Harvard prof's Scholar ID to a Yale faculty.
 */
export const COMPETING_UNIVERSITY_KEYWORDS: string[] = [
  'harvard',
  'stanford',
  'mit',
  'massachusetts institute of technology',
  'princeton',
  'columbia',
  'oxford',
  'cambridge',
  'berkeley',
  'university of chicago',
  'cornell',
  'duke',
  'northwestern',
  'upenn',
  'university of pennsylvania',
  'johns hopkins',
  'caltech',
  'brown university',
  'dartmouth',
  'nyu',
  'new york university',
  'ucla',
  'university of california',
];

// ---------------------------------------------------------------------------
// Apify actor I/O types
// ---------------------------------------------------------------------------

/**
 * A single Scholar search-result row. The actor returns paper-shaped rows in
 * search mode; each `authors[]` entry may include an `authorId` link to a
 * Scholar profile we can later fetch in detail.
 */
export interface ApifySearchResultAuthor {
  name?: string;
  authorId?: string;
  profileUrl?: string;
}

export interface ApifySearchResult {
  recordType?: string;
  title?: string;
  authors?: ApifySearchResultAuthor[];
  year?: number | string;
  venue?: string;
}

/**
 * Profile-mode result. Mirrors the existing scraper's profile shape but
 * widened with `verifiedEmail` (Scholar sometimes exposes the verification
 * domain — `Verified email at yale.edu`).
 */
export interface ApifyProfileCoAuthor {
  name?: string;
  authorId?: string;
}

export interface ApifyProfilePublication {
  title?: string;
  authors?: string;
  year?: number | string;
  venue?: string;
  citationCount?: number;
}

export interface ApifyCandidateProfile {
  recordType?: string;
  authorId?: string;
  name?: string;
  affiliation?: string;
  verifiedEmail?: string;
  hIndex?: number;
  i10Index?: number;
  totalCitations?: number;
  interests?: string[];
  publications?: ApifyProfilePublication[];
  coAuthors?: ApifyProfileCoAuthor[];
  homepageUrl?: string;
  profileImageUrl?: string;
}

export interface ApifySearchInput {
  searchQueries: string[];
  maxResults: number;
}

export interface ApifyProfileInput {
  authorIds: string[];
  maxResults: number;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Pure: normalize a paper title for cross-source matching. Lowercase, strip
 *  non-alphanumerics, collapse whitespace, take first 60 chars. Two papers
 *  whose normalized titles match exactly are treated as the same paper. */
export function normalizeTitle(title: string | undefined | null): string {
  if (!title) return '';
  return String(title)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

/** Pure: build the search-mode query string for a given faculty member.
 *  We intentionally include "Yale" so the upstream search returns more
 *  Yale-relevant pages — the affiliation check still gates the final assignment. */
export function buildSearchQuery(user: { fname?: string; lname?: string; primary_department?: string }): string {
  const parts: string[] = [];
  if (user.fname) parts.push(user.fname.trim());
  if (user.lname) parts.push(user.lname.trim());
  parts.push('Yale');
  if (user.primary_department) parts.push(user.primary_department.trim());
  return parts.filter((p) => p.length > 0).join(' ');
}

/** Pure: case-insensitive substring containment check. */
function ciContains(haystack: string | undefined | null, needle: string): boolean {
  if (!haystack || !needle) return false;
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/**
 * Pure: aggregate distinct candidate authorIds from a search response. Caps at
 * `MAX_CANDIDATES_PER_FACULTY` so we don't blow up the profile-mode call cost.
 *
 * We preserve insertion order — the actor returns search results in
 * relevance-ish order, and seeing the most-cited paper first tends to surface
 * the canonical author profile.
 */
export function extractCandidateIds(
  results: ApifySearchResult[],
  cap: number = MAX_CANDIDATES_PER_FACULTY,
): string[] {
  const seen = new Set<string>();
  for (const row of results) {
    const authors = Array.isArray(row.authors) ? row.authors : [];
    for (const a of authors) {
      const id = (a.authorId || '').trim();
      if (!id) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      if (seen.size >= cap) return Array.from(seen);
    }
  }
  return Array.from(seen);
}

/** Inputs to score a candidate. Plain objects so test fixtures stay tiny. */
export interface ScoringUser {
  netid: string;
  fname?: string;
  lname?: string;
  primary_department?: string;
  h_index?: number;
}

export interface OpenAlexPaperLite {
  title?: string;
}

export interface ScoreResult {
  /** The numeric confidence score in roughly [-1, +3]. */
  score: number;
  /** Human-readable signal trail. Surfaced in the source URL for admin review. */
  signals: string[];
}

/**
 * Pure: score one Scholar candidate against a Yale faculty target.
 *
 * Weights (additive unless otherwise noted):
 *   +1.0  affiliation contains "yale"
 *   −1.0  affiliation contains another major university (hard disqualifier)
 *   +0.6  verified email at @yale.edu
 *   +0.4  interest overlaps with primary_department
 *   +0.3 per known Yale-faculty co-author (cap +0.6)
 *   +0.5 per paper-title overlap with the user's OpenAlex papers (cap +1.0)
 *   force −1.0 if candidate has totalCitations<5 AND user has h_index>10
 *
 * Notes:
 *   - The Yale-affiliation bonus and the competing-university penalty are both
 *     applied; an affiliation like "Visiting Scholar, Yale; previously Harvard"
 *     would net to 0, which correctly demotes it to ambiguous.
 *   - Co-author and paper-overlap caps prevent runaway scores from generic
 *     names with lots of common collaborators.
 */
export function scoreCandidate(
  profile: ApifyCandidateProfile,
  user: ScoringUser,
  openAlexPapers: OpenAlexPaperLite[] = [],
  knownYaleFacultyNames: Set<string> = new Set(),
): ScoreResult {
  const signals: string[] = [];
  let score = 0;
  const aff = profile.affiliation || '';

  // Yale affiliation — the dominant positive signal.
  if (ciContains(aff, 'yale')) {
    score += 1.0;
    signals.push('+1.0 affiliation:yale');
  }

  // Competing university — hard disqualifier.
  for (const u of COMPETING_UNIVERSITY_KEYWORDS) {
    if (ciContains(aff, u)) {
      score -= 1.0;
      signals.push(`-1.0 affiliation:${u}`);
      break; // Only penalize once even if multiple competing names appear.
    }
  }

  // Verified email at yale.edu.
  if (profile.verifiedEmail && /yale\.edu$/i.test(profile.verifiedEmail.trim())) {
    score += 0.6;
    signals.push('+0.6 verified-email:@yale.edu');
  }

  // Interests overlap with primary_department. Substring either direction.
  if (user.primary_department && Array.isArray(profile.interests)) {
    const dept = user.primary_department.toLowerCase();
    const hit = profile.interests.some((i) => {
      const n = String(i || '').toLowerCase();
      if (!n) return false;
      return n.includes(dept) || dept.includes(n);
    });
    if (hit) {
      score += 0.4;
      signals.push('+0.4 interest:dept-overlap');
    }
  }

  // Co-author overlap with known Yale faculty.
  if (Array.isArray(profile.coAuthors) && knownYaleFacultyNames.size > 0) {
    let coauthorBonus = 0;
    let coauthorMatches = 0;
    for (const ca of profile.coAuthors) {
      const name = (ca.name || '').trim().toLowerCase();
      if (!name) continue;
      if (knownYaleFacultyNames.has(name)) {
        coauthorMatches++;
        coauthorBonus += 0.3;
        if (coauthorBonus >= 0.6) {
          coauthorBonus = 0.6;
          break;
        }
      }
    }
    if (coauthorBonus > 0) {
      score += coauthorBonus;
      signals.push(`+${coauthorBonus.toFixed(1)} coauthors:${coauthorMatches}-yale-match`);
    }
  }

  // Paper-title overlap with the user's OpenAlex papers — the most decisive
  // signal because different people don't share authorship of the same paper.
  if (Array.isArray(profile.publications) && openAlexPapers.length > 0) {
    const oaTitles = new Set(
      openAlexPapers.map((p) => normalizeTitle(p.title)).filter((t) => t.length > 0),
    );
    let overlapBonus = 0;
    let overlapCount = 0;
    for (const pub of profile.publications) {
      const t = normalizeTitle(pub.title);
      if (!t) continue;
      if (oaTitles.has(t)) {
        overlapCount++;
        overlapBonus += 0.5;
        if (overlapBonus >= 1.0) {
          overlapBonus = 1.0;
          break;
        }
      }
    }
    if (overlapBonus > 0) {
      score += overlapBonus;
      signals.push(`+${overlapBonus.toFixed(1)} title-overlap:${overlapCount}`);
    }
  }

  // Floor on impossibility: candidate is too small to be the prolific user.
  if (
    typeof profile.totalCitations === 'number' &&
    profile.totalCitations < 5 &&
    typeof user.h_index === 'number' &&
    user.h_index > 10
  ) {
    score = -1.0;
    signals.push('floor:totalCitations<5 AND user.h_index>10 → -1.0');
  }

  return { score, signals };
}

/**
 * A scored candidate ready for the decision rule. We carry the full profile
 * along so the emission step can produce per-candidate observations and source
 * URLs without re-looking-up by ID.
 */
export interface ScoredCandidate {
  authorId: string;
  profile: ApifyCandidateProfile;
  score: number;
  signals: string[];
}

export interface PickWinnerResult {
  winner: ScoredCandidate | null;
  isConfident: boolean;
  /** Candidates surfaced to the resolver as alternates (excluding the winner). */
  alternates: ScoredCandidate[];
}

/**
 * Pure: apply the decision rule.
 *
 *   - Top score ≥ 1.5 AND (no second OR second < 0.5)  → confident win
 *   - Top score ≥ 0.5                                 → ambiguous win, top 3 alternates
 *   - Otherwise                                        → no winner
 */
export function pickWinner(candidates: ScoredCandidate[]): PickWinnerResult {
  if (!candidates || candidates.length === 0) {
    return { winner: null, isConfident: false, alternates: [] };
  }
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const top = sorted[0];
  const second = sorted[1];

  if (
    top.score >= CONFIDENT_SCORE_THRESHOLD &&
    (!second || second.score < SECOND_PLACE_AMBIGUITY_CEILING)
  ) {
    return { winner: top, isConfident: true, alternates: [] };
  }

  if (top.score >= MIN_AMBIGUOUS_SCORE) {
    // Top 3 candidates including the winner; emit alternates as the list
    // *excluding* the winner so callers don't double-emit it.
    const top3 = sorted.slice(0, 3);
    return {
      winner: top,
      isConfident: false,
      alternates: top3.slice(1),
    };
  }

  return { winner: null, isConfident: false, alternates: [] };
}

/**
 * Pure: build the set of "known Yale faculty names" used for co-author
 * matching. Names are lowercased and stripped to roughly match Scholar's
 * "First Last" formatting.
 */
export function gatherKnownYaleFaculty(
  faculty: { fname?: string; lname?: string }[],
): Set<string> {
  const out = new Set<string>();
  for (const f of faculty) {
    const fn = (f.fname || '').trim();
    const ln = (f.lname || '').trim();
    if (!fn || !ln) continue;
    out.add(`${fn} ${ln}`.toLowerCase());
  }
  return out;
}

/** Pure: build the source URL we attach to ambiguous-winner observations so an
 *  admin reviewing the resolver can click straight through to the candidate's
 *  Scholar profile. */
export function candidateProfileUrl(authorId: string): string {
  return `https://scholar.google.com/citations?user=${authorId}`;
}

// ---------------------------------------------------------------------------
// I/O hooks (default implementations)
// ---------------------------------------------------------------------------

/**
 * The actor accepts both `searchQueries` and `authorIds` payloads on the same
 * endpoint, so we use a single Apify caller and switch on input shape.
 */
export type CallApifyFn = (input: {
  apiToken: string;
  body: ApifySearchInput | ApifyProfileInput;
}) => Promise<unknown[]>;

export const defaultCallApify: CallApifyFn = async ({ apiToken, body }) => {
  const res = await axios.post(APIFY_SYNC_ENDPOINT, body, {
    params: { token: apiToken },
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
    },
    timeout: APIFY_TIMEOUT_MS,
    maxContentLength: 50 * 1024 * 1024,
    maxBodyLength: 50 * 1024 * 1024,
  });
  const data = res.data;
  if (!Array.isArray(data)) {
    throw new Error(`Apify response was not an array (got ${typeof data})`);
  }
  return data;
};

/** Lightweight projection of the User docs the bootstrap scraper considers. */
export interface BootstrapCandidateFaculty {
  _id: string | { toString(): string };
  netid: string;
  fname?: string;
  lname?: string;
  primary_department?: string;
  h_index?: number;
  openalex_id?: string;
  orcid?: string;
}

export type UserFinderFn = (
  query: Record<string, unknown>,
  limit?: number,
) => Promise<BootstrapCandidateFaculty[]>;

export const defaultUserFinder: UserFinderFn = async (query, limit) => {
  let q = User.find(query, {
    _id: 1,
    netid: 1,
    fname: 1,
    lname: 1,
    primary_department: 1,
    h_index: 1,
    openalex_id: 1,
    orcid: 1,
  }).lean();
  if (limit && limit > 0) q = q.limit(limit);
  const docs = (await q) as any[];
  return docs.map((d) => ({
    _id: d._id,
    netid: d.netid,
    fname: d.fname,
    lname: d.lname,
    primary_department: d.primary_department,
    h_index: d.h_index,
    openalex_id: d.openalex_id,
    orcid: d.orcid,
  }));
};

/** Returns recent OpenAlex papers we already have for a given faculty. Used to
 *  power the title-overlap signal — Scholar listing the same paper as our
 *  OpenAlex Paper for that user is conclusive. */
export type PaperFinderFn = (
  yaleAuthorId: string,
  limit?: number,
) => Promise<OpenAlexPaperLite[]>;

export const defaultPaperFinder: PaperFinderFn = async (yaleAuthorId, limit) => {
  const cap = limit ?? MAX_OPENALEX_PAPERS_PER_USER;
  const docs = (await Paper.find(
    { yaleAuthorIds: yaleAuthorId },
    { title: 1 },
  )
    .sort({ citationCount: -1 })
    .limit(cap)
    .lean()) as any[];
  return docs.map((d) => ({ title: d.title }));
};

/** Returns names of all professor/faculty in the User collection — used as the
 *  co-author-overlap reference set. Pulling this once per run avoids per-faculty
 *  DB roundtrips and is cheap (a few thousand rows of fname/lname). */
export type KnownYaleFacultyFinderFn = () => Promise<{ fname?: string; lname?: string }[]>;

export const defaultKnownYaleFacultyFinder: KnownYaleFacultyFinderFn = async () => {
  const docs = (await User.find(
    { userType: { $in: ['professor', 'faculty'] } },
    { fname: 1, lname: 1 },
  ).lean()) as any[];
  return docs.map((d) => ({ fname: d.fname, lname: d.lname }));
};

/** Resolves Department names whose primaryCategory is one of the bootstrap
 *  target categories. Same shape as the existing scraper's resolver. */
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

/**
 * Pure: Mongo query for "users this scraper considers eligible". Eligible
 * means: faculty/professor, no googleScholarId yet (we don't overwrite), and
 * — when the category filter is on — primary or secondary department falls in
 * the target categories.
 */
export function eligibleBootstrapFacultyQuery(
  categoryDeptNames?: string[],
  onlyNetids?: string[],
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    userType: { $in: ['professor', 'faculty'] },
    $or: [
      { googleScholarId: { $exists: false } },
      { googleScholarId: null },
      { googleScholarId: '' },
    ],
  };
  if (onlyNetids && onlyNetids.length > 0) {
    base.netid = { $in: onlyNetids };
  }
  if (categoryDeptNames && categoryDeptNames.length > 0) {
    base.$and = [
      {
        $or: [
          { primary_department: { $in: categoryDeptNames } },
          { secondary_departments: { $in: categoryDeptNames } },
          { departments: { $in: categoryDeptNames } },
        ],
      },
    ];
  }
  return base;
}

// ---------------------------------------------------------------------------
// Scraper class
// ---------------------------------------------------------------------------

export interface ApifyGoogleScholarBootstrapScraperDeps {
  callApify?: CallApifyFn;
  userFinder?: UserFinderFn;
  paperFinder?: PaperFinderFn;
  knownYaleFacultyFinder?: KnownYaleFacultyFinderFn;
  departmentResolver?: DepartmentNameResolverFn;
  apiToken?: string;
  /** Pass `false` to disable the humanities/social-sci department filter. */
  filterByCategory?: boolean;
  /** Override clock for deterministic observedAt in tests. */
  now?: () => Date;
  /** Override the cap on candidate IDs per faculty. Defaults to 5. */
  maxCandidatesPerFaculty?: number;
}

export class ApifyGoogleScholarBootstrapScraper implements IScraper {
  readonly name = 'apify-google-scholar-bootstrap';
  readonly displayName = 'Apify Google Scholar — bootstrap (discover IDs)';

  private readonly callApify: CallApifyFn;
  private readonly userFinder: UserFinderFn;
  private readonly paperFinder: PaperFinderFn;
  private readonly knownYaleFacultyFinder: KnownYaleFacultyFinderFn;
  private readonly departmentResolver: DepartmentNameResolverFn;
  private readonly apiToken: string | undefined;
  private readonly filterByCategory: boolean;
  private readonly now: () => Date;
  private readonly maxCandidatesPerFaculty: number;

  constructor(deps: ApifyGoogleScholarBootstrapScraperDeps = {}) {
    this.callApify = deps.callApify ?? defaultCallApify;
    this.userFinder = deps.userFinder ?? defaultUserFinder;
    this.paperFinder = deps.paperFinder ?? defaultPaperFinder;
    this.knownYaleFacultyFinder =
      deps.knownYaleFacultyFinder ?? defaultKnownYaleFacultyFinder;
    this.departmentResolver = deps.departmentResolver ?? defaultDepartmentNameResolver;
    this.apiToken = deps.apiToken ?? process.env.APIFY_API_TOKEN;
    this.filterByCategory = deps.filterByCategory ?? true;
    this.now = deps.now ?? (() => new Date());
    this.maxCandidatesPerFaculty =
      deps.maxCandidatesPerFaculty ?? MAX_CANDIDATES_PER_FACULTY;
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

    let categoryDeptNames: string[] | undefined;
    if (this.filterByCategory) {
      try {
        const names = await this.departmentResolver(BOOTSTRAP_TARGET_CATEGORIES);
        if (names.length > 0) categoryDeptNames = names;
      } catch (err: any) {
        ctx.log(
          `departmentResolver failed (${err?.message || err}); skipping category filter.`,
        );
      }
    }

    const query = eligibleBootstrapFacultyQuery(categoryDeptNames, ctx.options.only);
    ctx.log(
      `Eligible-faculty query: ${JSON.stringify(query)} (limit=${ctx.options.limit ?? 'none'})`,
    );

    const faculty = await this.userFinder(query, ctx.options.limit);
    ctx.log(`Faculty eligible for bootstrap discovery: ${faculty.length}`);

    if (faculty.length === 0) {
      return {
        observationCount: 0,
        entitiesObserved: 0,
        notes: 'No eligible faculty found',
      };
    }

    // Co-author reference set, pulled once.
    let knownYaleFacultyNames: Set<string>;
    try {
      const all = await this.knownYaleFacultyFinder();
      knownYaleFacultyNames = gatherKnownYaleFaculty(all);
    } catch (err: any) {
      ctx.log(
        `knownYaleFacultyFinder failed (${err?.message || err}); proceeding with empty set.`,
      );
      knownYaleFacultyNames = new Set();
    }

    let totalObs = 0;
    let entitiesObserved = 0;
    let confidentAssigns = 0;
    let ambiguousAssigns = 0;
    let noWinnerCount = 0;
    let apifyCalls = 0;
    let cacheHits = 0;
    let processed = 0;

    for (const user of faculty) {
      processed++;
      const cacheKey = `bootstrap:${user.netid}`;

      // Per-faculty cache: stores the {searchResults, profiles} payload so a
      // rerun with --use-cache replays the full Apify roundtrip for free.
      let cached:
        | { searchResults: ApifySearchResult[]; profiles: ApifyCandidateProfile[] }
        | null = null;
      if (ctx.options.useCache) {
        try {
          cached = await getCached(SOURCE_KEY, cacheKey);
        } catch {
          cached = null;
        }
      }

      let searchResults: ApifySearchResult[] = [];
      let profiles: ApifyCandidateProfile[] = [];

      if (cached) {
        searchResults = cached.searchResults || [];
        profiles = cached.profiles || [];
        cacheHits++;
      } else {
        // Step 1: search-mode call.
        try {
          const searchBody: ApifySearchInput = {
            searchQueries: [buildSearchQuery(user)],
            maxResults: DEFAULT_SEARCH_MAX_RESULTS,
          };
          const raw = await this.callApify({ apiToken: this.apiToken!, body: searchBody });
          searchResults = (raw as ApifySearchResult[]).filter(
            (r) => !r.recordType || r.recordType !== 'authorProfile',
          );
          apifyCalls++;
        } catch (err: any) {
          ctx.log(
            `[${user.netid}] search call failed: ${err?.message || err}; skipping faculty.`,
          );
          continue;
        }

        const candidateIds = extractCandidateIds(searchResults, this.maxCandidatesPerFaculty);
        if (candidateIds.length === 0) {
          ctx.log(`[${user.netid}] no candidate authorIds in search results; skipping.`);
          noWinnerCount++;
          continue;
        }

        // Step 2: profile-mode call for candidate IDs.
        try {
          const profileBody: ApifyProfileInput = {
            authorIds: candidateIds,
            maxResults: DEFAULT_PROFILE_MAX_RESULTS,
          };
          const raw = await this.callApify({ apiToken: this.apiToken!, body: profileBody });
          profiles = (raw as ApifyCandidateProfile[]).filter(
            (p) => p && p.authorId,
          );
          apifyCalls++;
        } catch (err: any) {
          ctx.log(
            `[${user.netid}] profile call failed: ${err?.message || err}; skipping faculty.`,
          );
          continue;
        }

        if (ctx.options.useCache) {
          try {
            await setCached(SOURCE_KEY, cacheKey, { searchResults, profiles });
          } catch {
            /* ignore cache write failures */
          }
        }
      }

      if (profiles.length === 0) {
        ctx.log(`[${user.netid}] zero profiles to score; skipping.`);
        noWinnerCount++;
        continue;
      }

      // Pull OpenAlex papers for the title-overlap signal.
      let openAlexPapers: OpenAlexPaperLite[] = [];
      try {
        const yaleId =
          typeof user._id === 'string' ? user._id : String(user._id);
        openAlexPapers = await this.paperFinder(yaleId);
      } catch (err: any) {
        ctx.log(
          `[${user.netid}] paperFinder failed (${err?.message || err}); proceeding without title-overlap signal.`,
        );
      }

      const scored: ScoredCandidate[] = profiles.map((p) => {
        const r = scoreCandidate(p, user, openAlexPapers, knownYaleFacultyNames);
        return {
          authorId: p.authorId!,
          profile: p,
          score: r.score,
          signals: r.signals,
        };
      });

      const decision = pickWinner(scored);

      if (decision.isConfident && decision.winner) {
        confidentAssigns++;
        const winner = decision.winner;
        const obs: ObservationInput = {
          entityType: 'user',
          entityKey: user.netid,
          field: 'googleScholarId',
          value: winner.authorId,
          sourceUrl: candidateProfileUrl(winner.authorId),
          observedAt: this.now(),
          confidenceOverride: CONFIDENT_CONFIDENCE,
        };
        await ctx.emit(obs);
        totalObs += 1;
        entitiesObserved++;
        ctx.log(
          `[${user.netid}] CONFIDENT → ${winner.authorId} (score ${winner.score.toFixed(2)}; ${winner.signals.join(', ')})`,
        );
      } else if (decision.winner) {
        ambiguousAssigns++;
        const winner = decision.winner;
        const observedAt = this.now();
        const winnerObs: ObservationInput = {
          entityType: 'user',
          entityKey: user.netid,
          field: 'googleScholarId',
          value: winner.authorId,
          sourceUrl: candidateProfileUrl(winner.authorId),
          observedAt,
          confidenceOverride: AMBIGUOUS_WINNER_CONFIDENCE,
        };
        const altObs: ObservationInput[] = decision.alternates.map((a) => ({
          entityType: 'user' as const,
          entityKey: user.netid,
          field: 'googleScholarId',
          value: a.authorId,
          sourceUrl: candidateProfileUrl(a.authorId),
          observedAt,
          confidenceOverride: ALTERNATE_CONFIDENCE,
        }));
        const all = [winnerObs, ...altObs];
        await ctx.emit(all);
        totalObs += all.length;
        entitiesObserved++;
        ctx.log(
          `[${user.netid}] AMBIGUOUS → top ${winner.authorId} (score ${winner.score.toFixed(2)}) + ${altObs.length} alternates`,
        );
      } else {
        noWinnerCount++;
        ctx.log(`[${user.netid}] NO-WINNER → all candidates scored below ${MIN_AMBIGUOUS_SCORE}`);
      }

      ctx.log(
        `progress: ${processed}/${faculty.length} | confident=${confidentAssigns} ambiguous=${ambiguousAssigns} no-winner=${noWinnerCount} | apify=${apifyCalls} cache=${cacheHits} obs=${totalObs}`,
      );
    }

    return {
      observationCount: totalObs,
      entitiesObserved,
      notes: `Bootstrap: ${confidentAssigns} confident, ${ambiguousAssigns} ambiguous, ${noWinnerCount} no-winner across ${faculty.length} faculty (${apifyCalls} apify calls, ${cacheHits} cache hits)`,
    };
  }
}
