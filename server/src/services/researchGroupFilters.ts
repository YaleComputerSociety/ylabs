/**
 * Pure helpers for building Meilisearch filter strings for ResearchGroup search.
 *
 * Kept in their own module so they can be unit-tested without spinning up
 * Meilisearch, Mongo, or Express.
 */

export type AcceptanceLevelInput = 'verified' | 'verified-or-likely' | 'all';

export type CurrentAvailabilityFilterInput = 'OPEN' | 'ROLLING';

export interface ResearchGroupFilterInput {
  kind?: string[];
  entityType?: string[];
  school?: string[];
  departments?: string[];
  researchAreas?: string[];
  acceptanceLevel?: AcceptanceLevelInput;
  hostsUndergrads?: boolean;
  hasDocumentedWayIn?: boolean;
  currentAvailability?: CurrentAvailabilityFilterInput[];
  studentVisibilityTier?: string[];
}

const escapeMeiliFilterValue = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

const orEqualsClause = (field: string, values: unknown[]): string | null => {
  const cleaned = values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  if (cleaned.length === 0) return null;
  const inner = cleaned.map((v) => `${field} = "${escapeMeiliFilterValue(v)}"`).join(' OR ');
  return `(${inner})`;
};

const acceptanceLevelClauses = (level: AcceptanceLevelInput | undefined): string[] => {
  if (!level || level === 'all') return [];
  if (level === 'verified') {
    return ['accessAcceptanceLevel = "verified"'];
  }
  if (level === 'verified-or-likely') {
    return ['(accessAcceptanceLevel = "verified" OR accessAcceptanceLevel = "likely")'];
  }
  return [];
};

export interface BuildResearchGroupFilterStringOptions {
  /** Omit this field's own clause, so its facet distribution can be computed disjunctively. */
  excludeField?: keyof ResearchGroupFilterInput;
}

/**
 * Build the Meilisearch filter string for a ResearchGroup search request.
 *
 * Always pins `archived = false`. Each provided multi-value filter behaves as
 * an OR within the field, and all fields are AND-ed together.
 */
export function buildResearchGroupFilterString(
  filters: ResearchGroupFilterInput = {},
  options: BuildResearchGroupFilterStringOptions = {},
): string {
  const effectiveFilters: ResearchGroupFilterInput = options.excludeField
    ? { ...filters, [options.excludeField]: undefined }
    : filters;
  const parts: string[] = ['archived = false'];

  const kindClause = effectiveFilters.kind ? orEqualsClause('kind', effectiveFilters.kind) : null;
  if (kindClause) parts.push(kindClause);

  const entityTypeClause = effectiveFilters.entityType
    ? orEqualsClause('entityType', effectiveFilters.entityType)
    : null;
  if (entityTypeClause) parts.push(entityTypeClause);

  // Filter on the multi-valued `schools` field so a cross-school lab matches
  // under every school it belongs to. The request field stays `school`.
  const schoolClause = effectiveFilters.school
    ? orEqualsClause('schools', effectiveFilters.school)
    : null;
  if (schoolClause) parts.push(schoolClause);

  const departmentsClause = effectiveFilters.departments
    ? orEqualsClause('departments', effectiveFilters.departments)
    : null;
  if (departmentsClause) parts.push(departmentsClause);

  const researchAreasClause = effectiveFilters.researchAreas
    ? orEqualsClause('researchAreas', effectiveFilters.researchAreas)
    : null;
  if (researchAreasClause) parts.push(researchAreasClause);

  for (const clause of acceptanceLevelClauses(effectiveFilters.acceptanceLevel)) {
    parts.push(clause);
  }

  if (effectiveFilters.hostsUndergrads === true) {
    parts.push('hasUndergradHostingEvidence = true');
  }

  if (effectiveFilters.hasDocumentedWayIn === true) {
    parts.push('hasDocumentedWayIn = true');
  }

  const currentAvailabilityClause = effectiveFilters.currentAvailability
    ? orEqualsClause('undergraduateCurrentAvailability', effectiveFilters.currentAvailability)
    : null;
  if (currentAvailabilityClause) parts.push(currentAvailabilityClause);

  const studentVisibilityClause = effectiveFilters.studentVisibilityTier
    ? orEqualsClause('studentVisibilityTier', effectiveFilters.studentVisibilityTier)
    : null;
  if (studentVisibilityClause) parts.push(studentVisibilityClause);

  return parts.join(' AND ');
}
