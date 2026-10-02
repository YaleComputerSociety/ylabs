import {
  ProgramDateBoundary,
  newYorkCalendarDateParts,
  newYorkClockParts,
  newYorkInstant,
  parseProgramDate,
  programDateStatesTime,
} from './programDates';

export interface ProgramDateDraft {
  date: string;
  time: string;
}

export const EMPTY_PROGRAM_DATE_DRAFT: ProgramDateDraft = { date: '', time: '' };

const pad = (value: number) => String(value).padStart(2, '0');

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^(\d{2}):(\d{2})$/;

export const programDateDraft = (
  value: string | null | undefined,
  boundary: ProgramDateBoundary,
): ProgramDateDraft => {
  const instant = parseProgramDate(value);
  if (!instant) return EMPTY_PROGRAM_DATE_DRAFT;
  const { year, month, day } = newYorkCalendarDateParts(instant);
  const date = `${year}-${pad(month)}-${pad(day)}`;
  if (!programDateStatesTime(instant, boundary)) return { date, time: '' };
  const { hour, minute } = newYorkClockParts(instant);
  return { date, time: `${pad(hour)}:${pad(minute)}` };
};

export const programDateDraftInstant = (
  draft: ProgramDateDraft,
  boundary: ProgramDateBoundary,
): string | null => {
  const dateMatch = DATE_PATTERN.exec(draft.date);
  if (!dateMatch) return null;
  const [year, month, day] = dateMatch.slice(1).map(Number);
  const timeMatch = TIME_PATTERN.exec(draft.time);
  if (timeMatch) {
    const [hour, minute] = timeMatch.slice(1).map(Number);
    return newYorkInstant({ year, month, day, hour, minute }).toISOString();
  }
  const endOfDay = { hour: 23, minute: 59, second: 59, millisecond: 999 };
  const clock = boundary === 'deadline' ? endOfDay : {};
  return newYorkInstant({ year, month, day, ...clock }).toISOString();
};

const sameDraft = (a: ProgramDateDraft, b: ProgramDateDraft) =>
  a.date === b.date && a.time === b.time;

export type ProgramDateEdit = { changed: false } | { changed: true; value: string | null };

export const programDateEdit = (
  stored: string | null | undefined,
  draft: ProgramDateDraft,
  boundary: ProgramDateBoundary,
): ProgramDateEdit =>
  sameDraft(programDateDraft(stored, boundary), draft)
    ? { changed: false }
    : { changed: true, value: programDateDraftInstant(draft, boundary) };

export const editedProgramDateValue = (
  stored: string | null | undefined,
  draft: ProgramDateDraft,
  boundary: ProgramDateBoundary,
): string | null => {
  const edit = programDateEdit(stored, draft, boundary);
  return edit.changed ? edit.value : (stored ?? null);
};

export const programDatePatch = <Field extends string>(
  field: Field,
  stored: string | null | undefined,
  draft: ProgramDateDraft,
  boundary: ProgramDateBoundary,
): Partial<Record<Field, string | null>> => {
  const edit = programDateEdit(stored, draft, boundary);
  return edit.changed ? ({ [field]: edit.value } as Partial<Record<Field, string | null>>) : {};
};
