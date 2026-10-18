import { isFacultyResearchEntity } from '../utils/servedResearchEntityTitle';

interface RelatedRowKind {
  kind?: unknown;
  entityType?: unknown;
}

/**
 * The stored edge label is written once from the edge type, and AFFILIATED_LAB is
 * chosen for any target that is not a faculty research area, so a faculty research
 * row reached that way was served as an "Affiliated lab". The kind chip beside the
 * label already names what the row is, so the label names only the role.
 */
export const servedRelationshipLabel = (relatedEntity?: RelatedRowKind): string =>
  isFacultyResearchEntity(relatedEntity) ? 'Member' : 'Affiliated';

export const isPageLeadsOwnFacultyResearch = (
  relatedEntity: RelatedRowKind,
  relatedLeadPersonIds: readonly string[] | undefined,
  pageLeadPersonIds: ReadonlySet<string>,
): boolean =>
  pageLeadPersonIds.size > 0 &&
  isFacultyResearchEntity(relatedEntity) &&
  Boolean(relatedLeadPersonIds?.some((personId) => pageLeadPersonIds.has(personId)));
