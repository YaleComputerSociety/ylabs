/**
 * Read/write access to a student's self-declared research interests, the
 * signal that personalizes the default `/research` "Recommended" order.
 *
 * The record lives on the retained StudentProfile personalization model, keyed
 * by the session netid so it works for account-only students with no legacy
 * User document. Interests are constrained to the governed research-area
 * vocabulary (the same terms the corpus and search box already use); anything
 * outside that vocabulary is dropped so no free-text ever enters the signal.
 * See issue #1468.
 */
import { StudentProfile } from '../models/studentProfile';
import { ResearchArea } from '../models/researchArea';
import { MAX_STUDENT_RESEARCH_INTERESTS } from './researchInterestPersonalization';

const NETID_INPUT_RE = /^[A-Za-z0-9]{2,12}$/;
const MIN_GRADUATION_YEAR = 1900;
const MAX_GRADUATION_YEAR = 2100;

export interface StudentResearchInterests {
  researchInterests: string[];
  graduationYear: number | null;
}

const badRequest = (message: string): Error => {
  const error: any = new Error(message);
  error.status = 400;
  return error;
};

const normalizeNetid = (value: unknown): string => {
  const netid = typeof value === 'string' ? value.trim() : '';
  if (!NETID_INPUT_RE.test(netid)) {
    throw badRequest('Invalid account netid');
  }
  return netid.toLowerCase();
};

const canonicalGovernedInterestTerm = (value: string): string =>
  value.toLowerCase().replace(/['’]/g, '').replace(/\s+/g, ' ').trim();

/**
 * Map of canonicalized governed research-area label -> the canonical display
 * casing stored in the ResearchArea taxonomy.
 */
const governedResearchAreaLabels = async (): Promise<Map<string, string>> => {
  const areas = (await ResearchArea.find().select('name -_id').lean()) as Array<{ name?: unknown }>;
  const byCanonical = new Map<string, string>();
  for (const area of areas) {
    if (typeof area.name !== 'string') continue;
    const label = area.name.trim();
    const key = canonicalGovernedInterestTerm(label);
    if (key && !byCanonical.has(key)) byCanonical.set(key, label);
  }
  return byCanonical;
};

const sanitizeSubmittedInterests = (
  values: unknown,
  governedLabels: Map<string, string>,
): string[] => {
  if (values === undefined || values === null) return [];
  if (!Array.isArray(values)) {
    throw badRequest('Research interests must be a list');
  }
  const seen = new Set<string>();
  const sanitized: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const key = canonicalGovernedInterestTerm(value);
    if (!key || seen.has(key)) continue;
    const canonicalLabel = governedLabels.get(key);
    if (!canonicalLabel) continue;
    seen.add(key);
    sanitized.push(canonicalLabel);
    if (sanitized.length >= MAX_STUDENT_RESEARCH_INTERESTS) break;
  }
  return sanitized;
};

const normalizeGraduationYear = (value: unknown): number | null => {
  if (value === undefined || value === null || value === '') return null;
  const year = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(year) || year < MIN_GRADUATION_YEAR || year > MAX_GRADUATION_YEAR) {
    throw badRequest('Invalid graduation year');
  }
  return year;
};

const toStudentResearchInterests = (profile: any): StudentResearchInterests => ({
  researchInterests: Array.isArray(profile?.researchInterests)
    ? profile.researchInterests.filter((value: unknown): value is string => typeof value === 'string')
    : [],
  graduationYear: typeof profile?.graduationYear === 'number' ? profile.graduationYear : null,
});

export const getStudentResearchInterests = async (
  netid: unknown,
): Promise<StudentResearchInterests> => {
  const normalizedNetid = normalizeNetid(netid);
  const profile = await StudentProfile.findOne({ netid: normalizedNetid })
    .select('researchInterests graduationYear -_id')
    .lean();
  return toStudentResearchInterests(profile);
};

export const setStudentResearchInterests = async (
  netid: unknown,
  input: { researchInterests?: unknown; graduationYear?: unknown },
): Promise<StudentResearchInterests> => {
  const normalizedNetid = normalizeNetid(netid);
  const governedLabels = await governedResearchAreaLabels();
  const researchInterests = sanitizeSubmittedInterests(input.researchInterests, governedLabels);
  const graduationYear = normalizeGraduationYear(input.graduationYear);

  const profile = await StudentProfile.findOneAndUpdate(
    { netid: normalizedNetid },
    { $set: { researchInterests, graduationYear } },
    { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true },
  ).lean();
  return toStudentResearchInterests(profile);
};
