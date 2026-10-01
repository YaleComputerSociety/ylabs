import {
  type NewYorkCalendarDate,
  endOfNewYorkDay,
  isRealCalendarDate,
  newYorkCalendarDate,
  newYorkInstant,
  startOfNewYorkDay,
} from '../../utils/newYorkTime';

/**
 * Program pages state dates in New Haven time. A stated time is stored as that New York
 * minute, and a date with no time as its whole New York day: a deadline at the day's last
 * millisecond and an opening at its first. A page never states seconds, so the `:59.999`
 * ending is what tells a reader a deadline stated no time (`utils/programDeadlineInstant`).
 */

export type ProgramDateBoundary = 'deadline' | 'opens';

const MONTH_INDEX: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

const MONTH_NAMES = Object.keys(MONTH_INDEX).join('|');
const WEEKDAY_NAMES = 'Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday';
const EASTERN_ZONE_NAMES = String.raw`ET|EST|EDT|E\.T\.|Eastern(?:\s+(?:Standard|Daylight))?(?:\s+Time)?`;
const OTHER_ZONE_NAMES = 'PT|PST|PDT|CT|CST|CDT|MT|MST|MDT|GMT|UTC';
const CLOCK_LEAD = String.raw`\s*(?:,|at|by|@|-|–)?\s*(?:at|by)?\s*`;
const MERIDIEM_CLOCK = String.raw`(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s?m\.?(?![a-z])`;
const NOON_CLOCK = String.raw`(?:12(?::00)?\s*)?(noon)\b`;
const ZONE_SUFFIX = String.raw`(?:\s*\(?\s*(${EASTERN_ZONE_NAMES}|${OTHER_ZONE_NAMES})(?![a-z])\)?)?`;

const STATED_CLOCK_TIME_BODY = `${CLOCK_LEAD}(?:${MERIDIEM_CLOCK}|${NOON_CLOCK})${ZONE_SUFFIX}`;
const STATED_CLOCK_TIME = new RegExp(`^${STATED_CLOCK_TIME_BODY}`, 'i');
const OTHER_ZONE = new RegExp(`^(?:${OTHER_ZONE_NAMES})$`, 'i');

/**
 * An optional clock time after a date, for a lane that extracts a date's text before
 * parsing it, so the time survives the extraction. It carries capture groups, so read
 * only the whole match of a pattern built from it.
 */
export const OPTIONAL_STATED_CLOCK_TIME = `(?:${STATED_CLOCK_TIME_BODY})?`;

export const NAMED_PROGRAM_DATE_SOURCE = `(?:(?:${WEEKDAY_NAMES})?[,]?\\s*(?:${MONTH_NAMES})\\s+\\d{1,2}(?!\\d)(?:,\\s*\\d{4})?)`;
export const NUMERIC_PROGRAM_DATE_SOURCE = String.raw`(?:\d{1,2}\/\d{1,2}\/\d{2,4})`;

const NUMERIC_DATE = /\b(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})\b/;
const NAMED_DATE = new RegExp(`(${MONTH_NAMES})\\s+(\\d{1,2})(?!\\d)(?:,\\s*(\\d{4}))?`, 'i');

const INFERRED_YEAR_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

export interface StatedClockTime {
  hour: number;
  minute: number;
}

/**
 * The New York clock time stated at the start of `text`, if any. A time stated in another
 * zone is not read, so the date falls back to its whole-day boundary rather than to a
 * wrong minute.
 */
export function statedClockTime(text: string): StatedClockTime | undefined {
  const match = STATED_CLOCK_TIME.exec(text);
  if (!match) return undefined;
  const [, hourText, minuteText, meridiem, noon, zone] = match;
  if (zone && OTHER_ZONE.test(zone)) return undefined;
  if (noon) return { hour: 12, minute: 0 };
  const hour12 = Number(hourText);
  const minute = minuteText ? Number(minuteText) : 0;
  if (hour12 < 1 || hour12 > 12 || minute > 59) return undefined;
  const isPm = meridiem.toLowerCase() === 'p';
  return { hour: (hour12 % 12) + (isPm ? 12 : 0), minute };
}

export function programDateInstant(
  date: NewYorkCalendarDate,
  boundary: ProgramDateBoundary,
  clock?: StatedClockTime,
): Date {
  if (clock) return newYorkInstant({ ...date, hour: clock.hour, minute: clock.minute });
  return boundary === 'deadline' ? endOfNewYorkDay(date) : startOfNewYorkDay(date);
}

interface DateMatch {
  date: NewYorkCalendarDate;
  yearStated: boolean;
  rest: string;
}

function numericDateMatch(text: string): DateMatch | undefined {
  const match = NUMERIC_DATE.exec(text);
  if (!match) return undefined;
  const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  const date = { year, monthIndex: Number(match[1]) - 1, day: Number(match[2]) };
  if (!isRealCalendarDate(date)) return undefined;
  return { date, yearStated: true, rest: text.slice((match.index ?? 0) + match[0].length) };
}

function namedDateMatch(text: string, referenceDate: Date): DateMatch | undefined {
  const match = NAMED_DATE.exec(text);
  if (!match) return undefined;
  const monthIndex = MONTH_INDEX[match[1].toLowerCase()];
  const day = Number(match[2]);
  const year = match[3] ? Number(match[3]) : newYorkCalendarDate(referenceDate).year;
  return {
    date: { year, monthIndex, day },
    yearStated: Boolean(match[3]),
    rest: text.slice((match.index ?? 0) + match[0].length),
  };
}

function withInferredYear(match: DateMatch, referenceDate: Date): NewYorkCalendarDate {
  if (match.yearStated || !isRealCalendarDate(match.date)) return match.date;
  const lapsed =
    endOfNewYorkDay(match.date).getTime() < referenceDate.getTime() - INFERRED_YEAR_GRACE_MS;
  return lapsed ? { ...match.date, year: match.date.year + 1 } : match.date;
}

/**
 * The first date in `text`, as `M/D/YY(YY)` or a month name, read with any clock time that
 * directly follows it. A month-name date without a year takes the reference year, or the
 * next one once the date is more than 30 days past.
 */
export function parseProgramDate(
  text: string,
  boundary: ProgramDateBoundary,
  referenceDate: Date = new Date(),
): Date | undefined {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const match = numericDateMatch(normalized) ?? namedDateMatch(normalized, referenceDate);
  if (!match) return undefined;
  const date = withInferredYear(match, referenceDate);
  if (!isRealCalendarDate(date)) return undefined;
  return programDateInstant(date, boundary, statedClockTime(match.rest));
}
