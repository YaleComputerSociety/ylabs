import { Fellowship } from '../types/types';

export interface ProgramDeadlineEvent {
  programId: string;
  title: string;
  link: string;
  date: Date;
}

const validDeadlineDate = (value?: string | null): Date | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const deadlineEndOfUtcDay = (date: Date): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));

export const fellowshipFutureDeadlineDate = (
  fellowship: Fellowship,
  now: Date = new Date(),
): Date | null => {
  const date = validDeadlineDate(fellowship.deadline);
  if (!date || deadlineEndOfUtcDay(date).getTime() < now.getTime()) return null;
  return date;
};

export const upcomingProgramDeadlineEvents = (
  fellowships: readonly Fellowship[],
  now: Date = new Date(),
): ProgramDeadlineEvent[] =>
  fellowships
    .map((fellowship) => {
      const date = fellowshipFutureDeadlineDate(fellowship, now);
      if (!date) return null;
      return {
        programId: fellowship.id,
        title: fellowship.title,
        link: fellowship.applicationLink || fellowship.sourceUrl || '',
        date,
      };
    })
    .filter((event): event is ProgramDeadlineEvent => Boolean(event))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

const escapeIcsText = (value: string): string =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');

const formatIcsAllDayDate = (date: Date): string =>
  `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(
    date.getUTCDate(),
  ).padStart(2, '0')}`;

const formatIcsTimestamp = (date: Date): string =>
  `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(
    date.getUTCDate(),
  ).padStart(2, '0')}T${String(date.getUTCHours()).padStart(2, '0')}${String(
    date.getUTCMinutes(),
  ).padStart(2, '0')}${String(date.getUTCSeconds()).padStart(2, '0')}Z`;

const nextUtcDay = (date: Date): Date =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1));

const ICS_LINE_BREAK = '\r\n';

const buildVEvent = (event: ProgramDeadlineEvent, now: Date): string => {
  const description = event.link
    ? `Application deadline for ${event.title}. Program link: ${event.link}`
    : `Application deadline for ${event.title}.`;
  return [
    'BEGIN:VEVENT',
    `UID:program-deadline-${event.programId}@ylabs.app`,
    `DTSTAMP:${formatIcsTimestamp(now)}`,
    `DTSTART;VALUE=DATE:${formatIcsAllDayDate(event.date)}`,
    `DTEND;VALUE=DATE:${formatIcsAllDayDate(nextUtcDay(event.date))}`,
    `SUMMARY:${escapeIcsText(`${event.title} application deadline`)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    ...(event.link ? [`URL:${escapeIcsText(event.link)}`] : []),
    'END:VEVENT',
  ].join(ICS_LINE_BREAK);
};

export const buildProgramDeadlinesIcsCalendar = (
  events: readonly ProgramDeadlineEvent[],
  now: Date = new Date(),
): string =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Yale Research//Program Watch//EN',
    'CALSCALE:GREGORIAN',
    ...events.map((event) => buildVEvent(event, now)),
    'END:VCALENDAR',
  ].join(ICS_LINE_BREAK);

export const downloadIcsCalendar = (filename: string, icsContent: string): void => {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return;
  }

  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

export const icsFilenameForProgram = (title: string): string => {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug || 'program'}-deadline.ics`;
};
