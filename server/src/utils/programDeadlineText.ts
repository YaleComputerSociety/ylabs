import { isRealCalendarDate, newYorkCalendarDate } from './newYorkTime';

const MONTH_NAME =
  '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

const MONTH_PREFIXES = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
];

const STATED_DATE = new RegExp(
  `\\b(${MONTH_NAME})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`,
  'gi',
);

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

const DEADLINE_CUE = new RegExp(
  `\\b(?:due(?!\\s+to\\b)|deadlines?|submitted|submissions?|received|apply by|close[sd]?(?=\\s+(?:on|at|by|${MONTH_NAME}|${WEEKDAYS.join('|')})\\b))\\b`,
  'gi',
);

const OTHER_EVENT =
  /\b(?:notif(?:y|ied|ication)|decisions?|announced|interviews?|reports?|symposium|begins?|start(?:s|ing)?|dates?|held|present(?:ed|ations?)?|opens?|between|until|from|letters?|recommendations?|references?|transcripts?)\b/gi;

const DATE_RANGE_END =
  /(?:^|\d{1,2}(?:st|nd|rd|th)?,?)\s*[-\u2013\u2014]\s*(?:[a-z]+\.?\s+\d{1,2}\s*[-\u2013\u2014]\s*)?$/i;

function firstIndexOf(pattern: RegExp, text: string): number {
  for (const match of text.matchAll(pattern)) return match.index ?? -1;
  return -1;
}

// A date belongs to the deadline only when the words since the previous date name the
// deadline and no other event: "the deadline is July 10" does, "final reports are due May 1"
// and "submissions open January 4" do not.
function spanNamesDeadline(span: string): boolean {
  return firstIndexOf(DEADLINE_CUE, span) >= 0 && firstIndexOf(OTHER_EVENT, span) < 0;
}

const NOT_AFTER_ABBREVIATION =
  '(?<!\\b(?:[aApP]\\.[mM]|U\\.S|e\\.g|i\\.e|No|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)\\.)';

const SENTENCE_BREAK = new RegExp(
  `(?<=[.!?;])${NOT_AFTER_ABBREVIATION}\\s+|(?<=[a-z][.!?;])${NOT_AFTER_ABBREVIATION}(?=[A-Z])`,
);

function sentencesOf(text: string): string[] {
  return text.replace(/\s+/g, ' ').split(SENTENCE_BREAK).filter(Boolean);
}

function isoDate(year: number, monthIndex: number, day: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function deadlineDatesStatedIn(prose: readonly unknown[]): Set<string> {
  const dates = new Set<string>();
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
          monthIndex: MONTH_PREFIXES.indexOf(month.slice(0, 3).toLowerCase()),
          day: Number(day),
        };
        if (isRealCalendarDate(date)) dates.add(isoDate(date.year, date.monthIndex, date.day));
      }
    }
  }
  return dates;
}

/**
 * The one deadline date a program's own text gives when it differs from the served
 * deadline, as `YYYY-MM-DD` (#5158). The structured deadline and the prose are often
 * written in different cycles, so the reader cannot tell which is current; it flags the
 * disagreement instead of choosing. Text that states two or more deadline dates is not
 * flagged, so a date the reader misses can never make another look like a contradiction.
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
  if (stated.size !== 1 || stated.has(servedDate)) return undefined;
  return [...stated][0];
}
