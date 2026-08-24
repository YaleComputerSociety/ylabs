import mongoose from 'mongoose';
import { Observation } from '../models/observation';
import { Signal } from '../models/signal';
import {
  undergraduateLogisticsSignalTypes as undergraduateLogisticsClaimTypes,
  type SignalStatus as UndergraduateLogisticsClaimStatus,
  type UndergraduateLogisticsSignalType as UndergraduateLogisticsClaimType,
} from '../models/researchAccessTypes';
import { sanitizeEvidenceExcerpt } from '../utils/descriptionHygiene';
import { isPublicHttpUrl } from '../utils/urlSafety';

export const UNDERGRADUATE_LOGISTICS_OBSERVATION_FIELDS: Record<
  UndergraduateLogisticsClaimType,
  string
> = {
  STUDENT_LEVEL: 'undergraduateLogisticsStudentLevel',
  COMPENSATION: 'undergraduateLogisticsCompensation',
  TIME_COMMITMENT: 'undergraduateLogisticsTimeCommitment',
  MODALITY: 'undergraduateLogisticsModality',
  CURRENT_AVAILABILITY: 'undergraduateLogisticsCurrentAvailability',
};

export const UNDERGRADUATE_LOGISTICS_OBSERVATION_FIELD_SET = new Set(
  Object.values(UNDERGRADUATE_LOGISTICS_OBSERVATION_FIELDS),
);

export const UNDERGRADUATE_LOGISTICS_DAY_MS = 24 * 60 * 60 * 1000;
export const UNDERGRADUATE_LOGISTICS_FRESHNESS_MS: Record<UndergraduateLogisticsClaimType, number> =
  {
    STUDENT_LEVEL: 365 * UNDERGRADUATE_LOGISTICS_DAY_MS,
    COMPENSATION: 365 * UNDERGRADUATE_LOGISTICS_DAY_MS,
    TIME_COMMITMENT: 365 * UNDERGRADUATE_LOGISTICS_DAY_MS,
    MODALITY: 365 * UNDERGRADUATE_LOGISTICS_DAY_MS,
    CURRENT_AVAILABILITY: 60 * UNDERGRADUATE_LOGISTICS_DAY_MS,
  };

const ALLOWED_LOGISTICS_SOURCES = new Set([
  'lab-microsite-undergrad-llm',
  'department-undergrad-research',
  'manual-admin-edit',
  'manual-pi-edit',
]);

const STUDENT_LEVELS = ['FIRST_YEAR', 'SOPHOMORE', 'JUNIOR', 'SENIOR'] as const;
const COMPENSATION_MODES = [
  'PAID',
  'STIPEND',
  'COURSE_CREDIT',
  'VOLUNTEER',
  'WORK_STUDY',
  'FELLOWSHIP',
] as const;
const MODALITY_MODES = ['IN_PERSON', 'HYBRID', 'REMOTE'] as const;
const AVAILABILITY_STATUSES = ['OPEN', 'ROLLING', 'NOT_CURRENTLY_AVAILABLE'] as const;

export const CURRENT_UNDERGRAD_AVAILABILITY_VALUES = [
  'OPEN',
  'ROLLING',
  'NOT_CURRENTLY_AVAILABLE',
  'UNKNOWN',
] as const;

export type CurrentUndergradAvailability = (typeof CURRENT_UNDERGRAD_AVAILABILITY_VALUES)[number];

export interface CurrentAvailabilitySignalInput {
  type?: unknown;
  status?: unknown;
  value?: unknown;
  expiresAt?: Date | string | null;
}

/**
 * Re-derives the browse-filterable current-availability status from raw
 * Signal rows, independently re-applying the 60-day freshness window rather
 * than trusting a status written by a possibly-stale materialize run. Any
 * missing, non-KNOWN, or expired signal fails closed to 'UNKNOWN' - it must
 * never surface as 'OPEN'.
 */
export function currentUndergradAvailabilityFromSignals(
  signals: CurrentAvailabilitySignalInput[],
  now: Date = new Date(),
): CurrentUndergradAvailability {
  const fresh = signals.find(
    (signal) =>
      signal.type === 'CURRENT_AVAILABILITY' &&
      signal.status === 'KNOWN' &&
      signal.expiresAt != null &&
      new Date(signal.expiresAt).getTime() > now.getTime(),
  );
  const status = fresh ? (fresh.value as { status?: unknown } | undefined)?.status : undefined;
  return typeof status === 'string' &&
    AVAILABILITY_STATUSES.includes(status as (typeof AVAILABILITY_STATUSES)[number])
    ? (status as CurrentUndergradAvailability)
    : 'UNKNOWN';
}

type LogisticsValue =
  | { levels: string[] }
  | { modes: string[] }
  | { minHours?: number; maxHours?: number; period: 'WEEK' }
  | { status: string };

export interface UndergraduateLogisticsObservationValue {
  schemaVersion: 1;
  claimType: UndergraduateLogisticsClaimType;
  value: LogisticsValue;
  evidenceQuote: string;
  quoteVerified: true;
  validThrough?: string;
}

export interface UndergraduateLogisticsObservationLike {
  _id?: unknown;
  field?: unknown;
  value?: unknown;
  sourceName?: unknown;
  sourceUrl?: unknown;
  scrapeRunId?: unknown;
  observedAt?: unknown;
  superseded?: unknown;
}

export interface ValidatedUndergraduateLogisticsObservation {
  observationId?: string;
  scrapeRunId?: string;
  claimType: UndergraduateLogisticsClaimType;
  value: LogisticsValue;
  normalizedValue: string;
  sourceName: string;
  sourceUrl: string;
  evidenceExcerpt: string;
  observedAt: Date;
  expiresAt: Date;
}

export interface UndergraduateLogisticsValidationResult {
  accepted?: ValidatedUndergraduateLogisticsObservation;
  rejectedReason?: string;
}

export interface UndergraduateLogisticsClaimPatch {
  claimType: UndergraduateLogisticsClaimType;
  status: UndergraduateLogisticsClaimStatus;
  value?: LogisticsValue;
  sourceEvidenceIds: string[];
  sourceScrapeRunIds: string[];
  sourceName: string;
  sourceUrl: string;
  evidenceExcerpt: string;
  observedAt: Date;
  expiresAt: Date;
  archived: false;
}

export interface UndergraduateLogisticsResolution {
  patches: UndergraduateLogisticsClaimPatch[];
  missingClaimTypes: UndergraduateLogisticsClaimType[];
  rejected: Array<{ claimType?: UndergraduateLogisticsClaimType; reason: string }>;
}

const idString = (value: unknown): string | undefined => {
  if (value instanceof mongoose.Types.ObjectId) return value.toHexString();
  if (typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value)) return value;
  if (value && typeof value === 'object' && 'toString' in value) {
    const text = String(value);
    return /^[a-f0-9]{24}$/i.test(text) ? text : undefined;
  }
  return undefined;
};

const recordValue = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const boundedEnumArray = (value: unknown, allowed: readonly string[]): string[] | undefined => {
  if (!Array.isArray(value) || value.length === 0 || value.length > allowed.length)
    return undefined;
  const normalized = Array.from(new Set(value.map(String))).sort();
  return normalized.every((item) => allowed.includes(item)) ? normalized : undefined;
};

const finiteHour = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 80
    ? value
    : undefined;

function normalizeClaimValue(
  claimType: UndergraduateLogisticsClaimType,
  value: unknown,
): LogisticsValue | undefined {
  const record = recordValue(value);
  if (!record) return undefined;

  if (claimType === 'STUDENT_LEVEL') {
    const levels = boundedEnumArray(record.levels, STUDENT_LEVELS);
    return levels ? { levels } : undefined;
  }
  if (claimType === 'COMPENSATION') {
    const modes = boundedEnumArray(record.modes, COMPENSATION_MODES);
    return modes ? { modes } : undefined;
  }
  if (claimType === 'MODALITY') {
    const modes = boundedEnumArray(record.modes, MODALITY_MODES);
    return modes ? { modes } : undefined;
  }
  if (claimType === 'CURRENT_AVAILABILITY') {
    const status = typeof record.status === 'string' ? record.status : '';
    return AVAILABILITY_STATUSES.includes(status as (typeof AVAILABILITY_STATUSES)[number])
      ? { status }
      : undefined;
  }

  const minHours = finiteHour(record.minHours);
  const maxHours = finiteHour(record.maxHours);
  if (record.period !== 'WEEK' || (!minHours && !maxHours)) return undefined;
  if (minHours && maxHours && minHours > maxHours) return undefined;
  return {
    ...(minHours ? { minHours } : {}),
    ...(maxHours ? { maxHours } : {}),
    period: 'WEEK',
  };
}

const normalizedQuote = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

const hourValuePattern = (value: number): string => {
  const [integer, fraction] = String(value).split('.');
  return fraction ? `${integer}\\.${fraction.replace(/0+$/, '')}0*` : `${integer}(?:\\.0+)?`;
};

const boundedHourPattern = (value: number): string =>
  `(?<![\\d.])${hourValuePattern(value)}(?![\\d.])`;

const clauseHasExclusionOrConditionalScope = (clause: string): boolean =>
  /\b(?:except(?:ing)?|excluding|other\s+than)\b|\bonly\s+(?:if|when)\b/i.test(clause);

const clauseIsDeclarative = (clause: string): boolean =>
  !/^\s*(?:are|is|can|may|will|do|does|did|would|could|should|how|when|where)\b/i.test(clause) &&
  !/\b(?:ask(?:ed|ing)?\s+(?:if|whether)|wonder(?:ed|ing)?\s+(?:if|whether)|whether|would|could|might|hypothetical(?:ly)?|prefer(?:red|s|ring)?|would\s+(?:like|prefer)|propos(?:e|ed|al)|suggest(?:ed|ion)?|discuss(?:ed|ing|ion)?|consider(?:ed|ing)?\s+(?:whether|the\s+possibility))\b/i.test(
    clause,
  );

const clauseSupportsWeeklyHours = (
  clause: string,
  hours: { minHours?: number; maxHours?: number },
): boolean => {
  const { minHours, maxHours } = hours;
  const weeklyUnit = String.raw`(?:(?:hours?|hrs?)\s*(?:per|each|a)\s+week|weekly\s+(?:hours?|hrs?))`;
  const negativeOrAlternative = /\b(?:not|rather\s+than|instead\s+of|except)\b/i;
  const workCommitment =
    /\b(?:work|works|working|commit|commits|commitment|require(?:s|d)?|expect(?:s|ed)?|schedule(?:d)?|spend|spends|dedicate(?:s|d)?|devote(?:s|d)?)\b/i;
  if (
    negativeOrAlternative.test(clause) ||
    !clauseIsDeclarative(clause) ||
    !workCommitment.test(clause)
  ) {
    return false;
  }

  if (minHours !== undefined && maxHours !== undefined) {
    if (minHours === maxHours) {
      return new RegExp(`${boundedHourPattern(minHours)}\\s*${weeklyUnit}`, 'i').test(clause);
    }
    const min = boundedHourPattern(minHours);
    const max = boundedHourPattern(maxHours);
    return (
      new RegExp(`${min}\\s*(?:-|–|—|to|through)\\s*${max}\\s*${weeklyUnit}`, 'i').test(clause) ||
      new RegExp(`\\bbetween\\s+${min}\\s+and\\s+${max}\\s*${weeklyUnit}`, 'i').test(clause)
    );
  }

  if (minHours !== undefined) {
    return new RegExp(
      `\\b(?:at\\s+least|minimum(?:\\s+of)?)\\s+${boundedHourPattern(minHours)}\\s*${weeklyUnit}`,
      'i',
    ).test(clause);
  }
  if (maxHours !== undefined) {
    return new RegExp(
      `\\b(?:up\\s+to|at\\s+most|maximum(?:\\s+of)?)\\s+${boundedHourPattern(maxHours)}\\s*${weeklyUnit}`,
      'i',
    ).test(clause);
  }
  return false;
};

const quoteHasUndergraduatePopulation = (quote: string): boolean => {
  if (
    /\b(?:undergrads?|undergraduates?|undergraduate\s+students?|college\s+students?|yale\s+college\s+students?)\b/i.test(
      quote,
    ) ||
    /\b(?:first[- ]years?|freshm(?:an|en)|sophomores?|juniors?|seniors?)\b/i.test(quote)
  ) {
    return true;
  }

  return (
    /\bstudents?\b/i.test(quote) &&
    !/\b(?:graduate|doctoral|ph\.?d\.?|master'?s?)\s+students?\b/i.test(quote)
  );
};

const undergraduateSubjectPattern = String.raw`(?:undergrads?|undergraduates?|undergraduate\s+(?:research\s+)?(?:students?|assistants?|fellows?)|college\s+students?|yale\s+college\s+students?|students?)`;

const undergraduateLocatedInDirectResearchHome = (clause: string): boolean =>
  new RegExp(
    `\\b${undergraduateSubjectPattern}\\s+(?:in|with|at)\\s+(?:our|this)\\s+lab\\b`,
    'i',
  ).test(clause);

const predicateGovernedByUndergraduateSubject = (
  clause: string,
  predicate: RegExp,
  requiredSubject?: RegExp,
): boolean => {
  const predicateFlags = predicate.flags.replace('g', '');
  const subjectFlags = requiredSubject?.flags.replace('g', '');
  const undergraduateSubject =
    /\b(?:(?:first[- ]years?|freshm(?:an|en)|sophomores?|juniors?|seniors?)\s+(?:undergraduate\s+students?|undergrads?|undergraduates?)|undergraduate\s+(?:research\s+)?(?:students?|assistants?|fellows?|applications?|positions?|roles?|opportunities|openings?)|undergrads?|undergraduates?|college\s+students?|yale\s+college\s+students?|first[- ]years?|freshm(?:an|en)|sophomores?|juniors?|seniors?|students?)\b/gi;
  const directPredicateBridge =
    /^\s*(?:(?:are|is|was|were|will|can|may|must|should|be|been|being|currently|now|also|generally|typically|usually|expected|required|scheduled|to|work|works|working|perform|performs|in|with|our|this|the|lab|commit|commits|committed|spend|spends|dedicate|dedicates|devote|devotes|at|least|up|most|a|minimum|maximum|of|between)\s+)*$/i;

  return clause
    .split(
      /\b(?:who|whom|whose|which|whereas|while)\b|\bthat\s+(?=\w+\s+(?:is|are|was|were|can|may|will|must|work|works|commit|commits|receive|receives|apply|applies)\b)/i,
    )
    .some((segment) => {
      if (!quoteHasUndergraduatePopulation(segment)) return false;
      if (requiredSubject && !new RegExp(requiredSubject.source, subjectFlags).test(segment)) {
        return false;
      }
      const subjects = Array.from(segment.matchAll(undergraduateSubject));
      const predicates = Array.from(
        segment.matchAll(new RegExp(predicate.source, `${predicateFlags}g`)),
      );
      return predicates.some((predicateMatch) =>
        subjects.some((subjectMatch) => {
          const subjectStart = subjectMatch.index ?? -1;
          const subjectEnd = subjectStart + subjectMatch[0].length;
          const predicateStart = predicateMatch.index ?? -1;
          const predicateEnd = predicateStart + predicateMatch[0].length;
          if (subjectStart < 0 || predicateStart < 0) return false;
          if (
            requiredSubject &&
            !new RegExp(requiredSubject.source, subjectFlags).test(subjectMatch[0])
          ) {
            return false;
          }
          if (predicateStart < subjectStart) {
            return (
              predicateEnd <= subjectStart &&
              (/^\s*we\s+(?:are|were|will\s+be)\s*$/i.test(segment.slice(0, predicateStart)) ||
                /^\s*(?:our|this)\s+lab\s+(?:(?:is|was|will\s+be)\s+)?$/i.test(
                  segment.slice(0, predicateStart),
                )) &&
              /^\s*$/.test(segment.slice(predicateEnd, subjectStart))
            );
          }
          if (predicateStart <= subjectEnd) return true;
          return directPredicateBridge.test(segment.slice(subjectEnd, predicateStart));
        }),
      );
    });
};

const undergraduateClaimClauses = (quote: string): string[] =>
  quote
    .split(
      /(?:[!?;]+|(?<!\d)\.(?!\d)|(?:,\s*|\s+)(?:and|but|while|whereas)\s+(?=(?:undergrads?|undergraduates?|undergraduate\s+students?|college\s+students?|yale\s+college\s+students?|students?|first[- ]years?|freshm(?:an|en)|sophomores?|juniors?|seniors?|graduate\s+(?:students?|assistants?)|doctoral\s+(?:students?|fellows?)|postdoctoral\s+fellows?|postdocs?|staff)\b)|,\s*(?=(?:undergrads?|undergraduates?|undergraduate\s+students?|college\s+students?|yale\s+college\s+students?|students?|first[- ]years?|freshm(?:an|en)|sophomores?|juniors?|seniors?|graduate\s+(?:students?|assistants?)|doctoral\s+(?:students?|fellows?)|postdoctoral\s+fellows?|postdocs?|staff)\b)|,\s*(?=(?:but|while|whereas)\b))/i,
    )
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0 && quoteHasUndergraduatePopulation(clause));

const DIRECT_UNDERGRADUATE_NON_ACCEPTANCE_POLICY =
  /\b(?:not\s+(?:currently\s+|now\s+)?accepting|(?:currently|now)\s+not\s+accepting)\b[^.!?;]{0,80}\b(?:undergrads?|undergraduates?|undergraduate\s+(?:students?|researchers?)|research\s+assistants?)\b/i;

export function quoteExplicitlyDeclinesUndergraduates(quote: string): boolean {
  return undergraduateClaimClauses(quote).some(
    (clause) =>
      clauseIsDeclarative(clause) &&
      !clauseHasExclusionOrConditionalScope(clause) &&
      DIRECT_UNDERGRADUATE_NON_ACCEPTANCE_POLICY.test(clause),
  );
}

const clauseHasUndergraduateAvailabilitySubject = (clause: string): boolean => {
  const undergraduatePopulation = String.raw`(?:undergrads?|undergraduates?|undergraduate\s+students?|college\s+students?|yale\s+college\s+students?)`;
  const availabilitySubject = String.raw`(?:applications?|positions?|roles?|opportunities|openings?)`;
  const researchContext =
    /\b(?:research\s+(?:applications?|positions?|roles?|programs?|opportunities|openings?|assistantships?|projects?|participation|work)|(?:applications?|positions?|roles?|programs?|opportunities|openings?)\s+(?:for|in|with|at|to)\s+(?:this|the|our)\s+(?:lab|research\s+(?:group|team|program|project))|participat(?:e|es|ing|ion)\s+in\s+(?:this|the|our)\s+(?:lab|research\s+(?:program|project|group|team)))\b/i;

  const directResearchHomeContext =
    undergraduateLocatedInDirectResearchHome(clause) || /^\s*(?:our|this)\s+lab\b/i.test(clause);

  return (
    (researchContext.test(clause) || directResearchHomeContext) &&
    (new RegExp(`\\b${undergraduatePopulation}\\s+${availabilitySubject}\\b`, 'i').test(clause) ||
      /\bundergraduate\s+research\s+(?:applications?|positions?|roles?|opportunities|openings?)\b/i.test(
        clause,
      ) ||
      new RegExp(
        `\\b${availabilitySubject}\\s+(?:for|from|open\\s+to)\\s+${undergraduatePopulation}\\b`,
        'i',
      ).test(clause) ||
      new RegExp(
        `\\b(?:accept(?:ing|s|ed)?|tak(?:e|es|ing)|hir(?:e|es|ing)|recruit(?:s|ed|ing)?|welcome(?:s|d)?)\\s+${undergraduatePopulation}\\b`,
        'i',
      ).test(clause) ||
      new RegExp(
        `\\b${undergraduatePopulation}\\s+(?:may|can|should|are\\s+(?:invited|welcome))\\s+(?:apply|join)\\b`,
        'i',
      ).test(clause))
  );
};

const studentLevelSupportsResearchParticipation = (clause: string, level: RegExp): boolean => {
  const levelSubject = String.raw`(?:${level.source})(?:\s+undergraduate)?(?:\s+students?)?`;
  const researchOpportunity = String.raw`(?:undergraduate\s+)?(?:research\s+)?(?:roles?|positions?|programs?|opportunities|openings?|assistantships?|projects?|labs?|research\s+groups?)`;
  const participation = String.raw`(?:(?:are\s+)?eligible\s+for|(?:are\s+)?(?:accepted|admitted|allowed)\s+(?:to|into)|(?:are\s+)?(?:welcome|encouraged)\s+to\s+(?:apply\s+(?:for|to)|join|participate\s+in)|(?:may|can)\s+(?:apply\s+(?:for|to)|join|participate\s+in|occupy))`;

  return (
    new RegExp(`\\b${levelSubject}\\s+${participation}\\s+${researchOpportunity}\\b`, 'i').test(
      clause,
    ) ||
    new RegExp(
      `\\bapplications?\\s+from\\s+${levelSubject}\\s+(?:are\\s+)?(?:accepted|welcome|considered)\\s+(?:for|to)\\s+${researchOpportunity}\\b`,
      'i',
    ).test(clause) ||
    new RegExp(
      `^\\s*(?:our|this)\\s+lab\\s+(?:(?:currently|now)\\s+)?(?:accepts?|welcomes?|encourages?)\\s+${levelSubject}\\b`,
      'i',
    ).test(clause)
  );
};

const compensationBenefitsUndergraduateSubject = (clause: string, mode: string): boolean => {
  const benefits: Record<string, string> = {
    PAID: String.raw`(?:are|will\s+be|can\s+be|may\s+be)\s+(?:paid|compensated)|(?:receive|earn)\s+(?:hourly\s+)?(?:pay|wages?|salary|compensation)`,
    STIPEND: String.raw`(?:receive|are\s+(?:provided|offered)|will\s+be\s+(?:provided|offered))\s+(?:a\s+)?stipend`,
    COURSE_CREDIT: String.raw`(?:receive|earn|are\s+(?:provided|offered)|will\s+be\s+(?:provided|offered))\s+(?:course|academic)\s+credit`,
    WORK_STUDY: String.raw`(?:receive|qualify\s+for|are\s+eligible\s+for|hold|occupy|are\s+offered)\s+(?:a\s+)?work[- ]study(?:\s+positions?)?`,
    FELLOWSHIP: String.raw`(?:receive|are\s+(?:provided|offered)|will\s+be\s+(?:provided|offered))\s+(?:a\s+)?(?:fellowship|grant funding)`,
  };
  const benefit = benefits[mode];
  if (!benefit) return true;
  return new RegExp(
    `\\b${undergraduateSubjectPattern}(?:\\s+(?:in|with|at)\\s+(?:our|this)\\s+lab)?\\s+(?:also\\s+)?(?:${benefit})\\b`,
    'i',
  ).test(clause);
};

const compensationSupportsResearchParticipation = (clause: string): boolean => {
  const undergraduateResearchRole =
    /\b(?:undergrads?|undergraduates?|undergraduate\s+students?)\s+research\s+(?:assistants?|fellows?)\b|\bundergraduate\s+research\s+(?:assistants?|fellows?)\b/i;
  const researchParticipation = String.raw`(?:research\s+(?:roles?|positions?|programs?|opportunities|assistantships?|projects?|participation|work)|(?:roles?|positions?|programs?|opportunities|assistantships?|participation|work)\s+(?:in|with|at)\s+(?:this|the|our)\s+(?:lab|research\s+(?:group|team))|participat(?:e|es|ing|ion)\s+in\s+(?:this|the|our)\s+(?:lab|research\s+(?:program|project|group|team)))`;
  const compensationAssociation = String.raw`(?:paid|compensated|pay|wages?|salary|compensation|stipend|course\s+credit|academic\s+credit|volunteer(?:ing)?|work[- ]study(?:\s+positions?)?|fellowship|grant\s+funding)`;

  return (
    undergraduateResearchRole.test(clause) ||
    undergraduateLocatedInDirectResearchHome(clause) ||
    new RegExp(
      String.raw`\b${compensationAssociation}\b.{0,35}\b(?:for|in|through|as\s+part\s+of)\s+(?:their\s+|the\s+|this\s+|our\s+)?${researchParticipation}\b`,
      'i',
    ).test(clause) ||
    new RegExp(
      String.raw`\b${researchParticipation}\b.{0,35}\b(?:is|are|includes?|offers?|provides?|with)\b.{0,20}\b${compensationAssociation}\b`,
      'i',
    ).test(clause)
  );
};

const modalityDescribesUndergraduateWork = (clause: string, mode: RegExp): boolean => {
  const bridge = String.raw`(?:(?:may|can|will|must|should|are|is|be|work|works|working|perform|performs|conduct|conducts|do|does|in|with|at|our|this|the|lab|their|research|activities?|role|position|arrangement|fully|primarily|entirely|also)\s+){0,10}`;
  return new RegExp(
    `\\b${undergraduateSubjectPattern}\\s+${bridge}(?:${mode.source})`,
    mode.flags.replace('g', ''),
  ).test(clause);
};

const researchParticipationPattern = String.raw`(?:research\s+(?:roles?|positions?|programs?|opportunities|openings?|assistantships?|projects?|participation|work|activities?)|(?:roles?|positions?|programs?|opportunities|openings?|assistantships?|participation|work)\s+(?:in|with|at|for)\s+(?:this|the|our)\s+(?:lab|research\s+(?:group|team|program|project))|participat(?:e|es|ing|ion)\s+in\s+(?:this|the|our)\s+(?:lab|research\s+(?:program|project|group|team)))`;

const predicateSupportsResearchParticipation = (clause: string, predicate: RegExp): boolean => {
  return (
    (/\bundergraduate\s+research\s+(?:assistants?|fellows?)\b/i.test(clause) ||
      new RegExp(`\\b${researchParticipationPattern}\\b`, 'i').test(clause) ||
      undergraduateLocatedInDirectResearchHome(clause)) &&
    predicate.test(clause)
  );
};

function quoteSupportsClaim(
  claimType: UndergraduateLogisticsClaimType,
  value: LogisticsValue,
  quote: string,
): boolean {
  const clauses = undergraduateClaimClauses(quote);
  if (clauses.length === 0) return false;
  if (claimType === 'STUDENT_LEVEL') {
    const levels = (value as { levels: string[] }).levels;
    const patterns: Record<string, RegExp> = {
      FIRST_YEAR: /\b(first[- ]year|freshm(?:an|en))\b/i,
      SOPHOMORE: /\bsophomore(s)?\b/i,
      JUNIOR: /\bjunior(s)?\b/i,
      SENIOR: /\bsenior(s)?\b/i,
    };
    const negatedPatterns: Record<string, RegExp> = {
      FIRST_YEAR:
        /\b(?:first[- ]year|freshm(?:an|en))(?:\s+undergraduate)?(?:\s+students?)?\s+(?:(?:are\s+)?(?:ineligible|not\s+(?:eligible|accepted|admitted|allowed|considered|welcome))|(?:cannot|may\s+not)\s+(?:apply|join|participate|be\s+(?:accepted|admitted|considered|welcomed)))\b|\bno\s+(?:first[- ]year|freshm(?:an|en))(?:\s+undergraduate)?(?:\s+students?)?\b/i,
      SOPHOMORE:
        /\bsophomores?(?:\s+undergraduate)?(?:\s+students?)?\s+(?:(?:are\s+)?(?:ineligible|not\s+(?:eligible|accepted|admitted|allowed|considered|welcome))|(?:cannot|may\s+not)\s+(?:apply|join|participate|be\s+(?:accepted|admitted|considered|welcomed)))\b|\bno\s+sophomores?(?:\s+undergraduate)?(?:\s+students?)?\b/i,
      JUNIOR:
        /\bjuniors?(?:\s+undergraduate)?(?:\s+students?)?\s+(?:(?:are\s+)?(?:ineligible|not\s+(?:eligible|accepted|admitted|allowed|considered|welcome))|(?:cannot|may\s+not)\s+(?:apply|join|participate|be\s+(?:accepted|admitted|considered|welcomed)))\b|\bno\s+juniors?(?:\s+undergraduate)?(?:\s+students?)?\b/i,
      SENIOR:
        /\bseniors?(?:\s+undergraduate)?(?:\s+students?)?\s+(?:(?:are\s+)?(?:ineligible|not\s+(?:eligible|accepted|admitted|allowed|considered|welcome))|(?:cannot|may\s+not)\s+(?:apply|join|participate|be\s+(?:accepted|admitted|considered|welcomed)))\b|\bno\s+seniors?(?:\s+undergraduate)?(?:\s+students?)?\b/i,
    };
    const eligibilityPolicy =
      /\b(?:eligible|eligibility|accepts?|accepted|admitted|allowed|welcomes?|open\s+to|may\s+(?:apply|join|participate)|can\s+(?:apply|join|participate)|encouraged\s+to\s+apply|applications?\s+(?:are\s+)?(?:accepted|open)|applicants?\s+(?:must|may|can|should|need\s+to|are\s+required\s+to)|we\s+(?:accept|welcome|consider))\b/i;
    return levels.every((level) =>
      clauses.some(
        (clause) =>
          patterns[level]?.test(clause) &&
          eligibilityPolicy.test(clause) &&
          studentLevelSupportsResearchParticipation(clause, patterns[level]) &&
          predicateGovernedByUndergraduateSubject(clause, eligibilityPolicy, patterns[level]) &&
          clauseIsDeclarative(clause) &&
          !clauseHasExclusionOrConditionalScope(clause) &&
          !negatedPatterns[level]?.test(clause),
      ),
    );
  }
  if (claimType === 'COMPENSATION') {
    const modes = (value as { modes: string[] }).modes;
    const patterns: Record<string, RegExp> = {
      PAID: /\b(paid|pay|hourly|wage|salary|compensat)/i,
      STIPEND: /\bstipend/i,
      COURSE_CREDIT: /\b(course|academic) credit\b/i,
      VOLUNTEER: /\bvolunteer/i,
      WORK_STUDY: /\bwork[- ]study/i,
      FELLOWSHIP: /\bfellowship|grant funding/i,
    };
    const negatedPatterns: Record<string, RegExp> = {
      PAID: /\b(?:positions?|roles?|work|students?|assistants?)\s+(?:(?:are\s+|is\s+)?not\s+(?:paid|compensated)|(?:cannot|may\s+not)\s+be\s+(?:paid|compensated))\b|\b(?:unpaid|without (?:pay|compensation))\b/i,
      STIPEND:
        /\bno\s+stipend\b|\bstipends?\s+(?:are\s+|is\s+)?not\s+(?:available|provided|offered)\b/i,
      COURSE_CREDIT:
        /\bno\s+(?:course|academic)\s+credit\b|\b(?:course|academic)\s+credit\s+(?:is\s+)?not\s+(?:available|provided|offered)\b/i,
      VOLUNTEER:
        /\bno\s+volunteers?\b|\bvolunteer(?:ing|s)?\s+(?:is\s+|are\s+)?not\s+(?:available|accepted|allowed|offered)\b/i,
      WORK_STUDY:
        /\bno\s+work[- ]study\b|\bwork[- ]study\s+(?:is\s+)?not\s+(?:available|accepted|offered)\b/i,
      FELLOWSHIP:
        /\bno\s+(?:fellowship|grant funding)\b|\b(?:fellowships?|grant funding)\s+(?:is\s+|are\s+)?not\s+(?:available|provided|offered)\b/i,
    };
    const affirmativePatterns: Record<string, RegExp> = {
      PAID: /\b(?:students?|assistants?|positions?|roles?|work)\s+(?:are|is|will\s+be|can\s+be|may\s+be)\s+(?:paid|compensated)\b|\b(?:receive|earn|provide[sd]?|offer(?:ed|s)?)\s+(?:hourly\s+)?(?:pay|wages?|salary|compensation)\b/i,
      STIPEND:
        /\b(?:receive|include[sd]?|provide[sd]?|offer(?:ed|s)?)\s+(?:a\s+)?stipend\b|\bstipend\s+(?:is|will\s+be)\s+(?:provided|offered|available)\b/i,
      COURSE_CREDIT:
        /\b(?:receive|earn|provide[sd]?|offer(?:ed|s)?)\s+(?:course|academic)\s+credit\b|\b(?:course|academic)\s+credit\s+(?:is|will\s+be)\s+(?:provided|offered|available)\b/i,
      VOLUNTEER:
        /\b(?:may|can)\s+volunteer\b|\bvolunteers?\s+(?:are\s+)?(?:accepted|welcome|needed)\b/i,
      WORK_STUDY:
        /\bwork[- ]study\s+(?:is|positions?\s+are)\s+(?:available|offered|accepted)\b|\b(?:students?|undergrads?|undergraduates?)\s+(?:receive|qualify\s+for|are\s+eligible\s+for|hold|occupy|are\s+offered)\s+(?:a\s+)?work[- ]study(?:\s+positions?)?\b/i,
      FELLOWSHIP:
        /\b(?:receive|include[sd]?|provide[sd]?|offer(?:ed|s)?)\s+(?:a\s+)?(?:fellowship|grant funding)\b|\b(?:fellowships?|grant funding)\s+(?:is|are)\s+(?:provided|offered|available)\b/i,
    };
    if (
      modes.includes('PAID') &&
      clauses.some((clause) => /\bno\s+(?:pay|compensation)(?:\s+is\s+available)?\b/i.test(clause))
    ) {
      return false;
    }
    return modes.every((mode) =>
      clauses.some(
        (clause) =>
          patterns[mode]?.test(clause) &&
          affirmativePatterns[mode]?.test(clause) &&
          predicateGovernedByUndergraduateSubject(clause, affirmativePatterns[mode]) &&
          compensationBenefitsUndergraduateSubject(clause, mode) &&
          compensationSupportsResearchParticipation(clause) &&
          clauseIsDeclarative(clause) &&
          !clauseHasExclusionOrConditionalScope(clause) &&
          !negatedPatterns[mode]?.test(clause) &&
          !/\bnot\s+(?:eligible|allowed|accepted|admitted)\s+for\s+(?:a\s+)?(?:paid|stipend|course|academic|volunteer|work[- ]study|fellowship|grant)/i.test(
            clause,
          ),
      ),
    );
  }
  if (claimType === 'TIME_COMMITMENT') {
    const hours = value as { minHours?: number; maxHours?: number };
    const weeklyHoursExpression =
      /(?<![\d.])\d+(?:\.\d+)?(?:\s*(?:-|–|—|to|through)\s*\d+(?:\.\d+)?)?\s*(?:(?:hours?|hrs?)\s*(?:per|each|a)\s+week|weekly\s+(?:hours?|hrs?))/i;
    return clauses.some(
      (clause) =>
        predicateGovernedByUndergraduateSubject(clause, weeklyHoursExpression) &&
        predicateSupportsResearchParticipation(clause, weeklyHoursExpression) &&
        clauseSupportsWeeklyHours(clause, hours),
    );
  }
  if (claimType === 'MODALITY') {
    const modes = (value as { modes: string[] }).modes;
    const patterns: Record<string, RegExp> = {
      IN_PERSON: /\bin[- ]person|on[- ]site|in the lab\b/i,
      HYBRID: /\bhybrid\b/i,
      REMOTE: /\bremote(?:ly)?|virtual\b/i,
    };
    const negatedPatterns: Record<string, RegExp> = {
      IN_PERSON:
        /\b(?:in[- ]person|on[- ]site)\s+(?:work\s+)?(?:is\s+)?(?:not\s+(?:available|allowed|offered)|unavailable)\b|\bno\s+(?:in[- ]person|on[- ]site)\s+(?:work|option)\b/i,
      HYBRID:
        /\bhybrid\s+(?:work\s+)?(?:is\s+)?(?:not\s+(?:available|allowed|offered)|unavailable)\b|\bno\s+hybrid\s+(?:work|option)\b/i,
      REMOTE:
        /\b(?:remote|virtual)\s+(?:work\s+)?(?:is\s+)?(?:not\s+(?:available|allowed|offered)|unavailable)\b|\bno\s+(?:remote|virtual)\s+(?:work|option)\b|\b(?:students?|assistants?)\s+(?:cannot|may\s+not)\s+(?:work\s+)?(?:remotely|virtually)\b/i,
    };
    const modalityPolicy =
      /\b(?:work|works|working|role|position|research|activities?)\b.{0,40}\b(?:in[- ]person|on[- ]site|in the lab|hybrid|remote(?:ly)?|virtual(?:ly)?)\b|\b(?:in[- ]person|on[- ]site|hybrid|remote|virtual)\s+(?:work|role|position|option|arrangement)\s+(?:is|are)\s+(?:available|offered|allowed|required)\b/i;
    return modes.every((mode) =>
      clauses.some(
        (clause) =>
          patterns[mode]?.test(clause) &&
          modalityPolicy.test(clause) &&
          predicateGovernedByUndergraduateSubject(clause, modalityPolicy) &&
          modalityDescribesUndergraduateWork(clause, patterns[mode]) &&
          predicateSupportsResearchParticipation(clause, modalityPolicy) &&
          clauseIsDeclarative(clause) &&
          !clauseHasExclusionOrConditionalScope(clause) &&
          !negatedPatterns[mode]?.test(clause),
      ),
    );
  }

  const status = (value as { status: string }).status;
  if (status === 'ROLLING') {
    const rollingPolicy =
      /\b(?:applications?|admissions?)\b.{0,30}\b(?:are|is|remain|accepted|reviewed|considered|open)\b|\brolling\s+(?:applications?|admissions?|basis)\b/i;
    return clauses.some(
      (clause) =>
        clauseHasUndergraduateAvailabilitySubject(clause) &&
        /\brolling\b/i.test(clause) &&
        rollingPolicy.test(clause) &&
        predicateGovernedByUndergraduateSubject(clause, rollingPolicy) &&
        clauseIsDeclarative(clause) &&
        !clauseHasExclusionOrConditionalScope(clause) &&
        !/\b(?:not|no\s+longer)\s+rolling\b|\bnon(?:[\s\-‐‑‒–—]+)rolling\b|\bno\s+rolling\s+(?:admissions?|applications?)\b/i.test(
          clause,
        ),
    );
  }
  if (status === 'NOT_CURRENTLY_AVAILABLE') {
    const unavailablePolicy =
      /\b(not currently (?:accepting|taking|hiring)|not accepting|no (?:current )?(?:openings|positions)|positions? (?:are|is) filled|unable to accept)\b/i;
    return clauses.some(
      (clause) =>
        (clauseHasUndergraduateAvailabilitySubject(clause) &&
          clauseIsDeclarative(clause) &&
          unavailablePolicy.test(clause) &&
          predicateGovernedByUndergraduateSubject(clause, unavailablePolicy)) ||
        (clauseIsDeclarative(clause) &&
          !clauseHasExclusionOrConditionalScope(clause) &&
          DIRECT_UNDERGRADUATE_NON_ACCEPTANCE_POLICY.test(clause)),
    );
  }
  const negatedAvailability =
    /\b(?:not|never)\s+(?:currently\s+|now\s+)?(?:accepting|taking|hiring|recruiting|open)\b|\bno\s+(?:longer\s+)?(?:openings?|positions?|opportunities)|\bapplications?\s+(?:are|is)\s+not\s+open\b|\b(?:positions?|roles?|opportunities)\s+(?:are|is)\s+(?:closed|filled)\b|\bunable\s+to\s+(?:accept|take|hire)\b/i;
  const openPolicy =
    /\b(?:currently|now)\s+(?:accepting|taking|hiring|recruiting|looking\s+for|seeking)\b|\b(?:is|are)\s+recruiting\b|\bapplications?\s+(?:are\s+|is\s+)?open\b|\b(?:positions?|roles?|opportunities)\s+(?:are\s+|is\s+)?open\b|\bopen\s+(?:positions?|roles?|opportunities)\b|\b(?:accepting|taking)\s+applications?\b|\brecruiting\s+(?:now|currently)\b/i;
  const directUndergraduateRecruitingPolicy =
    /\b(?:lab|laboratory|section|program)(?:\s+(?:of|for)\s+[a-z][a-z\s&-]{0,60})?\s+(?:is|are)\s+(?:currently\s+)?(?:looking\s+for|seeking|recruiting)\b[^.!?;]{0,120}\b(?:undergrads?|undergraduates?|undergraduate\s+students?|undergraduate\s+student\s+body|students?\s+to\s+join\s+(?:the\s+)?undergraduate\s+research)\b/i;
  return clauses.some(
    (clause) =>
      clauseIsDeclarative(clause) &&
      !negatedAvailability.test(clause) &&
      ((clauseHasUndergraduateAvailabilitySubject(clause) &&
        openPolicy.test(clause) &&
        predicateGovernedByUndergraduateSubject(clause, openPolicy)) ||
        directUndergraduateRecruitingPolicy.test(clause)),
  );
}

const dateValue = (value: unknown): Date | undefined => {
  const stringValue = typeof value === 'string' ? value.trim() : undefined;
  const date =
    value instanceof Date
      ? value
      : stringValue
        ? /^\d{4}-\d{2}-\d{2}$/.test(stringValue)
          ? new Date(`${stringValue}T23:59:59.999Z`)
          : new Date(stringValue)
        : undefined;
  return date && !Number.isNaN(date.getTime()) ? date : undefined;
};

function expiryForObservation(
  claimType: UndergraduateLogisticsClaimType,
  observedAt: Date,
  validThrough: unknown,
): Date {
  const freshnessExpiry = new Date(
    observedAt.getTime() + UNDERGRADUATE_LOGISTICS_FRESHNESS_MS[claimType],
  );
  const explicitExpiry = dateValue(validThrough);
  return explicitExpiry && explicitExpiry < freshnessExpiry ? explicitExpiry : freshnessExpiry;
}

export function validateUndergraduateLogisticsObservation(
  observation: UndergraduateLogisticsObservationLike,
): UndergraduateLogisticsValidationResult {
  const field = typeof observation.field === 'string' ? observation.field : '';
  const claimType = undergraduateLogisticsClaimTypes.find(
    (type) => UNDERGRADUATE_LOGISTICS_OBSERVATION_FIELDS[type] === field,
  );
  if (!claimType) return { rejectedReason: 'unsupported_field' };
  if (observation.superseded === true) return { rejectedReason: 'superseded' };

  const sourceName = typeof observation.sourceName === 'string' ? observation.sourceName : '';
  if (!ALLOWED_LOGISTICS_SOURCES.has(sourceName)) {
    return { rejectedReason: 'source_not_authoritative_for_logistics' };
  }
  const sourceUrl = typeof observation.sourceUrl === 'string' ? observation.sourceUrl : '';
  try {
    if (!isPublicHttpUrl(sourceUrl)) return { rejectedReason: 'missing_safe_public_source_url' };
  } catch {
    return { rejectedReason: 'missing_safe_public_source_url' };
  }

  const raw = recordValue(observation.value);
  if (!raw || raw.schemaVersion !== 1 || raw.claimType !== claimType) {
    return { rejectedReason: 'invalid_claim_envelope' };
  }
  if (raw.quoteVerified !== true) return { rejectedReason: 'quote_not_verified' };
  const quote = normalizedQuote(raw.evidenceQuote);
  if (quote.length < 8 || quote.length > 500) return { rejectedReason: 'invalid_evidence_quote' };
  const value = normalizeClaimValue(claimType, raw.value);
  if (!value) return { rejectedReason: 'invalid_claim_value' };
  if (!quoteSupportsClaim(claimType, value, quote)) {
    return { rejectedReason: 'evidence_does_not_support_exact_claim' };
  }
  const observedAt = dateValue(observation.observedAt);
  if (!observedAt) return { rejectedReason: 'invalid_observed_at' };

  return {
    accepted: {
      observationId: idString(observation._id),
      scrapeRunId: idString(observation.scrapeRunId),
      claimType,
      value,
      normalizedValue: JSON.stringify(value),
      sourceName,
      sourceUrl,
      evidenceExcerpt: sanitizeEvidenceExcerpt(quote),
      observedAt,
      expiresAt: expiryForObservation(claimType, observedAt, raw.validThrough),
    },
  };
}

const uniqueStrings = (values: Array<string | undefined>): string[] =>
  Array.from(new Set(values.filter((value): value is string => Boolean(value))));

function patchFromObservations(
  claimType: UndergraduateLogisticsClaimType,
  observations: ValidatedUndergraduateLogisticsObservation[],
  now: Date,
): UndergraduateLogisticsClaimPatch {
  const fresh = observations.filter((item) => item.expiresAt > now);
  const candidates = fresh.length > 0 ? fresh : observations;
  const newest = [...candidates].sort(
    (left, right) => right.observedAt.getTime() - left.observedAt.getTime(),
  )[0];
  const distinctFreshValues = new Set(fresh.map((item) => item.normalizedValue));
  const status: UndergraduateLogisticsClaimStatus =
    fresh.length === 0
      ? 'STALE_UNDER_REVIEW'
      : distinctFreshValues.size > 1
        ? 'CONFLICTING_WITHHELD'
        : 'KNOWN';
  const supporting =
    status === 'KNOWN'
      ? fresh.filter((item) => item.normalizedValue === newest.normalizedValue)
      : candidates;

  return {
    claimType,
    status,
    ...(status === 'KNOWN' ? { value: newest.value } : {}),
    sourceEvidenceIds: uniqueStrings(supporting.map((item) => item.observationId)),
    sourceScrapeRunIds: uniqueStrings(supporting.map((item) => item.scrapeRunId)),
    sourceName: newest.sourceName,
    sourceUrl: newest.sourceUrl,
    evidenceExcerpt: newest.evidenceExcerpt,
    observedAt: newest.observedAt,
    expiresAt: newest.expiresAt,
    archived: false,
  };
}

export function resolveUndergraduateLogisticsClaims(
  observations: UndergraduateLogisticsObservationLike[],
  now: Date = new Date(),
): UndergraduateLogisticsResolution {
  const acceptedByType = new Map<
    UndergraduateLogisticsClaimType,
    ValidatedUndergraduateLogisticsObservation[]
  >();
  const rejected: UndergraduateLogisticsResolution['rejected'] = [];

  for (const observation of observations) {
    const result = validateUndergraduateLogisticsObservation(observation);
    if (!result.accepted) {
      const field = typeof observation.field === 'string' ? observation.field : '';
      rejected.push({
        claimType: undergraduateLogisticsClaimTypes.find(
          (type) => UNDERGRADUATE_LOGISTICS_OBSERVATION_FIELDS[type] === field,
        ),
        reason: result.rejectedReason || 'rejected',
      });
      continue;
    }
    const rows = acceptedByType.get(result.accepted.claimType) || [];
    rows.push(result.accepted);
    acceptedByType.set(result.accepted.claimType, rows);
  }

  const patches: UndergraduateLogisticsClaimPatch[] = [];
  const missingClaimTypes: UndergraduateLogisticsClaimType[] = [];
  for (const claimType of undergraduateLogisticsClaimTypes) {
    const claimObservations = acceptedByType.get(claimType) || [];
    if (claimObservations.length === 0) {
      missingClaimTypes.push(claimType);
      continue;
    }
    patches.push(patchFromObservations(claimType, claimObservations, now));
  }
  return { patches, missingClaimTypes, rejected };
}

export async function materializeUndergraduateLogisticsForResearchEntity(input: {
  researchEntityId: string;
  entityKey?: string;
  now?: Date;
  dryRun?: boolean;
}): Promise<{
  known: number;
  stale: number;
  conflicts: number;
  archived: number;
  rejected: number;
}> {
  const now = input.now || new Date();
  const identifiers: Record<string, unknown>[] = [{ entityId: input.researchEntityId }];
  if (input.entityKey) identifiers.push({ entityKey: input.entityKey });
  const observations = await Observation.find({
    entityType: { $in: ['researchEntity', 'researchGroup'] },
    $or: identifiers,
    field: { $in: Array.from(UNDERGRADUATE_LOGISTICS_OBSERVATION_FIELD_SET) },
    superseded: false,
  }).lean();
  const resolution = resolveUndergraduateLogisticsClaims(observations, now);

  if (input.dryRun) {
    return {
      known: resolution.patches.filter((patch) => patch.status === 'KNOWN').length,
      stale: resolution.patches.filter((patch) => patch.status === 'STALE_UNDER_REVIEW').length,
      conflicts: resolution.patches.filter((patch) => patch.status === 'CONFLICTING_WITHHELD')
        .length,
      archived: 0,
      rejected: resolution.rejected.length,
    };
  }

  for (const patch of resolution.patches) {
    await Signal.updateOne(
      {
        researchEntityId: input.researchEntityId,
        type: patch.claimType,
        derivationKey: `logistics:${patch.claimType}`,
      },
      {
        $set: {
          researchEntityId: input.researchEntityId,
          type: patch.claimType,
          derivationKey: `logistics:${patch.claimType}`,
          status: patch.status,
          'source.name': patch.sourceName,
          'source.url': patch.sourceUrl,
          'source.excerpt': patch.evidenceExcerpt,
          'source.evidenceIds': patch.sourceEvidenceIds,
          'source.scrapeRunIds': patch.sourceScrapeRunIds,
          observedAt: patch.observedAt,
          expiresAt: patch.expiresAt,
          archived: patch.archived,
          lastMaterializedAt: now,
          ...(patch.value === undefined ? {} : { value: patch.value }),
        },
        ...(patch.value === undefined ? { $unset: { value: '' } } : {}),
      },
      { upsert: true },
    );
  }

  let archived = 0;
  if (resolution.missingClaimTypes.length > 0) {
    const result = await Signal.updateMany(
      {
        researchEntityId: input.researchEntityId,
        type: { $in: resolution.missingClaimTypes },
        archived: { $ne: true },
      },
      { $set: { archived: true, lastMaterializedAt: now } },
    );
    archived = result.modifiedCount;
  }

  return {
    known: resolution.patches.filter((patch) => patch.status === 'KNOWN').length,
    stale: resolution.patches.filter((patch) => patch.status === 'STALE_UNDER_REVIEW').length,
    conflicts: resolution.patches.filter((patch) => patch.status === 'CONFLICTING_WITHHELD').length,
    archived,
    rejected: resolution.rejected.length,
  };
}
