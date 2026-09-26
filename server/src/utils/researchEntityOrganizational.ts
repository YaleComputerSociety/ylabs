/**
 * Organizational research homes (centers, institutes, initiatives, and core
 * facilities) are institutionally contactable: the entity itself, via its
 * official page and its affiliated labs, is the way in, so a single named
 * individual lead is NOT required for student visibility. (Many real Yale
 * centers are dean- or committee-led and never publish a single "director".) A
 * named director is still surfaced when known, but its absence should not hide a
 * well-described, source-backed organizational home from students.
 *
 * Their student-facing copy describes what the organization is and does rather
 * than a lab-style "Studies X" research focus, so the research-focus card
 * invariant is the wrong bar for them too (#1872), exactly as it is for
 * program-like homes.
 *
 * A type only belongs here if the entity itself is a usable way in. The
 * collections, archive/museum, and digital-humanities types were lead-exempt on
 * that theory and turned out to publish 144 student-ready pages with no lead, no
 * roster, no affiliated labs, and no contact email, so they were retired (#2202).
 * CORE_FACILITY stays because it routes to labs on 38 of 57 rows.
 *
 * This module is the single owner of the set. `studentVisibilityTier`,
 * `researchEntityPublicDescription`, and `researchEntityResearchScope` all read
 * it; a type added here changes the lead exemption, the card exemption, and the
 * research-scope classification together.
 */
export const ORGANIZATIONAL_ENTITY_TYPES: ReadonlySet<string> = new Set([
  'CENTER',
  'INSTITUTE',
  'INITIATIVE',
  'CORE_FACILITY',
]);

const textValue = (value: unknown): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';

export function isOrganizationalResearchEntity(
  entity: Record<string, unknown> | null | undefined,
): boolean {
  if (!entity) return false;
  return ORGANIZATIONAL_ENTITY_TYPES.has(textValue(entity.entityType).toUpperCase());
}
