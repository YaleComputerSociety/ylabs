import type { Fellowship, ProgramAudience } from '../types/types';
import {
  type ProgramDateBoundary,
  formatProgramDate,
  formatShortProgramDate,
  parseProgramDate,
  programDeadlineClosingInstant,
} from './programDates';

export const CLOSING_SOON_DAYS = 30;

export const STALE_DEADLINE_MESSAGE = 'Check the official page for the current deadline';
export const STALE_DEADLINE_SHORT_LABEL = 'Deadline: check official page';
export const STALE_DEADLINE_STATUS_LABEL = 'Dates not confirmed';

export type FellowshipApplicationStatusKind =
  | 'open'
  | 'closingSoon'
  | 'notOpenYet'
  | 'closed'
  | 'deadlinePassed'
  | 'projectedNextCycle'
  | 'staleDeadline'
  | 'unknown';

export interface FellowshipApplicationStatus {
  kind: FellowshipApplicationStatusKind;
  label: string;
  detail: string;
  deadlineLabel: string;
  openDateLabel: string;
  daysUntilDeadline: number | null;
  isCurrentlyRelevant: boolean;
  isApplicationWindowOpen: boolean;
  needsDateReview: boolean;
  needsEligibilityReview: boolean;
}

export const formatFellowshipDate = (
  value: string | null | undefined,
  boundary: ProgramDateBoundary,
  fallback = 'Not specified',
): string => formatProgramDate(value, boundary, fallback);

export const formatShortFellowshipDate = (
  value: string | null | undefined,
  fallback = 'Date not specified',
): string => formatShortProgramDate(value, fallback);

const ROLLING_APPLICATION_RE =
  /\brolling\b|\breview(?:ed|ing)?\s+applications?\s+as\s+(?:we|they)\s+(?:are\s+)?receiv|\bas\s+applications?\s+are\s+received\b|\bapplications?\s+(?:are\s+)?accepted\s+(?:on\s+a\s+)?(?:rolling|continuous|year[-\s]?round)\b|\bno\s+(?:fixed|set)\s+deadline\b/i;

type FellowshipApplicationTextFields = Partial<
  Pick<
    Fellowship,
    | 'title'
    | 'competitionType'
    | 'summary'
    | 'description'
    | 'applicationInformation'
    | 'additionalInformation'
  >
>;

export const hasRollingApplicationWindow = (
  fellowship: FellowshipApplicationTextFields,
): boolean => {
  const text = [
    fellowship.title,
    fellowship.competitionType,
    fellowship.summary,
    fellowship.description,
    fellowship.applicationInformation,
    fellowship.additionalInformation,
  ]
    .filter(Boolean)
    .join(' ');
  return ROLLING_APPLICATION_RE.test(text);
};

export const getFellowshipApplicationStatus = (
  fellowship: Pick<
    Fellowship,
    | 'isAcceptingApplications'
    | 'applicationOpenDate'
    | 'deadline'
    | 'deadlineProjectedNextCycle'
    | 'deadlineStale'
    | 'eligibility'
    | 'yearOfStudy'
    | 'termOfAward'
    | 'purpose'
    | 'globalRegions'
    | 'citizenshipStatus'
  > &
    FellowshipApplicationTextFields,
  now = new Date(),
): FellowshipApplicationStatus => {
  const openDate = parseProgramDate(fellowship.applicationOpenDate);
  const deadline = programDeadlineClosingInstant(fellowship.deadline);
  const deadlinePassed = deadline ? deadline.getTime() < now.getTime() : false;
  const notOpenYet = openDate ? openDate.getTime() > now.getTime() : false;
  const rollingApplications = hasRollingApplicationWindow(fellowship);
  const isApplicationWindowOpen =
    !deadlinePassed && !notOpenYet && (Boolean(deadline) || rollingApplications);
  const daysUntilDeadline = deadline
    ? Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    : null;
  const hasStructuredEligibility =
    (fellowship.yearOfStudy?.length || 0) > 0 ||
    (fellowship.termOfAward?.length || 0) > 0 ||
    (fellowship.purpose?.length || 0) > 0 ||
    (fellowship.globalRegions?.length || 0) > 0 ||
    (fellowship.citizenshipStatus?.length || 0) > 0;
  const needsEligibilityReview = !fellowship.eligibility?.trim() && !hasStructuredEligibility;
  const needsDateReview = fellowship.isAcceptingApplications && !deadline;

  const base = {
    deadlineLabel: formatFellowshipDate(fellowship.deadline, 'deadline'),
    openDateLabel: formatFellowshipDate(fellowship.applicationOpenDate, 'opens'),
    daysUntilDeadline,
    needsDateReview,
    needsEligibilityReview,
  };

  if (fellowship.deadlineStale) {
    return {
      ...base,
      deadlineLabel: STALE_DEADLINE_MESSAGE,
      openDateLabel: STALE_DEADLINE_MESSAGE,
      daysUntilDeadline: null,
      needsDateReview: false,
      kind: 'staleDeadline',
      label: STALE_DEADLINE_STATUS_LABEL,
      detail: STALE_DEADLINE_MESSAGE,
      isCurrentlyRelevant: true,
      isApplicationWindowOpen: false,
    };
  }

  if (fellowship.deadlineProjectedNextCycle) {
    return {
      ...base,
      kind: 'projectedNextCycle',
      label: 'Projected next cycle',
      detail: `Est. next deadline ~${formatShortFellowshipDate(fellowship.deadline)} - unconfirmed, verify at source`,
      isCurrentlyRelevant: true,
      isApplicationWindowOpen: false,
    };
  }

  if (deadlinePassed) {
    return {
      ...base,
      kind: 'deadlinePassed',
      label: 'Deadline passed',
      detail: `Deadline passed ${formatShortFellowshipDate(fellowship.deadline)}`,
      isCurrentlyRelevant: false,
      isApplicationWindowOpen,
    };
  }

  if (notOpenYet) {
    return {
      ...base,
      kind: 'notOpenYet',
      label: 'Opens soon',
      detail: `Applications open ${formatShortFellowshipDate(fellowship.applicationOpenDate)}`,
      isCurrentlyRelevant: true,
      isApplicationWindowOpen,
    };
  }

  if (!deadline) {
    if (rollingApplications) {
      return {
        ...base,
        kind: 'open',
        label: 'Accepting applications',
        detail: 'Applications are accepted on a rolling basis',
        isCurrentlyRelevant: true,
        isApplicationWindowOpen,
      };
    }
    if (fellowship.isAcceptingApplications) {
      return {
        ...base,
        kind: 'unknown',
        label: 'Timing not confirmed',
        detail: 'Applications may be open, but no deadline is listed',
        isCurrentlyRelevant: true,
        isApplicationWindowOpen,
      };
    }
    return {
      ...base,
      kind: 'closed',
      label: 'Not accepting applications',
      detail: 'Application timing has not been announced',
      isCurrentlyRelevant: false,
      isApplicationWindowOpen,
    };
  }

  if (daysUntilDeadline !== null && daysUntilDeadline <= CLOSING_SOON_DAYS) {
    return {
      ...base,
      kind: 'closingSoon',
      label: daysUntilDeadline <= 1 ? 'Due soon' : 'Closing soon',
      detail:
        daysUntilDeadline <= 1 ? 'Due today or tomorrow' : `${daysUntilDeadline}\u00a0days left`,
      isCurrentlyRelevant: true,
      isApplicationWindowOpen,
    };
  }

  return {
    ...base,
    kind: 'open',
    label: 'Accepting applications',
    detail: `Due ${formatShortFellowshipDate(fellowship.deadline)}`,
    isCurrentlyRelevant: true,
    isApplicationWindowOpen,
  };
};

const PROGRAM_AUDIENCE_LEVEL_LABELS: Record<ProgramAudience, string> = {
  UNDERGRADUATE: 'Undergraduates only',
  UNDERGRADUATE_AND_GRADUATE: 'Undergraduate and graduate students',
  GRADUATE: 'Graduate students only',
};

const PROGRAM_AUDIENCE_LABELS: Record<ProgramAudience, string> = {
  UNDERGRADUATE: 'Undergraduate students',
  UNDERGRADUATE_AND_GRADUATE: 'Undergraduate and graduate students',
  GRADUATE: 'Graduate students',
};

export const programAudienceLabel = (audience: ProgramAudience | null): string | null =>
  audience ? PROGRAM_AUDIENCE_LABELS[audience] : null;

export interface EligibilityDetail {
  label: string;
  value: string;
}

export const getStructuredEligibilityDetails = (
  fellowship: Pick<
    Fellowship,
    | 'audience'
    | 'yaleCollegeOnly'
    | 'yearOfStudy'
    | 'termOfAward'
    | 'citizenshipStatus'
    | 'globalRegions'
    | 'purpose'
  >,
): EligibilityDetail[] => {
  const details: EligibilityDetail[] = [];

  const level = fellowship.audience ? PROGRAM_AUDIENCE_LEVEL_LABELS[fellowship.audience] : null;
  if (level) details.push({ label: 'Level', value: level });
  if (fellowship.yaleCollegeOnly === true && fellowship.audience === 'UNDERGRADUATE') {
    details.push({ label: 'School', value: 'Yale College students only' });
  }
  if ((fellowship.yearOfStudy?.length || 0) > 0) {
    details.push({ label: 'Year of study', value: fellowship.yearOfStudy.join(', ') });
  }
  if ((fellowship.termOfAward?.length || 0) > 0) {
    details.push({ label: 'Term', value: fellowship.termOfAward.join(', ') });
  }
  if ((fellowship.citizenshipStatus?.length || 0) > 0) {
    details.push({ label: 'Citizenship', value: fellowship.citizenshipStatus.join(', ') });
  }
  if ((fellowship.globalRegions?.length || 0) > 0) {
    details.push({ label: 'Regions', value: fellowship.globalRegions.join(', ') });
  }
  if ((fellowship.purpose?.length || 0) > 0) {
    details.push({ label: 'Purpose', value: fellowship.purpose.join(', ') });
  }

  return details;
};

export const getEligibilitySummary = (fellowship: Fellowship): string => {
  const pieces = [
    ...(fellowship.yearOfStudy || []),
    ...(fellowship.termOfAward || []),
    ...(fellowship.purpose || []),
    ...(fellowship.globalRegions || []),
    ...(fellowship.citizenshipStatus || []),
  ];

  if (pieces.length > 0) return pieces.slice(0, 3).join(' · ');
  if (fellowship.eligibility?.trim()) return 'Eligibility details listed';
  return 'Eligibility not specified';
};
