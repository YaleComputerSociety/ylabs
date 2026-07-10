import { Fellowship } from '../types/types';
import { getFellowshipApplicationStatus } from './fellowshipStatus';

export const CLOSING_SOON_DAYS = 30;

export type FellowshipCycleCategory = 'closingSoon' | 'open' | 'openingSoon' | 'nextCycle' | 'closed';

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
  const deadline = fellowship.deadline ? new Date(fellowship.deadline) : null;
  const deadlinePassed = deadline ? deadline.getTime() < now.getTime() : false;
  const isOpen = applicationStatus.isApplicationWindowOpen;
  const sourceBacked = hasSourceUrl(fellowship);
  const likelyRecurring = !isOpen && isLikelyRecurringFellowship(fellowship);

  if (applicationStatus.kind === 'notOpenYet') {
    return {
      category: 'openingSoon',
      label: 'Opens Soon',
      className: 'bg-blue-50 text-blue-700 border border-blue-100',
      deadlinePassed,
      sourceBacked,
      likelyRecurring: false,
    };
  }

  if (isOpen && deadline) {
    const daysUntil = Math.ceil(
      (deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );
    if (daysUntil <= CLOSING_SOON_DAYS && daysUntil > 0) {
      return {
        category: 'closingSoon',
        label: 'Closing Soon',
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
      label: 'Next Cycle Signal',
      className: 'bg-sky-50 text-sky-700 border border-sky-100',
      deadlinePassed,
      sourceBacked,
      likelyRecurring: true,
    };
  }

  return {
    category: 'closed',
    label: 'Closed',
    className: 'bg-gray-100 text-gray-600 border border-gray-200',
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
  if (status.category === 'openingSoon') {
    const openDate = new Date(String(fellowship.applicationOpenDate));
    return `Opens ${openDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  }
  if (!fellowship.deadline) {
    return status.category === 'nextCycle' ? 'Track for next cycle' : 'No deadline';
  }
  const deadline = new Date(fellowship.deadline);
  if (status.category === 'nextCycle') return 'Past cycle; track for reopening';
  if (deadline.getTime() < now.getTime()) return 'Deadline passed';
  return `Due ${deadline.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}
