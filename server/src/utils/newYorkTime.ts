export const NEW_YORK_TIME_ZONE = 'America/New_York';

export interface NewYorkCalendarDate {
  year: number;
  monthIndex: number;
  day: number;
}

export interface NewYorkWallClock extends NewYorkCalendarDate {
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

const wallClockFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: NEW_YORK_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
});

export const newYorkWallClock = (instant: Date): NewYorkWallClock => {
  const fields = Object.fromEntries(
    wallClockFormatter
      .formatToParts(instant)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: fields.year,
    monthIndex: fields.month - 1,
    day: fields.day,
    hour: fields.hour,
    minute: fields.minute,
    second: fields.second,
    millisecond: ((instant.getTime() % 1000) + 1000) % 1000,
  };
};

export const newYorkCalendarDate = (instant: Date): NewYorkCalendarDate => {
  const { year, monthIndex, day } = newYorkWallClock(instant);
  return { year, monthIndex, day };
};

const wallClockAsUtcMs = (clock: NewYorkWallClock): number =>
  Date.UTC(
    clock.year,
    clock.monthIndex,
    clock.day,
    clock.hour,
    clock.minute,
    clock.second,
    clock.millisecond,
  );

const offsetMsAt = (instantMs: number): number =>
  wallClockAsUtcMs(newYorkWallClock(new Date(instantMs))) - instantMs;

export const isRealCalendarDate = ({ year, monthIndex, day }: NewYorkCalendarDate): boolean => {
  const probe = new Date(Date.UTC(year, monthIndex, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === monthIndex &&
    probe.getUTCDate() === day
  );
};

/**
 * The instant a New York wall-clock reading names. The offset is read twice because the
 * first guess can sit on the other side of a daylight-saving change from the answer.
 */
export const newYorkInstant = (clock: Partial<NewYorkWallClock> & NewYorkCalendarDate): Date => {
  const wallClockMs = wallClockAsUtcMs({
    hour: 0,
    minute: 0,
    second: 0,
    millisecond: 0,
    ...clock,
  });
  const firstGuess = wallClockMs - offsetMsAt(wallClockMs);
  return new Date(wallClockMs - offsetMsAt(firstGuess));
};

export const startOfNewYorkDay = (date: NewYorkCalendarDate): Date => newYorkInstant(date);

export const endOfNewYorkDay = (date: NewYorkCalendarDate): Date =>
  newYorkInstant({ ...date, hour: 23, minute: 59, second: 59, millisecond: 999 });
