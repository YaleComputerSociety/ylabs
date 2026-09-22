/**
 * The title a student actually reads on a card, mirrored server-side so the search
 * index can store it instead of the stored `name`.
 *
 * `name` carries a synthesized `"<Person> Faculty Research"` for a faculty research
 * area, written by three roster scrapers when no lab is detected. The client has
 * always stripped that suffix for display and rendered "Faculty Research" as a kind
 * label instead, so nobody saw it - but `name` is a `searchableAttributes` entry, so
 * the suffix was indexed on 1,543 served rows. A query for "research" or "faculty
 * research" then matched every one of them and ranked placeholders above real labs.
 *
 * Behaviour is pinned against the client by `contracts/researchEntitySearchTitle.cases.json`;
 * changing a rule here requires changing `client/src/utils/researchEntityCopy.ts`
 * and the contract together.
 */

export interface ServedTitleInput {
  name?: unknown;
  displayName?: unknown;
  kind?: unknown;
  entityType?: unknown;
}

const FACULTY_RESEARCH_ENTITY_TYPES = new Set([
  'FACULTY_RESEARCH',
  'FACULTY_RESEARCH_AREA',
  'INDIVIDUAL_RESEARCH',
]);

const FACULTY_RESEARCH_KINDS = new Set(['individual', 'solo']);

const LAB_STRUCTURE_MARKER = /\b(?:lab|labs|laboratory|laboratories)\b/i;

const FACULTY_RESEARCH_TITLE_SUFFIX = /\s*(?:[-–—]\s*)?(?:Faculty\s+)?Research$/i;

export const isFacultyResearchEntity = (entity?: ServedTitleInput | null): boolean =>
  Boolean(
    entity &&
    (FACULTY_RESEARCH_KINDS.has(String(entity.kind)) ||
      FACULTY_RESEARCH_ENTITY_TYPES.has(String(entity.entityType))),
  );

/**
 * A `displayName` claiming a lab on an entity whose `name` does not is a graft from
 * a different research home, so the whole string is untrusted rather than trimmed.
 */
const displayNameGraftsLabStructure = (entity?: ServedTitleInput | null): boolean =>
  isFacultyResearchEntity(entity) &&
  Boolean(entity?.displayName) &&
  Boolean(entity?.name) &&
  LAB_STRUCTURE_MARKER.test(String(entity?.displayName)) &&
  !LAB_STRUCTURE_MARKER.test(String(entity?.name));

export const researchEntityDisplayName = (entity?: ServedTitleInput | null): string =>
  displayNameGraftsLabStructure(entity)
    ? String(entity?.name || entity?.displayName || '')
    : String(entity?.displayName || entity?.name || '');

export const servedResearchEntityTitle = (entity?: ServedTitleInput | null): string => {
  const base = researchEntityDisplayName(entity);
  if (!isFacultyResearchEntity(entity)) return base;
  const normalized = base.replace(FACULTY_RESEARCH_TITLE_SUFFIX, '').trim();
  return normalized || base;
};
