import { isRealCalendarDate, newYorkCalendarDate } from './newYorkTime';

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

const STATED_DATE = new RegExp(
  `\\b(${MONTHS.join('|')})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`,
  'gi',
);

const DEADLINE_CUE = /\b(?:due|deadlines?|submitted|submissions?|received|apply by|close[sd]?)\b/gi;

const OTHER_EVENT =
  /\b(?:notif(?:y|ied|ication)|decisions?|announced|interviews?|reports?|symposium|begins?|start(?:s|ing)?|dates?|held|present(?:ed|ations?)?|opens?|between|until|from)\b/gi;

const CUE_WINDOW = 120;

function lastIndexOf(pattern: RegExp, text: string): number {
  let last = -1;
  for (const match of text.matchAll(pattern)) last = match.index ?? last;
  return last;
}

// The nearest event word before a date decides what the date is: "applications open
// January 5 and are due February 11" gives the second date to the deadline only.
function datesDeadlineCued(before: string): boolean {
  const window = before.slice(-CUE_WINDOW);
  const cue = lastIndexOf(DEADLINE_CUE, window);
  return cue >= 0 && cue > lastIndexOf(OTHER_EVENT, window);
}

function sentencesOf(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .filter(Boolean);
}

function isoDate(year: number, monthIndex: number, day: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function deadlineDatesStatedIn(prose: readonly unknown[]): string[] {
  const dates: string[] = [];
  for (const text of prose) {
    if (typeof text !== 'string') continue;
    for (const sentence of sentencesOf(text)) {
      for (const match of sentence.matchAll(STATED_DATE)) {
        if (!datesDeadlineCued(sentence.slice(0, match.index ?? 0))) continue;
        const [, month, day, year] = match;
        const date = {
          year: Number(year),
          monthIndex: MONTHS.indexOf(month.toLowerCase()),
          day: Number(day),
        };
        if (isRealCalendarDate(date)) dates.push(isoDate(date.year, date.monthIndex, date.day));
      }
    }
  }
  return dates;
}

/**
 * The deadline date a program's own text gives when it names none that matches the served
 * deadline, as `YYYY-MM-DD` (#5158). The structured deadline and the prose are often
 * written in different cycles, so the reader cannot tell which is current; it flags the
 * disagreement instead of choosing, and a page whose prose agrees anywhere is not flagged.
 */
export function programTextDeadlineConflict(
  deadline: unknown,
  prose: readonly unknown[],
): string | undefined {
  const served = deadline instanceof Date ? deadline : new Date(String(deadline ?? ''));
  if (!deadline || Number.isNaN(served.getTime())) return undefined;
  const { year, monthIndex, day } = newYorkCalendarDate(served);
  const servedDate = isoDate(year, monthIndex, day);
  const stated = deadlineDatesStatedIn(prose);
  if (stated.length === 0 || stated.includes(servedDate)) return undefined;
  return stated[0];
}
