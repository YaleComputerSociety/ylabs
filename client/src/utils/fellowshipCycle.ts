import { Fellowship } from '../types/types';
import {
  STALE_DEADLINE_SHORT_LABEL,
  STALE_DEADLINE_STATUS_LABEL,
  getFellowshipApplicationStatus,
} from './fellowshipStatus';
import { formatShortProgramDate, programDeadlineClosingInstant } from './programDates';

export const CLOSING_SOON_DAYS = 30;

const NEUTRAL_CYCLE_BADGE_CLASS = 'bg-gray-100 text-gray-600 border border-gray-200';

export type FellowshipCycleCategory =
  | 'closingSoon'
  | 'open'
  | 'openingSoon'
  | 'projectedNextCycle'
  | 'nextCycle'
  | 'staleDeadline'
  | 'closed';

export interface FellowshipCycleStatus {
  category: FellowshipCycleCategory;
  label: string;
  className: string;
  deadlinePassed: boolean;
  sourceBacked: boolean;
  likelyRecurring: boolean;
}

function hasHttpUrl(value: unknown): boolean {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function hasSourceUrl(fellowship: Fellowship): boolean {
  if (hasHttpUrl(fellowship.applicationLink)) return true;
  return (fellowship.links || []).some((link) => hasHttpUrl(link.url));
}

function textForFellowship(fellowship: Fellowship): string {
  return [
    fellowship.title,
    fellowship.competitionType,
    fellowship.summary,
    fellowship.description,
    fellowship.applicationInformation,
    fellowship.eligibility,
    fellowship.additionalInformation,
    ...(fellowship.purpose || []),
    ...(fellowship.termOfAward || []),
  ]
    .filter(Boolean)
    .join(' ');
}

export function isLikelyRecurringFellowship(fellowship: Fellowship): boolean {
  if (fellowship.archived || !hasSourceUrl(fellowship)) return false;
  return /\b(fellowship|grant|award|funding|stipend|summer|annual|year|cycle|term|spring|fall|deadline|application)\b/i.test(
    textForFellowship(fellowship),
  );
}

export function getFellowshipCycleStatus(
  fellowship: Fellowship,
  now: Date = new Date(),
): FellowshipCycleStatus {
  const applicationStatus = getFellowshipApplicationStatus(fellowship, now);
  const deadline = programDeadlineClosingInstant(fellowship.deadline);
  const deadlinePassed = deadline ? deadline.getTime() < now.getTime() : false;
  const isOpen = applicationStatus.isApplicationWindowOpen;
  const sourceBacked = hasSourceUrl(fellowship);
  const likelyRecurring = !isOpen && deadlinePassed && isLikelyRecurringFellowship(fellowship);

  if (applicationStatus.kind === 'staleDeadline') {
    return {
      category: 'staleDeadline',
      label: STALE_DEADLINE_STATUS_LABEL,
      className: NEUTRAL_CYCLE_BADGE_CLASS,
      deadlinePassed: false,
      sourceBacked,
      likelyRecurring: false,
    };
  }

  if (applicationStatus.kind === 'notOpenYet') {
    return {
      category: 'openingSoon',
      label: 'Opens soon',
      className: 'bg-blue-50 text-blue-700 border border-blue-100',
      deadlinePassed,
      sourceBacked,
      likelyRecurring: false,
    };
  }

  if (applicationStatus.kind === 'projectedNextCycle') {
    return {
      category: 'projectedNextCycle',
      label: 'Next cycle (est.)',
      className: 'bg-sky-50 text-sky-700 border border-sky-100',
      deadlinePassed: false,
      sourceBacked,
      likelyRecurring: true,
    };
  }

  if (isOpen && deadline) {
    const daysUntil = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (daysUntil <= CLOSING_SOON_DAYS && daysUntil > 0) {
      return {
        category: 'closingSoon',
        label: 'Closing soon',
        className: 'bg-amber-50 text-amber-700 border border-amber-100',
        deadlinePassed,
        sourceBacked,
        likelyRecurring: false,
      };
    }
  }

  if (isOpen) {
    return {
      category: 'open',
      label: 'Open',
      className: 'bg-green-50 text-green-700 border border-green-100',
      deadlinePassed,
      sourceBacked,
      likelyRecurring: false,
    };
  }

  if (likelyRecurring) {
    return {
      category: 'nextCycle',
      label: 'Deadline passed',
      className: 'bg-sky-50 text-sky-700 border border-sky-100',
      deadlinePassed,
      sourceBacked,
      likelyRecurring: true,
    };
  }

  return {
    category: 'closed',
    label: deadline ? 'Closed' : 'No dates posted',
    className: NEUTRAL_CYCLE_BADGE_CLASS,
    deadlinePassed,
    sourceBacked,
    likelyRecurring: false,
  };
}

export function getFellowshipDeadlineSubtitle(
  fellowship: Fellowship,
  now: Date = new Date(),
): string {
  const status = getFellowshipCycleStatus(fellowship, now);
  if (status.category === 'staleDeadline') return STALE_DEADLINE_SHORT_LABEL;
  if (status.category === 'openingSoon') {
    return `Opens ${formatShortProgramDate(fellowship.applicationOpenDate)}`;
  }
  if (status.category === 'projectedNextCycle' && fellowship.deadline) {
    return `Est. next cycle ~${formatShortProgramDate(fellowship.deadline)} (unconfirmed)`;
  }
  const deadline = programDeadlineClosingInstant(fellowship.deadline);
  if (!deadline) return 'No deadline';
  if (status.category === 'nextCycle') return 'Past cycle; track for reopening';
  if (deadline.getTime() < now.getTime()) return 'Deadline passed';
  return `Due ${formatShortProgramDate(fellowship.deadline)}`;
}
