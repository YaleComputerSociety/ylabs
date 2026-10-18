/**
 * Pure helpers for building Meilisearch filter strings for ResearchGroup search.
 *
 * Kept in their own module so they can be unit-tested without spinning up
 * Meilisearch, Mongo, or Express.
 */

export interface ResearchGroupFilterInput {
  kind?: string[];
  entityType?: string[];
  school?: string[];
  departments?: string[];
  researchAreas?: string[];
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

type StudentMultiValueFilterKey =
  'kind' | 'entityType' | 'school' | 'departments' | 'researchAreas';

// The request field `school` filters on the multi-valued `schools` index field,
// so a cross-school lab matches under every school it belongs to.
const STUDENT_MULTI_VALUE_FILTER_FIELDS: ReadonlyArray<{
  filterKey: StudentMultiValueFilterKey;
  indexField: string;
}> = [
  { filterKey: 'kind', indexField: 'kind' },
  { filterKey: 'entityType', indexField: 'entityType' },
  { filterKey: 'school', indexField: 'schools' },
  { filterKey: 'departments', indexField: 'departments' },
  { filterKey: 'researchAreas', indexField: 'researchAreas' },
];

export const HOSTS_UNDERGRADS_INDEX_FIELD = 'hasUndergradHostingEvidence';

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

  for (const { filterKey, indexField } of STUDENT_MULTI_VALUE_FILTER_FIELDS) {
    const values = effectiveFilters[filterKey];
    const clause = values ? orEqualsClause(indexField, values) : null;
    if (clause) parts.push(clause);
  }

  if (effectiveFilters.hostsUndergrads === true) {
    parts.push(`${HOSTS_UNDERGRADS_INDEX_FIELD} = true`);
  }

  const studentVisibilityClause = effectiveFilters.studentVisibilityTier
    ? orEqualsClause('studentVisibilityTier', effectiveFilters.studentVisibilityTier)
    : null;
  if (studentVisibilityClause) parts.push(studentVisibilityClause);

  return parts.join(' AND ');
}

const normalizedFacetValue = (value: string): string => value.trim().toLowerCase();

const candidateFieldValues = (candidate: Record<string, unknown>, indexField: string): string[] => {
  const raw = candidate[indexField];
  const values = Array.isArray(raw) ? raw : [raw];
  return values
    .filter((value): value is string | number | boolean =>
      ['string', 'number', 'boolean'].includes(typeof value),
    )
    .map((value) => String(value))
    .filter((value) => value.trim().length > 0);
};

const activeFilterValues = (values: unknown): Set<string> => {
  if (!Array.isArray(values)) return new Set();
  return new Set(
    values
      .filter((value): value is string => typeof value === 'string')
      .map(normalizedFacetValue)
      .filter((value) => value.length > 0),
  );
};

/**
 * The in-process twin of `buildResearchGroupFilterString` for the student-facing
 * filters, read against an index document. It omits `archived` and
 * `studentVisibilityTier`, which the candidate pool query already pins, and it
 * compares case-insensitively as Meilisearch filters do.
 */
export function candidateMatchesStudentFilters(
  candidate: Record<string, unknown>,
  filters: ResearchGroupFilterInput,
  options: BuildResearchGroupFilterStringOptions = {},
): boolean {
  for (const { filterKey, indexField } of STUDENT_MULTI_VALUE_FILTER_FIELDS) {
    if (filterKey === options.excludeField) continue;
    const wanted = activeFilterValues(filters[filterKey]);
    if (wanted.size === 0) continue;
    const held = candidateFieldValues(candidate, indexField).map(normalizedFacetValue);
    if (!held.some((value) => wanted.has(value))) return false;
  }
  if (options.excludeField !== 'hostsUndergrads' && filters.hostsUndergrads === true) {
    if (candidate[HOSTS_UNDERGRADS_INDEX_FIELD] !== true) return false;
  }
  return true;
}

export const visibilityScopeOnly = (filters: ResearchGroupFilterInput): ResearchGroupFilterInput =>
  filters.studentVisibilityTier ? { studentVisibilityTier: filters.studentVisibilityTier } : {};

/**
 * A facet distribution tallied over the same candidate rows the results are
 * drawn from, so an option's count is the number of results applying it returns.
 * Each facet is disjunctive: its population drops only its own filter clause.
 */
export function tallyCandidateFacetDistribution(
  candidates: ReadonlyArray<Record<string, unknown>>,
  filters: ResearchGroupFilterInput,
  facets: ReadonlyArray<{ filterKey: keyof ResearchGroupFilterInput; indexField: string }>,
): Record<string, Record<string, number>> {
  const distribution: Record<string, Record<string, number>> = {};
  for (const { filterKey, indexField } of facets) {
    const labelByKey = new Map<string, string>();
    const counts = new Map<string, number>();
    for (const candidate of candidates) {
      if (!candidateMatchesStudentFilters(candidate, filters, { excludeField: filterKey })) {
        continue;
      }
      const seen = new Set<string>();
      for (const value of candidateFieldValues(candidate, indexField)) {
        const key = normalizedFacetValue(value);
        if (seen.has(key)) continue;
        seen.add(key);
        if (!labelByKey.has(key)) labelByKey.set(key, value);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    distribution[indexField] = Object.fromEntries(
      [...counts.entries()].map(([key, count]) => [labelByKey.get(key) as string, count]),
    );
  }
  return distribution;
}
