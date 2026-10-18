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
  /\b(?:notif(?:y|ied|ication)|decisions?|announced|interviews?|reports?|symposium|begins?|start(?:s|ing)?|dates?|held|present(?:ed|ations?)?|opens?|between|until|from|letters?|recommendations?|references?|transcripts?)\b/gi;

const DATE_RANGE_END = /[-\u2013\u2014]\s*(?:[a-z]+\.?\s+\d{1,2}\s*[-\u2013\u2014]\s*)?$/i;

function firstIndexOf(pattern: RegExp, text: string): number {
  for (const match of text.matchAll(pattern)) return match.index ?? -1;
  return -1;
}

// A date belongs to the deadline when the words since the previous date name the deadline
// before any other event: "the deadline is July 10" does, "final reports are due May 1"
// and "recommendation letters must be received by March 1" do not.
function spanNamesDeadline(span: string): boolean {
  const cue = firstIndexOf(DEADLINE_CUE, span);
  if (cue < 0) return false;
  const other = firstIndexOf(OTHER_EVENT, span);
  return other < 0 || other > cue;
}

function sentencesOf(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?;])\s+|(?<=[a-z][.!?;])(?=[A-Z])/)
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
      let spanStart = 0;
      for (const match of sentence.matchAll(STATED_DATE)) {
        const index = match.index ?? 0;
        const span = sentence.slice(spanStart, index);
        spanStart = index + match[0].length;
        if (DATE_RANGE_END.test(span) || !spanNamesDeadline(span)) continue;
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
  { projected = false, stale = false }: { projected?: boolean; stale?: boolean } = {},
): string | undefined {
  if (projected || stale) return undefined;
  const served = deadline instanceof Date ? deadline : new Date(String(deadline ?? ''));
  if (!deadline || Number.isNaN(served.getTime())) return undefined;
  const { year, monthIndex, day } = newYorkCalendarDate(served);
  const servedDate = isoDate(year, monthIndex, day);
  const stated = deadlineDatesStatedIn(prose);
  if (stated.length === 0 || stated.includes(servedDate)) return undefined;
  return stated[0];
}
