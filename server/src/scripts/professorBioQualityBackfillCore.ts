import type { ResolverObservation } from '../scrapers/confidenceResolver';
import { buildUserBioObservationScore } from '../scrapers/entityMaterializer';
import {
  cleanProfileText,
  isMaterializableUserBioCandidate,
  profileWordCount,
} from '../utils/profileBioQuality';

export {
  cleanProfileText,
  isMaterializableUserBioCandidate,
  profileWordCount,
} from '../utils/profileBioQuality';
export { buildUserBioObservationScore } from '../scrapers/entityMaterializer';

export interface ProfessorBioQualityBackfillArgs {
  apply: boolean;
  limit: number;
  offset: number;
  concurrency: number;
  timeoutMs: number;
  output?: string;
  acceptedInput?: string;
}

export interface ProfessorBioBackfillUser {
  _id: unknown;
  netid?: string;
  email?: string;
  fname?: string;
  lname?: string;
  bio?: string;
  website?: string;
  profileUrls?: Record<string, unknown>;
  confidenceByField?: Record<string, number>;
  manuallyLockedFields?: string[];
}

export interface ProfessorBioBackfillCandidate {
  text: string;
  sourceUrl: string;
  profileName?: string;
  sourceName: string;
  sourceId: unknown;
  confidence: number;
}

export interface ProfessorBioBackfillDecision {
  status: 'accepted' | 'rejected';
  reasons: string[];
  netid?: string;
  name: string;
  sourceUrl?: string;
  profileName?: string;
  oldWords: number;
  newWords: number;
  currentBioPreview: string;
  candidateBioPreview: string;
  candidate?: ProfessorBioBackfillCandidate;
}

const DEFAULT_LIMIT = Number.MAX_SAFE_INTEGER;
const DEFAULT_OFFSET = 0;
const DEFAULT_CONCURRENCY = 2;
const DEFAULT_TIMEOUT_MS = 30_000;
const MIN_NARRATIVE_WORDS = 35;
const MAX_FETCH_FAILURE_RATE = 0.2;

export function parseProfessorBioQualityBackfillArgs(
  argv: string[],
): ProfessorBioQualityBackfillArgs {
  const args: ProfessorBioQualityBackfillArgs = {
    apply: false,
    limit: DEFAULT_LIMIT,
    offset: DEFAULT_OFFSET,
    concurrency: DEFAULT_CONCURRENCY,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') {
      args.apply = true;
      continue;
    }
    if (arg === '--limit') {
      args.limit = positiveInt(requiredNext(argv, index, '--limit'), '--limit');
      index += 1;
      continue;
    }
    if (arg.startsWith('--limit=')) {
      args.limit = positiveInt(arg.slice('--limit='.length), '--limit');
      continue;
    }
    if (arg === '--offset') {
      args.offset = nonNegativeInt(requiredNext(argv, index, '--offset'), '--offset');
      index += 1;
      continue;
    }
    if (arg.startsWith('--offset=')) {
      args.offset = nonNegativeInt(arg.slice('--offset='.length), '--offset');
      continue;
    }
    if (arg === '--concurrency') {
      args.concurrency = positiveInt(requiredNext(argv, index, '--concurrency'), '--concurrency');
      index += 1;
      continue;
    }
    if (arg.startsWith('--concurrency=')) {
      args.concurrency = positiveInt(arg.slice('--concurrency='.length), '--concurrency');
      continue;
    }
    if (arg === '--timeout-ms') {
      args.timeoutMs = positiveInt(requiredNext(argv, index, '--timeout-ms'), '--timeout-ms');
      index += 1;
      continue;
    }
    if (arg.startsWith('--timeout-ms=')) {
      args.timeoutMs = positiveInt(arg.slice('--timeout-ms='.length), '--timeout-ms');
      continue;
    }
    if (arg === '--output') {
      args.output = requiredNext(argv, index, '--output');
      index += 1;
      continue;
    }
    if (arg.startsWith('--output=')) {
      args.output = arg.slice('--output='.length);
      continue;
    }
    if (arg === '--accepted-input') {
      args.acceptedInput = requiredNext(argv, index, '--accepted-input');
      index += 1;
      continue;
    }
    if (arg.startsWith('--accepted-input=')) {
      args.acceptedInput = arg.slice('--accepted-input='.length);
      continue;
    }
    throw new Error(`Unknown professorBioQualityBackfill option: ${arg}`);
  }

  if (args.apply && !args.acceptedInput) {
    throw new Error('--apply requires --accepted-input');
  }
  return args;
}

function requiredNext(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

function positiveInt(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function nonNegativeInt(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative integer`);
  }
  return parsed;
}

export function isProbablyOfficialProfileUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    return (
      (hostname === 'yale.edu' || hostname.endsWith('.yale.edu')) &&
      /\/(?:profile|people|person|faculty|faculty-affiliated|faculty-directory)(?:\/|$|-)/i.test(
        parsed.pathname,
      )
    );
  } catch {
    return false;
  }
}

export function normalizeUrl(value: unknown): string {
  const raw = cleanProfileText(value);
  if (!/^https?:\/\//i.test(raw)) return '';
  try {
    const url = new URL(raw);
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

export function userUrls(user: ProfessorBioBackfillUser): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of Object.values(user.profileUrls || {})) {
    const url = normalizeUrl(value);
    if (url && !seen.has(url)) {
      seen.add(url);
      out.push(url);
    }
  }
  const website = normalizeUrl(user.website);
  if (website && !seen.has(website)) out.push(website);
  return out.filter((url) => !/^https?:\/\/orcid\.org\//i.test(url));
}

function nameTokens(value: unknown): string[] {
  return cleanProfileText(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3);
}

export function profileNameMatchesFacultyUser(
  profileName: unknown,
  user: Pick<ProfessorBioBackfillUser, 'fname' | 'lname'>,
): boolean {
  const profileTokens = new Set(nameTokens(profileName));
  if (profileTokens.size === 0) return false;
  const first = nameTokens(user.fname)[0] || '';
  const last = nameTokens(user.lname).at(-1) || '';
  if (last && !profileTokens.has(last)) return false;
  if (!first) return true;
  if (profileTokens.has(first)) return true;
  const aliases: Record<string, string[]> = {
    jonathan: ['jon'],
    jon: ['jonathan'],
    william: ['will', 'bill', 'billy'],
    will: ['william'],
    bill: ['william'],
    james: ['jim'],
    jim: ['james'],
    jacob: ['jake'],
    jake: ['jacob'],
  };
  return (aliases[first] || []).some((alias) => profileTokens.has(alias));
}

export function personUrlMatchesUser(url: string, user: ProfessorBioBackfillUser): boolean {
  let path = '';
  try {
    path = new URL(url).pathname;
  } catch {
    return false;
  }
  const pathTokens = new Set(nameTokens(path));
  const first = nameTokens(user.fname)[0] || '';
  const last = nameTokens(user.lname).at(-1) || '';
  return !!last && pathTokens.has(last) && (!first || pathTokens.has(first));
}

export function sourceUrlNameMatchesUser(
  sourceUrl: string,
  user: ProfessorBioBackfillUser,
): boolean {
  try {
    const parsed = new URL(sourceUrl);
    return personUrlMatchesUser(parsed.toString(), user);
  } catch {
    return false;
  }
}

export function scoreRawBio(value: string): number {
  return buildUserBioObservationScore(
    {
      field: 'bio',
      value,
      sourceName: 'candidate',
      confidence: 1,
      observedAt: new Date(),
    },
    1,
  );
}

export function currentBioScore(value: unknown): number {
  if (!isMaterializableUserBioCandidate(value)) return 0;
  return scoreRawBio(cleanProfileText(value));
}

export function candidateRejectionReasons(value: unknown): string[] {
  const text = cleanProfileText(value);
  const reasons: string[] = [];
  const words = profileWordCount(text);
  if (!isMaterializableUserBioCandidate(text)) reasons.push('failed-shared-bio-quality');
  if (/^In Memoriam\b|^\s*In Memory\b/i.test(text)) reasons.push('in-memoriam');
  if (/^Research Interests?\b/i.test(text) && words < MIN_NARRATIVE_WORDS) {
    reasons.push('short-research-interests-fragment');
  }
  const educationSignals =
    /\b(?:Medical College|College of Dentistry|School of Dental Medicine|Internship|Residency|Fellowship|Specialty Certificate|University College|M\.?D\.?|D\.?M\.?D\.?|D\.?D\.?S\.?)\b/gi;
  const narrativeSignals =
    /\b(?:research|stud(?:y|ies)|program|laboratory|lab|project|focus(?:es|ed)?|develops?|investigat(?:e|es|ing)|clinical trial|data|methods?)\b/i;
  const educationCount = Array.from(text.matchAll(educationSignals)).length;
  if (educationCount >= 3 && !narrativeSignals.test(text)) {
    reasons.push('education-or-training-list');
  }
  if (
    /\b(?:cares for patients|sees patients|patient care|treating|treatment of|specializes in treating)\b/i.test(
      text,
    ) &&
    !narrativeSignals.test(text)
  ) {
    reasons.push('patient-care-only');
  }
  return Array.from(new Set(reasons));
}

export function buildProfessorBioBackfillDecision({
  user,
  candidate,
  currentResolvedBio,
}: {
  user: ProfessorBioBackfillUser;
  candidate: ProfessorBioBackfillCandidate | null;
  currentResolvedBio: { text: string; confidence: number } | null;
}): ProfessorBioBackfillDecision {
  const name = [user.fname, user.lname].filter(Boolean).join(' ');
  const current = cleanProfileText(user.bio);
  const base = {
    netid: user.netid,
    name,
    oldWords: profileWordCount(current),
    currentBioPreview: current.slice(0, 220),
  };
  if (!candidate) {
    return {
      ...base,
      status: 'rejected',
      reasons: ['no-quality-bio'],
      newWords: 0,
      candidateBioPreview: '',
    };
  }

  const reasons = candidateRejectionReasons(candidate.text);
  if (!candidate.profileName || !profileNameMatchesFacultyUser(candidate.profileName, user)) {
    reasons.push('profile-name-mismatch');
  }
  if (!sourceUrlNameMatchesUser(candidate.sourceUrl, user)) {
    reasons.push('source-url-name-mismatch');
  }

  const resolvedCurrent = cleanProfileText(currentResolvedBio?.text);
  const next = cleanProfileText(candidate.text);
  const baseText = resolvedCurrent || current;
  const baseScore = Math.max(currentBioScore(current), currentBioScore(baseText));
  if (cleanProfileText(baseText) === next) reasons.push('same-as-current');
  if (baseScore > 0 && scoreRawBio(next) <= baseScore * 1.1) {
    reasons.push('not-meaningfully-better');
  }

  const uniqueReasons = Array.from(new Set(reasons));
  return {
    ...base,
    status: uniqueReasons.length === 0 ? 'accepted' : 'rejected',
    reasons: uniqueReasons.length === 0 ? ['accepted'] : uniqueReasons,
    sourceUrl: candidate.sourceUrl,
    profileName: candidate.profileName,
    newWords: profileWordCount(candidate.text),
    candidateBioPreview: next.slice(0, 220),
    candidate,
  };
}

export function fetchFailureRate(fetched: number, fetchFailed: number): number {
  return fetched > 0 ? fetchFailed / fetched : 0;
}

export function shouldWarnHighFetchFailureRate(fetched: number, fetchFailed: number): boolean {
  return fetchFailureRate(fetched, fetchFailed) > MAX_FETCH_FAILURE_RATE;
}

export function resolverObservationFromBioCandidate(
  candidate: ProfessorBioBackfillCandidate,
): ResolverObservation {
  return {
    field: 'bio',
    value: candidate.text,
    sourceName: candidate.sourceName,
    sourceUrl: candidate.sourceUrl,
    confidence: candidate.confidence,
    observedAt: new Date(),
  };
}
