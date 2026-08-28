/**
 * Watched-program deadline urgency summary.
 *
 * Turns the watched-program data already loaded on the account page (or fetched
 * once for the /research landing) into a near-term urgency signal: how many
 * watched programs close within a short window, how many of those the student
 * has not started yet, and the approaching deadlines ordered soonest-first.
 *
 * It is a
 * pure surfacing layer over `fellowshipFutureDeadlineDate` (the same future-
 * deadline handling ProgramWatch and the .ics export already use) and the
 * existing ResearchPlan stage, so the dashboard, Program Watch list, and
 * /research indicator all derive urgency the same way and cannot diverge.
 */
import { Fellowship } from '../types/types';
import { fellowshipFutureDeadlineDate } from './calendarExport';
import {
  DEFAULT_RESEARCH_PLAN_STAGE,
  normalizeResearchPlanStage,
} from './researchPlanStages';

export const DEFAULT_DEADLINE_WINDOW_DAYS = 14;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface WatchedProgramWithStage {
  program: Fellowship;
  stage?: string;
}

export interface ApproachingWatchedDeadline {
  programId: string;
  title: string;
  date: Date;
  /** True when the student has not advanced this program past the default saved stage. */
  notStarted: boolean;
}

export interface WatchedDeadlineSummary {
  /** Approaching deadlines within the window, ordered soonest-first. */
  approaching: ApproachingWatchedDeadline[];
  approachingCount: number;
  /** Of the approaching deadlines, how many the student has not started yet. */
  notStartedCount: number;
  hasWatchedPrograms: boolean;
}

export const EMPTY_WATCHED_DEADLINE_SUMMARY: WatchedDeadlineSummary = {
  approaching: [],
  approachingCount: 0,
  notStartedCount: 0,
  hasWatchedPrograms: false,
};

/**
 * Order watched programs soonest-approaching-deadline first. Programs without a
 * known future deadline sort last (and keep their relative order), so they are
 * never presented ahead of a time-critical program.
 */
export const compareByUpcomingDeadline = (
  a: Fellowship,
  b: Fellowship,
  now: Date = new Date(),
): number => {
  const dateA = fellowshipFutureDeadlineDate(a, now);
  const dateB = fellowshipFutureDeadlineDate(b, now);
  if (dateA && dateB) return dateA.getTime() - dateB.getTime();
  if (dateA) return -1;
  if (dateB) return 1;
  return 0;
};

export const sortByUpcomingDeadline = (
  programs: readonly Fellowship[],
  now: Date = new Date(),
): Fellowship[] => [...programs].sort((a, b) => compareByUpcomingDeadline(a, b, now));

export const summarizeWatchedDeadlines = (
  watched: readonly WatchedProgramWithStage[],
  now: Date = new Date(),
  windowDays: number = DEFAULT_DEADLINE_WINDOW_DAYS,
): WatchedDeadlineSummary => {
  const windowEnd = now.getTime() + windowDays * MS_PER_DAY;
  const approaching = watched
    .map(({ program, stage }) => {
      const date = fellowshipFutureDeadlineDate(program, now);
      if (!date || date.getTime() > windowEnd) return null;
      return {
        programId: program.id,
        title: program.title,
        date,
        notStarted: normalizeResearchPlanStage(stage) === DEFAULT_RESEARCH_PLAN_STAGE,
      };
    })
    .filter((item): item is ApproachingWatchedDeadline => Boolean(item))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  return {
    approaching,
    approachingCount: approaching.length,
    notStartedCount: approaching.filter((item) => item.notStarted).length,
    hasWatchedPrograms: watched.length > 0,
  };
};

const windowPhrase = (windowDays: number): string => {
  if (windowDays > 0 && windowDays % 7 === 0) {
    const weeks = windowDays / 7;
    return `${weeks} ${weeks === 1 ? 'week' : 'weeks'}`;
  }
  return `${windowDays} ${windowDays === 1 ? 'day' : 'days'}`;
};

/** e.g. "2 watched programs close within 2 weeks". */
export const approachingDeadlineLabel = (
  count: number,
  windowDays: number = DEFAULT_DEADLINE_WINDOW_DAYS,
): string =>
  `${count} watched ${count === 1 ? 'program closes' : 'programs close'} within ${windowPhrase(
    windowDays,
  )}`;

/** Emphasis appended when some approaching programs have not been started yet. */
export const notStartedEmphasis = (notStartedCount: number): string | null =>
  notStartedCount > 0 ? `${notStartedCount} not started` : null;

/**
 * Accessible label conveying both the count/window and, when relevant, the
 * not-started emphasis that marks the true failure mode.
 */
export const approachingDeadlineAriaLabel = (
  count: number,
  notStartedCount: number,
  windowDays: number = DEFAULT_DEADLINE_WINDOW_DAYS,
): string => {
  const emphasis = notStartedEmphasis(notStartedCount);
  return emphasis
    ? `${approachingDeadlineLabel(count, windowDays)}, ${emphasis}`
    : approachingDeadlineLabel(count, windowDays);
};
