/**
 * Program-like research homes are institutionally contactable through their own
 * application flow rather than a named individual lead, and their student-facing
 * copy describes what the program offers and how to apply rather than a
 * lab-style "Studies X" research focus. Serve-time gates that were written for
 * PI-led labs (named-lead requirement, research-focus card invariant) therefore
 * treat them specially.
 *
 * `Fellowship` is the live owner of program-like copy, not `ResearchEntity`
 * (#2215). `COURSE_SEQUENCE` was retired (#2202) and no surviving `entityType`
 * derives `program`, while the scraper records that observe `kind: 'program'`
 * are routed into the Fellowship lane rather than minting an entity
 * (`departmentUndergradResearchScraper`). So this predicate matched 0 of 4,743
 * live Dev rows, and the only way a materialized entity keeps `kind: 'program'`
 * is an operator lock on `kind`. That lock is the documented entry point and the
 * reason the arm stays: the serve-time gates below must still treat such a row
 * as program-like. The bar it selects reaches real student-facing copy through
 * `programLikeCardShortDescription`, which `Fellowship` calls directly.
 */
const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

export function isProgramLikeResearchEntity(
  entity: Record<string, unknown> | null | undefined,
): boolean {
  if (!entity) return false;
  return textValue(entity.kind).toLowerCase() === 'program';
}
