import type { Fellowship } from '../types/types';
import { isBareHostRoot, safeHttpUrl } from './url';

export const CLOSING_SOON_DAYS = 30;

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
  const openDate = parseDate(fellowship.applicationOpenDate);
  const deadline = parseDate(fellowship.deadline);
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
      detail: daysUntilDeadline <= 1 ? 'Due today or tomorrow' : `${daysUntilDeadline} days left`,
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

export interface FellowshipApplyCta {
  href: string;
  isBareHostFallback: boolean;
  primaryLabel: string;
  shortLabel: string;
  sectionLabel: string;
}

export const getFellowshipApplyCta = (
  fellowship: Pick<Fellowship, 'applicationLink' | 'sourceUrl'>,
  status: Pick<FellowshipApplicationStatus, 'isApplicationWindowOpen' | 'kind'>,
): FellowshipApplyCta => {
  const applicationHref = safeHttpUrl(fellowship.applicationLink);
  const sourceHref = safeHttpUrl(fellowship.sourceUrl);

  let href = '';
  let isBareHostFallback = false;
  if (applicationHref && !isBareHostRoot(applicationHref)) {
    href = applicationHref;
  } else if (sourceHref && !isBareHostRoot(sourceHref)) {
    href = sourceHref;
  } else if (applicationHref) {
    href = applicationHref;
    isBareHostFallback = true;
  } else if (sourceHref) {
    href = sourceHref;
    isBareHostFallback = true;
  }

  if (!href) {
    return {
      href: '',
      isBareHostFallback: false,
      primaryLabel: '',
      shortLabel: '',
      sectionLabel: '',
    };
  }

  if (isBareHostFallback) {
    return {
      href,
      isBareHostFallback: true,
      primaryLabel: 'Visit site',
      shortLabel: 'Visit site',
      sectionLabel: 'Visit site',
    };
  }

  if (status.isApplicationWindowOpen) {
    return {
      href,
      isBareHostFallback: false,
      primaryLabel: 'Apply Now',
      shortLabel: 'Apply',
      sectionLabel: 'Open official application',
    };
  }

  if (status.kind === 'notOpenYet') {
    return {
      href,
      isBareHostFallback: false,
      primaryLabel: 'Track Opening Date',
      shortLabel: 'Open source',
      sectionLabel: 'Open official application',
    };
  }

  return {
    href,
    isBareHostFallback: false,
    primaryLabel: 'Open Fellowship Source',
    shortLabel: 'Open source',
    sectionLabel: 'Open official application',
  };
};

export interface EligibilityDetail {
  label: string;
  value: string;
}

export const getStructuredEligibilityDetails = (
  fellowship: Pick<
    Fellowship,
    | 'undergraduateOnly'
    | 'yaleCollegeOnly'
    | 'yearOfStudy'
    | 'termOfAward'
    | 'citizenshipStatus'
    | 'globalRegions'
    | 'purpose'
  >,
): EligibilityDetail[] => {
  const details: EligibilityDetail[] = [];

  if (fellowship.undergraduateOnly === true) {
    details.push({ label: 'Level', value: 'Undergraduates only' });
  } else if (fellowship.undergraduateOnly === false) {
    details.push({ label: 'Level', value: 'Open beyond undergraduates' });
  }
  if (fellowship.yaleCollegeOnly === true) {
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
