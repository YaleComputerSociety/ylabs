// Mirrors ROSTER_ALUMNI_PROGRAM_NAME in server/src/scrapers/sources/labMicrositeUndergradLLMExtractor.ts; change both together.
export const ROSTER_ALUMNI_PROGRAM_NAME = 'Lab roster alumni';

type PastAdviseeEntry = { programName?: string; year?: number; count?: number };

const shortAdviseeProgramName = (programName: string): string => programName.split(' (')[0].trim();

const adviseeYearRange = (entries: PastAdviseeEntry[]): string | null => {
  const years = entries
    .map((entry) => entry?.year)
    .filter((year): year is number => typeof year === 'number' && year > 0)
    .sort((a, b) => a - b);
  if (years.length === 0) return null;
  return years[0] === years[years.length - 1]
    ? `${years[0]}`
    : `${years[0]}–${years[years.length - 1]}`;
};

// Mirrors the adviser-list program names in server/src/scrapers/sources/undergradFellowshipRecipientScraper.ts; change both together.
const ADVISED_WORK_PLURALS: ReadonlyArray<[singular: string, plural: string]> = [
  ['senior essay', 'senior essays'],
  ['senior thesis', 'senior theses'],
];

const programLine = (program: string, total: number): string => {
  const work = ADVISED_WORK_PLURALS.find(([singular]) =>
    program.toLowerCase().endsWith(` ${singular}`),
  );
  if (!work) return `Mentored ${total} ${program} ${total === 1 ? 'recipient' : 'recipients'}`;
  const [singular, plural] = work;
  const named = total === 1 ? program : `${program.slice(0, -singular.length)}${plural}`;
  return `Advised ${total} ${named}`;
};

const adviseeTotal = (entries: PastAdviseeEntry[]): number =>
  entries.reduce((sum, entry) => sum + (entry?.count ?? 1), 0);

const withYearRange = (text: string, entries: PastAdviseeEntry[]): string => {
  const range = adviseeYearRange(entries);
  return range ? `${text} (${range})` : text;
};

/**
 * One evidence line per thing counted, each saying what it counts. A fellowship
 * program's mentee count is not the lab's undergraduate roster, so it is named by
 * its program; the roster-alumni count is left to the roster section whenever the
 * page renders one, because two counts of the same people read as a contradiction.
 * The advised line carries no number: a lab-site read undercounts long alumni lists
 * (5 of 29 graded rows, 2026-10-18), while the claim that undergrads were advised held.
 */
export const formatPastAdvisees = (
  group: { pastUndergradAdvisees?: PastAdviseeEntry[] | null },
  rosterListsUndergraduates = false,
): string[] => {
  const entries = (group.pastUndergradAdvisees || []).filter(Boolean);
  const advised: PastAdviseeEntry[] = [];
  const byProgram = new Map<string, PastAdviseeEntry[]>();
  for (const entry of entries) {
    if (entry.programName === ROSTER_ALUMNI_PROGRAM_NAME) {
      if (!rosterListsUndergraduates) advised.push(entry);
      continue;
    }
    const program = shortAdviseeProgramName(entry.programName || '');
    if (!program) {
      advised.push(entry);
      continue;
    }
    byProgram.set(program, [...(byProgram.get(program) || []), entry]);
  }
  const lines: string[] = [];
  if (adviseeTotal(advised) > 0) lines.push(withYearRange('Has advised undergrads', advised));
  for (const [program, programEntries] of byProgram) {
    const total = adviseeTotal(programEntries);
    if (total <= 0) continue;
    lines.push(withYearRange(programLine(program, total), programEntries));
  }
  return lines;
};
