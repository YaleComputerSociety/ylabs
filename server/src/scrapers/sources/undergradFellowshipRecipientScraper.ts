/**
 * UndergradFellowshipRecipientScraper
 *
 * Reverse-looks-up Yale faculty who have actually mentored undergraduate
 * researchers by harvesting publicly published recipient lists for each of the
 * major Yale undergrad research fellowship programs (STARS, Dean's Research,
 * Tetelman, Mellon Mays, etc.).
 *
 * Each {student, program, year, advisor} pair feeds the matched advisor's
 * ResearchGroup as a `pastUndergradAdvisees` entry. The pure presence of even
 * one prior advisee is a strong "this lab actually takes undergrads" signal —
 * stronger than course-listing inference — so we set
 * `acceptingUndergrads=true` with a relatively high confidence override (0.8).
 *
 * Strategy:
 *   1. For each per-program config:
 *        a. fetch each configured URL
 *        b. run the per-program extractor (HTML → recipient[])
 *   2. Aggregate recipients by canonical advisor name. Each advisor accumulates
 *      a `pastUndergradAdvisees` array with one entry per (program, year)
 *      observation. Multiple students under the same (program, year) collapse
 *      via a `count` field rather than producing duplicate rows.
 *   3. For each aggregated advisor:
 *        a. resolve to a Yale User (lname + fname → lname + first initial → none).
 *           Unmatched advisors are logged and skipped — we deliberately do NOT
 *           create synthetic User records for advisors we can't disambiguate
 *           (those would pollute the User collection with low-quality stubs).
 *        b. resolve to a ResearchGroup via `findOrCreateForOwner` (the same
 *           helper Listing-creation uses), then emit observations against the
 *           returned slug. This guarantees the past-advisee history lands on
 *           the canonical group, not a synthetic key.
 *   4. Emit ResearchGroup observations:
 *        - `pastUndergradAdvisees`: FULL aggregated array for the PI on every
 *          run. The resolver picks the highest-confidence (most recent) value
 *          per field rather than trying to merge partial arrays.
 *        - `acceptingUndergrads = true` (confidenceOverride 0.8 — strong
 *          evidence; they actually mentored an undergrad, not just listed a
 *          course)
 *        - `lastObservedAt = now`
 *
 * Honors:
 *   - ctx.options.useCache — caches each fetched HTML page payload
 *   - ctx.options.limit — caps the number of recipients PROCESSED (not advisors
 *     emitted) so a smoke run with `--limit 50` exercises the full pipeline
 *     without producing 1000s of observations
 *   - ctx.options.only — filters to a subset of programKeys, e.g.
 *     `--only stars-ii,deans-research`
 *   - ctx.options.manualRecipientCsvDir — optional directory containing
 *     `<programKey>.csv` files for otherwise manual-upload-required programs
 *
 * Most Yale fellowship programs do NOT publish recipient lists in scrapable
 * HTML — they're either symposium PDFs (STARS II), hidden behind admin email
 * contact (Mellon Mays, Tetelman, Dean's Research), or not published at all.
 * Configs for those programs are stubbed with `manualUploadRequired=true` and
 * a clear error from their extractor; an admin can drop a CSV / hand-curated
 * recipient list into the system at a later stage. The scraper architecture is
 * built so adding a new program — when a list does become available — is a
 * single config-row change.
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs/promises';
import path from 'path';
import { User } from '../../models/user';
import { findOrCreateForOwner } from '../../services/researchGroupService';
import { normalizeOrcid } from '../../utils/orcid';
import { getCached, setCached } from '../snapshotCache';
import { normalizeName, slugify, splitName } from '../utils/scraperHelpers';
import type {
  IScraper,
  ObservationInput,
  ScraperContext,
  ScraperResult,
} from '../types';

const USER_AGENT = 'ylabs-scraper/1.0 (+https://yalelabs.io)';
const FETCH_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One {student, project, advisor, year} record extracted from a recipient list. */
export interface FellowshipRecipient {
  /** Student's full name as it appears on the recipient list (used only for logging). */
  studentName: string;
  /** Faculty advisor's full name as it appears on the recipient list. */
  advisorName: string;
  /** Advisor ORCID when an accepted manual row has already been reviewed. */
  advisorOrcid?: string;
  /** Project title as it appears on the recipient list, when available. */
  projectTitle?: string;
  /** Row-level source URL for manual accepted inputs, when available. */
  sourceUrl?: string;
  /** Optional source page or text block pointer for review traceability. */
  sourcePage?: string;
  /** Human review note retained from accepted-input CSVs. */
  reviewNote?: string;
  /** Year of the award (4-digit). Inferred from the listing or the URL. */
  year: number;
}

/** Context passed to per-program extractors for URL resolution + year inference. */
export interface ExtractorCtx {
  pageUrl: string;
  /** When the URL implies a single year (e.g. `/recipients/2024/`), the runner
   * pre-computes it and passes it down so the extractor doesn't have to repeat
   * the parse. Extractors are free to override per-row when the page itself
   * groups by year. */
  defaultYear?: number;
}

/** Pure HTML → recipient rows. No I/O. */
export type RecipientExtractor = (
  html: string,
  ctx: ExtractorCtx,
) => FellowshipRecipient[];

export interface ProgramConfig {
  programKey: string;
  programName: string;
  /** Each URL is fetched and run through the extractor. Use one URL per year
   * when the program publishes a separate page per year. */
  urls: string[];
  extractor: RecipientExtractor;
  /**
   * Set when the program does not publish a public, text-extractable recipient
   * list (symposium PDFs, gated pages, contact-only). The extractor in this
   * case throws a clear "manual upload required" error and the runner logs
   * `manual-upload-required` instead of attempting the fetch.
   */
  manualUploadRequired?: boolean;
  /** Reason string surfaced in the log line when manualUploadRequired=true. */
  skipReason?: string;
}

/** Aggregated advisee history for one advisor, ready to emit. */
export interface PastUndergradAdviseeEntry {
  year: number;
  programName: string;
  count: number;
}

/** Internal: result of aggregating recipients by advisor canonical name. */
export interface AdvisorAggregateRow {
  /** Canonical (normalized) advisor display name. */
  canonicalName: string;
  /** Advisor ORCID when present; takes precedence over name-based resolution. */
  advisorOrcid?: string;
  /** Original/raw name as it first appeared (for logging). */
  rawName: string;
  /** Full aggregated `pastUndergradAdvisees` array for this advisor. */
  advisees: PastUndergradAdviseeEntry[];
  /** Set of source URLs across this advisor's recipient rows (for traceability). */
  sourceUrls: Set<string>;
  /** Most recent year observed across this advisor's rows; used as lastObservedAt. */
  latestYear: number;
}

/** Lightweight User shape returned by the user-resolver. */
export interface UserMatch {
  _id: any;
  netid: string;
  fname: string;
  lname: string;
  primaryDepartment?: string;
  departments?: string[];
  secondaryDepartments?: string[];
  website?: string;
  profileUrls?: Record<string, unknown>;
  topics?: string[];
  researchInterests?: string[];
  bio?: string;
  orcid?: string;
}

// ---------------------------------------------------------------------------
// Per-program extractor stubs
//
// All active v1 programs require a manual upload: their recipient lists are either
// PDF-only (STARS II symposium booklets), behind an admin contact (Mellon Mays,
// Tetelman, Dean's Research), or simply never published. Each stub throws a
// clear, identical-shaped error so the
// orchestrator records `manual-upload-required` for that program and continues.
//
// The architecture keeps the per-program extractor as the single change-site:
// when a program publishes a real HTML list (or admin uploads a CSV), the stub
// is swapped for a pure parser without touching the orchestrator class.
// ---------------------------------------------------------------------------

/** Stub used by every config that's currently blocked behind a PDF/gate. */
export const manualUploadStub: RecipientExtractor = () => {
  throw new Error(
    'Recipient list not available as scrapable HTML — manual upload required',
  );
};

function parseCsvRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const next = input[i + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      row.push(cell.trim());
      cell = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i++;
      row.push(cell.trim());
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }

  row.push(cell.trim());
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}

function normalizedHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function valueFor(row: Record<string, string>, names: string[]): string {
  for (const name of names) {
    const value = row[normalizedHeader(name)];
    if (value) return value;
  }
  return '';
}

/**
 * Manual recipient CSV extractor for programs whose official pages are
 * PDF-only, gated, or published by an office as a spreadsheet.
 *
 * Required columns:
 *   - advisorName or advisor
 *   - year or awardYear, unless the URL provides a default year
 *
 * Optional columns:
 *   - studentName or student
 *   - projectTitle or project/title
 *   - advisorOrcid or orcid
 *   - sourceUrl
 *   - sourcePage
 *   - reviewNote
 */
export const manualRecipientCsvExtractor: RecipientExtractor = (csv, ctx) => {
  const rows = parseCsvRows(csv);
  if (rows.length < 2) return [];

  const headers = rows[0].map(normalizedHeader);
  const out: FellowshipRecipient[] = [];
  for (const cells of rows.slice(1)) {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = cells[index]?.trim() || '';
    });

    const advisorName = valueFor(record, ['advisorName', 'advisor', 'facultyAdvisor']);
    if (!advisorName) continue;

    const rawYear = valueFor(record, ['year', 'awardYear', 'fellowshipYear']);
    const parsedYear = rawYear ? parseInt(rawYear, 10) : undefined;
    const year = parsedYear && !Number.isNaN(parsedYear) ? parsedYear : ctx.defaultYear;
    if (!year) continue;

    out.push({
      studentName: valueFor(record, ['studentName', 'student', 'recipientName', 'recipient']),
      advisorName,
      advisorOrcid: normalizeOrcid(valueFor(record, ['advisorOrcid', 'orcid'])) || undefined,
      projectTitle:
        valueFor(record, ['projectTitle', 'project', 'title', 'researchTitle']) || undefined,
      sourceUrl: valueFor(record, ['sourceUrl', 'source', 'sourceLink', 'url']) || undefined,
      sourcePage: valueFor(record, ['sourcePage', 'page']) || undefined,
      reviewNote: valueFor(record, ['reviewNote', 'note', 'notes']) || undefined,
      year,
    });
  }
  return out;
};

/**
 * Generic "year-grouped Drupal recipient list" extractor.
 *
 * Parses pages whose recipient list is structured as repeated cards/rows like:
 *
 *   <div class="recipient-row" data-year="2024">
 *     <span class="recipient-name">Student Name</span>
 *     <span class="project-title">Project Title</span>
 *     <span class="advisor-name">Advisor Name</span>
 *   </div>
 *
 * — a shape that several Yale Drupal "fellowships and awards" pages have
 * adopted. When the row omits `data-year`, the extractor falls back to
 * `ctx.defaultYear` (inferred from the URL by the runner). Rows missing an
 * advisor name are skipped — without an advisor, there's nothing to attribute
 * the advisee to.
 *
 * Kept separate from the manual-upload stubs so we have a real, testable
 * extractor in the codebase the moment one of the live pages adopts this
 * structure (and so the test suite can exercise the full pipeline against
 * representative HTML).
 */
export const drupalRecipientRowExtractor: RecipientExtractor = (html, ctx) => {
  const $ = cheerio.load(html);
  const out: FellowshipRecipient[] = [];
  $('.recipient-row').each((_i, el) => {
    const row = $(el);
    const studentName = row.find('.recipient-name').first().text().trim();
    const advisorName = row.find('.advisor-name').first().text().trim();
    const projectTitle = row.find('.project-title').first().text().trim() || undefined;
    if (!advisorName) return;
    const yearAttr = row.attr('data-year');
    let year: number | undefined;
    if (yearAttr) {
      const parsed = parseInt(yearAttr, 10);
      if (!Number.isNaN(parsed)) year = parsed;
    }
    if (year === undefined) year = ctx.defaultYear;
    if (year === undefined) return; // can't attribute without a year
    out.push({
      studentName,
      advisorName,
      projectTitle,
      year,
    });
  });
  return out;
};

// ---------------------------------------------------------------------------
// Default config
// ---------------------------------------------------------------------------

export const DEFAULT_PROGRAM_CONFIGS: ProgramConfig[] = [
  {
    programKey: 'stars-ii',
    programName: 'STARS II (Science, Technology and Research Scholars)',
    // Symposium abstract booklets are published as PDFs for 2024/2025/etc.
    // Cheerio cannot parse PDFs; needs a separate text-extraction pipeline.
    urls: [
      'https://science.yalecollege.yale.edu/sites/default/files/files/2025%20STARS2%20Symposium.pdf',
      'https://science.yalecollege.yale.edu/sites/default/files/files/2024%20STARS2%20Symposium%20(1)%20(002).pdf',
    ],
    extractor: manualUploadStub,
    manualUploadRequired: true,
    skipReason: 'STARS II symposium abstracts published as PDF only',
  },
  {
    programKey: 'stars-summer',
    programName: 'STARS Summer Research Program',
    urls: [
      'https://science.yalecollege.yale.edu/stem-fellowships/funding-stem-opportunities-yale/stars/stars-summer-research-program',
    ],
    extractor: manualUploadStub,
    manualUploadRequired: true,
    skipReason:
      'STARS Summer recipient lists not publicly published; symposium booklets are PDFs',
  },
  {
    programKey: 'deans-research',
    programName: "Yale College Dean's Research Fellowship & Rosenfeld Science Scholars",
    urls: [
      'https://science.yalecollege.yale.edu/yale-undergraduate-research/fellowship-grants/yale-college-deans-research-fellowship',
    ],
    extractor: manualUploadStub,
    manualUploadRequired: true,
    skipReason:
      "Dean's Research / Rosenfeld recipient lists not published; contact program office",
  },
  {
    programKey: 'tetelman',
    programName: 'Alan S. Tetelman 1958 Fellowship for International Research in the Sciences',
    urls: [
      'https://science.yalecollege.yale.edu/yale-undergraduate-research/fellowship-grants/tetelman-fellowship-international-research-sciences',
    ],
    extractor: manualUploadStub,
    manualUploadRequired: true,
    skipReason:
      'Tetelman recipient list not publicly published; only sample destinations are listed',
  },
  {
    programKey: 'mellon-mays',
    programName: 'Mellon Mays Undergraduate Fellowship (Yale)',
    urls: [
      'https://college.yale.edu/life-at-yale/student-faculty-awards/mellon-mays-undergraduate-fellowship-program',
    ],
    extractor: manualUploadStub,
    manualUploadRequired: true,
    skipReason: 'Mellon Mays Yale fellow names not publicly published',
  },
];

// ---------------------------------------------------------------------------
// Pure helpers (no I/O, unit-testable)
// ---------------------------------------------------------------------------

/**
 * Pure: try to read a 4-digit year out of a URL like
 *   https://example/recipients/2024/   →  2024
 *   https://example/2025-stars-symposium.pdf  →  2025
 * Returns undefined when no plausible year is present.
 *
 * Plausible = 1980 ≤ year ≤ currentYear+1 to avoid matching e.g. ZIP codes.
 */
export function inferYearFromUrl(url: string): number | undefined {
  const matches = url.match(/(19[89]\d|20\d{2})/g);
  if (!matches || matches.length === 0) return undefined;
  const currentYear = new Date().getFullYear();
  // Prefer the LAST match (URLs typically end with `/2024/` rather than start with it).
  for (let i = matches.length - 1; i >= 0; i--) {
    const y = parseInt(matches[i], 10);
    if (y >= 1980 && y <= currentYear + 1) return y;
  }
  return undefined;
}

/**
 * Pure: collapse a heterogeneous recipient list into one row per advisor.
 *
 * Multiple students under the same (advisor, programName, year) collapse into
 * a single PastUndergradAdviseeEntry with `count` incremented. Different years
 * or different programs produce separate entries. The output array is sorted
 * by year descending so the most recent year is first — handy for downstream
 * "most recent advisee" displays.
 *
 * Source URLs are accumulated as a Set per advisor so the emit step can choose
 * a representative one (or surface them all as `sourceUrls`).
 */
export function aggregateAdviseesByAdvisor(
  recipients: FellowshipRecipient[],
  programName: string,
  sourceUrlByRecipient?: Map<FellowshipRecipient, string>,
): Map<string, AdvisorAggregateRow> {
  const out = new Map<string, AdvisorAggregateRow>();
  for (const r of recipients) {
    const cleaned = normalizeName(r.advisorName);
    const advisorOrcid = normalizeOrcid(r.advisorOrcid);
    if (!cleaned && !advisorOrcid) continue;
    const { last } = splitName(cleaned);
    if (!last && !advisorOrcid) continue;
    // Canonical key is the slugified normalized name — collapses
    // "Dr. Sandy Chang" and "Sandy Chang" into one row.
    const key = advisorOrcid ? `orcid:${advisorOrcid}` : slugify(cleaned);
    if (!key) continue;

    const existing =
      out.get(key) ||
      ({
        canonicalName: cleaned || advisorOrcid,
        advisorOrcid: advisorOrcid || undefined,
        rawName: r.advisorName,
        advisees: [] as PastUndergradAdviseeEntry[],
        sourceUrls: new Set<string>(),
        latestYear: 0,
      } satisfies AdvisorAggregateRow);

    // Merge into the right (year, programName) bucket.
    const bucket = existing.advisees.find(
      (a) => a.year === r.year && a.programName === programName,
    );
    if (bucket) {
      bucket.count += 1;
    } else {
      existing.advisees.push({
        year: r.year,
        programName,
        count: 1,
      });
    }
    existing.latestYear = Math.max(existing.latestYear, r.year);

    const url = r.sourceUrl || sourceUrlByRecipient?.get(r);
    if (url) existing.sourceUrls.add(url);

    out.set(key, existing);
  }
  // Sort each advisor's advisees by year desc.
  for (const row of out.values()) {
    row.advisees.sort((a, b) => b.year - a.year);
  }
  return out;
}

/**
 * Look up the Yale User most likely to be `advisorName`.
 *
 * Strategy (in order, return on first hit):
 *   1. Exact case-insensitive match on lname AND fname.
 *   2. lname + first-initial of fname (handles "S. Chang" / "Sandy" vs "Sanford").
 *   3. lname only — but only if exactly one faculty user has that lname.
 *
 * The DB query is exposed via the `userFinder` parameter so tests can inject a
 * mock without touching mongoose. Faculty types include `admin` because some
 * Yale faculty also serve as deans/admins in the User collection.
 */
export async function findUserForAdvisor(
  advisorName: string,
  userFinder: (filter: Record<string, unknown>) => Promise<UserMatch[]> = defaultUserFinder,
): Promise<UserMatch | null> {
  const cleaned = normalizeName(advisorName);
  const { first, last } = splitName(cleaned);
  if (!last) return null;

  const lnameRe = new RegExp(`^${escapeRegex(last)}$`, 'i');
  const facultyTypes = { $in: ['professor', 'faculty', 'admin'] };

  if (first) {
    const fnameRe = new RegExp(`^${escapeRegex(first)}$`, 'i');
    const exact = await userFinder({
      lname: lnameRe,
      fname: fnameRe,
      userType: facultyTypes,
    });
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) return exact[0]; // ambiguous — take first deterministic hit

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

export async function findUserForAdvisorOrcid(
  advisorOrcid: string,
  userFinder: (filter: Record<string, unknown>) => Promise<UserMatch[]> = defaultUserFinder,
): Promise<UserMatch | null> {
  const cleaned = normalizeOrcid(advisorOrcid);
  if (!cleaned) return null;
  const matches = await userFinder({
    orcid: cleaned,
    userType: { $in: ['professor', 'faculty', 'admin'] },
  });
  return matches.length === 1 ? matches[0] : null;
}

async function findUserForAdvisorRow(
  row: AdvisorAggregateRow,
  userFinder: (filter: Record<string, unknown>) => Promise<UserMatch[]>,
): Promise<UserMatch | null> {
  if (row.advisorOrcid) {
    return findUserForAdvisorOrcid(row.advisorOrcid, userFinder);
  }
  return findUserForAdvisor(row.canonicalName, userFinder);
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
    primaryDepartment: 1,
    departments: 1,
    secondaryDepartments: 1,
    website: 1,
    profileUrls: 1,
    topics: 1,
    researchInterests: 1,
    bio: 1,
    orcid: 1,
  })
    .limit(10)
    .lean();
  return (docs as any[]).map((d) => ({
    _id: d._id,
    netid: d.netid,
    fname: d.fname,
    lname: d.lname,
    primaryDepartment: d.primaryDepartment,
    departments: d.departments,
    secondaryDepartments: d.secondaryDepartments,
    website: d.website,
    profileUrls: d.profileUrls,
    topics: d.topics,
    researchInterests: d.researchInterests,
    bio: d.bio,
    orcid: d.orcid,
  }));
}

/**
 * Default group-slug resolver: hits Mongo via `findOrCreateForOwner`, the same
 * canonical helper Listing-creation uses. Returns the resulting ResearchGroup's
 * `slug`, or null on failure (don't surface the error — the caller logs and
 * moves on so one bad row can't kill the run).
 */
async function defaultOwnerToGroupSlug(owner: UserMatch): Promise<string | null> {
  try {
    const { group } = await findOrCreateForOwner({
      _id: owner._id,
      netid: owner.netid,
      fname: owner.fname,
      lname: owner.lname,
      primaryDepartment: owner.primaryDepartment,
      departments: owner.departments,
      secondaryDepartments: owner.secondaryDepartments,
      website: owner.website,
      profileUrls: owner.profileUrls,
      topics: owner.topics,
      researchInterests: owner.researchInterests,
      bio: owner.bio,
    });
    return group?.slug || null;
  } catch {
    const fullName = `${owner.fname || ''} ${owner.lname || ''}`.trim();
    const nameSlug = slugify(fullName || owner.netid || 'advisor');
    const netidSlug = slugify(owner.netid || '');
    return netidSlug ? `${nameSlug}-${netidSlug}` : nameSlug;
  }
}

/**
 * Pure: build the ResearchGroup observation list for one matched advisor.
 *
 * Emits the FULL aggregated `pastUndergradAdvisees` array on each pass. The
 * resolver picks the highest-confidence value per field rather than trying to
 * merge partial arrays from successive runs — this keeps the materialized lab
 * record consistent even if a single run only sees a subset of programs.
 *
 * `acceptingUndergrads=true` carries a 0.8 confidence override because
 * mentoring an undergrad on a *named, dollar-backed fellowship* is far stronger
 * evidence than (e.g.) listing an independent-study course at 0.7.
 */
export function buildObservationsForAdvisor(
  groupSlug: string,
  advisees: PastUndergradAdviseeEntry[],
  sourceUrl: string,
): ObservationInput[] {
  const base = {
    entityType: 'researchEntity' as const,
    entityKey: groupSlug,
    sourceUrl,
  };
  return [
    { ...base, field: 'pastUndergradAdvisees', value: advisees },
    {
      ...base,
      field: 'acceptingUndergrads',
      value: true,
      confidenceOverride: 0.8,
    },
    { ...base, field: 'lastObservedAt', value: new Date() },
  ];
}

// ---------------------------------------------------------------------------
// Internal: HTTP fetch with cache passthrough
// ---------------------------------------------------------------------------

async function fetchHtml(
  url: string,
  useCache: boolean,
  sourceName: string,
): Promise<string> {
  const cacheKey = `page:${url}`;
  if (useCache) {
    const cached = await getCached<string>(sourceName, cacheKey);
    if (cached) return cached;
  }
  const res = await axios.get(url, {
    timeout: FETCH_TIMEOUT_MS,
    headers: { 'User-Agent': USER_AGENT },
    maxRedirects: 5,
  });
  const html = res.data as string;
  if (useCache) await setCached(sourceName, cacheKey, html);
  return html;
}

// ---------------------------------------------------------------------------
// Scraper class
// ---------------------------------------------------------------------------

/** Hooks injectable for testing. Production defaults talk to HTTP + Mongo. */
export interface UndergradFellowshipScraperDeps {
  /** Override per-URL HTML fetching (tests inject canned bodies). */
  fetchPage?: (url: string, useCache: boolean) => Promise<string>;
  /** Override the User lookup (tests inject a Mongo-free mock). */
  userFinder?: (filter: Record<string, unknown>) => Promise<UserMatch[]>;
  /** Override the User → ResearchGroup slug resolver. */
  ownerToGroupSlug?: (owner: UserMatch) => Promise<string | null>;
}

export class UndergradFellowshipRecipientScraper implements IScraper {
  readonly name = 'undergrad-fellowships-recipients';
  readonly displayName = 'Yale undergrad fellowship recipient lists';

  private readonly fetchPage: (url: string, useCache: boolean) => Promise<string>;
  private readonly userFinder: (
    filter: Record<string, unknown>,
  ) => Promise<UserMatch[]>;
  private readonly ownerToGroupSlug: (owner: UserMatch) => Promise<string | null>;

  /**
   * Configs are injectable for testing; default to the v1 six-program set.
   * Most defaults are stubs (`manualUploadRequired=true`) — see file header.
   */
  constructor(
    private readonly configs: ProgramConfig[] = DEFAULT_PROGRAM_CONFIGS,
    deps: UndergradFellowshipScraperDeps = {},
  ) {
    const sourceName = this.name;
    this.fetchPage =
      deps.fetchPage ?? ((url, useCache) => fetchHtml(url, useCache, sourceName));
    this.userFinder = deps.userFinder ?? defaultUserFinder;
    this.ownerToGroupSlug = deps.ownerToGroupSlug ?? defaultOwnerToGroupSlug;
  }

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    const onlyFilter =
      ctx.options.only && ctx.options.only.length > 0
        ? new Set(ctx.options.only.map((s) => s.trim().toLowerCase()))
        : null;
    const recipientLimit =
      ctx.options.limit && ctx.options.limit > 0 ? ctx.options.limit : Infinity;

    let totalObs = 0;
    let totalAdvisorsEmitted = 0;
    let totalRecipientsProcessed = 0;
    let totalUnmatched = 0;
    const perProgram: Array<{ key: string; status: string; count: number }> = [];

    for (const config of this.configs) {
      if (onlyFilter && !onlyFilter.has(config.programKey.toLowerCase())) continue;
      if (totalRecipientsProcessed >= recipientLimit) break;

      let effectiveConfig = config;
      let manualCsvBody: string | null = null;
      if (config.manualUploadRequired && ctx.options.manualRecipientCsvDir) {
        const csvPath = path.resolve(
          ctx.options.manualRecipientCsvDir,
          `${config.programKey}.csv`,
        );
        try {
          manualCsvBody = await fs.readFile(csvPath, 'utf8');
          effectiveConfig = {
            ...config,
            manualUploadRequired: false,
            urls: [`manual://${config.programKey}.csv`],
            extractor: manualRecipientCsvExtractor,
          };
          ctx.log(`[${config.programKey}] using manual recipient CSV ${csvPath}`);
        } catch (err: any) {
          ctx.log(
            `[${config.programKey}] manual CSV not found/readable at ${csvPath}: ${err?.message || err}`,
          );
        }
      }

      if (effectiveConfig.manualUploadRequired) {
        ctx.log(
          `[${config.programKey}] skipped — ${config.skipReason || 'manual upload required'}`,
        );
        perProgram.push({
          key: config.programKey,
          status: 'manual-upload-required',
          count: 0,
        });
        continue;
      }

      // Fetch + extract per URL, accumulating recipients across the program's URLs.
      const recipients: FellowshipRecipient[] = [];
      const sourceByRecipient = new Map<FellowshipRecipient, string>();
      let representativeUrl = effectiveConfig.urls[0] || '';
      let extractFailed = false;

      for (const url of effectiveConfig.urls) {
        if (totalRecipientsProcessed + recipients.length >= recipientLimit) break;
        let html: string;
        try {
          html =
            manualCsvBody && url.startsWith('manual://')
              ? manualCsvBody
              : await this.fetchPage(url, ctx.options.useCache);
        } catch (err: any) {
          ctx.log(
            `[${config.programKey}] fetch failed for ${url}: ${err?.message || err}`,
          );
          continue;
        }
        const defaultYear = inferYearFromUrl(url);
        let pageRecipients: FellowshipRecipient[];
        try {
          pageRecipients = effectiveConfig.extractor(html, { pageUrl: url, defaultYear });
        } catch (err: any) {
          ctx.log(
            `[${config.programKey}] extractor error on ${url}: ${err?.message || err}`,
          );
          extractFailed = true;
          break;
        }
        for (const r of pageRecipients) {
          recipients.push(r);
          sourceByRecipient.set(r, r.sourceUrl || url);
        }
        if (!representativeUrl) representativeUrl = url;
      }

      if (extractFailed && recipients.length === 0) {
        perProgram.push({
          key: config.programKey,
          status: 'extractor-failed',
          count: 0,
        });
        continue;
      }
      if (recipients.length === 0) {
        ctx.log(`[${config.programKey}] 0 recipients found across ${effectiveConfig.urls.length} URL(s)`);
        perProgram.push({ key: config.programKey, status: 'empty', count: 0 });
        continue;
      }

      // Cap recipients processed across all programs.
      const remaining = recipientLimit - totalRecipientsProcessed;
      const trimmed = remaining < recipients.length ? recipients.slice(0, remaining) : recipients;
      totalRecipientsProcessed += trimmed.length;

      // Aggregate by canonical advisor name.
      const aggregated = aggregateAdviseesByAdvisor(
        trimmed,
        effectiveConfig.programName,
        sourceByRecipient,
      );

      let programAdvisorsEmitted = 0;
      let programUnmatched = 0;
      for (const [, row] of aggregated) {
        // Resolve advisor → User
        let user: UserMatch | null;
        try {
          user = await findUserForAdvisorRow(row, this.userFinder);
        } catch (err: any) {
          ctx.log(
            `[${config.programKey}] user lookup failed for "${row.rawName}": ${err?.message || err}`,
          );
          continue;
        }
        if (!user) {
          programUnmatched++;
          continue;
        }

        // Resolve User → ResearchGroup slug (via findOrCreateForOwner)
        const slug = await this.ownerToGroupSlug(user);
        if (!slug) {
          ctx.log(
            `[${config.programKey}] could not resolve research-group slug for ${user.netid || user.lname}; skipping`,
          );
          continue;
        }

        const sourceUrl =
          row.sourceUrls.values().next().value || representativeUrl || effectiveConfig.urls[0];
        const obs = buildObservationsForAdvisor(slug, row.advisees, sourceUrl);
        await ctx.emit(obs);
        totalObs += obs.length;
        programAdvisorsEmitted++;
      }

      totalAdvisorsEmitted += programAdvisorsEmitted;
      totalUnmatched += programUnmatched;

      ctx.log(
        `[${config.programKey}] ${trimmed.length} recipients → ${programAdvisorsEmitted} advisors emitted, ${programUnmatched} unmatched`,
      );
      perProgram.push({
        key: config.programKey,
        status: 'ok',
        count: programAdvisorsEmitted,
      });
    }

    const summary = perProgram
      .map((p) => `${p.key}=${p.status === 'ok' ? p.count : p.status}`)
      .join(', ');
    ctx.log(
      `Emitted ${totalObs} observations across ${totalAdvisorsEmitted} advisors (${totalRecipientsProcessed} recipients, ${totalUnmatched} unmatched). Programs: ${summary}`,
    );

    return {
      observationCount: totalObs,
      entitiesObserved: totalAdvisorsEmitted,
      notes: `Programs: ${summary}; ${totalUnmatched} unmatched advisor names skipped`,
    };
  }
}
