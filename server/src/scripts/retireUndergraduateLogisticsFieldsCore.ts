// The undergraduate availability, compensation and class-year enums were removed
// from the ResearchEntity schema along with their Signal derivations, Meilisearch
// filterable attributes, browse filters and dashboard claim, because no source
// populates them. Mongoose ignores an undeclared field on read but never strips
// the stored value, and the public search hit spreads the raw Mongo row, so every
// environment keeps serving the frozen values until they are unset.
export const RETIRED_UNDERGRADUATE_LOGISTICS_FIELDS = [
  'undergraduateCurrentAvailability',
  'undergraduateCompensationModel',
  'undergraduateEligibleStudentLevels',
] as const;

export const RETIRED_UNDERGRADUATE_LOGISTICS_INDEX_NAMES = [
  'archived_1_undergraduateCurrentAvailability_1',
  'archived_1_undergraduateCompensationModel_1',
  'archived_1_undergraduateEligibleStudentLevels_1',
] as const;

export function assertUndergraduateLogisticsFieldsFullyUnset(presentAfter: number): void {
  if (presentAfter !== 0) {
    throw new Error(
      `retire:undergraduate-logistics-fields invariant violated: ${presentAfter} research_entities documents still carry a retired undergraduate-logistics field after apply.`,
    );
  }
}

// The physical indexes outlive the schema declaration exactly as the stored
// fields do, and dropping one while something still writes its field would mask a
// regression rather than complete a retirement. So the drops are refused until
// the fields are fully unset, mirroring retire:documented-way-in-field.
export function assertUndergraduateLogisticsIndexDropAllowed(fieldPresentAfter: number): void {
  if (fieldPresentAfter !== 0) {
    throw new Error(
      `Refusing to drop the retired undergraduate-logistics indexes: a retired field is still populated on ${fieldPresentAfter} documents, so something began writing it.`,
    );
  }
}
