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
  openness?: string[];
  acceptingUndergrads?: boolean;
  /**
   * Trust gradient filter:
   *   - 'verified' → `acceptingUndergrads = true AND acceptanceConfidence >= 0.7`
   *   - 'verified-or-likely' → ANY of:
   *       acceptingUndergrads = true,
   *       offersIndependentStudy = true,
   *       (we approximate "current undergrads listed" via
   *        currentUndergradCount > 0 — Meili does not expose array length so
   *        the past-advisees check uses pastUndergradAdviseesCount instead.
   *        For now we conservatively OR over the booleans + the explicit
   *        currentUndergradCount field; lab-microsite agreements still surface
   *        through acceptingUndergrads = true.)
   *   - 'all' or undefined → no filter
   */
  acceptanceLevel?: AcceptanceLevelInput;
}

const VERIFIED_CONFIDENCE_FLOOR = 0.7;

const escapeMeiliFilterValue = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

const orEqualsClause = (field: string, values: string[]): string | null => {
  const cleaned = values.map((v) => v.trim()).filter((v) => v.length > 0);
  if (cleaned.length === 0) return null;
  const inner = cleaned.map((v) => `${field} = "${escapeMeiliFilterValue(v)}"`).join(' OR ');
  return `(${inner})`;
};

/**
 * Build the ANDed clause(s) representing an `acceptanceLevel` choice. Returns
 * an array because the OR group for 'verified-or-likely' is one clause that
 * gets AND-ed with the rest.
 */
const acceptanceLevelClauses = (level: AcceptanceLevelInput | undefined): string[] => {
  if (!level || level === 'all') return [];
  if (level === 'verified') {
    return [
      `(acceptingUndergrads = true AND acceptanceConfidence >= ${VERIFIED_CONFIDENCE_FLOOR})`,
    ];
  }
  if (level === 'verified-or-likely') {
    // Any positive signal qualifies. We can't easily express "array length > 0"
    // for `pastUndergradAdvisees`, so we rely on the denormalized scalar
    // signals: the boolean acceptingUndergrads (set by lab pages or PIs),
    // the boolean offersIndependentStudy, and the scalar currentUndergradCount.
    return [
      '(acceptingUndergrads = true OR offersIndependentStudy = true OR currentUndergradCount > 0)',
    ];
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

  const schoolClause = filters.school ? orEqualsClause('school', filters.school) : null;
  if (schoolClause) parts.push(schoolClause);

  const departmentsClause = filters.departments
    ? orEqualsClause('departments', filters.departments)
    : null;
  if (departmentsClause) parts.push(departmentsClause);

  const researchAreasClause = filters.researchAreas
    ? orEqualsClause('researchAreas', filters.researchAreas)
    : null;
  if (researchAreasClause) parts.push(researchAreasClause);

  const opennessClause = filters.openness ? orEqualsClause('openness', filters.openness) : null;
  if (opennessClause) parts.push(opennessClause);

  if (typeof filters.acceptingUndergrads === 'boolean') {
    parts.push(`acceptingUndergrads = ${filters.acceptingUndergrads}`);
  }

  for (const clause of acceptanceLevelClauses(filters.acceptanceLevel)) {
    parts.push(clause);
  }

  return parts.join(' AND ');
}
