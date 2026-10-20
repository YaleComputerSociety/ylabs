import type { ObservationInput } from '../types';
import { deriveBioResearchStatement } from '../../utils/bioResearchStatement';
import { stripPersonNameCredentialList } from '../../utils/personNameHygiene';
import { titleResearchOwnership } from './titleResearchOwnership';
import {
  mintsNoResearchEntityAsTeachingAppointment,
  ownsNoResearchEntityByTitle,
} from '../sources/yaleDirectoryScraper';

export interface RosterBioPerson {
  key: string;
  bio?: unknown;
  title?: unknown;
  fname?: unknown;
  lname?: unknown;
  profileUrls?: unknown;
  primaryDepartment?: unknown;
  departments?: unknown;
  rosterSourceUrl?: string;
}

export interface RosterBioCoveredIdentities {
  urls: ReadonlySet<string>;
  personKeys: ReadonlySet<string>;
  personNames: ReadonlySet<string>;
  slugs: ReadonlySet<string>;
}

export type RosterBioSkipReason =
  | 'already_covered'
  | 'already_covered_by_person'
  | 'unusable_name'
  | 'no_title'
  | 'non_hosting_title'
  | 'no_research_rank'
  | 'no_department'
  | 'slug_taken'
  | 'no_research_statement'
  | 'only_past_research'
  | 'not_useful_after_filtering'
  | 'empty_bio'
  | 'teaching_appointment';

export interface RosterBioPlannedRow {
  personKey: string;
  slug: string;
  name: string;
  profileUrl: string;
  department: string;
  school: string;
  evidenceSentences: string[];
}

export interface RosterBioDepartment {
  deptName: string;
  schoolName: string;
  slug: string;
}

export type RosterBioDepartmentResolver = (
  person: RosterBioPerson,
  name: string,
) => RosterBioDepartment | null;

// The owner's hosting rule (2026-10-04/05) names ranks `ownsNoResearchEntityByTitle` does not read.
const NON_HOSTING_RANK =
  /\bstaff affiliate\b|\bclinical fellow\b|\bhospital resident\b|\bresident\b|\bpostgraduate associate\b|\bpostdoc|\bpost-doctoral\b|\bresearch (?:associate|assistant)\b(?!\s+professor)|\bvisiting\b|\bstudent\b|\bcandidate\b/i;

const RESEARCH_TRACK_RANK =
  /\bresearch\s+(?:scholar|scientist)\b|\bresearch\s+(?:(?:assistant|associate)\s+)?professor\b/i;

export type RosterBioTitleVerdict = 'eligible' | 'no_title' | 'non_hosting' | 'no_research_rank';

export function rosterBioTitleVerdict(title: unknown): RosterBioTitleVerdict {
  const text = typeof title === 'string' ? title.trim() : '';
  if (!text) return 'no_title';
  if (NON_HOSTING_RANK.test(text)) return 'non_hosting';
  if (RESEARCH_TRACK_RANK.test(text)) return 'eligible';
  if (ownsNoResearchEntityByTitle(text)) return 'non_hosting';
  return titleResearchOwnership(text) === 'owns_research' ? 'eligible' : 'no_research_rank';
}

export const normalizeRosterBioUrl = (value: unknown): string =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?/, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');

export function rosterBioProfileUrl(person: RosterBioPerson): string {
  const value = person.profileUrls;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return String(value[0] || '');
  if (value && typeof value === 'object') return String(Object.values(value)[0] || '');
  return '';
}

const CREDENTIAL_TOKEN =
  /^(?:ph\.?\s?d\.?|m\.?\s?d\.?|m\.?\s?p\.?\s?h\.?|sc\.?\s?d\.?|d\.?\s?phil\.?|ed\.?\s?d\.?|psy\.?\s?d\.?|d\.?\s?n\.?\s?p\.?|r\.?\s?n\.?|m\.?\s?s\.?\s?n\.?|l\.?\s?c\.?\s?s\.?\s?w\.?|aprn|dr\.?|prof\.?|professor)$/i;

const TRAILING_CREDENTIAL_WORD =
  /^(?:dvm|vmd|ms|msc|msn|mph|mba|ma|mfa|mdiv|jd|llm|rn|np|pa|famia|facs|facp|faan|fache|lcsw|ladc|cnm|crna|mhs|mhsa|dnp|pharmd|dds|dmd|od|abpp)$/i;

const bareToken = (token: string): string => token.replace(/[.,]/g, '');

const isTitleCase = (token: string): boolean =>
  token === token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();

const isTrailingCredential = (token: string): boolean =>
  !isTitleCase(bareToken(token)) && TRAILING_CREDENTIAL_WORD.test(bareToken(token));

function credentialFreeTokens(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return stripPersonNameCredentialList(value.split(',')[0])
    .split(/\s+/)
    .map((token) => token.replace(/,$/, ''))
    .filter((token) => token && !CREDENTIAL_TOKEN.test(token));
}

// A roster name without a comma leaves a trailing credential as the whole surname field
// ("Jane Doe DVM" gives the surname "DVM"), so the trailing credential is read across both
// fields, keeping two tokens so a short surname that spells a credential survives.
export function rosterBioPersonName(person: RosterBioPerson): string {
  const givenTokens = credentialFreeTokens(person.fname);
  const familyTokens = credentialFreeTokens(person.lname);
  while (givenTokens.length + familyTokens.length > 2) {
    const tokens = familyTokens.length ? familyTokens : givenTokens;
    if (!isTrailingCredential(tokens[tokens.length - 1])) break;
    tokens.pop();
  }
  let given = givenTokens.join(' ');
  const family = familyTokens.join(' ');
  // A roster that puts a credential where the given name belongs ("Ph.D." as the first
  // name) leaves the given name to the profile URL, trusted only when it ends in the surname.
  if (!given && family) {
    const segment =
      rosterBioProfileUrl(person)
        .replace(/[?#].*$/, '')
        .replace(/\/+$/, '')
        .split('/')
        .pop() || '';
    const parts = segment.toLowerCase().split('-').filter(Boolean);
    const familyTail = family.toLowerCase().replace(/[^a-z]+/g, '');
    if (parts.length >= 2 && parts.slice(1).join('') === familyTail) {
      given = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
    }
  }
  return [given, family].filter(Boolean).join(' ');
}

export function rosterBioPersonNameKey(value: unknown): string {
  const tokens = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(?:faculty\s+research|research|lab|laboratory)\b/g, ' ')
    .replace(/[^a-z\s'-]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1);
  if (tokens.length < 2) return '';
  return `${tokens[0]} ${tokens[tokens.length - 1]}`;
}

export function planRosterBioResearchRows(
  people: readonly RosterBioPerson[],
  covered: RosterBioCoveredIdentities,
  resolveDepartment: RosterBioDepartmentResolver,
): { planned: RosterBioPlannedRow[]; skipped: Record<RosterBioSkipReason, number> } {
  const skipped = {} as Record<RosterBioSkipReason, number>;
  const skip = (reason: RosterBioSkipReason) => {
    skipped[reason] = (skipped[reason] || 0) + 1;
  };
  const planned: RosterBioPlannedRow[] = [];
  const plannedSlugs = new Set<string>();
  const plannedNames = new Set<string>();
  for (const person of people) {
    const profileUrl = rosterBioProfileUrl(person);
    if (
      covered.personKeys.has(person.key) ||
      (profileUrl && covered.urls.has(normalizeRosterBioUrl(profileUrl)))
    ) {
      skip('already_covered');
      continue;
    }
    const name = rosterBioPersonName(person);
    const nameKey = rosterBioPersonNameKey(name);
    if (!nameKey) {
      skip('unusable_name');
      continue;
    }
    if (covered.personNames.has(nameKey) || plannedNames.has(nameKey)) {
      skip('already_covered_by_person');
      continue;
    }
    const verdict = rosterBioTitleVerdict(person.title);
    if (verdict !== 'eligible') {
      skip(verdict === 'non_hosting' ? 'non_hosting_title' : verdict);
      continue;
    }
    const derived = deriveBioResearchStatement(person.bio, { name });
    if (derived.rejection) {
      skip(derived.rejection);
      continue;
    }
    if (
      mintsNoResearchEntityAsTeachingAppointment(String(person.title), {
        fullDescription: derived.fullDescription,
      })
    ) {
      skip('teaching_appointment');
      continue;
    }
    const department = resolveDepartment(person, name);
    if (!department) {
      skip('no_department');
      continue;
    }
    if (covered.slugs.has(department.slug) || plannedSlugs.has(department.slug)) {
      skip('slug_taken');
      continue;
    }
    plannedSlugs.add(department.slug);
    plannedNames.add(nameKey);
    planned.push({
      personKey: person.key,
      slug: department.slug,
      name,
      profileUrl,
      department: department.deptName,
      school: department.schoolName,
      evidenceSentences: derived.evidenceSentences,
    });
  }
  return { planned, skipped };
}

// A writer evidence field that is not a stored research-entity path, so the bio's own
// sentences reach the writer but can never be served as the description.
export const ROSTER_BIO_EVIDENCE_FIELD = 'researchInterestSummary';

export function rosterBioResearchObservations(row: RosterBioPlannedRow): ObservationInput[] {
  const base = {
    entityType: 'researchEntity' as const,
    entityKey: row.slug,
    sourceUrl: row.profileUrl,
  };
  return [
    { ...base, field: 'slug', value: row.slug },
    { ...base, field: 'name', value: `${row.name} Faculty Research` },
    { ...base, field: 'kind', value: 'individual' },
    { ...base, field: 'entityType', value: 'FACULTY_RESEARCH_AREA' },
    ...(row.school ? [{ ...base, field: 'school', value: row.school }] : []),
    { ...base, field: 'departments', value: [row.department] },
    { ...base, field: 'sourceUrls', value: [row.profileUrl] },
    { ...base, field: 'inferredPiUserKey', value: row.personKey, confidenceOverride: 0.7 },
    { ...base, field: ROSTER_BIO_EVIDENCE_FIELD, value: row.evidenceSentences.join(' ') },
  ];
}
