import crypto from 'crypto';

import type { ObservationInput } from './types';
import { slugify } from './utils/scraperHelpers';

export type ProgramAccessRole =
  | 'FUNDING_ONLY'
  | 'STRUCTURED_ENTRY'
  | 'HOSTED_INTERNSHIP'
  | 'MENTOR_MATCHING'
  | 'UNKNOWN';

type ProgramCategory = string;

export interface ProgramCandidateInput {
  sourceName: string;
  title: string;
  sourceUrl: string;
  summary?: string;
  description?: string;
  applicationInformation?: string;
  eligibility?: string;
  restrictionsToUseOfAward?: string;
  additionalInformation?: string;
  applicationLink?: string;
  links?: Array<{ label: string; url: string }>;
  awardAmount?: string;
  deadline?: Date;
  applicationOpenDate?: Date;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  contactOffice?: string;
  yearOfStudy?: string[];
  termOfAward?: string[];
  purpose?: string[];
  globalRegions?: string[];
  citizenshipStatus?: string[];
  isAcceptingApplications?: boolean;
  reviewRequired?: boolean;
  programCategory?: ProgramCategory;
  programAccessRole?: ProgramAccessRole;
  hostedByResearchEntityName?: string;
  hostedByResearchEntityUrl?: string;
}

export interface ProgramCandidate extends ProgramCandidateInput {
  sourceKey: string;
  sourceFingerprint: string;
}

export function buildProgramSourceKey(sourceName: string, title: string): string {
  return `${sourceName}:${slugify(title)}`;
}

export function parseProgramDeadlineToUtcEndOfDay(text: string, _referenceDate?: Date): Date | undefined {
  const monthNames =
    'January|February|March|April|May|June|July|August|September|October|November|December';
  const match = text.match(
    new RegExp(`\\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday,?\\s+)?(${monthNames})\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, 'i'),
  );
  if (!match) return undefined;

  const monthIndex = new Date(`${match[1]} 1, 2000`).getUTCMonth();
  const day = Number(match[2]);
  const year = Number(match[3]);
  if (!Number.isInteger(day) || day < 1 || day > 31) return undefined;

  const parsed = new Date(Date.UTC(year, monthIndex, day, 23, 59, 59, 999));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== monthIndex || parsed.getUTCDate() !== day) {
    return undefined;
  }

  return parsed;
}

export function inferProgramAccessRole(title: string, description: string): ProgramAccessRole {
  const text = `${title} ${description}`.toLowerCase();

  if (/\bmentor[-\s]?matching\b/.test(text) || /\bmatched with (?:yale )?faculty mentors?\b/.test(text)) {
    return 'MENTOR_MATCHING';
  }

  if (/\binternships?\b/.test(text) && /\b(place|places|placement|placed|placing)\b/.test(text)) {
    return 'HOSTED_INTERNSHIP';
  }

  if (
    /\bjoin (?:a )?cohort\b/.test(text) ||
    /\blab placement\b/.test(text) ||
    /\bresearch placement\b/.test(text) ||
    /\bhosted research program\b/.test(text)
  ) {
    return 'STRUCTURED_ENTRY';
  }

  if (/\b(funding|grant|stipend|award|proposal|adviser|advisor|student-designed project)\b/.test(text)) {
    return 'FUNDING_ONLY';
  }

  return 'UNKNOWN';
}

export function finalizeProgramCandidate(input: ProgramCandidateInput): ProgramCandidate {
  const sourceKey = buildProgramSourceKey(input.sourceName, input.title);
  const fingerprintPayload = stableJson({
    ...input,
    sourceKey,
    deadline: input.deadline?.toISOString(),
    applicationOpenDate: input.applicationOpenDate?.toISOString(),
  });
  const sourceFingerprint = crypto.createHash('sha256').update(fingerprintPayload).digest('hex');

  return {
    ...input,
    sourceKey,
    sourceFingerprint,
  };
}

export function candidateToProgramObservations(candidate: ProgramCandidate): ObservationInput[] {
  const base = {
    entityType: 'fellowship' as const,
    entityKey: candidate.sourceKey,
    sourceUrl: candidate.sourceUrl,
  };
  const observations: ObservationInput[] = [];

  const add = (field: keyof ProgramCandidate | string, value: unknown) => {
    if (value === undefined || value === null) return;
    if (typeof value === 'string' && value.trim() === '') return;
    if (Array.isArray(value) && value.length === 0) return;
    observations.push({ ...base, field: String(field), value });
  };

  add('sourceKey', candidate.sourceKey);
  add('sourceFingerprint', candidate.sourceFingerprint);
  add('sourceName', candidate.sourceName);
  add('title', candidate.title);
  add('sourceUrl', candidate.sourceUrl);
  add('summary', candidate.summary);
  add('description', candidate.description);
  add('applicationInformation', candidate.applicationInformation);
  add('eligibility', candidate.eligibility);
  add('restrictionsToUseOfAward', candidate.restrictionsToUseOfAward);
  add('additionalInformation', candidate.additionalInformation);
  add('applicationLink', candidate.applicationLink);
  add('links', candidate.links);
  add('awardAmount', candidate.awardAmount);
  add('deadline', candidate.deadline);
  add('applicationOpenDate', candidate.applicationOpenDate);
  add('contactName', candidate.contactName);
  add('contactEmail', candidate.contactEmail);
  add('contactPhone', candidate.contactPhone);
  add('contactOffice', candidate.contactOffice);
  add('yearOfStudy', candidate.yearOfStudy);
  add('termOfAward', candidate.termOfAward);
  add('purpose', candidate.purpose);
  add('globalRegions', candidate.globalRegions);
  add('citizenshipStatus', candidate.citizenshipStatus);
  add('isAcceptingApplications', candidate.isAcceptingApplications);
  add('reviewRequired', candidate.reviewRequired);
  add('programCategory', candidate.programCategory);
  add('programAccessRole', candidate.programAccessRole);
  add('hostedByResearchEntityName', candidate.hostedByResearchEntityName);
  add('hostedByResearchEntityUrl', candidate.hostedByResearchEntityUrl);

  return observations;
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortForStableJson(value));
}

function sortForStableJson(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(sortForStableJson);
  if (!value || typeof value !== 'object') return value;

  return Object.keys(value)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = sortForStableJson((value as Record<string, unknown>)[key]);
      return acc;
    }, {});
}
