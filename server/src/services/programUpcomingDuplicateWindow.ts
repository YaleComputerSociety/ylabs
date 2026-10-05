import { programDeadlineClosesAt } from '../utils/programDeadlineInstant';
import { programTermQualifier } from './programDuplicateIdentity';

/**
 * The application window a hidden copy of a fund states for a cycle that is still ahead,
 * served on the kept copy when the kept copy's own deadline has passed or is absent
 * (owner decision, #4382). The gate derives it on every run and nothing else writes it.
 */
export interface UpcomingDuplicateWindow {
  deadline: Date;
  applicationOpenDate?: Date;
  isAcceptingApplications: boolean;
  sourceProgramId: string;
}

export interface ProgramWindowCopy {
  id: string;
  title?: unknown;
  deadline?: unknown;
  applicationOpenDate?: unknown;
  isAcceptingApplications?: unknown;
  servableOnItsOwn: boolean;
}

export const UPCOMING_DUPLICATE_WINDOW_FIELD = 'upcomingDuplicateWindow';

const validDate = (value: unknown): Date | undefined => {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date;
};

const closingTime = (deadline: unknown): number | undefined => {
  const date = validDate(deadline);
  return date ? programDeadlineClosesAt(date).getTime() : undefined;
};

export const programDeadlineIsUpcoming = (deadline: unknown, now: Date): boolean => {
  const closesAt = closingTime(deadline);
  return closesAt !== undefined && closesAt > now.getTime();
};

const windowOf = (copy: ProgramWindowCopy): UpcomingDuplicateWindow => {
  const applicationOpenDate = validDate(copy.applicationOpenDate);
  return {
    deadline: validDate(copy.deadline) as Date,
    ...(applicationOpenDate ? { applicationOpenDate } : {}),
    isAcceptingApplications: copy.isAcceptingApplications === true,
    sourceProgramId: copy.id,
  };
};

/**
 * The earliest still-upcoming window among the other copies of the kept copy's fund. A copy
 * the gate would not serve on its own supplies nothing, so a hidden copy's date is served
 * only on the evidence that would have served the copy itself. A copy for another term of the
 * program states that term's window, which the kept copy's title does not name (#4587).
 */
export function upcomingDuplicateWindowFor(
  kept: ProgramWindowCopy,
  copies: readonly ProgramWindowCopy[],
  now: Date,
): UpcomingDuplicateWindow | undefined {
  if (programDeadlineIsUpcoming(kept.deadline, now)) return undefined;
  const keptTerm = programTermQualifier(kept.title);
  const upcoming = copies
    .filter(
      (copy) =>
        copy.id !== kept.id &&
        copy.servableOnItsOwn &&
        programTermQualifier(copy.title) === keptTerm &&
        programDeadlineIsUpcoming(copy.deadline, now),
    )
    .sort(
      (a, b) =>
        (closingTime(a.deadline) as number) - (closingTime(b.deadline) as number) ||
        a.id.localeCompare(b.id),
    );
  return upcoming.length > 0 ? windowOf(upcoming[0]) : undefined;
}

/**
 * Derives the window for every kept copy from the duplicate grouping the gate already
 * made (`selectDuplicateProgramCopies`, which maps each redundant copy to its kept copy).
 */
export function deriveUpcomingDuplicateWindows(
  programs: readonly ProgramWindowCopy[],
  keptCopyById: ReadonlyMap<string, string>,
  now: Date,
): Map<string, UpcomingDuplicateWindow> {
  const programById = new Map(programs.map((program) => [program.id, program]));
  const copiesByKeptId = new Map<string, ProgramWindowCopy[]>();
  for (const [copyId, keptId] of keptCopyById) {
    const copy = programById.get(copyId);
    if (!copy) continue;
    const copies = copiesByKeptId.get(keptId);
    if (copies) copies.push(copy);
    else copiesByKeptId.set(keptId, [copy]);
  }

  const windows = new Map<string, UpcomingDuplicateWindow>();
  for (const [keptId, copies] of copiesByKeptId) {
    const kept = programById.get(keptId);
    if (!kept) continue;
    const window = upcomingDuplicateWindowFor(kept, copies, now);
    if (window) windows.set(keptId, window);
  }
  return windows;
}

export function storedUpcomingDuplicateWindow(value: unknown): UpcomingDuplicateWindow | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const deadline = validDate(record.deadline);
  const sourceProgramId = record.sourceProgramId ? String(record.sourceProgramId) : '';
  if (!deadline || !sourceProgramId) return null;
  return windowOf({
    id: sourceProgramId,
    deadline,
    applicationOpenDate: record.applicationOpenDate,
    isAcceptingApplications: record.isAcceptingApplications,
    servableOnItsOwn: true,
  });
}

const sameInstant = (a: Date | undefined, b: Date | undefined): boolean =>
  a?.getTime() === b?.getTime();

export function sameUpcomingDuplicateWindow(
  a: UpcomingDuplicateWindow | null | undefined,
  b: UpcomingDuplicateWindow | null | undefined,
): boolean {
  if (!a || !b) return !a && !b;
  return (
    sameInstant(a.deadline, b.deadline) &&
    sameInstant(a.applicationOpenDate, b.applicationOpenDate) &&
    a.isAcceptingApplications === b.isAcceptingApplications &&
    a.sourceProgramId === b.sourceProgramId
  );
}

/**
 * The window a student is served at `now`. The stored window was derived at gate time, so it
 * is re-checked here: once its deadline passes, or the row's own deadline is upcoming again,
 * the row's own deadline decides, exactly as if the gate had cleared it.
 */
export function servedUpcomingDuplicateWindow(
  program: { deadline?: unknown; upcomingDuplicateWindow?: unknown } | null | undefined,
  now: Date,
): UpcomingDuplicateWindow | undefined {
  const window = storedUpcomingDuplicateWindow(program?.upcomingDuplicateWindow);
  if (!window || !programDeadlineIsUpcoming(window.deadline, now)) return undefined;
  if (programDeadlineIsUpcoming(program?.deadline, now)) return undefined;
  return window;
}
