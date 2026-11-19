import { endOfNewYorkDay, isRealCalendarDate, type NewYorkCalendarDate } from './newYorkTime';

export function awardDateOfCalendarDay(year: number, month: number, day: number): Date | undefined {
  const calendarDay = { year, monthIndex: month - 1, day };
  if (!isRealCalendarDate(calendarDay)) return undefined;
  return new Date(Date.UTC(year, calendarDay.monthIndex, day));
}

// Read in UTC on purpose: a date stored before #6041 is New York local midnight (04:00Z or
// 05:00Z), which still falls on the same UTC calendar day as the UTC-midnight form.
export function storedAwardCalendarDay(value: unknown): NewYorkCalendarDate | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const instant = new Date(value as string | number | Date);
  if (!Number.isFinite(instant.getTime())) return undefined;
  return {
    year: instant.getUTCFullYear(),
    monthIndex: instant.getUTCMonth(),
    day: instant.getUTCDate(),
  };
}

export function awardEndDayHasPassed(endDate: unknown, now: number): boolean {
  const lastDay = storedAwardCalendarDay(endDate);
  return lastDay !== undefined && now > endOfNewYorkDay(lastDay).getTime();
}
