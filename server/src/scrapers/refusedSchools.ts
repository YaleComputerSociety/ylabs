import { valueIsRefused } from '../utils/researchEntityFieldValueRefusals';

/**
 * A school refused at `school` or at a `schools` entry is inadmissible for the row's whole
 * org-unit closure, whichever route derived it: a department's parent school, a profile host,
 * or a lead's appointment. If the evidence really supports it, the refusal is wrong and is
 * withdrawn through the audited path; a derivation never overrides it (#6155). This is the
 * same test `withRetainedSecondarySchools` applies to a retained roster school (#6157).
 */
export function schoolIsRefused(fieldValueRefusals: unknown, school: unknown): boolean {
  return (
    valueIsRefused(fieldValueRefusals, 'school', school) ||
    valueIsRefused(fieldValueRefusals, 'schools', school)
  );
}

/**
 * Removes every refused school from a derived `$set` in place and returns what it removed.
 * A refused scalar `school` falls to the first school still admissible, or leaves the `$set`
 * when none is, so the stored value stays as the refusal left it.
 */
export function withoutRefusedSchools(
  set: Record<string, unknown>,
  fieldValueRefusals: unknown,
): string[] {
  const removed: string[] = [];
  if (Array.isArray(set.schools)) {
    set.schools = set.schools.filter((school) => {
      if (!schoolIsRefused(fieldValueRefusals, school)) return true;
      removed.push(String(school));
      return false;
    });
  }
  if (
    typeof set.school === 'string' &&
    set.school &&
    schoolIsRefused(fieldValueRefusals, set.school)
  ) {
    removed.push(set.school);
    const next = Array.isArray(set.schools) ? set.schools.find((school) => school) : undefined;
    if (typeof next === 'string') set.school = next;
    else delete set.school;
  }
  return [...new Set(removed)];
}
