import {
  endOfNewYorkDay,
  newYorkCalendarDate,
  newYorkInstant,
  newYorkWallClock,
} from './newYorkTime';

/**
 * A stated deadline time has minute precision, so a deadline ending in `:59.999` was
 * stored as the end of a day with no time stated. That holds for the end of a UTC day,
 * which every program lane stored before #4215, as well as for the end of a New York day.
 */
export const isDateOnlyProgramDeadline = (deadline: Date): boolean =>
  deadline.getUTCSeconds() === 59 && deadline.getUTCMilliseconds() === 999;

/**
 * The instant a deadline closes. A date-only deadline closes at the end of its New York
 * day, so one stored at the end of the UTC day does not close five hours early.
 */
export const programDeadlineClosesAt = (deadline: Date): Date =>
  isDateOnlyProgramDeadline(deadline) ? endOfNewYorkDay(newYorkCalendarDate(deadline)) : deadline;

export const sameProgramDeadlineNextCycle = (deadline: Date): Date => {
  const stated = newYorkWallClock(deadline);
  const sameDayNextCycle = new Date(Date.UTC(stated.year + 1, stated.monthIndex, stated.day));
  return newYorkInstant({
    ...stated,
    year: sameDayNextCycle.getUTCFullYear(),
    monthIndex: sameDayNextCycle.getUTCMonth(),
    day: sameDayNextCycle.getUTCDate(),
  });
};

// A deadline that closed more than one cycle ago means the source page skipped at least a
// whole cycle, so neither the stated date nor an estimate from it is served (#4363).
export const deadlineIsStale = (closesAt: Date, now: Date): boolean =>
  sameProgramDeadlineNextCycle(closesAt).getTime() < now.getTime();
