import { Fellowship } from '../types/types';
import { fellowshipFutureDeadlineDate } from './calendarExport';
import {
  DEFAULT_RESEARCH_PLAN_STAGE,
  isActiveResearchPlanStage,
  type ResearchPlanStage,
} from './researchPlanStages';

export const WATCHED_PROGRAM_URGENCY_WINDOW_DAYS = 14;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

interface FellowshipWithDeadline {
  fellowship: Fellowship;
  date: Date;
}

const upcomingFellowshipsByDeadline = (
  fellowships: readonly Fellowship[],
  now: Date,
): FellowshipWithDeadline[] =>
  fellowships
    .map((fellowship) => {
      const date = fellowshipFutureDeadlineDate(fellowship, now);
      if (!date) return null;
      return { fellowship, date };
    })
    .filter((item): item is FellowshipWithDeadline => Boolean(item))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

export const sortWatchedProgramsByDeadline = (
  fellowships: readonly Fellowship[],
  now: Date = new Date(),
): Fellowship[] => {
  const withDeadline = upcomingFellowshipsByDeadline(fellowships, now);
  const withDeadlineIds = new Set(withDeadline.map((item) => item.fellowship.id));
  const withoutDeadline = fellowships.filter((fellowship) => !withDeadlineIds.has(fellowship.id));
  return [...withDeadline.map((item) => item.fellowship), ...withoutDeadline];
};

export interface WatchedProgramUrgencySummary {
  closingWithin14DaysCount: number;
  hasNotStartedClosingSoon: boolean;
  nextDeadlineDate?: string;
  nextDeadlineLabel?: string;
}

const stageFor = (
  stagesByProgramId: Readonly<Record<string, ResearchPlanStage>>,
  programId: string,
): ResearchPlanStage => stagesByProgramId[programId] ?? DEFAULT_RESEARCH_PLAN_STAGE;

export const computeWatchedProgramUrgencySummary = (
  fellowships: readonly Fellowship[],
  stagesByProgramId: Readonly<Record<string, ResearchPlanStage>>,
  now: Date = new Date(),
  windowDays: number = WATCHED_PROGRAM_URGENCY_WINDOW_DAYS,
): WatchedProgramUrgencySummary => {
  const upcoming = upcomingFellowshipsByDeadline(fellowships, now);
  const next = upcoming[0];
  const nextDeadlineLabel = next
    ? `${
        next.fellowship.isAcceptingApplications
          ? `${next.fellowship.title}: Now open; due `
          : `${next.fellowship.title}: Due `
      }${dateFormatter.format(next.date)}`
    : undefined;

  const windowEnd = now.getTime() + windowDays * MS_PER_DAY;
  const closingSoon = upcoming.filter(
    ({ fellowship, date }) =>
      date.getTime() <= windowEnd && isActiveResearchPlanStage(stageFor(stagesByProgramId, fellowship.id)),
  );

  return {
    closingWithin14DaysCount: closingSoon.length,
    hasNotStartedClosingSoon: closingSoon.some(
      ({ fellowship }) => stageFor(stagesByProgramId, fellowship.id) === DEFAULT_RESEARCH_PLAN_STAGE,
    ),
    nextDeadlineDate: next?.fellowship.deadline || undefined,
    nextDeadlineLabel,
  };
};
