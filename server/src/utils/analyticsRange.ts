import { NEW_YORK_TIME_ZONE, newYorkCalendarDate, startOfNewYorkDay } from './newYorkTime';

export const ANALYTICS_TIME_ZONE = NEW_YORK_TIME_ZONE;

export interface AnalyticsDateRange {
  start?: Date;
  end?: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export const startOfAnalyticsDay = (now: Date = new Date()): Date =>
  startOfNewYorkDay(newYorkCalendarDate(now));

export const startOfAnalyticsSemester = (now: Date = new Date()): Date => {
  const { year, monthIndex } = newYorkCalendarDate(now);
  return startOfNewYorkDay({ year, monthIndex: monthIndex >= 6 ? 6 : 0, day: 1 });
};

export const parseAnalyticsRange = (range: unknown, now: Date = new Date()): AnalyticsDateRange => {
  if (range === 'all') return {};
  if (range === 'today') return { start: startOfAnalyticsDay(now), end: now };
  if (range === '7d') return { start: new Date(now.getTime() - 7 * DAY_MS), end: now };
  if (range === 'semester') return { start: startOfAnalyticsSemester(now), end: now };
  return { start: new Date(now.getTime() - 30 * DAY_MS), end: now };
};
