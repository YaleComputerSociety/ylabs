/**
 * Program dates are stated in New Haven time, so they render in America/New_York for
 * every reader. Mirrors `server/src/utils/programDeadlineInstant.ts`: a stated time has
 * minute precision, so a deadline ending in `:59.999` stated no time, and an opening at
 * New York midnight reads the same as its date alone.
 */
export const PROGRAM_TIME_ZONE = 'America/New_York';
const PROGRAM_TIME_ZONE_LABEL = 'ET';

export type ProgramDateBoundary = 'deadline' | 'opens';

const calendarDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: PROGRAM_TIME_ZONE,
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

const shortDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: PROGRAM_TIME_ZONE,
  month: 'short',
  day: 'numeric',
});

const clockFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: PROGRAM_TIME_ZONE,
  hour: 'numeric',
  minute: '2-digit',
});

const wallClockFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: PROGRAM_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
});

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const newYorkWallClock = (instant: Date): WallClock => {
  const fields = Object.fromEntries(
    wallClockFormatter
      .formatToParts(instant)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
  return fields as unknown as WallClock;
};

const wallClockAsUtcMs = (clock: WallClock, millisecond: number): number =>
  Date.UTC(
    clock.year,
    clock.month - 1,
    clock.day,
    clock.hour,
    clock.minute,
    clock.second,
    millisecond,
  );

const offsetMsAt = (instantMs: number): number =>
  wallClockAsUtcMs(newYorkWallClock(new Date(instantMs)), ((instantMs % 1000) + 1000) % 1000) -
  instantMs;

export interface NewYorkWallClockReading {
  year: number;
  month: number;
  day: number;
  hour?: number;
  minute?: number;
  second?: number;
  millisecond?: number;
}

/**
 * Mirrors `newYorkInstant` in `server/src/utils/newYorkTime.ts`. The offset is read twice
 * because the first guess can sit on the other side of a daylight-saving change.
 */
export const newYorkInstant = ({
  year,
  month,
  day,
  hour = 0,
  minute = 0,
  second = 0,
  millisecond = 0,
}: NewYorkWallClockReading): Date => {
  const wallClockMs = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  const firstGuess = wallClockMs - offsetMsAt(wallClockMs);
  return new Date(wallClockMs - offsetMsAt(firstGuess));
};

const endOfNewYorkDay = (instant: Date): Date => {
  const { year, month, day } = newYorkWallClock(instant);
  return newYorkInstant({ year, month, day, hour: 23, minute: 59, second: 59, millisecond: 999 });
};

export const parseProgramDate = (value: string | null | undefined): Date | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const isDateOnlyProgramDeadline = (deadline: Date): boolean =>
  deadline.getUTCSeconds() === 59 && deadline.getUTCMilliseconds() === 999;

export const programDeadlineClosesAt = (deadline: Date): Date =>
  isDateOnlyProgramDeadline(deadline) ? endOfNewYorkDay(deadline) : deadline;

export const programDeadlineClosingInstant = (value: string | null | undefined): Date | null => {
  const deadline = parseProgramDate(value);
  return deadline ? programDeadlineClosesAt(deadline) : null;
};

export const programDateStatesTime = (date: Date, boundary: ProgramDateBoundary): boolean => {
  if (boundary === 'deadline') return !isDateOnlyProgramDeadline(date);
  const { hour, minute, second } = newYorkWallClock(date);
  return hour !== 0 || minute !== 0 || second !== 0;
};

export const formatProgramDate = (
  value: string | null | undefined,
  boundary: ProgramDateBoundary,
  fallback = 'Not specified',
): string => {
  const date = parseProgramDate(value);
  if (!date) return fallback;
  const calendarDate = calendarDateFormatter.format(date);
  if (!programDateStatesTime(date, boundary)) return calendarDate;
  return `${calendarDate}, ${clockFormatter.format(date)} ${PROGRAM_TIME_ZONE_LABEL}`;
};

export const formatShortProgramDate = (
  value: string | null | undefined,
  fallback = 'Date not specified',
): string => {
  const date = parseProgramDate(value);
  return date ? shortDateFormatter.format(date) : fallback;
};

export const formatProgramCalendarDate = (date: Date): string => calendarDateFormatter.format(date);

export const programStatedClockLabel = (deadline: Date): string | null =>
  isDateOnlyProgramDeadline(deadline)
    ? null
    : `${clockFormatter.format(deadline)} ${PROGRAM_TIME_ZONE_LABEL}`;

export const newYorkCalendarDateParts = (
  date: Date,
): { year: number; month: number; day: number } => {
  const { year, month, day } = newYorkWallClock(date);
  return { year, month, day };
};

export const newYorkClockParts = (date: Date): { hour: number; minute: number } => {
  const { hour, minute } = newYorkWallClock(date);
  return { hour, minute };
};
