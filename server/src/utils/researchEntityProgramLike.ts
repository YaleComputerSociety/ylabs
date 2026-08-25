/**
 * Program-like research homes (structured programs, RA programs, fellowship
 * programs, course sequences) are institutionally contactable through their own
 * application flow rather than a named individual lead, and their student-facing
 * copy describes what the program offers and how to apply rather than a
 * lab-style "Studies X" research focus. Serve-time gates that were written for
 * PI-led labs (named-lead requirement, research-focus card invariant) therefore
 * treat these types specially. Keep this list in sync with the program bucket in
 * `researchAccessTypes` and the client `ENTITY_TYPE_TO_KIND` program mapping.
 */
const PROGRAM_LIKE_ENTITY_TYPES = new Set([
  'PROGRAM',
  'RA_PROGRAM',
  'FELLOWSHIP_PROGRAM',
  'COURSE_SEQUENCE',
]);

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

export function isProgramLikeResearchEntity(entity: Record<string, unknown> | null | undefined): boolean {
  if (!entity) return false;
  return (
    textValue(entity.kind).toLowerCase() === 'program' ||
    PROGRAM_LIKE_ENTITY_TYPES.has(textValue(entity.entityType).toUpperCase())
  );
}

/**
 * Organizational research homes (centers, institutes, initiatives, core
 * facilities, library collections initiatives, archive/museum projects, and
 * digital-humanities projects) are institutionally contactable via their own
 * official page and programs rather than a single named individual lead, and -
 * like program-like homes - their student-facing copy describes what the home is
 * and offers, not a lab-style "Studies X" research focus. Serve-time gates
 * written for PI-led labs (named-lead requirement, lab-style card invariant)
 * therefore treat these types specially too.
 *
 * Must stay consistent with accessMaterializer's ORGANIZATIONAL_WAYS_IN_ENTITY_TYPES:
 * the materializer emits a lead-optional organizational REACH_OUT_PLAUSIBLE
 * ways-in for exactly these types, so any type it treats as organizational must
 * also be lead-exempt here or the class is stranded on missing_lead forever
 * despite carrying that signal (the ARCHIVE_OR_MUSEUM_PROJECT Beinecke/Peabody
 * curatorial units were minted lead-optional by design yet held on missing_lead
 * because that set omitted the type, issue #1367).
 */
const ORGANIZATIONAL_ENTITY_TYPES = new Set([
  'CENTER',
  'INSTITUTE',
  'INITIATIVE',
  'CORE_FACILITY',
  'COLLECTIONS_INITIATIVE',
  'ARCHIVE_OR_MUSEUM_PROJECT',
  'DIGITAL_HUMANITIES_PROJECT',
]);

export function isOrganizationalResearchEntity(
  entity: Record<string, unknown> | null | undefined,
): boolean {
  if (!entity) return false;
  return ORGANIZATIONAL_ENTITY_TYPES.has(textValue(entity.entityType).toUpperCase());
}

/**
 * A lab-style one-line "Studies X" card is a bonus, not a requirement, for homes
 * that are not PI-led labs: program-like homes (described by what they offer and
 * how to apply) and organizational homes (described by what the center, library
 * collection, or archive is and does). The full-description requirement and the
 * non-blank served-copy guard still apply to these types; only the lab-style
 * card requirement is lifted. PI-led labs and faculty research areas still
 * require a genuine card. See researchEntityPublicDescription's card invariant
 * and docs/student-ready-definition.md.
 */
export function researchEntityCardIsOptional(
  entity: Record<string, unknown> | null | undefined,
): boolean {
  return isProgramLikeResearchEntity(entity) || isOrganizationalResearchEntity(entity);
}

/**
 * The program/fellowship bucket surfaced by the cross-surface "Related programs
 * & fellowships" module on `/research` (issue #1509). Course sequences are
 * deliberately excluded: they are program-like for serve-time gating but are not
 * the structured programs and fellowships the `/programs` catalog represents.
 */
const RELATED_PROGRAM_ENTITY_TYPES = ['PROGRAM', 'RA_PROGRAM', 'FELLOWSHIP_PROGRAM'] as const;

export { PROGRAM_LIKE_ENTITY_TYPES, ORGANIZATIONAL_ENTITY_TYPES, RELATED_PROGRAM_ENTITY_TYPES };
