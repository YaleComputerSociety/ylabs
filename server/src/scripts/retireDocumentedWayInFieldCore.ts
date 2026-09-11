// PR #2530 (issue #2527) removed `hasDocumentedWayIn` from the ResearchEntity
// schema along with its Signal derivation, Meilisearch filterable attribute,
// browse filter, and facet distribution. Mongoose ignores an undeclared field on
// read but never strips the stored value, so every environment still carries it.
export const RETIRED_DOCUMENTED_WAY_IN_FIELDS = ['hasDocumentedWayIn'] as const;

export const RETIRED_DOCUMENTED_WAY_IN_INDEX_NAME = 'archived_1_hasDocumentedWayIn_1';

export function assertDocumentedWayInFieldsFullyUnset(presentAfter: number): void {
  if (presentAfter !== 0) {
    throw new Error(
      `retire:documented-way-in-field invariant violated: ${presentAfter} research_entities documents still carry hasDocumentedWayIn after apply.`,
    );
  }
}

// The physical index outlives the schema declaration exactly as the stored field
// does, and dropping it while something still writes the field would mask a
// regression rather than complete a retirement. So the drop is refused until the
// field is fully unset, mirroring the retired-index guard in legacy:cleanup.
export function assertDocumentedWayInIndexDropAllowed(fieldPresentAfter: number): void {
  if (fieldPresentAfter !== 0) {
    throw new Error(
      `Refusing to drop ${RETIRED_DOCUMENTED_WAY_IN_INDEX_NAME}: hasDocumentedWayIn is still populated on ${fieldPresentAfter} documents, so something began writing it.`,
    );
  }
}
