import fs from 'fs/promises';
import path from 'path';
import { User } from '../models/user';
import { isPublicHttpUrl } from '../utils/urlSafety';
import {
  DEFAULT_PROGRAM_CONFIGS,
  type ProgramConfig,
} from '../scrapers/sources/undergradFellowshipRecipientScraper';

export const DEFAULT_ACCEPTED_INPUT_ROOT = '/tmp/ylabs-accepted-inputs';
export const ACCEPTED_INPUT_SOURCE = 'accepted-inputs';

export interface AcceptedInputUser {
  _id: unknown;
  netid?: string;
  email?: string;
  fname?: string;
  lname?: string;
  userType?: string;
  title?: string;
  orcid?: string;
  openAlexId?: string;
  website?: string;
  profileUrls?: unknown;
  scholarCandidateProfileUrls?: string[];
  profileVerified?: boolean;
  primaryDepartment?: string;
  secondaryDepartments?: string[];
  departments?: string[];
  googleScholarId?: string;
  manuallyLockedFields?: string[];
  dataSources?: string[];
}

export interface CrosswalkHint {
  name?: string;
  email?: string;
  openAlexId?: string;
  profileUrl?: string;
  sourceUrl?: string;
  reviewNote?: string;
}

export type CrosswalkStatus =
  | 'matched-existing'
  | 'matched-new'
  | 'ambiguous'
  | 'unresolved'
  | 'invalid-orcid';

export interface CrosswalkUserSummary {
  userId: string;
  name: string;
  diagnosticNetid?: string;
  email?: string;
  primaryDepartment?: string;
}

export interface OrcidCrosswalkResult {
  status: CrosswalkStatus;
  normalizedOrcid: string | null;
  user?: AcceptedInputUser;
  userSummary?: CrosswalkUserSummary;
  candidates: CrosswalkUserSummary[];
  basis: string[];
  canPersist: boolean;
  message?: string;
}

export interface AcceptedInputIssue {
  row?: number;
  orcid?: string;
  status: string;
  message: string;
}

export interface FileValidationResult {
  status: 'ready' | 'blocked' | 'missing' | 'manual-required';
  totalRows: number;
  readyRows: number;
  blockedRows: number;
  issues: AcceptedInputIssue[];
}

export interface FellowshipValidationResult extends FileValidationResult {
  programKey: string;
}

export interface FellowshipExportResult {
  programKey: string;
  csv: string;
  validation: FellowshipValidationResult;
  exportedRows: number;
}

export interface ScholarAcceptedRow {
  rowNumber: number;
  orcid: string;
  googleScholarId: string;
  profileUrl: string;
  reviewNote: string;
  user: AcceptedInputUser;
}

export interface ScholarValidationResult extends FileValidationResult {
  ready: ScholarAcceptedRow[];
}

export interface ScholarApplyResult {
  dryRun: boolean;
  validation: ScholarValidationResult;
  appliedRows: number;
  updates: Array<{
    row: number;
    orcid: string;
    googleScholarId: string;
    user: CrosswalkUserSummary;
  }>;
}

export interface ArxivResolvedTarget {
  row: number;
  orcid: string;
  userId: string;
  name: string;
  diagnosticNetid?: string;
  scraperOnlyValue: string;
}

export interface ArxivValidationResult extends FileValidationResult {
  resolvedTargets: ArxivResolvedTarget[];
  scraperOnlyValues: string[];
}

export interface OrcidCrosswalkApplyResult {
  dryRun: boolean;
  totalRows: number;
  readyRows: number;
  appliedRows: number;
  issues: AcceptedInputIssue[];
  updates: Array<{
    row: number;
    orcid: string;
    user: CrosswalkUserSummary;
    basis: string[];
  }>;
}

export type UpdateUserFn = (
  userId: unknown,
  update: Record<string, unknown>,
) => Promise<unknown>;

type CsvRecord = Record<string, string>;

const USER_PROJECTION = {
  _id: 1,
  netid: 1,
  email: 1,
  fname: 1,
  lname: 1,
  userType: 1,
  title: 1,
  orcid: 1,
  openAlexId: 1,
  website: 1,
  profileUrls: 1,
  scholarCandidateProfileUrls: 1,
  profileVerified: 1,
  primaryDepartment: 1,
  secondaryDepartments: 1,
  departments: 1,
  googleScholarId: 1,
  manuallyLockedFields: 1,
  dataSources: 1,
};

export function normalizeOrcid(raw: string | null | undefined): string | null {
  const compact = String(raw || '')
    .trim()
    .replace(/^https?:\/\/orcid\.org\//i, '')
    .replace(/^orcid:/i, '')
    .replace(/[\s-]/g, '')
    .toUpperCase();
  if (!/^\d{15}[\dX]$/.test(compact)) return null;
  const formatted = `${compact.slice(0, 4)}-${compact.slice(4, 8)}-${compact.slice(
    8,
    12,
  )}-${compact.slice(12)}`;
  return isValidOrcid(formatted) ? formatted : null;
}

export function isValidOrcid(raw: string | null | undefined): boolean {
  const compact = String(raw || '')
    .trim()
    .replace(/^https?:\/\/orcid\.org\//i, '')
    .replace(/^orcid:/i, '')
    .replace(/[\s-]/g, '')
    .toUpperCase();
  if (!/^\d{15}[\dX]$/.test(compact)) return false;

  let total = 0;
  for (const digit of compact.slice(0, 15)) {
    total = (total + Number(digit)) * 2;
  }
  const result = (12 - (total % 11)) % 11;
  const expected = result === 10 ? 'X' : String(result);
  return compact[15] === expected;
}

export function parseCsvRecords(input: string): CsvRecord[] {
  const rows = parseCsvRows(input);
  if (rows.length < 1) return [];
  const headers = rows[0].map(normalizedHeader);
  return rows.slice(1).flatMap((cells) => {
    if (!cells.some((cell) => cell.trim().length > 0)) return [];
    if (cells[0]?.trim().startsWith('#')) return [];
    const record: CsvRecord = {};
    headers.forEach((header, index) => {
      record[header] = cells[index]?.trim() || '';
    });
    return [record];
  });
}

export function serializeCsv(
  rows: Array<Record<string, unknown>>,
  headers: string[],
): string {
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => escapeCsvCell(row[header])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

export function userDisplayName(user: AcceptedInputUser): string {
  return normalizeWhitespace(`${user.fname || ''} ${user.lname || ''}`) || 'Unknown';
}

export function isYaleConfirmedUser(user: AcceptedInputUser): boolean {
  if (user.netid && user.netid.trim()) return true;
  if (isYaleEmail(user.email)) return true;
  if (user.profileVerified) return true;
  return userProfileUrls(user).some(isYaleUrl);
}

export function summarizeUser(user: AcceptedInputUser): CrosswalkUserSummary {
  return {
    userId: stringifyId(user._id),
    name: userDisplayName(user),
    diagnosticNetid: user.netid || undefined,
    email: user.email || undefined,
    primaryDepartment: user.primaryDepartment || undefined,
  };
}

export function resolveOrcidCrosswalk(
  orcidInput: string,
  users: AcceptedInputUser[],
  hints: CrosswalkHint = {},
): OrcidCrosswalkResult {
  const normalizedOrcid = normalizeOrcid(orcidInput);
  if (!normalizedOrcid) {
    return {
      status: 'invalid-orcid',
      normalizedOrcid: null,
      candidates: [],
      basis: [],
      canPersist: false,
      message: 'ORCID failed format or checksum validation',
    };
  }

  const existing = users.filter((user) => normalizeOrcid(user.orcid) === normalizedOrcid);
  if (existing.length === 1) {
    const user = existing[0];
    if (!isYaleConfirmedUser(user)) {
      return {
        status: 'unresolved',
        normalizedOrcid,
        user,
        userSummary: summarizeUser(user),
        candidates: [summarizeUser(user)],
        basis: ['user.orcid'],
        canPersist: false,
        message: 'ORCID exists on a user that is not Yale-confirmed',
      };
    }
    return {
      status: 'matched-existing',
      normalizedOrcid,
      user,
      userSummary: summarizeUser(user),
      candidates: [summarizeUser(user)],
      basis: ['user.orcid'],
      canPersist: false,
    };
  }
  if (existing.length > 1) {
    return {
      status: 'ambiguous',
      normalizedOrcid,
      candidates: existing.map(summarizeUser),
      basis: ['user.orcid'],
      canPersist: false,
      message: 'ORCID is already attached to multiple users',
    };
  }

  const candidateMap = new Map<string, { user: AcceptedInputUser; basis: Set<string> }>();
  const addCandidate = (user: AcceptedInputUser, basis: string) => {
    const key = stringifyId(user._id);
    const existingCandidate = candidateMap.get(key);
    if (existingCandidate) {
      existingCandidate.basis.add(basis);
      return;
    }
    candidateMap.set(key, { user, basis: new Set([basis]) });
  };

  const hintEmail = normalizeEmail(hints.email);
  if (hintEmail) {
    for (const user of users) {
      if (normalizeEmail(user.email) === hintEmail) addCandidate(user, 'yale-email');
    }
  }

  const hintOpenAlex = normalizeExternalId(hints.openAlexId);
  if (hintOpenAlex) {
    for (const user of users) {
      if (normalizeExternalId(user.openAlexId) === hintOpenAlex) addCandidate(user, 'openalex');
    }
  }

  const hintProfile = hints.profileUrl || hints.sourceUrl;
  if (hintProfile) {
    const canonicalHint = canonicalUrl(hintProfile);
    for (const user of users) {
      const matchedProfile = userProfileUrls(user).some(
        (url) => canonicalUrl(url) === canonicalHint,
      );
      if (matchedProfile) addCandidate(user, 'official-profile-url');
    }
  }

  const hintName = normalizePersonName(hints.name);
  const hasOfficialYaleSource =
    isYaleUrl(hints.profileUrl) || isYaleUrl(hints.sourceUrl);
  if (hintName && hasOfficialYaleSource) {
    for (const user of users) {
      if (normalizePersonName(userDisplayName(user)) === hintName) {
        addCandidate(user, 'name-with-yale-source');
      }
    }
  }

  const candidates = Array.from(candidateMap.values());
  if (candidates.length === 0) {
    return {
      status: 'unresolved',
      normalizedOrcid,
      candidates: [],
      basis: [],
      canPersist: false,
      message:
        'No existing Yale-confirmed user matched the supplied ORCID crosswalk evidence',
    };
  }
  if (candidates.length > 1) {
    return {
      status: 'ambiguous',
      normalizedOrcid,
      candidates: candidates.map(({ user }) => summarizeUser(user)),
      basis: Array.from(new Set(candidates.flatMap(({ basis }) => Array.from(basis)))),
      canPersist: false,
      message: 'Crosswalk evidence matched multiple existing users',
    };
  }

  const [{ user, basis }] = candidates;
  const basisList = Array.from(basis);
  const canPersist = isYaleConfirmedUser(user) && hasSourceBackedBasis(basisList);
  return {
    status: canPersist ? 'matched-new' : 'unresolved',
    normalizedOrcid,
    user,
    userSummary: summarizeUser(user),
    candidates: [summarizeUser(user)],
    basis: basisList,
    canPersist,
    message: canPersist
      ? undefined
      : 'Matched candidate lacks Yale confirmation or source-backed evidence',
  };
}

export function validateFellowshipAcceptedCsv(
  programKey: string,
  csv: string,
  users: AcceptedInputUser[],
): FellowshipValidationResult {
  const rows = parseCsvRecords(csv);
  const issues: AcceptedInputIssue[] = [];
  let readyRows = 0;

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const advisorOrcid = field(row, ['advisorOrcid', 'orcid']);
    const advisorName = field(row, ['advisorName', 'advisor', 'facultyAdvisor']);
    const sourceUrl = field(row, ['sourceUrl', 'source', 'sourceLink', 'url']);
    const reviewNote = field(row, ['reviewNote', 'note', 'notes']);
    const year = parseAwardYear(field(row, ['year', 'awardYear', 'fellowshipYear']));
    const rowIssues: AcceptedInputIssue[] = [];

    if (!year) {
      rowIssues.push({
        row: rowNumber,
        status: 'blocked',
        message: 'year, awardYear, or fellowshipYear is required before scraper export',
      });
    }

    if (advisorOrcid) {
      const resolved = resolveOrcidCrosswalk(advisorOrcid, users, {
        name: advisorName || undefined,
        sourceUrl: sourceUrl || undefined,
        reviewNote: reviewNote || undefined,
      });
      if (resolved.status !== 'matched-existing' && resolved.status !== 'matched-new') {
        rowIssues.push({
          row: rowNumber,
          orcid: advisorOrcid,
          status: resolved.status,
          message: resolved.message || 'advisorOrcid did not resolve to one Yale user',
        });
      }
    } else if (!advisorName || !sourceUrl || !reviewNote) {
      rowIssues.push({
        row: rowNumber,
        status: 'manual-required',
        message:
          'Rows without advisorOrcid require advisorName, sourceUrl, and reviewNote',
      });
    } else if (!isHttpUrl(sourceUrl)) {
      rowIssues.push({
        row: rowNumber,
        status: 'blocked',
        message: 'sourceUrl must be an http(s) provenance URL',
      });
    }

    if (rowIssues.length === 0) readyRows++;
    issues.push(...rowIssues);
  });

  return {
    programKey,
    status: issues.length === 0 && rows.length > 0 ? 'ready' : 'blocked',
    totalRows: rows.length,
    readyRows,
    blockedRows: rows.length - readyRows,
    issues,
  };
}

export function exportFellowshipAcceptedCsv(
  programKey: string,
  csv: string,
  users: AcceptedInputUser[],
): FellowshipExportResult {
  const validation = validateFellowshipAcceptedCsv(programKey, csv, users);
  const rows = parseCsvRecords(csv);
  const out: Array<Record<string, unknown>> = [];

  rows.forEach((row) => {
    const advisorOrcidRaw = field(row, ['advisorOrcid', 'orcid']);
    const advisorOrcid = normalizeOrcid(advisorOrcidRaw) || advisorOrcidRaw;
    const resolved = advisorOrcidRaw
      ? resolveOrcidCrosswalk(advisorOrcidRaw, users, {
          name: field(row, ['advisorName', 'advisor', 'facultyAdvisor']) || undefined,
          sourceUrl: field(row, ['sourceUrl', 'source', 'sourceLink', 'url']) || undefined,
        })
      : null;
    const year = parseAwardYear(field(row, ['year', 'awardYear', 'fellowshipYear']));
    if (!year) return;
    if (
      advisorOrcidRaw &&
      resolved?.status !== 'matched-existing' &&
      resolved?.status !== 'matched-new'
    ) {
      return;
    }

    const advisorName =
      field(row, ['advisorName', 'advisor', 'facultyAdvisor']) ||
      (resolved?.user ? userDisplayName(resolved.user) : '');
    if (!advisorName) return;

    const sourceUrl = field(row, ['sourceUrl', 'source', 'sourceLink', 'url']);
    const reviewNote = field(row, ['reviewNote', 'note', 'notes']);
    if (!advisorOrcidRaw && (!sourceUrl || !reviewNote)) return;

    out.push({
      advisorName,
      advisorOrcid,
      year,
      studentName: field(row, ['studentName', 'student', 'recipientName', 'recipient']),
      projectTitle: field(row, ['projectTitle', 'project', 'title', 'researchTitle']),
      sourceUrl,
      reviewNote,
    });
  });

  return {
    programKey,
    csv: serializeCsv(out, [
      'advisorName',
      'advisorOrcid',
      'year',
      'studentName',
      'projectTitle',
      'sourceUrl',
      'reviewNote',
    ]),
    validation,
    exportedRows: out.length,
  };
}

export function validateScholarAcceptedCsv(
  csv: string,
  users: AcceptedInputUser[],
): ScholarValidationResult {
  const rows = parseCsvRecords(csv);
  const issues: AcceptedInputIssue[] = [];
  const ready: ScholarAcceptedRow[] = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const orcidRaw = field(row, ['orcid', 'advisorOrcid']);
    const googleScholarId = field(row, ['googleScholarId', 'scholarId', 'authorId']);
    const profileUrl = field(row, ['profileUrl', 'googleScholarProfileUrl', 'url']);
    const reviewNote = field(row, ['reviewNote', 'note', 'notes']);
    const normalizedOrcid = normalizeOrcid(orcidRaw);
    const rowIssues: AcceptedInputIssue[] = [];

    if (!normalizedOrcid) {
      rowIssues.push({
        row: rowNumber,
        orcid: orcidRaw,
        status: 'invalid-orcid',
        message: 'orcid is required and must pass checksum validation',
      });
    }
    if (!googleScholarId) {
      rowIssues.push({
        row: rowNumber,
        status: 'blocked',
        message: 'googleScholarId is required',
      });
    }
    if (!profileUrl || !isGoogleScholarProfileUrl(profileUrl)) {
      rowIssues.push({
        row: rowNumber,
        status: 'blocked',
        message: 'profileUrl must be a Google Scholar citations profile URL',
      });
    }
    if (!reviewNote) {
      rowIssues.push({
        row: rowNumber,
        status: 'blocked',
        message: 'reviewNote is required',
      });
    }

    if (normalizedOrcid) {
      const resolved = resolveOrcidCrosswalk(normalizedOrcid, users);
      if (resolved.status !== 'matched-existing' || !resolved.user) {
        rowIssues.push({
          row: rowNumber,
          orcid: normalizedOrcid,
          status: resolved.status,
          message:
            resolved.message ||
            'Scholar accepted rows require ORCID to already resolve to one Yale user',
        });
      } else if (rowIssues.length === 0) {
        ready.push({
          rowNumber,
          orcid: normalizedOrcid,
          googleScholarId,
          profileUrl,
          reviewNote,
          user: resolved.user,
        });
      }
    }

    issues.push(...rowIssues);
  });

  return {
    status: issues.length === 0 && rows.length > 0 ? 'ready' : 'blocked',
    totalRows: rows.length,
    readyRows: ready.length,
    blockedRows: rows.length - ready.length,
    issues,
    ready,
  };
}

export async function applyScholarAcceptedCsv(
  csv: string,
  users: AcceptedInputUser[],
  options: { dryRun: boolean; updateUser?: UpdateUserFn } = { dryRun: true },
): Promise<ScholarApplyResult> {
  const validation = validateScholarAcceptedCsv(csv, users);
  const updateUser = options.updateUser || defaultUpdateUser;
  const updates: ScholarApplyResult['updates'] = [];

  for (const row of validation.ready) {
    updates.push({
      row: row.rowNumber,
      orcid: row.orcid,
      googleScholarId: row.googleScholarId,
      user: summarizeUser(row.user),
    });
    if (options.dryRun) continue;
    await updateUser(row.user._id, {
      $set: {
        googleScholarId: row.googleScholarId,
        'profileUrls.googleScholar': row.profileUrl,
        'confidenceByField.googleScholarId': 1,
      },
      $addToSet: {
        manuallyLockedFields: 'googleScholarId',
        dataSources: ACCEPTED_INPUT_SOURCE,
      },
    });
  }

  return {
    dryRun: options.dryRun,
    validation,
    appliedRows: options.dryRun ? 0 : updates.length,
    updates,
  };
}

export function validateArxivOrcidList(
  input: string,
  users: AcceptedInputUser[],
): ArxivValidationResult {
  const rows = parseOrcidLines(input);
  const issues: AcceptedInputIssue[] = [];
  const resolvedTargets: ArxivResolvedTarget[] = [];

  rows.forEach(({ raw, row }) => {
    const normalizedOrcid = normalizeOrcid(raw);
    if (!normalizedOrcid) {
      issues.push({
        row,
        orcid: raw,
        status: 'invalid-orcid',
        message: 'ORCID failed format or checksum validation',
      });
      return;
    }
    const resolved = resolveOrcidCrosswalk(normalizedOrcid, users);
    if (resolved.status !== 'matched-existing' || !resolved.user) {
      issues.push({
        row,
        orcid: normalizedOrcid,
        status: resolved.status,
        message:
          resolved.message ||
          'arXiv accepted ORCID must already resolve to one Yale-confirmed user',
      });
      return;
    }
    const name = userDisplayName(resolved.user);
    const scraperOnlyValue = resolved.user.netid || name;
    resolvedTargets.push({
      row,
      orcid: normalizedOrcid,
      userId: stringifyId(resolved.user._id),
      name,
      diagnosticNetid: resolved.user.netid || undefined,
      scraperOnlyValue,
    });
  });

  return {
    status: issues.length === 0 && rows.length > 0 ? 'ready' : 'blocked',
    totalRows: rows.length,
    readyRows: resolvedTargets.length,
    blockedRows: rows.length - resolvedTargets.length,
    issues,
    resolvedTargets,
    scraperOnlyValues: resolvedTargets.map((target) => target.scraperOnlyValue),
  };
}

export async function applyOrcidCrosswalkCsv(
  csv: string,
  users: AcceptedInputUser[],
  options: { dryRun: boolean; updateUser?: UpdateUserFn } = { dryRun: true },
): Promise<OrcidCrosswalkApplyResult> {
  const rows = parseCsvRecords(csv);
  const issues: AcceptedInputIssue[] = [];
  const updates: OrcidCrosswalkApplyResult['updates'] = [];
  const updateUser = options.updateUser || defaultUpdateUser;

  rows.forEach((row, index) => {
    const rowNumber = index + 2;
    const orcid = field(row, ['orcid', 'advisorOrcid']);
    const hints: CrosswalkHint = {
      name: field(row, ['name', 'fullName', 'advisorName']) || undefined,
      email: field(row, ['email', 'yaleEmail']) || undefined,
      openAlexId: field(row, ['openAlexId', 'openAlex']) || undefined,
      profileUrl: field(row, ['profileUrl', 'yaleProfileUrl']) || undefined,
      sourceUrl: field(row, ['sourceUrl', 'source']) || undefined,
      reviewNote: field(row, ['reviewNote', 'note', 'notes']) || undefined,
    };
    const resolved = resolveOrcidCrosswalk(orcid, users, hints);
    if (resolved.status === 'matched-existing') return;
    if (resolved.status !== 'matched-new' || !resolved.user || !resolved.canPersist) {
      issues.push({
        row: rowNumber,
        orcid,
        status: resolved.status,
        message: resolved.message || 'ORCID could not be persisted confidently',
      });
      return;
    }
    updates.push({
      row: rowNumber,
      orcid: resolved.normalizedOrcid || orcid,
      user: summarizeUser(resolved.user),
      basis: resolved.basis,
    });
  });

  if (!options.dryRun) {
    for (const update of updates) {
      const user = users.find((candidate) => stringifyId(candidate._id) === update.user.userId);
      if (!user) continue;
      await updateUser(user._id, {
        $set: {
          orcid: update.orcid,
          'confidenceByField.orcid': 1,
        },
        $addToSet: {
          dataSources: ACCEPTED_INPUT_SOURCE,
        },
      });
    }
  }

  return {
    dryRun: options.dryRun,
    totalRows: rows.length,
    readyRows: rows.length - issues.length,
    appliedRows: options.dryRun ? 0 : updates.length,
    issues,
    updates,
  };
}

export function buildFellowshipCandidateRows(
  configs: ProgramConfig[] = DEFAULT_PROGRAM_CONFIGS,
): Array<Record<string, unknown>> {
  return configs.map((config) => ({
    programKey: config.programKey,
    programName: config.programName,
    sourceUrl: config.urls[0] || '',
    status: config.manualUploadRequired ? 'manual-required' : 'review-source',
    reviewNote: config.skipReason || '',
  }));
}

export function buildScholarCandidateRows(
  users: AcceptedInputUser[],
  limit = Infinity,
): Array<Record<string, unknown>> {
  return users
    .filter(isResearchFacultyUser)
    .filter((user) => normalizeOrcid(user.orcid))
    .filter((user) => !user.googleScholarId)
    .slice(0, limit)
    .map((user) => {
      const name = userDisplayName(user);
      return {
        orcid: normalizeOrcid(user.orcid) || '',
        name,
        primaryDepartment: user.primaryDepartment || '',
        yaleProfileUrl: preferredYaleProfileUrl(user),
        officialScholarCandidateUrl: (user.scholarCandidateProfileUrls || []).join(' | '),
        googleScholarSearchUrl: `https://scholar.google.com/citations?view_op=search_authors&mauthors=${encodeURIComponent(
          `${name} Yale`,
        )}`,
        googleScholarId: '',
        profileUrl: '',
        reviewNote: '',
      };
    });
}

export function buildArxivCandidateRows(
  users: AcceptedInputUser[],
  limit = Infinity,
): Array<Record<string, unknown>> {
  return users
    .filter(isResearchFacultyUser)
    .filter(isMathPhysicsStatsUser)
    .filter((user) => normalizeOrcid(user.orcid))
    .slice(0, limit)
    .map((user) => ({
      orcid: normalizeOrcid(user.orcid) || '',
      name: userDisplayName(user),
      primaryDepartment: user.primaryDepartment || '',
      diagnosticNetid: user.netid || '',
    }));
}

export function buildArxivCandidateText(users: AcceptedInputUser[], limit = Infinity): string {
  const rows = buildArxivCandidateRows(users, limit);
  const lines = [
    '# Review before copying accepted lines to arxiv-math-physics-stat-orcids.txt',
    '# One ORCID per line; trailing comments are ignored by accepted-inputs arxiv:validate.',
  ];
  for (const row of rows) {
    const comment = [row.name, row.primaryDepartment]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .join(' | ');
    lines.push(comment ? `${row.orcid} # ${comment}` : String(row.orcid));
  }
  return `${lines.join('\n')}\n`;
}

export async function buildAcceptedInputsStatus(
  root: string,
  users: AcceptedInputUser[],
): Promise<Record<string, unknown>> {
  const fellowshipDir = path.join(root, 'fellowships');
  const fellowship = await Promise.all(
    DEFAULT_PROGRAM_CONFIGS.map(async (config) => {
      const filePath = path.join(fellowshipDir, `${config.programKey}.csv`);
      const content = await readFileIfExists(filePath);
      if (content === null) {
        return {
          programKey: config.programKey,
          path: filePath,
          status: 'missing',
          requiredShape:
            'advisorOrcid when known; otherwise advisorName, sourceUrl, reviewNote; year required for scraper export',
        };
      }
      return {
        path: filePath,
        ...validateFellowshipAcceptedCsv(config.programKey, content, users),
      };
    }),
  );

  const scholarPath = path.join(root, 'scholar', 'google-scholar-accepted.csv');
  const scholarContent = await readFileIfExists(scholarPath);
  const scholar =
    scholarContent === null
      ? { path: scholarPath, status: 'missing' }
      : { path: scholarPath, ...validateScholarAcceptedCsv(scholarContent, users) };

  const arxivPath = path.join(root, 'arxiv-math-physics-stat-orcids.txt');
  const arxivContent = await readFileIfExists(arxivPath);
  const arxiv =
    arxivContent === null
      ? { path: arxivPath, status: 'missing' }
      : { path: arxivPath, ...validateArxivOrcidList(arxivContent, users) };

  const crosswalkPath = path.join(root, 'orcid-crosswalk.csv');
  const crosswalkContent = await readFileIfExists(crosswalkPath);
  const crosswalk =
    crosswalkContent === null
      ? { path: crosswalkPath, status: 'missing' }
      : await applyOrcidCrosswalkCsv(crosswalkContent, users, { dryRun: true });

  return {
    root,
    fellowship,
    scholar,
    arxiv,
    crosswalk: {
      path: crosswalkPath,
      ...crosswalk,
    },
  };
}

export async function loadAcceptedInputUsers(): Promise<AcceptedInputUser[]> {
  const docs = await User.find({}, USER_PROJECTION).lean();
  return docs.map((doc) => normalizeLoadedUser(doc as Record<string, unknown>));
}

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

function field(row: CsvRecord, names: string[]): string {
  for (const name of names) {
    const value = row[normalizedHeader(name)];
    if (value) return value.trim();
  }
  return '';
}

function escapeCsvCell(value: unknown): string {
  const text = String(value ?? '');
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function parseAwardYear(raw: string): number | null {
  const match = raw.match(/\b(19[89]\d|20\d{2})\b/);
  if (!match) return null;
  const year = Number(match[1]);
  const max = new Date().getFullYear() + 1;
  return year >= 1980 && year <= max ? year : null;
}

function parseOrcidLines(input: string): Array<{ row: number; raw: string }> {
  return input
    .split(/\r?\n/)
    .map((line, index) => ({ row: index + 1, raw: line.replace(/\s+#.*$/, '').trim() }))
    .filter(({ raw }) => raw.length > 0 && !raw.startsWith('#'));
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeEmail(value: string | undefined): string {
  return String(value || '').trim().toLowerCase();
}

function normalizeExternalId(value: string | undefined): string {
  return String(value || '').trim().toLowerCase();
}

function normalizePersonName(value: string | undefined): string {
  return normalizeWhitespace(String(value || ''))
    .toLowerCase()
    .replace(/\b(dr|prof|professor|phd|m\.d|md)\b\.?/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function stringifyId(value: unknown): string {
  if (value && typeof value === 'object' && 'toString' in value) {
    return String((value as { toString(): string }).toString());
  }
  return String(value || '');
}

function isYaleEmail(value: string | undefined): boolean {
  return normalizeEmail(value).endsWith('@yale.edu');
}

function isHttpUrl(value: string | undefined): boolean {
  return isPublicHttpUrl(value);
}

function isYaleUrl(value: string | undefined): boolean {
  if (!isPublicHttpUrl(value)) return false;
  try {
    const host = new URL(String(value || '')).hostname.toLowerCase();
    return host === 'yale.edu' || host.endsWith('.yale.edu');
  } catch {
    return false;
  }
}

function isGoogleScholarProfileUrl(value: string | undefined): boolean {
  try {
    const url = new URL(String(value || ''));
    return (
      url.hostname.toLowerCase().includes('scholar.google.') &&
      url.pathname.includes('/citations') &&
      Boolean(url.searchParams.get('user'))
    );
  } catch {
    return false;
  }
}

function canonicalUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.toString().replace(/\/$/, '').toLowerCase();
  } catch {
    return normalizeWhitespace(value).replace(/\/$/, '').toLowerCase();
  }
}

function userProfileUrls(user: AcceptedInputUser): string[] {
  const urls: string[] = [];
  if (user.website) urls.push(user.website);
  collectProfileUrls(user.profileUrls, urls);
  return urls.filter((url) => url.trim().length > 0);
}

function preferredYaleProfileUrl(user: AcceptedInputUser): string {
  const urls = userProfileUrls(user).filter(isYaleUrl);
  return urls[0] || '';
}

function collectProfileUrls(value: unknown, urls: string[]): void {
  if (!value) return;
  if (typeof value === 'string') {
    urls.push(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectProfileUrls(item, urls));
    return;
  }
  if (typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach((item) =>
      collectProfileUrls(item, urls),
    );
  }
}

function hasSourceBackedBasis(basis: string[]): boolean {
  return basis.some((item) =>
    ['yale-email', 'openalex', 'official-profile-url', 'name-with-yale-source'].includes(
      item,
    ),
  );
}

function isResearchFacultyUser(user: AcceptedInputUser): boolean {
  return ['professor', 'faculty'].includes(String(user.userType || '').toLowerCase());
}

function isMathPhysicsStatsUser(user: AcceptedInputUser): boolean {
  const text = [
    user.primaryDepartment,
    ...(user.secondaryDepartments || []),
    ...(user.departments || []),
    user.title,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return [
    /\bmath(?:ematics)?\b/,
    /\bstatistics?\b/,
    /\bdata science\b/,
    /\bphysics\b/,
    /\bapplied physics\b/,
    /\bastronomy\b/,
    /\bastrophysics\b/,
  ].some((pattern) => pattern.test(text));
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function normalizeLoadedUser(doc: Record<string, unknown>): AcceptedInputUser {
  return {
    _id: doc._id,
    netid: asString(doc.netid),
    email: asString(doc.email),
    fname: asString(doc.fname),
    lname: asString(doc.lname),
    userType: asString(doc.userType),
    title: asString(doc.title),
    orcid: asString(doc.orcid),
    openAlexId: asString(doc.openAlexId),
    website: asString(doc.website),
    profileUrls: doc.profileUrls,
    scholarCandidateProfileUrls: Array.isArray(doc.scholarCandidateProfileUrls)
      ? doc.scholarCandidateProfileUrls
          .map(asString)
          .filter((value): value is string => Boolean(value))
      : [],
    profileVerified: Boolean(doc.profileVerified),
    primaryDepartment: asString(doc.primaryDepartment),
    secondaryDepartments: asStringArray(doc.secondaryDepartments),
    departments: asStringArray(doc.departments),
    googleScholarId: asString(doc.googleScholarId),
    manuallyLockedFields: asStringArray(doc.manuallyLockedFields),
    dataSources: asStringArray(doc.dataSources),
  };
}

async function readFileIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error: unknown) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'ENOENT'
    ) {
      return null;
    }
    throw error;
  }
}

async function defaultUpdateUser(
  userId: unknown,
  update: Record<string, unknown>,
): Promise<unknown> {
  return await User.updateOne({ _id: userId }, update);
}
