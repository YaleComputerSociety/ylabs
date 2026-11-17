/**
 * Who a program admits, derived from the evidence the row carries rather than stored.
 *
 * `undergraduateOnly` is a boolean, so it cannot say "open to undergraduate and graduate
 * applicants", and every program in that state was stored as one of two false claims (#4088).
 * The year-of-study facet the source publishes already names the audience, so it decides
 * whenever it names a class of student; the stored booleans are the fallback for a row whose
 * source lists no year. An eligibility statement that admits graduate students widens an
 * undergraduate audience to both (#6408), because a per-college copy of a fund can carry an
 * undergraduate year list while its own text admits graduate affiliates.
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
  eligibility?: unknown;
}

const GRADUATE_STUDENT_PHRASE =
  /\bgraduate\s+(?:students?|affiliates?)\b|\bgraduate,?\s+(?:and|or)\s+professional\b|\bmaster'?s(?:-level|\s+degree)?\s+students?\b|\bgraduate\s+school\s+of\s+arts\s+and\s+sciences\b/i;
const ELIGIBILITY_VERB =
  /\b(?:eligible|may\s+apply|can\s+apply|encouraged\s+to\s+apply|welcomes?|invites?\s+applications|open\s+to|be\s+considered|available\s+to)\b/i;
const NEGATION =
  /\b(?:not|ineligible|excluded|excluding|excludes)\b|\bonly\s+(?:open\s+)?to\s+(?:yale\s+)?(?:college\s+)?undergraduates?\b(?!\s*(?:,|and|or))/i;

/**
 * Clauses, so a negation about another group ("(seniors are not eligible)") does not cancel
 * the clause that admits graduate students.
 */
const eligibilityClauses = (value: unknown): string[] =>
  typeof value === 'string' ? value.split(/[.;!?()\n]+|,\s*but\b|\bbut\b/i) : [];

/** The program's own eligibility text states that graduate students may apply. */
export function eligibilityAdmitsGraduates(eligibility: unknown): boolean {
  return eligibilityClauses(eligibility).some(
    (clause) =>
      GRADUATE_STUDENT_PHRASE.test(clause) &&
      ELIGIBILITY_VERB.test(clause) &&
      !NEGATION.test(clause),
  );
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

function audienceFromStoredEvidence(program: ProgramAudienceInput): ProgramAudience | null {
  const fromYears = audienceFromYearsOfStudy(yearsOfStudy(program.yearOfStudy));
  if (fromYears) return fromYears;
  if (program.undergraduateOnly === true || program.yaleCollegeOnly === true)
    return 'UNDERGRADUATE';
  if (program.undergraduateOnly === false) return 'GRADUATE';
  return null;
}

export function programAudience(program: ProgramAudienceInput): ProgramAudience | null {
  const audience = audienceFromStoredEvidence(program);
  return audience === 'UNDERGRADUATE' && eligibilityAdmitsGraduates(program.eligibility)
    ? 'UNDERGRADUATE_AND_GRADUATE'
    : audience;
}

/**
 * `undergraduateOnly` as served: the derived audience, so the payload never states an
 * undergraduate-only program beside a graduate audience (#6400). A row with no audience
 * evidence serves no claim.
 */
export function servedUndergraduateOnly(program: ProgramAudienceInput): boolean | null {
  const audience = programAudience(program);
  return audience === null ? null : audience === 'UNDERGRADUATE';
}

export const programAudienceAdmitsUndergraduates = (audience: ProgramAudience | null): boolean =>
  audience === 'UNDERGRADUATE' || audience === 'UNDERGRADUATE_AND_GRADUATE';
