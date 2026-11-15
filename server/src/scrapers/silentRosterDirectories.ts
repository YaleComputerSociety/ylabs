/**
 * A department roster that carries no titles states nothing about anyone's home appointment,
 * so the lane files its own department as everyone's `primaryDepartment` (#6274). That is right
 * for a department's own faculty and wrong for a programme page that lists faculty from other
 * departments. The predicate below finds the second shape from evidence (#6299).
 */
export const SILENT_DIRECTORY_MIN_UNTITLED_SHARE = 0.8;
export const SILENT_DIRECTORY_MIN_DISAGREEMENT_SHARE = 0.5;
export const SILENT_DIRECTORY_MIN_FIRST_HAND_ENTRIES = 10;

export const FIRST_HAND_PRIMARY_DEPARTMENT_SOURCES: readonly string[] = [
  'ysm-faculty-directory',
  'official-profile-pi-backfill',
  'yale-directory',
];

export const SILENT_DIRECTORY_AUDIT_COMMAND = 'yarn --cwd server roster:audit-silent-directories';

export interface RosterTitleTally {
  deptKey: string;
  assertsHomeDepartment: boolean;
  entries: number;
  untitled: number;
}

export interface RosterDisagreementTally extends RosterTitleTally {
  withFirstHand: number;
  disagree: number;
}

export type SilentDirectoryClass =
  | 'titled'
  | 'silent-insufficient-evidence'
  | 'silent-low-disagreement'
  | 'silent-high-disagreement';

export const untitledShare = (tally: RosterTitleTally): number =>
  tally.entries > 0 ? tally.untitled / tally.entries : 0;

export const isSilentRosterPage = (tally: RosterTitleTally): boolean =>
  tally.entries > 0 && untitledShare(tally) >= SILENT_DIRECTORY_MIN_UNTITLED_SHARE;

export function classifySilentDirectory(tally: RosterDisagreementTally): SilentDirectoryClass {
  if (!isSilentRosterPage(tally)) return 'titled';
  if (tally.withFirstHand < SILENT_DIRECTORY_MIN_FIRST_HAND_ENTRIES) {
    return 'silent-insufficient-evidence';
  }
  return tally.disagree / tally.withFirstHand >= SILENT_DIRECTORY_MIN_DISAGREEMENT_SHARE
    ? 'silent-high-disagreement'
    : 'silent-low-disagreement';
}

/** A config that meets the predicate and still files its own department as everyone's home. */
export function silentDirectoryWarnings(tallies: readonly RosterDisagreementTally[]): string[] {
  return tallies
    .filter(
      (tally) =>
        tally.assertsHomeDepartment &&
        classifySilentDirectory(tally) === 'silent-high-disagreement',
    )
    .map((tally) => tally.deptKey)
    .sort();
}

/** The cheap half, computed inside a roster run: pages that read as silent and assert a home. */
export function silentRosterPagesAssertingHome(tallies: readonly RosterTitleTally[]): string[] {
  return tallies
    .filter((tally) => tally.assertsHomeDepartment && isSilentRosterPage(tally))
    .map((tally) => tally.deptKey)
    .sort();
}

export function silentRosterPagesNote(deptKeys: readonly string[]): string | undefined {
  if (deptKeys.length === 0) return undefined;
  return `NOTE (warn-only): ${deptKeys.length} roster page(s) in this run list mostly untitled entries and file their own department as each person's home: ${deptKeys.join(', ')}. Run \`${SILENT_DIRECTORY_AUDIT_COMMAND}\` to check whether the people listed have first-hand departments elsewhere (#6299).`;
}

/**
 * Whether a person's first-hand units disagree with the roster's department. A unit agrees when
 * it is the roster department or a catalog section under it; a unit the catalog cannot name
 * agrees with nothing.
 */
export function firstHandDisagrees(input: {
  rosterDepartment: string;
  firstHandUnits: readonly string[];
  canonicalDepartment: (name: string) => string | undefined;
  parentDepartmentsFor: (canonicalName: string) => readonly string[];
}): boolean {
  const roster = input.canonicalDepartment(input.rosterDepartment) ?? input.rosterDepartment;
  return !input.firstHandUnits.some((unit) => {
    const canonical = input.canonicalDepartment(unit);
    return (
      Boolean(canonical) &&
      (canonical === roster || input.parentDepartmentsFor(canonical!).includes(roster))
    );
  });
}
