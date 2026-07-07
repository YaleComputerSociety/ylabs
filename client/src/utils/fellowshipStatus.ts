import type { Fellowship } from '../types/types';

export const CLOSING_SOON_DAYS = 30;
export const URGENT_DEADLINE_DAYS = 14;

export type FellowshipApplicationStatusKind =
  | 'open'
  | 'closingSoon'
  | 'notOpenYet'
  | 'closed'
  | 'deadlinePassed'
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

const DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
};

const SHORT_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
};

const parseDate = (value: string | null | undefined): Date | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const formatFellowshipDate = (
  value: string | null | undefined,
  fallback = 'Not specified',
): string => {
  const date = parseDate(value);
  if (!date) return fallback;
  return date.toLocaleString('en-US', DATE_OPTIONS);
};

export const formatShortFellowshipDate = (
  value: string | null | undefined,
  fallback = 'Date not specified',
): string => {
  const date = parseDate(value);
  if (!date) return fallback;
  return date.toLocaleDateString('en-US', SHORT_DATE_OPTIONS);
};

export const getFellowshipApplicationStatus = (
  fellowship: Pick<
    Fellowship,
    | 'isAcceptingApplications'
    | 'applicationOpenDate'
    | 'deadline'
    | 'eligibility'
    | 'yearOfStudy'
    | 'termOfAward'
    | 'citizenshipStatus'
  >,
  now = new Date(),
): FellowshipApplicationStatus => {
  const openDate = parseDate(fellowship.applicationOpenDate);
  const deadline = parseDate(fellowship.deadline);
  const deadlinePassed = deadline ? deadline.getTime() < now.getTime() : false;
  const notOpenYet =
    fellowship.isAcceptingApplications && openDate ? openDate.getTime() > now.getTime() : false;
  const isApplicationWindowOpen =
    fellowship.isAcceptingApplications && !deadlinePassed && !notOpenYet;
  const daysUntilDeadline = deadline
    ? Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    : null;
  const hasStructuredEligibility =
    (fellowship.yearOfStudy?.length || 0) > 0 ||
    (fellowship.termOfAward?.length || 0) > 0 ||
    (fellowship.citizenshipStatus?.length || 0) > 0;
  const needsEligibilityReview =
    !fellowship.eligibility?.trim() && !hasStructuredEligibility;
  const needsDateReview = fellowship.isAcceptingApplications && !deadline;

  const base = {
    deadlineLabel: formatFellowshipDate(fellowship.deadline),
    openDateLabel: formatFellowshipDate(fellowship.applicationOpenDate),
    daysUntilDeadline,
    needsDateReview,
    needsEligibilityReview,
  };

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

  if (!fellowship.isAcceptingApplications) {
    return {
      ...base,
      kind: 'closed',
      label: 'Not accepting applications',
      detail: deadline
        ? `Next deadline listed as ${formatShortFellowshipDate(fellowship.deadline)}`
        : 'Application timing has not been announced',
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
    return {
      ...base,
      kind: 'unknown',
      label: 'Timing not confirmed',
      detail: 'Applications may be open, but no deadline is listed',
      isCurrentlyRelevant: true,
      isApplicationWindowOpen,
    };
  }

  if (daysUntilDeadline !== null && daysUntilDeadline <= CLOSING_SOON_DAYS) {
    return {
      ...base,
      kind: 'closingSoon',
      label: daysUntilDeadline <= 1 ? 'Due soon' : 'Closing soon',
      detail:
        daysUntilDeadline <= 1
          ? 'Due today or tomorrow'
          : `${daysUntilDeadline} days left`,
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

export const getEligibilitySummary = (fellowship: Fellowship): string => {
  const pieces = [
    ...(fellowship.yearOfStudy || []),
    ...(fellowship.termOfAward || []),
    ...(fellowship.citizenshipStatus || []),
  ];

  if (pieces.length > 0) return pieces.slice(0, 3).join(' · ');
  if (fellowship.eligibility?.trim()) return 'Eligibility details listed';
  return 'Eligibility not specified';
};
