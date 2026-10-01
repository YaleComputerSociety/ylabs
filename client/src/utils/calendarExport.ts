import { Fellowship } from '../types/types';
import {
  newYorkCalendarDateParts,
  programDeadlineClosingInstant,
  programStatedClockLabel,
} from './programDates';

export interface ProgramDeadlineEvent {
  programId: string;
  title: string;
  link: string;
  date: Date;
}

export const fellowshipFutureDeadlineDate = (
  fellowship: Fellowship,
  now: Date = new Date(),
): Date | null => {
  if (fellowship.deadlineProjectedNextCycle) return null;
  const closesAt = programDeadlineClosingInstant(fellowship.deadline);
  if (!closesAt || closesAt.getTime() < now.getTime()) return null;
  return closesAt;
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

const formatIcsDate = (year: number, month: number, day: number): string => {
  const date = new Date(Date.UTC(year, month - 1, day));
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(
    date.getUTCDate(),
  ).padStart(2, '0')}`;
};

const formatIcsTimestamp = (date: Date): string =>
  `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(
    date.getUTCDate(),
  ).padStart(2, '0')}T${String(date.getUTCHours()).padStart(2, '0')}${String(
    date.getUTCMinutes(),
  ).padStart(2, '0')}${String(date.getUTCSeconds()).padStart(2, '0')}Z`;

const ICS_LINE_BREAK = '\r\n';

const buildVEvent = (event: ProgramDeadlineEvent, now: Date): string => {
  const statedTime = programStatedClockLabel(event.date);
  const deadlineSentence = statedTime
    ? `Application deadline for ${event.title}, due ${statedTime}.`
    : `Application deadline for ${event.title}.`;
  const description = event.link
    ? `${deadlineSentence} Program link: ${event.link}`
    : deadlineSentence;
  const { year, month, day } = newYorkCalendarDateParts(event.date);
  return [
    'BEGIN:VEVENT',
    `UID:program-deadline-${event.programId}@ylabs.app`,
    `DTSTAMP:${formatIcsTimestamp(now)}`,
    `DTSTART;VALUE=DATE:${formatIcsDate(year, month, day)}`,
    `DTEND;VALUE=DATE:${formatIcsDate(year, month, day + 1)}`,
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
    'PRODID:-//y/labs//Program Watch//EN',
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
