export const NEW_YORK_TIME_ZONE = 'America/New_York';

export const newYorkCalendarDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: NEW_YORK_TIME_ZONE,
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

export const formatNewYorkCalendarDate = (value?: Date | string | null): string => {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? newYorkCalendarDateFormatter.format(date) : '';
};
