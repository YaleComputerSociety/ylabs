export const WRITERLESS_RESEARCH_ENTITY_FIELDS = [
  'prerequisiteCourses',
  'creditOptions',
  'fundingPrograms',
  'timeCommitmentHoursPerWeek',
  'location',
  'embedding',
] as const;

export const UNDECLARED_RESEARCH_ENTITY_FIELDS = [
  'accessAcceptanceLevel',
  'studentVisibilityVersion',
  'totalInquiriesCache',
  'claimedByFaculty',
  'studentDecisionExplanation',
  'description',
  'departmentIds',
  'researchAreaIds',
  'archiveReason',
] as const;

export const RETIRED_RESEARCH_ENTITY_RESIDUE_FIELDS = [
  ...WRITERLESS_RESEARCH_ENTITY_FIELDS,
  ...UNDECLARED_RESEARCH_ENTITY_FIELDS,
] as const;

export type RetiredResearchEntityResidueField =
  (typeof RETIRED_RESEARCH_ENTITY_RESIDUE_FIELDS)[number];

export const retiredResidueFieldPresenceFilter = (
  fields: readonly string[] = RETIRED_RESEARCH_ENTITY_RESIDUE_FIELDS,
) => ({
  $or: fields.map((field) => ({ [field]: { $exists: true } })),
});

export interface ResidueSnapshotRow {
  _id: string;
  values: Record<string, unknown>;
}

export function snapshotResidueRow(
  row: Record<string, unknown>,
  fields: readonly string[] = RETIRED_RESEARCH_ENTITY_RESIDUE_FIELDS,
): ResidueSnapshotRow {
  const values: Record<string, unknown> = {};
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(row, field)) values[field] = row[field];
  }
  return { _id: String(row._id), values };
}

export function assertResidueFieldsFullyUnset(presentAfter: Record<string, number>): void {
  const remaining = Object.entries(presentAfter).filter(([, count]) => count !== 0);
  if (remaining.length === 0) return;
  throw new Error(
    `retire:research-entity-residue-fields invariant violated: ${remaining
      .map(([field, count]) => `${field} on ${count}`)
      .join(', ')} research_entities documents after apply.`,
  );
}
