import axios from 'axios';
import * as cheerio from 'cheerio';
import fs from 'fs/promises';
import path from 'path';
import { User } from '../models/user';
import {
  DEFAULT_PROGRAM_CONFIGS,
  drupalRecipientRowExtractor,
  inferYearFromUrl,
  type ProgramConfig,
} from '../scrapers/sources/undergradFellowshipRecipientScraper';
import { normalizeName, splitName } from '../scrapers/utils/scraperHelpers';
import { normalizeOrcid } from '../utils/orcid';

export const DEFAULT_ACCEPTED_INPUT_ROOT = '/tmp/ylabs-accepted-inputs';
export const FELLOWSHIP_REVIEW_DIR = 'fellowship-review';
export const FELLOWSHIP_ACCEPTED_DIR = 'fellowships';

export const FELLOWSHIP_REVIEW_HEADERS = [
  'reviewStatus',
  'programKey',
  'programName',
  'year',
  'studentName',
  'advisorName',
  'advisorOrcid',
  'projectTitle',
  'sourceUrl',
  'sourcePage',
  'reviewNote',
  'extractionStatus',
] as const;

export const FELLOWSHIP_ACCEPTED_HEADERS = [
  'studentName',
  'advisorName',
  'advisorOrcid',
  'year',
  'projectTitle',
  'sourceUrl',
  'sourcePage',
  'reviewNote',
] as const;

export type FellowshipStatus = 'ready' | 'missing' | 'invalid' | 'manual-required';

export interface FellowshipReviewRow {
  reviewStatus: string;
  programKey: string;
  programName: string;
  year: string;
  studentName: string;
  advisorName: string;
  advisorOrcid: string;
  projectTitle: string;
  sourceUrl: string;
  sourcePage: string;
  reviewNote: string;
  extractionStatus: string;
}

export interface FellowshipValidationError {
  row: number;
  programKey: string;
  message: string;
}

export interface AdvisorResolution {
  status: 'resolved' | 'missing' | 'ambiguous';
  label?: string;
}

export type AdvisorResolver = (row: FellowshipReviewRow) => Promise<AdvisorResolution>;

export interface FellowshipInputDeps {
  configs?: ProgramConfig[];
  fetchUrl?: (url: string) => Promise<{ body: Buffer | string; contentType?: string }>;
  pdfTextExtractor?: (body: Buffer) => Promise<string>;
  advisorResolver?: AdvisorResolver;
}

const USER_AGENT = 'ylabs-accepted-inputs/1.0 (+https://yalelabs.io)';

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

function escapeCsvCell(value: unknown): string {
  const stringValue = value == null ? '' : String(value);
  if (!/[",\n\r]/.test(stringValue)) return stringValue;
  return `"${stringValue.replace(/"/g, '""')}"`;
}

export function stringifyCsv(rows: Array<Record<string, any>>, headers: readonly string[]): string {
  return [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => escapeCsvCell(row[header])).join(',')),
  ].join('\n');
}

function normalizedHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function readValue(row: Record<string, string>, names: string[]): string {
  const indexed = Object.fromEntries(
    Object.entries(row).map(([key, value]) => [normalizedHeader(key), value]),
  );
  for (const name of names) {
    const value = indexed[normalizedHeader(name)];
    if (value) return value.trim();
  }
  return '';
}

export function parseCsv(input: string): Record<string, string>[] {
  const rows = parseCsvRows(input);
  if (rows.length < 2) return [];
  const headers = rows[0];
  return rows.slice(1).map((cells) => {
    const out: Record<string, string> = {};
    headers.forEach((header, index) => {
      out[header] = cells[index]?.trim() || '';
    });
    return out;
  });
}

function reviewPath(root: string, programKey: string): string {
  return path.join(root, FELLOWSHIP_REVIEW_DIR, `${programKey}.csv`);
}

function acceptedPath(root: string, programKey: string): string {
  return path.join(root, FELLOWSHIP_ACCEPTED_DIR, `${programKey}.csv`);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function coerceReviewRow(row: Record<string, string>, config?: ProgramConfig): FellowshipReviewRow {
  const year = readValue(row, ['year', 'awardYear', 'fellowshipYear']);
  return {
    reviewStatus: readValue(row, ['reviewStatus', 'status']) || '',
    programKey: readValue(row, ['programKey']) || config?.programKey || '',
    programName: readValue(row, ['programName']) || config?.programName || '',
    year,
    studentName: readValue(row, ['studentName', 'student', 'recipientName', 'recipient']),
    advisorName: readValue(row, ['advisorName', 'advisor', 'facultyAdvisor']),
    advisorOrcid: normalizeOrcid(readValue(row, ['advisorOrcid', 'orcid'])),
    projectTitle: readValue(row, ['projectTitle', 'project', 'title', 'researchTitle']),
    sourceUrl: readValue(row, ['sourceUrl', 'url']),
    sourcePage: readValue(row, ['sourcePage', 'page']),
    reviewNote: readValue(row, ['reviewNote', 'note']),
    extractionStatus: readValue(row, ['extractionStatus']),
  };
}

async function readReviewRows(filePath: string, config?: ProgramConfig): Promise<FellowshipReviewRow[]> {
  const body = await fs.readFile(filePath, 'utf8');
  return parseCsv(body).map((row) => coerceReviewRow(row, config));
}

async function writeRows(filePath: string, rows: FellowshipReviewRow[], headers: readonly string[]) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${stringifyCsv(rows, headers)}\n`, 'utf8');
}

async function defaultFetchUrl(url: string): Promise<{ body: Buffer; contentType?: string }> {
  const response = await axios.get<ArrayBuffer>(url, {
    responseType: 'arraybuffer',
    timeout: 30_000,
    headers: { 'User-Agent': USER_AGENT },
    maxRedirects: 5,
  });
  return {
    body: Buffer.from(response.data),
    contentType: String(response.headers['content-type'] || ''),
  };
}

export async function extractPdfText(body: Buffer): Promise<string> {
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

function firstLabelValue(block: string, labels: string[]): string {
  const pattern = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const regex = new RegExp(`(?:^|\\n)\\s*(?:${pattern})\\s*[:\\-]\\s*([^\\n]+)`, 'i');
  const match = block.match(regex);
  return (match?.[1] || '')
    .replace(/\s+(student|advisor|adviser|mentor|project|title)\s*[:\-].*$/i, '')
    .trim();
}

function likelyProjectTitle(block: string): string {
  const explicit = firstLabelValue(block, ['Project', 'Project Title', 'Title', 'Research Title']);
  if (explicit) return explicit;
  const lines = block
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^(student|presenter|researcher|advisor|adviser|mentor)\s*[:\-]/i.test(line));
  return lines[0] || '';
}

export function candidateRowsFromText(
  text: string,
  config: ProgramConfig,
  sourceUrl: string,
  defaultYear?: number,
): FellowshipReviewRow[] {
  const normalized = text
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!normalized) return [];

  const blocks = normalized
    .split(/\n\s*\n|(?=\n?\s*(?:Student|Presenter|Researcher)\s*[:\-])/i)
    .map((block) => block.trim())
    .filter(Boolean);

  const rows: FellowshipReviewRow[] = [];
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

    rows.push({
      reviewStatus: 'needs-review',
      programKey: config.programKey,
      programName: config.programName,
      year: defaultYear ? String(defaultYear) : '',
      studentName: firstLabelValue(block, ['Student', 'Presenter', 'Researcher']),
      advisorName,
      advisorOrcid: '',
      projectTitle: likelyProjectTitle(block),
      sourceUrl,
      sourcePage: `text-block-${index + 1}`,
      reviewNote: '',
      extractionStatus: 'candidate',
    });
  }
  return rows;
}

function htmlCandidateRows(
  html: string,
  config: ProgramConfig,
  sourceUrl: string,
  defaultYear?: number,
): FellowshipReviewRow[] {
  const structured = drupalRecipientRowExtractor(html, { pageUrl: sourceUrl, defaultYear }).map(
    (row, index): FellowshipReviewRow => ({
      reviewStatus: 'needs-review',
      programKey: config.programKey,
      programName: config.programName,
      year: String(row.year),
      studentName: row.studentName,
      advisorName: row.advisorName,
      advisorOrcid: '',
      projectTitle: row.projectTitle || '',
      sourceUrl,
      sourcePage: `recipient-row-${index + 1}`,
      reviewNote: '',
      extractionStatus: 'candidate',
    }),
  );
  if (structured.length > 0) return structured;

  const text = cheerio.load(html).text();
  return candidateRowsFromText(text, config, sourceUrl, defaultYear);
}

function manualRequiredRow(config: ProgramConfig, sourceUrl = config.urls[0] || ''): FellowshipReviewRow {
  return {
    reviewStatus: 'manual-required',
    programKey: config.programKey,
    programName: config.programName,
    year: '',
    studentName: '',
    advisorName: '',
    advisorOrcid: '',
    projectTitle: '',
    sourceUrl,
    sourcePage: '',
    reviewNote: config.skipReason || 'Manual source review required',
    extractionStatus: 'manual-required',
  };
}

function isPdfSource(url: string, contentType = ''): boolean {
  return /\.pdf(?:$|[?#])/i.test(url) || contentType.toLowerCase().includes('pdf');
}

export async function generateFellowshipCandidates(
  root: string = DEFAULT_ACCEPTED_INPUT_ROOT,
  deps: FellowshipInputDeps = {},
) {
  const configs = deps.configs || DEFAULT_PROGRAM_CONFIGS;
  const fetchUrl = deps.fetchUrl || defaultFetchUrl;
  const pdfTextExtractor = deps.pdfTextExtractor || extractPdfText;
  const summaries: Array<{ programKey: string; status: string; candidateCount: number; path: string }> = [];

  for (const config of configs) {
    const rows: FellowshipReviewRow[] = [];
    for (const sourceUrl of config.urls) {
      const defaultYear = inferYearFromUrl(sourceUrl);
      try {
        const fetched = await fetchUrl(sourceUrl);
        const body = Buffer.isBuffer(fetched.body)
          ? fetched.body
          : Buffer.from(String(fetched.body), 'utf8');
        const sourceRows = isPdfSource(sourceUrl, fetched.contentType)
          ? candidateRowsFromText(
              await pdfTextExtractor(body),
              config,
              sourceUrl,
              defaultYear,
            )
          : htmlCandidateRows(body.toString('utf8'), config, sourceUrl, defaultYear);
        rows.push(...sourceRows);
      } catch (error: any) {
        rows.push({
          ...manualRequiredRow(config, sourceUrl),
          reviewNote: `${config.skipReason || 'Manual source review required'}; fetch/extract failed: ${
            error?.message || error
          }`,
        });
      }
    }

    const finalRows = rows.length > 0 ? rows : [manualRequiredRow(config)];
    const outputPath = reviewPath(root, config.programKey);
    await writeRows(outputPath, finalRows, FELLOWSHIP_REVIEW_HEADERS);
    summaries.push({
      programKey: config.programKey,
      status: finalRows.some((row) => row.reviewStatus === 'needs-review')
        ? 'candidates'
        : 'manual-required',
      candidateCount: finalRows.filter((row) => row.reviewStatus === 'needs-review').length,
      path: outputPath,
    });
  }

  return summaries;
}

function parseYear(row: FellowshipReviewRow): number | null {
  const parsed = Number.parseInt(row.year, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function validateFellowshipRows(
  rows: FellowshipReviewRow[],
  options: { programKey: string; advisorResolver?: AdvisorResolver },
): Promise<FellowshipValidationError[]> {
  const errors: FellowshipValidationError[] = [];
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const rowNumber = index + 2;
    const hasAdvisorOrcid = Boolean(row.advisorOrcid);
    if (!parseYear(row)) {
      errors.push({ row: rowNumber, programKey: options.programKey, message: 'Missing year' });
    }
    if (!hasAdvisorOrcid && !row.sourceUrl) {
      errors.push({ row: rowNumber, programKey: options.programKey, message: 'Missing sourceUrl' });
    }
    if (!hasAdvisorOrcid && !row.advisorName) {
      errors.push({
        row: rowNumber,
        programKey: options.programKey,
        message: 'Missing advisorName',
      });
    }
    if (!hasAdvisorOrcid && !row.reviewNote) {
      errors.push({
        row: rowNumber,
        programKey: options.programKey,
        message: 'Missing reviewNote for non-ORCID advisor row',
      });
    }

    if (options.advisorResolver && (row.advisorOrcid || row.advisorName)) {
      const resolution = await options.advisorResolver(row);
      if (resolution.status !== 'resolved') {
        errors.push({
          row: rowNumber,
          programKey: options.programKey,
          message:
            resolution.status === 'ambiguous'
              ? `Advisor identity is ambiguous${resolution.label ? `: ${resolution.label}` : ''}`
              : `Advisor identity is unresolved${resolution.label ? `: ${resolution.label}` : ''}`,
        });
      }
    }
  }
  return errors;
}

export async function exportAcceptedFellowshipRows(
  root: string,
  programKey: string,
  deps: FellowshipInputDeps = {},
) {
  const config = (deps.configs || DEFAULT_PROGRAM_CONFIGS).find((item) => item.programKey === programKey);
  if (!config) throw new Error(`Unknown fellowship program "${programKey}"`);
  const inputPath = reviewPath(root, programKey);
  const rows = (await readReviewRows(inputPath, config)).filter(
    (row) => row.reviewStatus.toLowerCase() === 'accepted',
  );
  if (rows.length === 0) {
    return {
      programKey,
      acceptedCount: 0,
      outputPath: '',
      errors: [
        {
          row: 0,
          programKey,
          message: `No reviewStatus=accepted rows found in ${inputPath}`,
        },
      ],
    };
  }
  const preparedRows: FellowshipReviewRow[] = [];
  for (const row of rows) {
    const prepared = { ...row };
    if (!prepared.advisorName && prepared.advisorOrcid && deps.advisorResolver) {
      const resolution = await deps.advisorResolver(prepared);
      if (resolution.status === 'resolved' && resolution.label) {
        prepared.advisorName = resolution.label;
      }
    }
    preparedRows.push(prepared);
  }

  const errors = await validateFellowshipRows(preparedRows, {
    programKey,
    advisorResolver: deps.advisorResolver,
  });
  if (errors.length > 0) {
    return { programKey, acceptedCount: rows.length, outputPath: '', errors };
  }

  const outputPath = acceptedPath(root, programKey);
  await writeRows(outputPath, preparedRows, FELLOWSHIP_ACCEPTED_HEADERS);
  return { programKey, acceptedCount: preparedRows.length, outputPath, errors };
}

export async function validateAcceptedFellowshipFiles(
  root: string,
  deps: FellowshipInputDeps = {},
) {
  const configs = deps.configs || DEFAULT_PROGRAM_CONFIGS;
  const results: Array<{
    programKey: string;
    status: FellowshipStatus;
    acceptedCount: number;
    errors: FellowshipValidationError[];
    acceptedPath: string;
    reviewPath: string;
  }> = [];

  for (const config of configs) {
    const outputPath = acceptedPath(root, config.programKey);
    const inputReviewPath = reviewPath(root, config.programKey);
    if (await pathExists(outputPath)) {
      const rows = await readReviewRows(outputPath, config);
      const errors = await validateFellowshipRows(rows, {
        programKey: config.programKey,
        advisorResolver: deps.advisorResolver,
      });
      results.push({
        programKey: config.programKey,
        status: errors.length > 0 || rows.length === 0 ? 'invalid' : 'ready',
        acceptedCount: rows.length,
        errors,
        acceptedPath: outputPath,
        reviewPath: inputReviewPath,
      });
      continue;
    }

    if (await pathExists(inputReviewPath)) {
      const reviewRows = await readReviewRows(inputReviewPath, config);
      const manualRequired = reviewRows.some(
        (row) => row.reviewStatus.toLowerCase() === 'manual-required',
      );
      results.push({
        programKey: config.programKey,
        status: manualRequired ? 'manual-required' : 'missing',
        acceptedCount: 0,
        errors: [],
        acceptedPath: outputPath,
        reviewPath: inputReviewPath,
      });
      continue;
    }

    results.push({
      programKey: config.programKey,
      status: 'missing',
      acceptedCount: 0,
      errors: [],
      acceptedPath: outputPath,
      reviewPath: inputReviewPath,
    });
  }

  return results;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function findUserByName(advisorName: string): Promise<AdvisorResolution> {
  const cleaned = normalizeName(advisorName);
  const { first, last } = splitName(cleaned);
  if (!last) return { status: 'missing', label: advisorName };
  const facultyTypes = { $in: ['professor', 'faculty', 'admin'] };
  const lname = new RegExp(`^${escapeRegex(last)}$`, 'i');

  const queries: Record<string, unknown>[] = [];
  if (first) {
    queries.push({ lname, fname: new RegExp(`^${escapeRegex(first)}$`, 'i'), userType: facultyTypes });
    queries.push({ lname, fname: new RegExp(`^${escapeRegex(first.charAt(0))}`, 'i'), userType: facultyTypes });
  }
  queries.push({ lname, userType: facultyTypes });

  for (const query of queries) {
    const matches = await User.find(query, { fname: 1, lname: 1, netid: 1 })
      .limit(2)
      .lean();
    if (matches.length === 1) {
      const match = matches[0] as any;
      return {
        status: 'resolved',
        label: `${match.fname || ''} ${match.lname || ''}`.trim() || match.netid,
      };
    }
    if (matches.length > 1) {
      return { status: 'ambiguous', label: advisorName };
    }
  }

  return { status: 'missing', label: advisorName };
}

export async function defaultAdvisorResolver(row: FellowshipReviewRow): Promise<AdvisorResolution> {
  const advisorOrcid = normalizeOrcid(row.advisorOrcid);
  const facultyTypes = { $in: ['professor', 'faculty', 'admin'] };
  if (advisorOrcid) {
    const matches = await User.find({ orcid: advisorOrcid, userType: facultyTypes }, { fname: 1, lname: 1, netid: 1 })
      .limit(2)
      .lean();
    if (matches.length === 1) {
      const match = matches[0] as any;
      return {
        status: 'resolved',
        label: `${match.fname || ''} ${match.lname || ''}`.trim() || match.netid,
      };
    }
    if (matches.length > 1) return { status: 'ambiguous', label: advisorOrcid };
    return { status: 'missing', label: advisorOrcid };
  }

  return findUserByName(row.advisorName);
}
