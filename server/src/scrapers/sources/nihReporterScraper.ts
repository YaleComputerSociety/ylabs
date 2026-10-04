/**
 * NihReporterScraper
 *
 * Pulls active NIH-funded research projects whose lead organization is Yale from
 * the public NIH RePORTER API (https://api.reporter.nih.gov/v2/projects/search).
 * The endpoint is free, requires no auth, and accepts a `User-Agent` header.
 *
 * The single canonical org_names value "YALE UNIVERSITY" captures all Yale
 * grants (we verified that "YALE SCHOOL OF MEDICINE", "YALE NEW HAVEN HOSPITAL",
 * etc. all resolve to 0 — RePORTER normalizes to a single org_name per IPF
 * code). YSM, YSPH and other school-affiliated grants surface under the same
 * "YALE UNIVERSITY" umbrella with `organization.dept_type` distinguishing them.
 *
 * Strategy:
 *   - Paginate through Yale grants (offset/limit, max 500 per request).
 *   - Group grants by every Yale principal investigator: the contact PI, plus each
 *     multi-PI co-PI whose most recent contact-PI project in RePORTER is at Yale.
 *     RePORTER's PI entries carry no organization, so a co-PI with no such evidence
 *     is never credited, because a same-name match would give a Yale researcher
 *     another institution's PI's grant (#4629).
 *   - For each PI:
 *       - Resolve an unambiguous canonical Researcher by exact or conservative prefix name matching.
 *       - Resolve the one existing research row the canonical resolver names for them.
 *         A grant proves that a person is funded, never that a row should exist, so
 *         every other outcome is counted by reason and mints nothing (#3145, #3561).
 *       - Emit grant evidence without replacing identity fields on the existing row.
 *
 * Honors:
 *   - ctx.options.useCache — caches each (offset/limit/fiscal_year) page payload.
 *   - ctx.options.limit — caps the *number of PIs processed*, not raw grants.
 */
import axios from 'axios';
import { sanitizeLogValue } from '../../utils/logSanitizer';
import { getCached, setCached } from '../snapshotCache';
import {
  resolveCanonicalResearchHomeForResearcher,
  type CanonicalResearchHomeResolution,
} from '../canonicalResearchHomeResolver';
import { Researcher } from '../../models/researcher';
import { resolveResearcherIdForPersonName } from '../../services/researcherPersonNameResolver';
import {
  countGrantAttach,
  emptyGrantAttachTally,
  grantAttachSummary,
  resolveGrantEnrichmentTarget,
} from '../utils/grantEnrichmentTarget';
import { recentGrantPeriodsOf } from '../utils/recentGrantPeriods';
import type { IScraper, ScraperContext, ScraperResult, ObservationInput } from '../types';
import { retryOnRetryableStatus } from '../utils/httpFetch';

const REPORTER_ENDPOINT = 'https://api.reporter.nih.gov/v2/projects/search';
const USER_AGENT = 'ylabs-scraper/1.0 (+https://yalelabs.io)';
const GRANT_DESCRIPTION_MAX_CHARS = 420;
const PAGE_SIZE = 500;
const FETCH_TIMEOUT_MS = 60_000;
const RECENT_GRANTS_PER_PI = 10;
export const fiscalYearsEndingAt = (date: Date): number[] => [
  date.getFullYear() - 2,
  date.getFullYear() - 1,
  date.getFullYear(),
];
const YALE_ORG_NAMES = ['YALE UNIVERSITY'];
// Cap how many pages we'll ever request defensively. 30 pages * 500 = 15k records,
// well above Yale's typical ~3.5k for a 3-year window.
const MAX_PAGES = 30;

// NIH individual trainee-fellowship activity codes (F30/F31/F32/F33): the
// contact PI on these awards is the trainee (grad student / postdoc), not a
// faculty lab lead, so their awards are never attributed to a row as its
// lead's funding (#739).
const TRAINEE_FELLOWSHIP_ACTIVITY_CODES = new Set(['F30', 'F31', 'F32', 'F33']);
const AFFILIATION_PROFILE_BATCH = 50;

// ---------------------------------------------------------------------------
// API response shapes (only the fields we use)
// ---------------------------------------------------------------------------

export interface NihPrincipalInvestigator {
  profile_id?: number;
  first_name?: string;
  middle_name?: string;
  last_name?: string;
  full_name?: string;
  is_contact_pi?: boolean;
  title?: string;
}

export interface NihAgencyAdmin {
  code?: string;
  abbreviation?: string;
  name?: string;
}

export interface NihOrganization {
  org_name?: string;
  dept_type?: string;
  org_city?: string;
  org_state?: string;
}

export interface NihProjectNumSplit {
  appl_type_code?: string;
  activity_code?: string;
  ic_code?: string;
  serial_num?: string;
  support_year?: string;
  suffix_code?: string;
}

export interface NihGrant {
  project_num?: string;
  appl_id?: number;
  core_project_num?: string;
  project_num_split?: NihProjectNumSplit;
  project_title?: string;
  abstract_text?: string;
  contact_pi_name?: string;
  principal_investigators?: NihPrincipalInvestigator[];
  organization?: NihOrganization;
  fiscal_year?: number;
  award_amount?: number;
  project_start_date?: string;
  project_end_date?: string;
  agency_ic_admin?: NihAgencyAdmin;
  activity_code?: string;
  project_detail_url?: string;
  is_active?: boolean;
}

interface NihPage {
  meta: {
    total: number;
    offset: number;
    limit: number;
  };
  results: NihGrant[];
}

// ---------------------------------------------------------------------------
// Normalized record shape we emit into ResearchGroup.recentGrants
// ---------------------------------------------------------------------------

export interface RecentGrantRecord {
  id: string;
  agency: string;
  title: string;
  abstract: string;
  startDate?: Date;
  endDate?: Date;
  dollarAmount: number;
  url: string;
  role: 'pi' | 'copi';
}

// ---------------------------------------------------------------------------
// Pure helpers (testable in isolation)
// ---------------------------------------------------------------------------

/**
 * Convert "TABACHNIKOVA, ALEXANDRA " (RePORTER's contact_pi_name format) into
 * a canonical "First Last" representation. Falls back to the raw string when
 * no comma is present.
 */
export function canonicalPiName(raw: string | undefined | null): string {
  if (!raw) return '';
  const trimmed = String(raw).trim();
  if (!trimmed) return '';
  if (trimmed.includes(',')) {
    const [last, rest] = trimmed.split(',', 2).map((s) => s.trim());
    const firstChunk = (rest || '').split(/\s+/)[0] || '';
    const last_t = titleCaseToken(last);
    const first_t = titleCaseToken(firstChunk);
    return [first_t, last_t].filter(Boolean).join(' ');
  }
  return trimmed.split(/\s+/).filter(Boolean).map(titleCaseToken).join(' ');
}

function titleCaseToken(token: string): string {
  if (!token) return '';
  // Title-case each letter run around a hyphen/apostrophe separately, e.g.
  // "OHNO-MACHADO" -> "Ohno-Machado", "D'SOUZA" -> "D'Souza".
  return token
    .split(/([-'‘’])/)
    .map((part) => (/^[A-Z]+$/.test(part) ? part.charAt(0) + part.slice(1).toLowerCase() : part))
    .join('');
}

/**
 * True when a grant is an NIH individual trainee-fellowship award (F30/F31/F32/
 * F33), whose contact PI is the trainee rather than a faculty lab lead. These
 * awards fail closed at ingestion: dropping them before grouping means a
 * trainee's award never reaches a row, while a faculty PI's normal awards
 * (R01, R35, ...) still group unaffected (#739).
 */
export function isTraineeFellowshipGrant(grant: NihGrant): boolean {
  const code = (grant.activity_code || '').trim().toUpperCase();
  return TRAINEE_FELLOWSHIP_ACTIVITY_CODES.has(code);
}

/**
 * Group grants by their contact PI's canonical name.
 *
 * The RePORTER record sometimes lists multiple PIs in `principal_investigators`
 * — we attribute the grant to whichever entry has `is_contact_pi: true`,
 * falling back to `contact_pi_name`. Grants with no resolvable PI are
 * dropped.
 */
export function groupGrantsByPi(grants: NihGrant[]): Map<string, NihGrant[]> {
  const groups = new Map<string, NihGrant[]>();
  for (const grant of grants) {
    const piName = pickContactPiName(grant);
    if (!piName) continue;
    const list = groups.get(piName) || [];
    list.push(grant);
    groups.set(piName, list);
  }
  return groups;
}

export interface ContactPiAffiliation {
  fiscalYear: number;
  atYale: boolean;
}

export type ContactPiAffiliationLookup = (
  profileIds: number[],
) => Promise<Map<number, ContactPiAffiliation>>;

export function principalInvestigatorName(pi: NihPrincipalInvestigator): string {
  const first = (pi.first_name || '').trim();
  const last = (pi.last_name || '').trim();
  if (first || last) return canonicalPiName(`${last}, ${first}`.trim());
  return pi.full_name ? canonicalPiName(pi.full_name) : '';
}

const isProfileId = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value);

export function contactPiProfileIds(grants: readonly NihGrant[]): Set<number> {
  const ids = new Set<number>();
  for (const grant of grants) {
    for (const pi of grant.principal_investigators || []) {
      if (pi.is_contact_pi && isProfileId(pi.profile_id)) ids.add(pi.profile_id);
    }
  }
  return ids;
}

export function nonContactPiProfileIds(grants: readonly NihGrant[]): number[] {
  const contact = contactPiProfileIds(grants);
  const ids = new Set<number>();
  for (const grant of grants) {
    for (const pi of grant.principal_investigators || []) {
      if (!pi.is_contact_pi && isProfileId(pi.profile_id) && !contact.has(pi.profile_id)) {
        ids.add(pi.profile_id);
      }
    }
  }
  return [...ids];
}

export function isYaleOrganization(orgName: string | undefined): boolean {
  const normalized = (orgName || '').trim().toUpperCase();
  return YALE_ORG_NAMES.includes(normalized);
}

/**
 * The latest fiscal year in which each profile is a contact PI, and whether every
 * contact-PI project that year is at Yale. A tie with another institution reads as
 * not at Yale, so a split year fails closed.
 */
export function latestContactPiAffiliations(
  projects: readonly NihGrant[],
  profileIds: ReadonlySet<number>,
): Map<number, ContactPiAffiliation> {
  const latest = new Map<number, ContactPiAffiliation>();
  for (const project of projects) {
    const fiscalYear = typeof project.fiscal_year === 'number' ? project.fiscal_year : 0;
    const atYale = isYaleOrganization(project.organization?.org_name);
    for (const pi of project.principal_investigators || []) {
      if (!pi.is_contact_pi || !isProfileId(pi.profile_id) || !profileIds.has(pi.profile_id)) {
        continue;
      }
      const held = latest.get(pi.profile_id);
      if (!held || fiscalYear > held.fiscalYear) {
        latest.set(pi.profile_id, { fiscalYear, atYale });
      } else if (fiscalYear === held.fiscalYear && !atYale) {
        latest.set(pi.profile_id, { fiscalYear, atYale: false });
      }
    }
  }
  return latest;
}

export function groupGrantsByCreditedPi(
  grants: readonly NihGrant[],
  creditedProfileIds: ReadonlySet<number>,
): Map<string, NihGrant[]> {
  const groups = new Map<string, NihGrant[]>();
  for (const grant of grants) {
    const names = new Set<string>();
    const contactName = pickContactPiName(grant);
    if (contactName) names.add(contactName);
    for (const pi of grant.principal_investigators || []) {
      if (pi.is_contact_pi || !isProfileId(pi.profile_id)) continue;
      if (!creditedProfileIds.has(pi.profile_id)) continue;
      const name = principalInvestigatorName(pi);
      if (name) names.add(name);
    }
    for (const name of names) {
      const list = groups.get(name) || [];
      list.push(grant);
      groups.set(name, list);
    }
  }
  return groups;
}

/** Prefer the structured `is_contact_pi: true` entry over the unstructured string. */
export function pickContactPiName(grant: NihGrant): string {
  const contactStruct = (grant.principal_investigators || []).find((p) => p.is_contact_pi);
  if (contactStruct) {
    const first = (contactStruct.first_name || '').trim();
    const last = (contactStruct.last_name || '').trim();
    if (first || last) {
      return canonicalPiName(`${last}, ${first}`.trim());
    }
    if (contactStruct.full_name) return canonicalPiName(contactStruct.full_name);
  }
  if (grant.contact_pi_name) return canonicalPiName(grant.contact_pi_name);
  return '';
}

// RePORTER returns one record per project per fiscal year, and only the core project
// number is stable across them, so it is the award identity (#3930).
export function nihCoreProjectNumber(grant: NihGrant): string | undefined {
  const core = (grant.core_project_num || '').trim().toUpperCase();
  if (core) return core;
  const split = grant.project_num_split;
  const parts = [split?.activity_code, split?.ic_code, split?.serial_num].map((part) =>
    (part || '').trim().toUpperCase(),
  );
  return parts.every(Boolean) ? parts.join('') : undefined;
}

function nihAwardKey(grant: NihGrant): string {
  return (
    nihCoreProjectNumber(grant) ||
    (grant.project_num || '').trim().toUpperCase() ||
    (grant.appl_id ? `appl-${grant.appl_id}` : 'unknown')
  );
}

function fiscalYearRecency(grant: NihGrant): number {
  return typeof grant.fiscal_year === 'number' ? grant.fiscal_year : -Infinity;
}

function newestFiscalYearRecord(records: readonly NihGrant[]): NihGrant {
  return records.reduce((newest, record) => {
    const yearOrder = fiscalYearRecency(record) - fiscalYearRecency(newest);
    if (yearOrder !== 0) return yearOrder > 0 ? record : newest;
    return (record.appl_id ?? 0) > (newest.appl_id ?? 0) ? record : newest;
  });
}

function earliestDate(dates: readonly (Date | undefined)[]): Date | undefined {
  return dates.reduce<Date | undefined>(
    (earliest, date) => (date && (!earliest || date < earliest) ? date : earliest),
    undefined,
  );
}

function projectEndDate(records: readonly NihGrant[]): Date | undefined {
  const endDates = records.map((record) => parseDate(record.project_end_date));
  if (endDates.some((date) => !date)) return undefined;
  return endDates.reduce<Date | undefined>(
    (latest, date) => (date && (!latest || date > latest) ? date : latest),
    undefined,
  );
}

export function groupGrantsByProject(grants: readonly NihGrant[]): NihGrant[][] {
  const projects = new Map<string, NihGrant[]>();
  for (const grant of grants) {
    const key = nihAwardKey(grant);
    const records = projects.get(key);
    if (records) records.push(grant);
    else projects.set(key, [grant]);
  }
  return [...projects.values()];
}

export function projectToRecord(records: readonly NihGrant[]): RecentGrantRecord {
  const newest = newestFiscalYearRecord(records);
  return {
    ...grantToRecord(newest),
    id: nihAwardKey(newest),
    startDate: earliestDate(records.map((record) => parseDate(record.project_start_date))),
    endDate: projectEndDate(records),
  };
}

/** Map a single API record into the schema-shaped record stored in `recentGrants`. */
export function grantToRecord(grant: NihGrant): RecentGrantRecord {
  const id =
    grant.project_num ||
    grant.core_project_num ||
    (grant.appl_id ? `appl-${grant.appl_id}` : 'unknown');
  const agency =
    grant.agency_ic_admin?.abbreviation ||
    grant.agency_ic_admin?.name ||
    grant.agency_ic_admin?.code ||
    'NIH';
  const title = (grant.project_title || '').trim();
  const abstract = (grant.abstract_text || '').trim();
  const dollarAmount = typeof grant.award_amount === 'number' ? grant.award_amount : 0;
  const url =
    grant.project_detail_url ||
    (grant.appl_id
      ? `https://reporter.nih.gov/project-details/${grant.appl_id}`
      : REPORTER_ENDPOINT);
  return {
    id,
    agency,
    title,
    abstract,
    startDate: parseDate(grant.project_start_date),
    endDate: parseDate(grant.project_end_date),
    dollarAmount,
    url,
    role: 'pi',
  };
}

const GRANT_ABSTRACT_HEADER_WORD = '(?:overall|proposal|project|research|program)';
const GRANT_ABSTRACT_HEADER_KIND = '(?:summary|narrative|abstract)';
const GRANT_ABSTRACT_LEADING_NOISE = /^[\s\d.)(/:;#*-]+/;
const GRANT_ABSTRACT_HEADER = new RegExp(
  `^\\s*(?:modified\\s+)?(?:${GRANT_ABSTRACT_HEADER_WORD}\\s*)?${GRANT_ABSTRACT_HEADER_KIND}` +
    `(?:\\s*[/&]\\s*${GRANT_ABSTRACT_HEADER_KIND})*\\s*(?:section)?\\s*[:.)-]*\\s*`,
  'i',
);
const GRANT_ABSTRACT_INLINE_MARKER =
  /^(?:.{0,130}?\b(?:abstract|project\s+summary)\b\s*[:.)-]+\s*)/i;
const GRANT_ABSTRACT_UNAVAILABLE =
  /^\s*(?:no\s+abstract|abstract\s+not\s+available|n\/?a)\s*\.?\s*$/i;
// A leading agency funding-disclaimer sentence ("This award is funded in whole
// or in part under the American Rescue Plan Act ...") is administrative
// boilerplate, not research, so drop it before taking the lead sentences
// (issue #1418 follow-up).
const GRANT_ABSTRACT_FUNDING_DISCLAIMER =
  /^(?:this (?:award|project|research) (?:is|was) funded\b[^.]*\.\s+|funds? (?:are|is) provided\b[^.]*\.\s+)/i;

const normalizeAbstractWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

const SENTENCE_SPLIT = /(?<=[.!?])\s+/;

function splitIntoSentences(text: string): string[] {
  return text.split(SENTENCE_SPLIT).filter(Boolean);
}

function stripGrantAbstractHeaders(value: string): string {
  let out = value;
  for (let i = 0; i < 4; i += 1) {
    const before = out;
    out = out.replace(GRANT_ABSTRACT_LEADING_NOISE, '').replace(GRANT_ABSTRACT_HEADER, '');
    if (out === before) break;
  }
  return out;
}

function firstSentencesWithinBudget(text: string, maxChars: number): string {
  const sentences = splitIntoSentences(text);
  let acc = '';
  for (const sentence of sentences) {
    if (!acc) {
      acc = sentence;
      continue;
    }
    if (`${acc} ${sentence}`.length > maxChars) break;
    acc = `${acc} ${sentence}`;
  }
  if (acc.length > maxChars + 160) acc = acc.slice(0, maxChars);
  return acc.trim();
}

// A grant abstract conventionally opens with disease-burden/background framing
// before reaching what the lab actually does. That framing is content-free for a
// student deciding whether to reach out, and can even name a different disease
// than the entity's own topic chips, so it must never survive as the served
// description (issue #1739).
const SIGNIFICANCE_OPENER_PATTERNS: RegExp[] = [
  /\b(?:is|are|remains?)\s+(?:the\s+|an?\s+)?(?:\w+\s+){0,2}(?:leading|major|significant|common|most\s+common)\s+(?:cause|source)\s+of\b/i,
  /\bis\s+at\s+the\s+forefront\s+of\b/i,
  /^(?:nearly|over|more\s+than|approximately)\s+[\d,.]+\s*(?:million\s+|thousand\s+)?(?:persons?|people|individuals?|children|adults|patients)\b/i,
  /\bstruggle[sd]?\s+more\s+than\s+any\s+other\b/i,
  /\bis\s+an?\s+common\s+event\s+in\s+the\s+lives\s+of\b/i,
  /\bis\s+the\s+most\s+common\b.*\b(?:annually|per\s+year|each\s+year)\b/i,
];

function isGrantSignificanceOpener(sentence: string): boolean {
  return SIGNIFICANCE_OPENER_PATTERNS.some((pattern) => pattern.test(sentence));
}

function stripLeadingSignificanceSentences(text: string): string {
  const sentences = splitIntoSentences(text);
  let start = 0;
  while (start < sentences.length && isGrantSignificanceOpener(sentences[start])) {
    start += 1;
  }
  return sentences.slice(start).join(' ');
}

const PDF_HYPHENATION_ARTIFACT = /([a-z])-\s+([a-z])/g;

function stripPdfHyphenationArtifacts(text: string): string {
  return text.replace(PDF_HYPHENATION_ARTIFACT, '$1-$2');
}

/**
 * Derive a source-backed lab description from a funded-project abstract. Strips
 * RePORTER boilerplate headers ("PROJECT SUMMARY/ABSTRACT", "OVERALL:",
 * numbering), PDF-extraction hyphenation artifacts, and leading disease-burden/
 * significance framing, then returns sentence-bounded lead prose. Returns '' when
 * the abstract is empty, a "No Abstract" placeholder, or nothing but significance
 * framing, so the scraper emits nothing rather than junk (issues #1418, #1739).
 */
export function grantAbstractToDescription(abstract: string | undefined | null): string {
  const normalized = stripPdfHyphenationArtifacts(
    normalizeAbstractWhitespace(String(abstract || '')),
  );
  if (!normalized || GRANT_ABSTRACT_UNAVAILABLE.test(normalized)) return '';
  const withoutInlineMarker = normalized.replace(GRANT_ABSTRACT_INLINE_MARKER, '');
  const withoutHeaders = stripGrantAbstractHeaders(withoutInlineMarker);
  const withoutFundingDisclaimer = withoutHeaders.replace(GRANT_ABSTRACT_FUNDING_DISCLAIMER, '');
  const withoutSignificanceOpener = stripLeadingSignificanceSentences(withoutFundingDisclaimer);
  if (!withoutSignificanceOpener) return '';
  return normalizeAbstractWhitespace(
    firstSentencesWithinBudget(withoutSignificanceOpener, GRANT_DESCRIPTION_MAX_CHARS),
  );
}

// Training, fellowship, career-development, commercialization, and conference/
// travel grants describe a program, a trainee's career plan, or a meeting rather
// than the lab's science, so their abstract is not a usable lab description
// (issue #1418 follow-up). Detected by grant title, since RePORTER titles name
// the mechanism explicitly.
const NON_RESEARCH_GRANT_TITLE =
  /\b(?:graduate research fellowship|grfp|i-?corps|training (?:program|grant)|training in|research training|(?:pre|post)doctoral training|annual meeting|student travel|travel grant|conference grant|symposium|workshop|fellowship)\b/i;
// A mentored career-development award's abstract is a first-person career
// statement ("Candidate: I aim to build an independent career ..."), not a lab
// description, even when the project science is real.
const CAREER_DEVELOPMENT_ABSTRACT_LEAD =
  /^(?:candidate\b|.{0,80}?\bi (?:aim|seek|plan|propose) to (?:build|establish|pursue|develop) (?:an? )?(?:independent )?(?:research )?career\b|.{0,140}?\b(?:mentored )?(?:patient-oriented )?(?:research )?career[ -]development award\b|.{0,120}?\bthis (?:application|proposal) (?:is )?for an? (?:mentored )?k\d\d\b)/i;

function grantAbstractDescribesLabResearch(record: RecentGrantRecord): boolean {
  if (NON_RESEARCH_GRANT_TITLE.test(String(record.title || ''))) return false;
  const normalized = normalizeAbstractWhitespace(String(record.abstract || ''));
  return !CAREER_DEVELOPMENT_ABSTRACT_LEAD.test(normalized);
}

/**
 * Pick the newest research grant with a usable abstract and reduce it to a
 * description, skipping training/fellowship/career-development/commercialization/
 * conference grants whose abstract does not describe the lab's science
 * (issue #1418 follow-up).
 */
export function labDescriptionFromRecentGrants(records: RecentGrantRecord[]): string {
  for (const record of records) {
    if (!grantAbstractDescribesLabResearch(record)) continue;
    const description = grantAbstractToDescription(record.abstract);
    if (description) return description;
  }
  return '';
}

function parseDate(s: string | undefined): Date | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  return isNaN(d.getTime()) ? undefined : d;
}

/**
 * Try to resolve a NIH PI name to an existing Yale faculty User.
 *
 * Strategy: split into first/last, look for an exact (case-insensitive) lname
 * match restricted to faculty/professor/admin userType, then narrow further
 * by either an exact fname match or a first-initial match. Returns the lone
 * matching user or null when ambiguous / not found. The DB query is exposed
 * via the `userModel` parameter so tests can inject a mock without touching
 * mongoose.
 */
export async function findUserForPi(
  canonicalName: string,
  deps?: NihPiResolverDeps,
): Promise<{ _id: string; netid?: string; researchHomeEligible?: boolean } | null> {
  const result = await resolveUserForPi(canonicalName, deps);
  return result.status === 'matched' ? result.user : null;
}

export type NihPiUserResolution =
  | { status: 'matched'; user: { _id: string; netid?: string; researchHomeEligible?: boolean } }
  | { status: 'absent' }
  | { status: 'ambiguous' };

export interface NihPiResolverDeps {
  resolveResearcherId?: typeof resolveResearcherIdForPersonName;
  loadResearcherProfileTitle?: (researcherId: string) => Promise<string | undefined>;
}

async function defaultLoadResearcherProfileTitle(
  researcherId: string,
): Promise<string | undefined> {
  const researcher: any = await Researcher.findById(researcherId).select('profile').lean();
  const title = researcher?.profile?.title;
  return typeof title === 'string' ? title : undefined;
}

export async function resolveUserForPi(
  canonicalName: string,
  deps: NihPiResolverDeps = {},
): Promise<NihPiUserResolution> {
  if (!canonicalName) return { status: 'absent' };
  const resolveResearcherId = deps.resolveResearcherId ?? resolveResearcherIdForPersonName;
  const loadResearcherProfileTitle =
    deps.loadResearcherProfileTitle ?? defaultLoadResearcherProfileTitle;
  const resolution = await resolveResearcherId(canonicalName);
  if (resolution.status === 'ambiguous') return { status: 'ambiguous' };
  if (resolution.status !== 'matched' || !resolution.researcherId) return { status: 'absent' };
  const researcherId = resolution.researcherId.toString();
  const title = await loadResearcherProfileTitle(researcherId);
  return {
    status: 'matched',
    user: {
      _id: researcherId,
      researchHomeEligible: researchHomeEligibleUserTitle(title),
    },
  };
}

function researchHomeEligibleUserTitle(title: unknown): boolean {
  const value = typeof title === 'string' ? title.toLowerCase() : '';
  if (!value) return true;
  if (/\bpostdoctoral\b|\bpostdoc\b/.test(value)) return false;
  if (/\bresearch affiliates?\b/.test(value)) return false;
  if (/\bassociate research scientist\b/.test(value)) return false;
  return true;
}

export function piGrantsToObservations(
  grants: NihGrant[],
  researcherId: string | undefined,
  existingRowSlug: string,
): ObservationInput[] {
  if (grants.length === 0 || !existingRowSlug) return [];

  const awards = groupGrantsByProject(grants)
    .map(projectToRecord)
    .sort((a, b) => (b.startDate?.getTime() ?? 0) - (a.startDate?.getTime() ?? 0));
  const recentRecords = awards.slice(0, RECENT_GRANTS_PER_PI);
  const lastObservedAt = recentRecords
    .map((g) => g.startDate?.getTime())
    .filter((t): t is number => typeof t === 'number')
    .reduce((max, t) => (t > max ? t : max), 0);

  const base = {
    entityType: 'researchEntity' as const,
    entityKey: existingRowSlug,
    sourceUrl: recentRecords[0]?.url || REPORTER_ENDPOINT,
  };
  const periods = recentGrantPeriodsOf(awards);
  const out: ObservationInput[] = [
    { ...base, field: 'recentGrants', value: recentRecords },
    { ...base, field: 'recentGrantPeriods', value: periods },
    { ...base, field: 'recentGrantCount', value: periods.length },
    { ...base, field: 'fundingAgencies', value: ['NIH'] },
  ];
  if (lastObservedAt > 0) {
    out.push({ ...base, field: 'lastObservedAt', value: new Date(lastObservedAt) });
  }
  if (researcherId) {
    out.push({ ...base, field: 'inferredPiUserId', value: researcherId, confidenceOverride: 0.9 });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Network layer
// ---------------------------------------------------------------------------

interface FetchPageOpts {
  offset: number;
  limit: number;
  fiscalYears: number[];
  useCache: boolean;
  ctx: ScraperContext;
}

async function fetchPage({
  offset,
  limit,
  fiscalYears,
  useCache,
  ctx,
}: FetchPageOpts): Promise<NihPage> {
  const cacheKey = `page:offset=${offset}:limit=${limit}:fy=${fiscalYears.join(',')}`;
  if (useCache) {
    const cached = await getCached<NihPage>('nih-reporter', cacheKey);
    if (cached) return cached;
  }
  const body = {
    criteria: {
      org_names: YALE_ORG_NAMES,
      exclude_subprojects: true,
      fiscal_years: fiscalYears,
    },
    offset,
    limit,
    sort_field: 'project_start_date',
    sort_order: 'desc',
  };
  const res = await retryOnRetryableStatus(() =>
    axios.post(REPORTER_ENDPOINT, body, {
      timeout: FETCH_TIMEOUT_MS,
      headers: {
        'User-Agent': USER_AGENT,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    }),
  );
  const payload: NihPage = {
    meta: res.data?.meta || { total: 0, offset, limit },
    results: (res.data?.results as NihGrant[]) || [],
  };
  if (useCache) await setCached('nih-reporter', cacheKey, payload);
  ctx.log(`fetched offset=${offset} got=${payload.results.length} total=${payload.meta.total}`);
  return payload;
}

async function fetchContactPiAffiliations(
  profileIds: number[],
  ctx: ScraperContext,
): Promise<Map<number, ContactPiAffiliation>> {
  const projects: NihGrant[] = [];
  for (let start = 0; start < profileIds.length; start += AFFILIATION_PROFILE_BATCH) {
    const batch = profileIds.slice(start, start + AFFILIATION_PROFILE_BATCH);
    let offset = 0;
    let total = Infinity;
    for (let page = 0; offset < total && page < MAX_PAGES; page++) {
      const res = await retryOnRetryableStatus(() =>
        axios.post(
          REPORTER_ENDPOINT,
          {
            criteria: { pi_profile_ids: batch, exclude_subprojects: true },
            include_fields: ['PrincipalInvestigators', 'Organization', 'FiscalYear'],
            offset,
            limit: PAGE_SIZE,
          },
          {
            timeout: FETCH_TIMEOUT_MS,
            headers: {
              'User-Agent': USER_AGENT,
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
          },
        ),
      );
      const results = (res.data?.results as NihGrant[]) || [];
      total = res.data?.meta?.total ?? results.length;
      projects.push(...results);
      if (results.length === 0) break;
      offset += results.length;
    }
    if (offset < total) {
      throw new Error(`co-PI affiliation read cut at ${offset} of ${total} projects`);
    }
  }
  ctx.log(`read ${projects.length} project(s) for ${profileIds.length} co-PI profile(s)`);
  return latestContactPiAffiliations(projects, new Set(profileIds));
}

// ---------------------------------------------------------------------------
// Scraper class
// ---------------------------------------------------------------------------

export interface NihReporterScraperOptions {
  /** Override fiscal years (defaults to current FY plus the two prior FYs). */
  fiscalYears?: number[];
  resolveResearcherId?: typeof resolveResearcherIdForPersonName;
  loadResearcherProfileTitle?: (researcherId: string) => Promise<string | undefined>;
  researchHomeResolver?: (researcherId: string) => Promise<CanonicalResearchHomeResolution>;
  lookupContactPiAffiliations?: ContactPiAffiliationLookup;
}

export class NihReporterScraper implements IScraper {
  readonly name = 'nih-reporter';
  readonly displayName = 'NIH RePORTER (Yale grants)';

  constructor(private readonly opts: NihReporterScraperOptions = {}) {}

  async run(ctx: ScraperContext): Promise<ScraperResult> {
    const fiscalYears =
      this.opts.fiscalYears || fiscalYearsEndingAt(ctx.options.referenceDate ?? new Date());
    const researchHomeResolver =
      this.opts.researchHomeResolver || resolveCanonicalResearchHomeForResearcher;
    const limitOption = ctx.options.limit;
    if (limitOption !== undefined && (!Number.isSafeInteger(limitOption) || limitOption < 1)) {
      throw new Error('--limit must be a safe positive integer');
    }
    ctx.log(`Querying NIH RePORTER for Yale grants in FY ${fiscalYears.join(', ')}`);

    // 1. Paginate through all matching grants.
    const allGrants: NihGrant[] = [];
    let offset = 0;
    let total = Infinity;
    let pages = 0;
    const partialFailures: string[] = [];
    while (offset < total && pages < MAX_PAGES) {
      let page: NihPage;
      try {
        page = await fetchPage({
          offset,
          limit: PAGE_SIZE,
          fiscalYears,
          useCache: ctx.options.useCache,
          ctx,
        });
      } catch (err: any) {
        const failure = `NIH RePORTER fetch failed at offset=${offset}: ${sanitizeLogValue(
          err instanceof Error ? err.message : err,
        )}; pagination aborted`;
        if (pages === 0) throw new Error(failure, { cause: err });
        ctx.log(`${failure}; the grant window is incomplete.`);
        partialFailures.push(failure);
        break;
      }
      pages++;
      total = page.meta.total ?? page.results.length;
      allGrants.push(...page.results);
      if (page.results.length === 0) break;
      offset += page.results.length;
    }
    ctx.log(`fetched ${allGrants.length}/${total} grants across ${pages} page(s)`);

    // 2. Drop individual trainee-fellowship awards (F30/F31/F32/F33) so a
    //    trainee's award is never attributed to a row (#739).
    const fundableGrants = allGrants.filter((grant) => !isTraineeFellowshipGrant(grant));
    const excludedTraineeFellowships = allGrants.length - fundableGrants.length;
    if (excludedTraineeFellowships > 0) {
      ctx.log(
        `excluded ${excludedTraineeFellowships} individual trainee-fellowship award(s) (F30/F31/F32/F33)`,
      );
    }

    // 3. Credit every Yale principal investigator: contact PIs, plus each co-PI whose
    //    latest contact-PI project is at Yale (#4629).
    const coPiCandidates = nonContactPiProfileIds(fundableGrants);
    const lookupAffiliations: ContactPiAffiliationLookup =
      this.opts.lookupContactPiAffiliations ??
      ((profileIds) => fetchContactPiAffiliations(profileIds, ctx));
    let affiliations = new Map<number, ContactPiAffiliation>();
    let affiliationLookupFailed = false;
    if (coPiCandidates.length > 0) {
      try {
        affiliations = await lookupAffiliations(coPiCandidates);
      } catch (err: unknown) {
        affiliationLookupFailed = true;
        ctx.log(
          `co-PI affiliation lookup failed; crediting contact PIs only: ${sanitizeLogValue(
            err instanceof Error ? err.message : err,
          )}`,
        );
      }
    }
    const creditedProfileIds = contactPiProfileIds(fundableGrants);
    const coPi = { credited: 0, elsewhere: 0, noEvidence: 0 };
    for (const profileId of coPiCandidates) {
      const affiliation = affiliations.get(profileId);
      if (!affiliation) coPi.noEvidence++;
      else if (!affiliation.atYale) coPi.elsewhere++;
      else {
        coPi.credited++;
        creditedProfileIds.add(profileId);
      }
    }
    const groups = groupGrantsByCreditedPi(fundableGrants, creditedProfileIds);
    ctx.log(`grouped into ${groups.size} credited PIs (${coPi.credited} multi-PI co-PIs)`);

    // 4. Honor --limit (caps PIs processed, NOT raw grants).
    const piLimit = limitOption ?? Infinity;
    const piEntries = Array.from(groups.entries()).slice(0, piLimit);

    const attach = emptyGrantAttachTally();
    let ineligibleLeadTitle = 0;
    let totalObs = 0;
    let processed = 0;
    const rows = new Map<string, { researcherIds: Set<string>; grants: NihGrant[] }>();
    for (const [piName, grants] of piEntries) {
      processed++;
      const person = await resolveUserForPi(piName, {
        resolveResearcherId: this.opts.resolveResearcherId,
        loadResearcherProfileTitle: this.opts.loadResearcherProfileTitle,
      });
      if (person.status === 'matched' && person.user.researchHomeEligible === false) {
        ineligibleLeadTitle++;
        continue;
      }
      const target = await resolveGrantEnrichmentTarget(
        person.status === 'matched' ? { status: 'matched', userId: person.user._id } : person,
        researchHomeResolver,
      );
      countGrantAttach(attach, target);
      if (target.status === 'enrich') {
        const row = rows.get(target.slug) ?? { researcherIds: new Set<string>(), grants: [] };
        row.researcherIds.add(target.researcherId);
        row.grants.push(...grants);
        rows.set(target.slug, row);
      }
      if (processed % 100 === 0 || processed === piEntries.length) {
        ctx.log(`progress: ${processed}/${piEntries.length} PIs (${attach.enriched} enriched)`);
      }
    }

    for (const [slug, row] of rows) {
      const soleResearcher = row.researcherIds.size === 1 ? [...row.researcherIds][0] : undefined;
      const observations = piGrantsToObservations(row.grants, soleResearcher, slug);
      await ctx.emit(observations);
      totalObs += observations.length;
    }

    const notes =
      `Yale NIH grants FY ${fiscalYears.join('-')}: ${allGrants.length} grants; ` +
      `credited PIs: ${groups.size} (${piEntries.length} processed); ` +
      `multi-PI co-PIs: ${coPiCandidates.length} not a Yale contact PI in the window, ${coPi.credited} credited ` +
      `(latest contact-PI project at Yale), ${coPi.elsewhere} refused (latest contact-PI project elsewhere), ` +
      `${coPi.noEvidence} refused (${
        affiliationLookupFailed
          ? 'affiliation lookup failed, so none credited'
          : 'never a contact PI, so no affiliation evidence'
      }); ` +
      `${rows.size} distinct row(s) enriched; ${grantAttachSummary(attach)}; ` +
      `${ineligibleLeadTitle} held for a non-lead title`;
    ctx.log(`Emitted ${totalObs} observations. ${notes}`);

    return {
      observationCount: totalObs,
      entitiesObserved: rows.size,
      notes,
      ...(partialFailures.length > 0 ? { partialFailures } : {}),
    };
  }
}
