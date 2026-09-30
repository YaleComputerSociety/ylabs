export const ANALYTICS_TIME_ZONE = 'America/New_York';

export interface AnalyticsDateRange {
  start?: Date;
  end?: Date;
}

interface ZonedDate {
  year: number;
  monthIndex: number;
  day: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const zonedFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: ANALYTICS_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
});

const zonedFields = (instant: Date): Record<string, number> =>
  Object.fromEntries(
    zonedFormatter
      .formatToParts(instant)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );

const zoneOffsetMs = (instant: Date): number => {
  const fields = zonedFields(instant);
  const wallClockAsUtc = Date.UTC(
    fields.year,
    fields.month - 1,
    fields.day,
    fields.hour,
    fields.minute,
    fields.second,
  );
  return wallClockAsUtc - Math.floor(instant.getTime() / 1000) * 1000;
};

const zonedDate = (instant: Date): ZonedDate => {
  const fields = zonedFields(instant);
  return { year: fields.year, monthIndex: fields.month - 1, day: fields.day };
};

const zonedMidnight = ({ year, monthIndex, day }: ZonedDate): Date => {
  const midnightAsUtc = Date.UTC(year, monthIndex, day);
  const firstGuess = midnightAsUtc - zoneOffsetMs(new Date(midnightAsUtc));
  return new Date(midnightAsUtc - zoneOffsetMs(new Date(firstGuess)));
};

export const startOfAnalyticsDay = (now: Date = new Date()): Date => zonedMidnight(zonedDate(now));

export const startOfAnalyticsSemester = (now: Date = new Date()): Date => {
  const { year, monthIndex } = zonedDate(now);
  return zonedMidnight({ year, monthIndex: monthIndex >= 6 ? 6 : 0, day: 1 });
};

export const parseAnalyticsRange = (range: unknown, now: Date = new Date()): AnalyticsDateRange => {
  if (range === 'all') return {};
  if (range === 'today') return { start: startOfAnalyticsDay(now), end: now };
  if (range === '7d') return { start: new Date(now.getTime() - 7 * DAY_MS), end: now };
  if (range === 'semester') return { start: startOfAnalyticsSemester(now), end: now };
  return { start: new Date(now.getTime() - 30 * DAY_MS), end: now };
};
