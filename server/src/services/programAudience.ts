/**
 * Who a program admits, derived from the evidence the row carries rather than stored.
 *
 * `undergraduateOnly` is a boolean, so it cannot say "open to undergraduate and graduate
 * applicants", and every program in that state was stored as one of two false claims (#4088).
 * The year-of-study facet the source publishes already names the audience, so it decides
 * whenever it names a class of student; the stored booleans are the fallback for a row whose
 * source lists no year.
 *
 * The client cannot import this module, so `ProgramAudience` in client/src/types/types.tsx
 * mirrors `programAudiences`; changing it here requires updating that copy.
 */
export const programAudiences = [
  'UNDERGRADUATE',
  'UNDERGRADUATE_AND_GRADUATE',
  'GRADUATE',
] as const;
export type ProgramAudience = (typeof programAudiences)[number];

const UNDERGRADUATE_YEAR_OF_STUDY = /^(first-year( student)?|sophomore|junior|senior)$/i;
const GRADUATE_YEAR_OF_STUDY = /\b(master|phd|jd|md|graduate|grad\/prof)\b/i;

export interface ProgramAudienceInput {
  yearOfStudy?: unknown;
  undergraduateOnly?: unknown;
  yaleCollegeOnly?: unknown;
}

const yearsOfStudy = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string').map((item) => item.trim())
    : [];

const isUndergraduateYearOfStudy = (year: string): boolean =>
  UNDERGRADUATE_YEAR_OF_STUDY.test(year.trim());

const isGraduateYearOfStudy = (year: string): boolean => GRADUATE_YEAR_OF_STUDY.test(year.trim());

function audienceFromYearsOfStudy(years: string[]): ProgramAudience | null {
  const admitsUndergraduates = years.some(isUndergraduateYearOfStudy);
  const admitsGraduates = years.some(isGraduateYearOfStudy);
  if (admitsUndergraduates && admitsGraduates) return 'UNDERGRADUATE_AND_GRADUATE';
  if (admitsGraduates) return 'GRADUATE';
  if (admitsUndergraduates) return 'UNDERGRADUATE';
  return null;
}

export function programAudience(program: ProgramAudienceInput): ProgramAudience | null {
  const fromYears = audienceFromYearsOfStudy(yearsOfStudy(program.yearOfStudy));
  if (fromYears) return fromYears;
  if (program.undergraduateOnly === true || program.yaleCollegeOnly === true)
    return 'UNDERGRADUATE';
  if (program.undergraduateOnly === false) return 'GRADUATE';
  return null;
}

export const programAudienceAdmitsUndergraduates = (audience: ProgramAudience | null): boolean =>
  audience === 'UNDERGRADUATE' || audience === 'UNDERGRADUATE_AND_GRADUATE';
