/**
 * UndergradFellowshipRecipientScraper
 *
 * Reverse-looks-up Yale faculty who have actually mentored undergraduate
 * researchers by harvesting publicly published recipient lists that name a
 * faculty mentor (STARS II symposium booklets).
 *
 * Each {student, program, year, advisor} pair feeds the matched advisor's
 * ResearchGroup as a `pastUndergradAdvisees` entry, which the access materializer
 * reads into the PAST_UNDERGRADS signal. Having mentored
 * a fellowship recipient is pathway-specific evidence, so this lane deliberately
 * asserts nothing about generic current openness.
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
 *        a. resolve to a canonical Researcher (lname + fname → lname + first initial → none).
 *           Unmatched advisors are logged and skipped — we deliberately do NOT
 *           create synthetic Researcher records for advisors we can't disambiguate
 *           (those would pollute the researcher collection with low-quality stubs).
 *        b. resolve to the advisor's EXISTING lead row (their own lab or faculty
 *           research profile before a facility or center they direct), then emit
 *           observations against its slug. No row is ever created here: an
 *           advisor with no lead row is logged as unmatched (#5048).
 *   4. Emit ResearchGroup observations:
 *        - `pastUndergradAdvisees`: FULL aggregated array for the PI on every
 *          run. The resolver picks the highest-confidence (most recent) value
 *          per field rather than trying to merge partial arrays.
 *        - `lastObservedAt = now`
 *
 * Honors:
 *   - ctx.options.useCache — caches each fetched HTML page payload
 *   - ctx.options.limit — caps the number of recipients PROCESSED (not advisors
 *     emitted) so a smoke run with `--limit 50` exercises the full pipeline
 *     without producing 1000s of observations
 *   - ctx.options.only — filters to a subset of programKeys, e.g.
 *     `--only stars-ii`
 *   - ctx.options.manualRecipientCsvDir — optional directory containing
 *     `<programKey>.csv` files for otherwise manual-upload-required programs.
 *     When no CSV is present, the scraper also looks for `<programKey>.pdf`
 *     in the accepted-input fellowship directory and extracts labelled rows.
 *
 * Most Yale fellowship programs do NOT publish recipient lists in scrapable
 * HTML. STARS II publishes symposium PDFs, so its config is stubbed with
 * `manualUploadRequired=true` and a clear error from its extractor; an admin
 * can drop a CSV, or a reviewed PDF with labelled recipient/advisor text, into
 * the system at a later stage. A program that publishes no recipient list
 * naming a mentor is not configured at all (docs/decisions.md, #5362).
 * The scraper architecture is
 * built so adding a new program — when a list does become available — is a
 * single config-row change.
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { Researcher } from '../../models/researcher';
import { resolveResearcherIdForPersonName } from '../../services/researcherPersonNameResolver';
import { ResearchEntity } from '../../models/researchEntity';
import { RoleAssignment } from '../../models/roleAssignment';
import { plausiblePersonOrcid } from '../../utils/orcid';
import { sanitizeLogValue } from '../../utils/logSanitizer';
import { researcherNetid } from '../../utils/researcherIdentity';
import { assertPublicHttpUrl, ssrfSafeAgents } from '../../utils/ssrfGuard';
import {
  SHARED_TEMP_ROOT,
  approvedTempRootFor,
  hasPathPrefix,
  sharedTempRoot,
} from '../../utils/tempArtifactRoots';
import { getCached, setCached } from '../snapshotCache';
import { normalizeName, slugify, splitName } from '../utils/scraperHelpers';
import {
  adviserPairCountsTowardHosting,
  departmentsAgree,
  type UndergradHostingRule,
} from '../utils/labScienceAdviserRule';
import {
  parseSeniorEssayAdviserTables,
  parseSeniorThesisAdviserParagraphs,
  parseStarsAuthorListBooklet,
  type AdviserListPair,
} from '../utils/undergradAdviserLists';
import type { IScraper, ObservationInput, ScraperContext, ScraperResult } from '../types';
import {
  catalogDepartmentWithAncestors,
  getOrgUnitCanonicalizer,
} from '../orgUnitCanonicalization';
import { mongooseConnectionWasOpened } from '../../utils/mongooseConnectionWasOpened';
import { retryOnRetryableStatus } from '../utils/httpFetch';
import { SCRAPER_USER_AGENT } from '../utils/scraperUserAgent';

const FETCH_TIMEOUT_MS = 30_000;
const MIN_FELLOWSHIP_RECIPIENT_YEAR = 1980;
const MAX_FELLOWSHIP_RECIPIENT_FUTURE_YEARS = 1;
export const DEFAULT_ACCEPTED_FELLOWSHIP_RECIPIENT_CSV_DIR = path.join(
  sharedTempRoot(),
  'ylabs-accepted-inputs',
  'fellowships',
);
export const DEFAULT_ACCEPTED_FELLOWSHIP_RECIPIENT_PDF_DIR =
  DEFAULT_ACCEPTED_FELLOWSHIP_RECIPIENT_CSV_DIR;
const SAFE_MANUAL_RECIPIENT_SEGMENT_RE = /^[A-Za-z0-9._-]{1,120}$/;
const MANUAL_RECIPIENT_FILE_EXTENSIONS = new Set(['.csv', '.pdf']);

export function resolveSafeManualRecipientInputPath(
  root: string,
  programKey: string,
  extension: '.csv' | '.pdf',
): string {
  if (!SAFE_MANUAL_RECIPIENT_SEGMENT_RE.test(programKey)) {
    throw new Error('Invalid manual recipient program key');
  }
  if (!MANUAL_RECIPIENT_FILE_EXTENSIONS.has(extension)) {
    throw new Error('Invalid manual recipient file extension');
  }

  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(resolvedRoot, `${programKey}${extension}`);
  const tmpRoot = path.resolve(os.tmpdir());
  const projectTmpRoot = path.resolve(process.cwd(), 'tmp');

  if (!approvedTempRootFor(resolvedRoot, [tmpRoot, SHARED_TEMP_ROOT, projectTmpRoot])) {
    throw new Error('Manual recipient input root must be under system temp or ./tmp');
  }
  if (!hasPathPrefix(resolvedPath, resolvedRoot)) {
    throw new Error('Manual recipient input path escapes root');
  }

  return resolvedPath;
}

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
  piAsPrinted?: string;
  classYear?: number;
  /** Row-level source URL for manual accepted inputs, when available. */
  sourceUrl?: string;
  /** Optional source page or text block pointer for review traceability. */
  sourcePage?: string;
  /** Human review note retained from accepted-input CSVs. */
  reviewNote?: string;
  /** Year of the award (4-digit). Inferred from the listing or the URL. */
  year: number;
  sourceDepartments?: string[];
}

/** Context passed to per-program extractors for URL resolution + year inference. */
export interface ExtractorCtx {
  pageUrl: string;
  /** Original official source URL when the input body came from an accepted local file. */
  sourceUrl?: string;
  /** When the URL implies a single year (e.g. `/recipients/2024/`), the runner
   * pre-computes it and passes it down so the extractor doesn't have to repeat
   * the parse. Extractors are free to override per-row when the page itself
   * groups by year. */
  defaultYear?: number;
}

/** Pure HTML → recipient rows. No I/O. */
export type RecipientExtractor = (html: string, ctx: ExtractorCtx) => FellowshipRecipient[];

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
  pdfExtractor?: RecipientExtractor;
  adviserDepartments?: readonly string[];
  hostingRule?: UndergradHostingRule;
}

export interface FellowshipRecipientListing {
  studentName: string;
  year: number;
  programName: string;
  projectTitle?: string;
  piAsPrinted?: string;
  sourceUrl?: string;
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
  recipients: FellowshipRecipientListing[];
}

/** Lightweight User shape returned by the user-resolver. */
export interface UserMatch {
  _id: any;
  netid: string;
  fname: string;
  lname: string;
  primaryDepartment?: string;
  orcid?: string;
}

// ---------------------------------------------------------------------------
// Per-program extractor stubs
//
// A program whose recipient list is PDF-only (STARS II symposium booklets)
// requires a manual upload. Each stub throws a
// clear, identical-shaped error so the
// orchestrator records `manual-upload-required` for that program and continues.
//
// The architecture keeps the per-program extractor as the single change-site:
// when a program publishes a real HTML list (or admin uploads a CSV), the stub
// is swapped for a pure parser without touching the orchestrator class.
// ---------------------------------------------------------------------------

/** Stub used by every config that's currently blocked behind a PDF/gate. */
export const manualUploadStub: RecipientExtractor = () => {
  throw new Error('Recipient list not available as scrapable HTML — manual upload required');
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

function parseExactYear(value: string | undefined): number | undefined {
  const trimmed = value?.trim();
  if (!trimmed || !/^\d{4}$/.test(trimmed)) return undefined;
  const year = Number(trimmed);
  const maxYear = new Date().getFullYear() + MAX_FELLOWSHIP_RECIPIENT_FUTURE_YEARS;
  return Number.isInteger(year) && year >= MIN_FELLOWSHIP_RECIPIENT_YEAR && year <= maxYear
    ? year
    : undefined;
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

    const parsedYear = parseExactYear(valueFor(record, ['year', 'awardYear', 'fellowshipYear']));
    const year = parsedYear ?? ctx.defaultYear;
    if (!year) continue;

    out.push({
      studentName: valueFor(record, ['studentName', 'student', 'recipientName', 'recipient']),
      advisorName,
      advisorOrcid: plausiblePersonOrcid(valueFor(record, ['advisorOrcid', 'orcid'])) || undefined,
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

function firstLabelValue(block: string, labels: string[]): string {
  const pattern = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const regex = new RegExp(`(?:^|\\n)\\s*(?:${pattern})\\s*[:-]\\s*([^\\n]+)`, 'i');
  const match = block.match(regex);
  return (match?.[1] || '')
    .replace(/\s+(student|advisor|adviser|mentor|project|title|year)\s*[:-].*$/i, '')
    .trim();
}

function likelyProjectTitle(block: string): string | undefined {
  const explicit = firstLabelValue(block, ['Project', 'Project Title', 'Title', 'Research Title']);
  if (explicit) return explicit;
  const lines = block
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter(
      (line) => !/^(student|presenter|researcher|advisor|adviser|mentor|year)\s*[:-]/i.test(line),
    );
  return lines[0] || undefined;
}

/**
 * Accepted PDF text extractor for fellowship recipient rows. It expects text
 * already extracted from a reviewed official PDF and reads conservative labelled
 * blocks such as `Student: ...`, `Advisor: ...`, `Project: ...`.
 */
export const manualRecipientPdfTextExtractor: RecipientExtractor = (text, ctx) => {
  const normalized = text
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!normalized) return [];

  const blocks = normalized
    .split(/\n\s*\n|(?=\n?\s*(?:Student|Presenter|Researcher)\s*[:-])/i)
    .map((block) => block.trim())
    .filter(Boolean);
  const sourceUrl = ctx.sourceUrl || ctx.pageUrl;
  const out: FellowshipRecipient[] = [];

  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    const advisorName = firstLabelValue(block, [
      'Advisor',
      'Adviser',
      'Advisors',
      'Advisers',
      'Faculty Advisor',
      'Faculty Adviser',
      'Mentor',
      'Mentors',
    ]);
    if (!advisorName) continue;

    const parsedYear = parseExactYear(
      firstLabelValue(block, ['Year', 'Award Year', 'Fellowship Year']),
    );
    const year = parsedYear ?? ctx.defaultYear;
    if (!year) continue;

    out.push({
      studentName: firstLabelValue(block, ['Student', 'Presenter', 'Researcher']),
      advisorName,
      projectTitle: likelyProjectTitle(block),
      sourceUrl,
      sourcePage: `text-block-${index + 1}`,
      reviewNote: 'Parsed from accepted PDF text',
      year,
    });
  }

  return out;
};

const SYMPOSIUM_PI_LINE =
  /^(?:PI|P\.I\.|Principal Investigators?|Faculty (?:Mentor|Advisor|Adviser))\s*:\s*(.*)$/i;
const SYMPOSIUM_LABEL_LINE =
  /^[A-Za-z’' ]{0,30}\b(?:mentors?|department|advisors?|advisers?|lab|PI)\b[A-Za-z’' ]{0,15}:/i;
const SYMPOSIUM_LABEL_CONTINUATION =
  /;|\b(?:name|mentors?|department)\b[^:]*:|\b(?:Professor|Ph\.?\s?D\.?|Lab|Laboratory|School|Department|Biology|Science|Sciences|Pharmacology|Diseases?|Engineering|Medicine|Public Health|Computing|Center|Institute|Postdoc\w*|Candidate)\b/i;
const SYMPOSIUM_CLASS_YEAR_LINE = /^Class of ((?:19|20)\d{2})\b/i;
const SYMPOSIUM_SLOT_LINE = /^\d{1,2}:\d{2}\s*(?:[AP]M)?\s*[–-]\s*\d{1,2}:\d{2}\s*(?:[AP]M)?$/i;
const SYMPOSIUM_NOT_A_STUDENT =
  /\b(?:Department|Dept\.?|School|Program|Lab|Laboratory|Biology|Engineering|Medicine|Science|Sciences|Physics|Chemistry|Psychiatry|Psychology|Neuroscience|Biochemistry|Biophysics|Genetics|Immunobiology|Pharmacology|Pathology|Mathematics|Statistics|Economics|Symposium|STARS|Session|Presentations?|Fellowships?)\b/i;
const CREDENTIAL_TOKEN =
  /^(?:Ph\.?\s?D\.?|M\.?\s?D\.?|MD\s?PhD|M\.?\s?S\.?|M\.?\s?P\.?\s?H\.?|Dr\.?|Prof\.?)$/i;
const SYMPOSIUM_TITLE_LINES_MAX = 6;

const looksLikeSymposiumStudent = (line: string): boolean => {
  if (line.length > 60 || /[\d:,;&/()]/.test(line) || SYMPOSIUM_NOT_A_STUDENT.test(line)) {
    return false;
  }
  const tokens = line.split(/\s+/);
  return (
    tokens.length >= 2 &&
    tokens.length <= 5 &&
    /^\p{Lu}/u.test(tokens[0]) &&
    /^\p{Lu}/u.test(tokens[tokens.length - 1])
  );
};

export function primarySymposiumPiName(value: string): string {
  const parts = value
    .replace(/\([^)]*\)/g, ' ')
    .split(/,|;|\s&\s|\sand\s/)
    .map((part) =>
      part
        .trim()
        .replace(/^(?:Dr|Prof|Professor)\.?\s+/i, '')
        .split(' ')
        .filter((token) => !CREDENTIAL_TOKEN.test(token))
        .join(' ')
        .replace(/\s+/g, ' '),
    )
    .filter((part) => part && !part.split(' ').every((token) => CREDENTIAL_TOKEN.test(token)));
  return parts.find((part) => part.split(' ').length >= 2) ?? parts[0] ?? '';
}

/**
 * STARS II symposium booklets list each presenter as a name, a department, an optional
 * class year, a `PI:` line and an optional `Mentor:` line, then the project title. The
 * lab is the PI's: the mentor is usually a graduate student or postdoc, so a block with
 * no `PI:` line is skipped rather than attributed to its mentor.
 */
export const starsSymposiumPiExtractor: RecipientExtractor = (text, ctx) => {
  const lines = text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const year =
    ctx.defaultYear ??
    parseExactYear(
      lines
        .slice(0, 40)
        .join(' ')
        .match(/\b20\d{2}\b/)?.[0],
    );
  if (!year) return [];
  const sourceUrl = ctx.sourceUrl || ctx.pageUrl;
  const piIndexes = lines.flatMap((line, index) => (SYMPOSIUM_PI_LINE.test(line) ? [index] : []));
  const studentIndexes = piIndexes.map((piIndex, order) => {
    const floor = order > 0 ? piIndexes[order - 1] + 1 : 0;
    for (let index = piIndex - 1; index >= Math.max(floor, piIndex - 6); index -= 1) {
      if (SYMPOSIUM_SLOT_LINE.test(lines[index])) break;
      if (looksLikeSymposiumStudent(lines[index])) return index;
    }
    return -1;
  });
  const out: FellowshipRecipient[] = [];
  const seen = new Set<string>();
  piIndexes.forEach((piIndex, order) => {
    const studentIndex = studentIndexes[order];
    if (studentIndex < 0) return;
    const studentName = lines[studentIndex];
    const piValue = (
      SYMPOSIUM_PI_LINE.exec(lines[piIndex])?.[1] ||
      lines[piIndex + 1] ||
      ''
    ).trim();
    const advisorName = primarySymposiumPiName(piValue);
    if (!advisorName || seen.has(studentName)) return;
    seen.add(studentName);
    const classYear = parseExactYear(
      lines
        .slice(studentIndex, piIndex)
        .map((line) => SYMPOSIUM_CLASS_YEAR_LINE.exec(line)?.[1])
        .find(Boolean),
    );
    const nextStudent = studentIndexes.slice(order + 1).find((index) => index > piIndex);
    const end = Math.min(nextStudent ?? lines.length, piIndex + 1 + SYMPOSIUM_TITLE_LINES_MAX + 4);
    const titleLines: string[] = [];
    for (let index = piIndex + 1; index < end; index += 1) {
      const line = lines[index];
      if (SYMPOSIUM_SLOT_LINE.test(line)) break;
      if (SYMPOSIUM_LABEL_LINE.test(line) || (index === piIndex + 1 && line === piValue)) continue;
      if (titleLines.length >= SYMPOSIUM_TITLE_LINES_MAX) break;
      titleLines.push(line);
    }
    while (
      titleLines.length > 1 &&
      titleLines[0].split(' ').length <= 6 &&
      SYMPOSIUM_LABEL_CONTINUATION.test(titleLines[0])
    ) {
      titleLines.shift();
    }
    const projectTitle = titleLines
      .join(' ')
      .replace(/\s+([,.;:])/g, '$1')
      .slice(0, 300)
      .trim();
    out.push({
      studentName,
      advisorName,
      piAsPrinted: piValue,
      ...(projectTitle ? { projectTitle } : {}),
      ...(classYear ? { classYear } : {}),
      sourceUrl,
      year,
    });
  });
  return out;
};

const adviserPairsToRecipients = (
  pairs: AdviserListPair[],
  sourceUrl: string,
): FellowshipRecipient[] =>
  pairs.map((pair) => ({
    studentName: '',
    advisorName: pair.advisorName,
    year: pair.year,
    sourceUrl,
    ...(pair.sourceDepartments ? { sourceDepartments: pair.sourceDepartments } : {}),
  }));

export const seniorEssayAdviserTableExtractor: RecipientExtractor = (html, ctx) =>
  adviserPairsToRecipients(parseSeniorEssayAdviserTables(html).pairs, ctx.sourceUrl || ctx.pageUrl);

export const seniorThesisAdviserParagraphExtractor: RecipientExtractor = (html, ctx) =>
  adviserPairsToRecipients(
    parseSeniorThesisAdviserParagraphs(html).pairs,
    ctx.sourceUrl || ctx.pageUrl,
  );

export const starsSymposiumBookletExtractor: RecipientExtractor = (text, ctx) => {
  const piLineRecipients = starsSymposiumPiExtractor(text, ctx);
  if (piLineRecipients.length > 0) return piLineRecipients;
  const year = ctx.defaultYear ?? parseExactYear(text.match(/\b20\d{2}\b/)?.[0]);
  if (!year) return [];
  return adviserPairsToRecipients(
    parseStarsAuthorListBooklet(text, year),
    ctx.sourceUrl || ctx.pageUrl,
  );
};

export function manualPdfInputsFor(
  config: Pick<ProgramConfig, 'programKey' | 'urls'>,
): Array<{ fileKey: string; sourceUrl: string }> {
  const pdfUrls = config.urls.filter((url) => /\.pdf(?:$|[?#])/i.test(url));
  const primary = pdfUrls[0] || config.urls[0] || `manual-pdf://${config.programKey}.pdf`;
  const byYear = pdfUrls.flatMap((url) => {
    const year = inferYearFromUrl(url);
    return year ? [{ fileKey: `${config.programKey}-${year}`, sourceUrl: url }] : [];
  });
  return [{ fileKey: config.programKey, sourceUrl: primary }, ...byYear];
}

export async function extractFellowshipPdfText(body: Buffer): Promise<string> {
  const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as any;
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(body),
    disableWorker: true,
    isEvalSupported: false,
  });
  const document = await loadingTask.promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(
      (content.items || [])
        .map((item: any) => (typeof item.str === 'string' ? item.str : ''))
        .filter(Boolean)
        .join('\n'),
    );
  }
  return pages.join('\n\n');
}

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
      year = parseExactYear(yearAttr);
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
      'https://science.yalecollege.yale.edu/sites/default/files/files/STARSII%20Symposium%20Abstract%20Booklet%20Spring%202021.pdf',
      'https://science.yalecollege.yale.edu/sites/default/files/files/STARS%20II%20Symposium%20Booklet%20Complete_13Apr2019.pdf',
    ],
    extractor: manualUploadStub,
    pdfExtractor: starsSymposiumBookletExtractor,
    manualUploadRequired: true,
    skipReason: 'STARS II symposium abstracts published as PDF only',
    hostingRule: 'lab-science-program',
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
function decodedUrl(url: string): string {
  try {
    return decodeURI(url);
  } catch {
    return url;
  }
}

export function inferYearFromUrl(url: string): number | undefined {
  const matches = decodedUrl(url).match(/(19[89]\d|20\d{2})/g);
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
    const advisorOrcid = plausiblePersonOrcid(r.advisorOrcid);
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
        recipients: [] as FellowshipRecipientListing[],
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
    const studentName = r.studentName?.trim();
    if (
      studentName &&
      !existing.recipients.some(
        (listed) => listed.studentName === studentName && listed.year === r.year,
      )
    ) {
      existing.recipients.push({
        studentName,
        year: r.year,
        programName,
        ...(r.projectTitle ? { projectTitle: r.projectTitle } : {}),
        ...(r.piAsPrinted ? { piAsPrinted: r.piAsPrinted } : {}),
        ...(url ? { sourceUrl: url } : {}),
      });
    }

    out.set(key, existing);
  }
  // Sort each advisor's advisees by year desc.
  for (const row of out.values()) {
    row.advisees.sort((a, b) => b.year - a.year);
  }
  return out;
}

/**
 * Resolve `advisorName` (optionally disambiguated by ORCID) to the canonical
 * Researcher most likely to be that advisor.
 *
 * ORCID, when present, is tried first; otherwise the shared
 * `resolveResearcherIdForPersonName` keystone does the name matching and returns
 * a match only when a single unambiguous candidate exists.
 *
 * The resolver is exposed via the `advisorResolver` dependency so tests can
 * inject a mock without touching mongoose.
 */
export type AdvisorResearcherResolver = (name: string, orcid?: string) => Promise<UserMatch | null>;

export async function netidForAdvisorResearcher(researcher: {
  identifiers?: { netid?: unknown } | null;
}): Promise<string> {
  return researcherNetid(researcher);
}

export function researcherToUserMatch(researcher: any, netid: string): UserMatch {
  const displayName =
    typeof researcher.displayName === 'string' ? researcher.displayName.trim() : '';
  const { first, last } = splitName(displayName);
  return {
    _id: researcher._id,
    netid,
    fname: first || '',
    lname: last || displayName,
    primaryDepartment: researcher.profile?.primaryDepartment,
    orcid: researcher.identifiers?.orcid,
  };
}

export const defaultAdvisorResearcherResolver: AdvisorResearcherResolver = async (name, orcid) => {
  const cleaned = plausiblePersonOrcid(orcid);
  if (cleaned) {
    const researcher: any = await Researcher.findOne({
      'identifiers.orcid': cleaned.toUpperCase(),
      archived: { $ne: true },
    })
      .select('_id displayName profile identifiers')
      .lean();
    if (!researcher) return null;
    return researcherToUserMatch(researcher, await netidForAdvisorResearcher(researcher));
  }
  const resolution = await resolveResearcherIdForPersonName(name);
  if (resolution.status !== 'matched' || !resolution.researcherId) return null;
  const researcher: any = await Researcher.findById(resolution.researcherId)
    .select('_id displayName profile identifiers')
    .lean();
  if (!researcher) return null;
  return researcherToUserMatch(researcher, await netidForAdvisorResearcher(researcher));
};

export interface AdvisorResolution {
  status: 'matched' | 'absent' | 'ambiguous';
  match?: UserMatch;
}

export type AdvisorResolutionResolver = (
  name: string,
  orcid?: string,
) => Promise<AdvisorResolution>;

export const defaultAdvisorResolution: AdvisorResolutionResolver = async (name, orcid) => {
  if (orcid) {
    const match = await defaultAdvisorResearcherResolver(name, orcid);
    return match ? { status: 'matched', match } : { status: 'absent' };
  }
  const resolution = await resolveResearcherIdForPersonName(name);
  if (resolution.status !== 'matched' || !resolution.researcherId) {
    return { status: resolution.status === 'ambiguous' ? 'ambiguous' : 'absent' };
  }
  const researcher: any = await Researcher.findById(resolution.researcherId)
    .select('_id displayName profile identifiers')
    .lean();
  if (!researcher) return { status: 'absent' };
  return {
    status: 'matched',
    match: researcherToUserMatch(researcher, await netidForAdvisorResearcher(researcher)),
  };
};

export interface AdvisorDepartments {
  departments: string[];
  affiliations: string[];
}

export type AdviserPairRefusal =
  'ambiguous' | 'no-match' | 'department-mismatch' | 'not-lab-science' | 'no-lead-row';

export const ADVISER_PAIR_REFUSALS: readonly AdviserPairRefusal[] = [
  'ambiguous',
  'no-match',
  'department-mismatch',
  'not-lab-science',
  'no-lead-row',
];

const LEAD_ROLES = ['PI', 'CO_PI', 'DIRECTOR', 'CO_DIRECTOR'] as const;
const OWN_RESEARCH_ROW_TYPES = ['LAB', 'FACULTY_RESEARCH_AREA'];

export interface LeadRowCandidate {
  slug: string;
  entityType?: string;
  role?: string;
}

/**
 * The row a fellow's PI mentors them in: the PI's own lab or faculty research profile
 * before a core facility, center or program they direct, then a PI role before a
 * directorship, then the slug for a stable choice.
 */
export function preferredLeadRowSlug(candidates: LeadRowCandidate[]): string | null {
  const rank = (candidate: LeadRowCandidate) => [
    OWN_RESEARCH_ROW_TYPES.includes(candidate.entityType ?? '') ? 0 : 1,
    candidate.role === 'PI' || candidate.role === 'CO_PI' ? 0 : 1,
  ];
  const [best] = [...candidates].sort((left, right) => {
    const [leftType, leftRole] = rank(left);
    const [rightType, rightRole] = rank(right);
    return leftType - rightType || leftRole - rightRole || left.slug.localeCompare(right.slug);
  });
  return best?.slug ?? null;
}

export async function existingLeadRowsForOwner(owner: UserMatch): Promise<LeadRowCandidate[]> {
  const edges: any[] = await RoleAssignment.find({
    personId: owner._id,
    'target.kind': 'RESEARCH_ENTITY',
    role: { $in: LEAD_ROLES },
    state: { $ne: 'HISTORICAL' },
    archived: { $ne: true },
  })
    .select('target role')
    .lean();
  if (edges.length === 0) return [];
  const roleByEntityId = new Map(edges.map((edge) => [String(edge.target?.id), edge.role]));
  const rows: any[] = await ResearchEntity.find({
    _id: { $in: edges.map((edge) => edge.target?.id).filter(Boolean) },
    archived: { $ne: true },
  })
    .select('slug entityType')
    .lean();
  return rows.map((row) => ({
    slug: String(row.slug),
    entityType: row.entityType,
    role: roleByEntityId.get(String(row._id)),
  }));
}

export async function existingLeadRowSlugForOwner(owner: UserMatch): Promise<string | null> {
  return preferredLeadRowSlug(await existingLeadRowsForOwner(owner));
}

export async function leadRowDepartmentsForOwner(owner: UserMatch): Promise<AdvisorDepartments> {
  const edges: any[] = await RoleAssignment.find({
    personId: owner._id,
    'target.kind': 'RESEARCH_ENTITY',
    role: { $in: LEAD_ROLES },
    state: { $ne: 'HISTORICAL' },
    archived: { $ne: true },
  })
    .select('target')
    .lean();
  const rows: any[] =
    edges.length === 0
      ? []
      : await ResearchEntity.find({
          _id: { $in: edges.map((edge) => edge.target?.id).filter(Boolean) },
          archived: { $ne: true },
        })
          .select('departments orgAffiliationLabels')
          .lean();
  const strings = (values: unknown): string[] =>
    Array.isArray(values)
      ? values.filter((value): value is string => typeof value === 'string')
      : [];
  return {
    departments: [
      ...new Set([
        ...(owner.primaryDepartment ? [owner.primaryDepartment] : []),
        ...rows.flatMap((row) => strings(row.departments)),
      ]),
    ],
    affiliations: [...new Set(rows.flatMap((row) => strings(row.orgAffiliationLabels)))],
  };
}

/**
 * Pure: build the ResearchGroup observation list for one matched advisor.
 *
 * Emits the FULL aggregated `pastUndergradAdvisees` array on each pass. The
 * resolver picks the highest-confidence value per field rather than trying to
 * merge partial arrays from successive runs — this keeps the materialized lab
 * record consistent even if a single run only sees a subset of programs.
 */
export function buildObservationsForAdvisor(
  groupSlug: string,
  advisees: PastUndergradAdviseeEntry[],
  sourceUrl: string,
  recipients: FellowshipRecipientListing[] = [],
): ObservationInput[] {
  const base = {
    entityType: 'researchEntity' as const,
    entityKey: groupSlug,
    sourceUrl,
  };
  return [
    { ...base, field: 'pastUndergradAdvisees', value: advisees },
    ...(recipients.length > 0
      ? [{ ...base, field: 'fellowshipRecipients', value: recipients }]
      : []),
    { ...base, field: 'lastObservedAt', value: new Date() },
  ];
}

// ---------------------------------------------------------------------------
// Internal: HTTP fetch with cache passthrough
// ---------------------------------------------------------------------------

async function fetchHtml(url: string, useCache: boolean, sourceName: string): Promise<string> {
  const safeUrl = await assertPublicHttpUrl(url);
  const safeUrlText = safeUrl.toString();
  const cacheKey = `page:${safeUrlText}`;
  if (useCache) {
    const cached = await getCached<string>(sourceName, cacheKey);
    if (cached) return cached;
  }
  const agents = ssrfSafeAgents();
  const res = await retryOnRetryableStatus(() =>
    axios.get(safeUrlText, {
      timeout: FETCH_TIMEOUT_MS,
      maxRedirects: 5,
      httpAgent: agents.httpAgent,
      httpsAgent: agents.httpsAgent,
    }),
  );
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
  /** Override the advisor identity resolver (tests inject a Mongo-free mock). */
  advisorResolver?: AdvisorResearcherResolver;
  /** Override the User → ResearchGroup slug resolver. */
  ownerToGroupSlug?: (owner: UserMatch) => Promise<string | null>;
  /** Override default accepted-input CSV directory for manual fellowship rows. */
  defaultManualRecipientCsvDir?: string;
  /** Override default accepted-input PDF directory for manual fellowship rows. */
  defaultManualRecipientPdfDir?: string;
  /** Override local PDF text extraction (tests inject canned text). */
  pdfTextExtractor?: (body: Buffer) => Promise<string>;
  advisorResolution?: AdvisorResolutionResolver;
  ownerDepartments?: (owner: UserMatch) => Promise<AdvisorDepartments>;
}

type AdviserPairVerdict = { slug: string } | { refusal: AdviserPairRefusal };

interface RowEvidence {
  advisees: PastUndergradAdviseeEntry[];
  recipients: FellowshipRecipientListing[];
  sourceUrls: Set<string>;
}

type AdviserPairOutcomes = Record<AdviserPairRefusal | 'parsed' | 'matched', number>;

const emptyAdviserPairOutcomes = (): AdviserPairOutcomes => ({
  parsed: 0,
  matched: 0,
  ambiguous: 0,
  'no-match': 0,
  'department-mismatch': 0,
  'not-lab-science': 0,
  'no-lead-row': 0,
});

const formatAdviserPairOutcomes = (outcomes: AdviserPairOutcomes): string =>
  [
    `parsed=${outcomes.parsed}`,
    `matched=${outcomes.matched}`,
    ...ADVISER_PAIR_REFUSALS.map((refusal) => `${refusal}=${outcomes[refusal]}`),
  ].join(' ');

function mergeAdvisorRowInto(evidence: RowEvidence, row: AdvisorAggregateRow): void {
  for (const entry of row.advisees) {
    const bucket = evidence.advisees.find(
      (existing) => existing.year === entry.year && existing.programName === entry.programName,
    );
    if (bucket) bucket.count += entry.count;
    else evidence.advisees.push({ ...entry });
  }
  for (const listing of row.recipients) {
    const duplicate = evidence.recipients.some(
      (existing) =>
        existing.studentName === listing.studentName &&
        existing.year === listing.year &&
        existing.programName === listing.programName,
    );
    if (!duplicate) evidence.recipients.push(listing);
  }
  for (const url of row.sourceUrls) evidence.sourceUrls.add(url);
}

export async function primaryDepartmentCatalogAncestors(
  primaryDepartment: unknown,
): Promise<string[]> {
  const primary = typeof primaryDepartment === 'string' ? primaryDepartment.trim() : '';
  if (!primary || !mongooseConnectionWasOpened()) return [];
  return catalogDepartmentWithAncestors(await getOrgUnitCanonicalizer(), primary).slice(1);
}

export class UndergradFellowshipRecipientScraper implements IScraper {
  readonly name = 'undergrad-fellowships-recipients';
  readonly displayName = 'Yale undergrad fellowship recipient lists';

  private readonly fetchPage: (url: string, useCache: boolean) => Promise<string>;
  private readonly ownerToGroupSlug: (owner: UserMatch) => Promise<string | null>;
  private readonly defaultManualRecipientCsvDir: string;
  private readonly defaultManualRecipientPdfDir: string;
  private readonly pdfTextExtractor: (body: Buffer) => Promise<string>;
  private readonly advisorResolution: AdvisorResolutionResolver;
  private readonly ownerDepartments: (owner: UserMatch) => Promise<AdvisorDepartments>;

  /**
   * Configs are injectable for testing; default to `DEFAULT_PROGRAM_CONFIGS`.
   * The STARS II default is a stub (`manualUploadRequired=true`); see the file header.
   */
  constructor(
    private readonly configs: ProgramConfig[] = DEFAULT_PROGRAM_CONFIGS,
    deps: UndergradFellowshipScraperDeps = {},
  ) {
    const sourceName = this.name;
    this.fetchPage = deps.fetchPage ?? ((url, useCache) => fetchHtml(url, useCache, sourceName));
    const injectedResolver = deps.advisorResolver;
    this.advisorResolution =
      deps.advisorResolution ??
      (injectedResolver
        ? async (name, orcid) => {
            const match = await injectedResolver(name, orcid);
            return match ? { status: 'matched', match } : { status: 'absent' };
          }
        : defaultAdvisorResolution);
    this.ownerDepartments = deps.ownerDepartments ?? leadRowDepartmentsForOwner;
    this.ownerToGroupSlug = deps.ownerToGroupSlug ?? existingLeadRowSlugForOwner;
    this.defaultManualRecipientCsvDir =
      deps.defaultManualRecipientCsvDir ?? DEFAULT_ACCEPTED_FELLOWSHIP_RECIPIENT_CSV_DIR;
    this.defaultManualRecipientPdfDir =
      deps.defaultManualRecipientPdfDir ?? DEFAULT_ACCEPTED_FELLOWSHIP_RECIPIENT_PDF_DIR;
    this.pdfTextExtractor = deps.pdfTextExtractor ?? extractFellowshipPdfText;
  }

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    const onlyFilter =
      ctx.options.only && ctx.options.only.length > 0
        ? new Set(ctx.options.only.map((s) => s.trim().toLowerCase()))
        : null;
    const limitOption = ctx.options.limit;
    if (limitOption !== undefined && (!Number.isSafeInteger(limitOption) || limitOption < 1)) {
      throw new Error('--limit must be a safe positive integer');
    }
    const recipientLimit = limitOption ?? Infinity;

    let totalRecipientsProcessed = 0;
    let totalUnmatched = 0;
    const perProgram: Array<{ key: string; status: string; count: number }> = [];
    const pairOutcomesByProgram: Array<{ key: string; outcomes: AdviserPairOutcomes }> = [];
    const evidenceBySlug = new Map<string, RowEvidence>();
    const caches: AdviserPairCaches = {
      resolutions: new Map(),
      departments: new Map(),
      slugs: new Map(),
    };

    for (const config of this.configs) {
      if (onlyFilter && !onlyFilter.has(config.programKey.toLowerCase())) continue;
      if (totalRecipientsProcessed >= recipientLimit) break;

      let effectiveConfig = config;
      let manualBody: string | null = null;
      let manualSourceUrl: string | null = null;
      const manualRecipientCsvDir =
        ctx.options.manualRecipientCsvDir || this.defaultManualRecipientCsvDir;
      if (config.manualUploadRequired && manualRecipientCsvDir) {
        const csvPath = resolveSafeManualRecipientInputPath(
          manualRecipientCsvDir,
          config.programKey,
          '.csv',
        );
        try {
          manualBody = await fs.readFile(csvPath, 'utf8');
          manualSourceUrl = `manual://${config.programKey}.csv`;
          effectiveConfig = {
            ...config,
            manualUploadRequired: false,
            urls: [manualSourceUrl],
            extractor: manualRecipientCsvExtractor,
          };
          ctx.log(`[${config.programKey}] using manual recipient CSV ${csvPath}`);
        } catch (err: any) {
          ctx.log(`[${config.programKey}] manual CSV not found/readable: ${sanitizeLogValue(err)}`);
        }
      }
      const manualRecipientPdfDir = this.defaultManualRecipientPdfDir;
      const manualPdfBodies = new Map<string, { body: string; sourceUrl: string }>();
      if (config.manualUploadRequired && !manualBody && manualRecipientPdfDir) {
        for (const input of manualPdfInputsFor(config)) {
          const pdfPath = resolveSafeManualRecipientInputPath(
            manualRecipientPdfDir,
            input.fileKey,
            '.pdf',
          );
          try {
            const pdfBody = await fs.readFile(pdfPath);
            if ([...manualPdfBodies.values()].some((read) => read.sourceUrl === input.sourceUrl)) {
              continue;
            }
            manualPdfBodies.set(`manual-pdf://${input.fileKey}.pdf`, {
              body: await this.pdfTextExtractor(Buffer.from(pdfBody)),
              sourceUrl: input.sourceUrl,
            });
            ctx.log(`[${config.programKey}] using manual recipient PDF ${pdfPath}`);
          } catch (err: any) {
            ctx.log(
              `[${config.programKey}] manual PDF not found/readable: ${sanitizeLogValue(err)}`,
            );
          }
        }
        if (manualPdfBodies.size > 0) {
          effectiveConfig = {
            ...config,
            manualUploadRequired: false,
            urls: [...manualPdfBodies.keys()],
            extractor: config.pdfExtractor ?? manualRecipientPdfTextExtractor,
          };
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
      let representativeUrl =
        manualSourceUrl ||
        manualPdfBodies.values().next().value?.sourceUrl ||
        effectiveConfig.urls[0] ||
        '';
      let extractFailed = false;

      for (const url of effectiveConfig.urls) {
        if (totalRecipientsProcessed + recipients.length >= recipientLimit) break;
        let html: string;
        try {
          html =
            manualPdfBodies.get(url)?.body ??
            (manualBody && /^manual(?:-pdf)?:\/\//i.test(url)
              ? manualBody
              : await this.fetchPage(url, ctx.options.useCache));
        } catch (err: any) {
          ctx.log(
            `[${config.programKey}] fetch failed for configured source: ${sanitizeLogValue(err)}`,
          );
          continue;
        }
        const sourceUrl = manualPdfBodies.get(url)?.sourceUrl || manualSourceUrl || url;
        const defaultYear = inferYearFromUrl(sourceUrl) || inferYearFromUrl(url);
        let pageRecipients: FellowshipRecipient[];
        try {
          pageRecipients = effectiveConfig.extractor(html, {
            pageUrl: url,
            sourceUrl,
            defaultYear,
          });
        } catch (err: any) {
          ctx.log(
            `[${config.programKey}] extractor error on configured source: ${sanitizeLogValue(err)}`,
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
        ctx.log(
          `[${config.programKey}] 0 recipients found across ${effectiveConfig.urls.length} URL(s)`,
        );
        perProgram.push({ key: config.programKey, status: 'empty', count: 0 });
        continue;
      }

      // Cap recipients processed across all programs.
      const remaining = recipientLimit - totalRecipientsProcessed;
      const trimmed = remaining < recipients.length ? recipients.slice(0, remaining) : recipients;
      totalRecipientsProcessed += trimmed.length;

      const outcomes = emptyAdviserPairOutcomes();
      const acceptedBySlug = new Map<string, FellowshipRecipient[]>();
      for (const recipient of trimmed) {
        outcomes.parsed += 1;
        let verdict: AdviserPairVerdict;
        try {
          verdict = await this.judgeAdviserPair(recipient, effectiveConfig, caches);
        } catch (err: any) {
          ctx.log(
            `[${config.programKey}] user lookup failed for recipient advisor: ${sanitizeLogValue(err)}`,
          );
          continue;
        }
        if ('refusal' in verdict) {
          outcomes[verdict.refusal] += 1;
          continue;
        }
        outcomes.matched += 1;
        acceptedBySlug.set(verdict.slug, [...(acceptedBySlug.get(verdict.slug) ?? []), recipient]);
      }

      for (const [slug, accepted] of acceptedBySlug) {
        const evidence =
          evidenceBySlug.get(slug) ??
          ({ advisees: [], recipients: [], sourceUrls: new Set<string>() } satisfies RowEvidence);
        for (const row of aggregateAdviseesByAdvisor(
          accepted,
          effectiveConfig.programName,
          sourceByRecipient,
        ).values()) {
          mergeAdvisorRowInto(evidence, row);
        }
        if (evidence.sourceUrls.size === 0 && representativeUrl) {
          evidence.sourceUrls.add(representativeUrl);
        }
        evidenceBySlug.set(slug, evidence);
      }

      const programUnmatched = outcomes.parsed - outcomes.matched;
      totalUnmatched += programUnmatched;
      pairOutcomesByProgram.push({ key: config.programKey, outcomes });
      ctx.log(
        `[${config.programKey}] ${trimmed.length} adviser pairs -> ${acceptedBySlug.size} rows matched (${formatAdviserPairOutcomes(outcomes)})`,
      );
      perProgram.push({
        key: config.programKey,
        status: 'ok',
        count: acceptedBySlug.size,
      });
    }

    let totalObs = 0;
    for (const [slug, evidence] of evidenceBySlug) {
      const advisees = [...evidence.advisees].sort(
        (left, right) =>
          right.year - left.year || left.programName.localeCompare(right.programName),
      );
      const sourceUrl = evidence.sourceUrls.values().next().value ?? '';
      const obs = buildObservationsForAdvisor(slug, advisees, sourceUrl, evidence.recipients);
      await ctx.emit(obs);
      totalObs += obs.length;
    }
    const totalAdvisorsEmitted = evidenceBySlug.size;

    const summary = perProgram
      .map((p) => `${p.key}=${p.status === 'ok' ? p.count : p.status}`)
      .join(', ');
    const pairSummary = pairOutcomesByProgram
      .map(({ key, outcomes }) => `${key}{${formatAdviserPairOutcomes(outcomes)}}`)
      .join(', ');
    ctx.log(
      `Emitted ${totalObs} observations across ${totalAdvisorsEmitted} rows (${totalRecipientsProcessed} adviser pairs, ${totalUnmatched} unmatched). Programs: ${summary}`,
    );

    return {
      observationCount: totalObs,
      entitiesObserved: totalAdvisorsEmitted,
      notes: `Programs: ${summary}; adviser pairs: ${pairSummary || 'none'}; ${totalUnmatched} unmatched adviser pairs skipped`,
    };
  }

  private async judgeAdviserPair(
    recipient: FellowshipRecipient,
    config: ProgramConfig,
    caches: AdviserPairCaches,
  ): Promise<AdviserPairVerdict> {
    const sourceDepartments = recipient.sourceDepartments ?? config.adviserDepartments;
    const advisorName = normalizeName(recipient.advisorName);
    const advisorOrcid = plausiblePersonOrcid(recipient.advisorOrcid);
    const resolution = await cachedLookup(
      caches.resolutions,
      advisorOrcid ? `orcid:${advisorOrcid}` : `name:${slugify(advisorName)}`,
      () => this.advisorResolution(advisorName || advisorOrcid, advisorOrcid || undefined),
    );
    if (resolution.status === 'ambiguous') return { refusal: 'ambiguous' };
    if (resolution.status !== 'matched' || !resolution.match) return { refusal: 'no-match' };
    const match = resolution.match;

    const ownerKey = String(match._id);
    if (sourceDepartments || config.hostingRule === 'lab-science-adviser-department') {
      const { departments, affiliations } = await cachedLookup(caches.departments, ownerKey, () =>
        this.ownerDepartments(match),
      );
      if (
        sourceDepartments &&
        !departmentsAgree(sourceDepartments, [...departments, ...affiliations])
      ) {
        return { refusal: 'department-mismatch' };
      }
      if (
        !adviserPairCountsTowardHosting(
          config.hostingRule,
          departments,
          match.primaryDepartment,
          await primaryDepartmentCatalogAncestors(match.primaryDepartment),
        )
      ) {
        return { refusal: 'not-lab-science' };
      }
    }

    const slug = await cachedLookup(caches.slugs, ownerKey, () => this.ownerToGroupSlug(match));
    return slug ? { slug } : { refusal: 'no-lead-row' };
  }
}

interface AdviserPairCaches {
  resolutions: Map<string, Promise<AdvisorResolution>>;
  departments: Map<string, Promise<AdvisorDepartments>>;
  slugs: Map<string, Promise<string | null>>;
}

function cachedLookup<T>(
  cache: Map<string, Promise<T>>,
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  const cached = cache.get(key);
  if (cached) return cached;
  const loaded = load();
  cache.set(key, loaded);
  return loaded;
}
