/**
 * Program-like research homes are institutionally contactable through their own
 * application flow rather than a named individual lead, and their student-facing
 * copy describes what the program offers and how to apply rather than a
 * lab-style "Studies X" research focus. Serve-time gates that were written for
 * PI-led labs (named-lead requirement, research-focus card invariant) therefore
 * treat them specially.
 *
 * `COURSE_SEQUENCE` was retired (#2202), so `kind: 'program'` is the sole
 * remaining marker: `departmentUndergradResearchScraper` still uses it to route
 * a record into the Fellowship lane.
 */
const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

export function isProgramLikeResearchEntity(
  entity: Record<string, unknown> | null | undefined,
): boolean {
  if (!entity) return false;
  return textValue(entity.kind).toLowerCase() === 'program';
}
