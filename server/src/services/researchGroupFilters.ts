/**
 * Pure helpers for building Meilisearch filter strings for ResearchGroup search.
 *
 * Kept in their own module so they can be unit-tested without spinning up
 * Meilisearch, Mongo, or Express.
 */

export type AcceptanceLevelInput = 'verified' | 'verified-or-likely' | 'all';

export interface ResearchGroupFilterInput {
  kind?: string[];
  school?: string[];
  departments?: string[];
  researchAreas?: string[];
  acceptanceLevel?: AcceptanceLevelInput;
  hostsUndergrads?: boolean;
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

/**
 * Build the Meilisearch filter string for a ResearchGroup search request.
 *
 * Always pins `archived = false`. Each provided multi-value filter behaves as
 * an OR within the field, and all fields are AND-ed together.
 */
export function buildResearchGroupFilterString(filters: ResearchGroupFilterInput = {}): string {
  const parts: string[] = ['archived = false'];

  const kindClause = filters.kind ? orEqualsClause('kind', filters.kind) : null;
  if (kindClause) parts.push(kindClause);

  // Filter on the multi-valued `schools` field so a cross-school lab matches
  // under every school it belongs to. The request field stays `school`.
  const schoolClause = filters.school ? orEqualsClause('schools', filters.school) : null;
  if (schoolClause) parts.push(schoolClause);

  const departmentsClause = filters.departments
    ? orEqualsClause('departments', filters.departments)
    : null;
  if (departmentsClause) parts.push(departmentsClause);

  const researchAreasClause = filters.researchAreas
    ? orEqualsClause('researchAreas', filters.researchAreas)
    : null;
  if (researchAreasClause) parts.push(researchAreasClause);

  for (const clause of acceptanceLevelClauses(filters.acceptanceLevel)) {
    parts.push(clause);
  }

  if (filters.hostsUndergrads === true) {
    parts.push('hasUndergradHostingEvidence = true');
  }

  const studentVisibilityClause = filters.studentVisibilityTier
    ? orEqualsClause('studentVisibilityTier', filters.studentVisibilityTier)
    : null;
  if (studentVisibilityClause) parts.push(studentVisibilityClause);

  return parts.join(' AND ');
}
