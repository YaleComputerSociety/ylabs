const ORGANIZATION_NAME_FILLER_WORDS = new Set([
  'a',
  'and',
  'at',
  'center',
  'centre',
  'committee',
  'council',
  'for',
  'foundation',
  'in',
  'initiative',
  'institute',
  'institution',
  'of',
  'on',
  'program',
  'research',
  'school',
  'studies',
  'the',
  'university',
  'yale',
]);

const INITIALISM_SKIPPED_WORDS = new Set(['a', 'and', 'at', 'for', 'in', 'of', 'on', 'the']);

function organizationNameWords(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function organizationNameInitialisms(words: string[]): string[] {
  const initials = words.filter((word) => !INITIALISM_SKIPPED_WORDS.has(word)).map((w) => w[0]);
  const withoutYale = words
    .filter((word) => word !== 'yale' && !INITIALISM_SKIPPED_WORDS.has(word))
    .map((w) => w[0]);
  return [initials.join(''), withoutYale.join('')].filter((initialism) => initialism.length >= 2);
}

function distinctiveWordRuns(words: string[]): string[] {
  const runs: string[][] = [[]];
  for (const word of words) {
    if (ORGANIZATION_NAME_FILLER_WORDS.has(word)) runs.push([]);
    else runs[runs.length - 1].push(word);
  }
  return runs.filter((run) => run.length > 0).map((run) => run.join(' '));
}

export function organizationTextNamesUnit(organizationText: string, unitName: string): boolean {
  const unitWords = organizationNameWords(unitName);
  const unitProperName = distinctiveWordRuns(unitWords)[0];
  const initialisms = new Set(organizationNameInitialisms(unitWords));
  const textWords = organizationNameWords(organizationText);
  return (
    textWords.some((word) => initialisms.has(word)) ||
    (unitProperName !== undefined && distinctiveWordRuns(textWords).includes(unitProperName))
  );
}

const DIRECTORSHIP_OF_NAMED_UNIT =
  /\bdirector\s+(?:of|for|at)\s+(?:the\s+)?([^,;]+?)(?:\s+and\s+|,|$)/i;
const DIRECTORSHIP_COMMA_NAMED_UNIT = /\bdirector\s*,\s*([^,;]+)/i;
export const ORGANIZATION_NOUN =
  /\b(?:center|centre|institute|institution|program|programme|lab|laboratory|council|initiative|foundation|school|department|office|project|committee)\b/i;

export function directorshipNamedUnit(clause: string): string | undefined {
  const ofUnit = clause.match(DIRECTORSHIP_OF_NAMED_UNIT)?.[1];
  if (ofUnit) return ofUnit;
  const commaUnit = clause.match(DIRECTORSHIP_COMMA_NAMED_UNIT)?.[1];
  return commaUnit && ORGANIZATION_NOUN.test(commaUnit) ? commaUnit : undefined;
}

export function organizationTextIsGenericSelfReference(organizationText: string): boolean {
  const words = organizationNameWords(organizationText);
  return (
    words.some((word) => ORGANIZATION_NOUN.test(word)) &&
    words.every((word) => ORGANIZATION_NAME_FILLER_WORDS.has(word) || ORGANIZATION_NOUN.test(word))
  );
}
const FORMER_DIRECTORSHIP =
  /\bformer(?:ly)?\s+(?:\S+\s+){0,4}\S*director\b|\bdirector\s+emerit(?:us|a)\b|\bemerit(?:us|a)\s+\S*director\b/i;
const CLOSED_YEAR_RANGE = /\b((?:19|20)\d{2})\s*[-\u2013\u2014]\s*((?:19|20)?\d{2})\b/g;

function closedRangeEndYear(startText: string, endText: string): number {
  const start = Number(startText);
  if (endText.length === 4) return Number(endText);
  const end = Math.floor(start / 100) * 100 + Number(endText);
  return end < start ? end + 100 : end;
}

export function isHistoricalDirectorship(clause: string): boolean {
  if (FORMER_DIRECTORSHIP.test(clause)) return true;
  const endYears = [...clause.matchAll(CLOSED_YEAR_RANGE)].map(([, start, end]) =>
    closedRangeEndYear(start, end),
  );
  const currentYear = new Date().getFullYear();
  return endYears.length > 0 && endYears.every((endYear) => endYear < currentYear);
}
