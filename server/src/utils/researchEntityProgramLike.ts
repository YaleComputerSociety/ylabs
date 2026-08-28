/**
 * Program-like research homes (structured programs and course sequences) are
 * institutionally contactable through their own application flow rather than a
 * named individual lead, and their student-facing copy describes what the
 * program offers and how to apply rather than a lab-style "Studies X" research
 * focus. Serve-time gates that were written for PI-led labs (named-lead
 * requirement, research-focus card invariant) therefore treat these types
 * specially. Keep this list in sync with the program bucket in
 * `researchAccessTypes` and the client `ENTITY_TYPE_TO_KIND` program mapping.
 */
const PROGRAM_LIKE_ENTITY_TYPES = new Set(['COURSE_SEQUENCE']);

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

export function isProgramLikeResearchEntity(
  entity: Record<string, unknown> | null | undefined,
): boolean {
  if (!entity) return false;
  return (
    textValue(entity.kind).toLowerCase() === 'program' ||
    PROGRAM_LIKE_ENTITY_TYPES.has(textValue(entity.entityType).toUpperCase())
  );
}

export { PROGRAM_LIKE_ENTITY_TYPES };
