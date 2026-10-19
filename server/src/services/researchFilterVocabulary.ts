import { ResearchEntity } from '../models/researchEntity';
import { sanitizeLogValue } from '../utils/logSanitizer';
import type { ResearchGroupFilterInput } from './researchGroupFilters';

export const RESEARCH_FILTER_VOCABULARY_TTL_MS = 5 * 60 * 1000;

const VOCABULARY_FIELDS = [
  { filterKey: 'school', storedField: 'schools' },
  { filterKey: 'departments', storedField: 'departments' },
] as const;

type VocabularyFilterKey = (typeof VOCABULARY_FIELDS)[number]['filterKey'];

export type ResearchFilterVocabulary = Record<VocabularyFilterKey, ReadonlyMap<string, string>>;

export type AppliedStudentFilters = Partial<Record<VocabularyFilterKey, string[]>>;

const vocabularyKey = (value: string): string => value.trim().toLowerCase();

const cachedVocabularies = new Map<
  string,
  { expiresAt: number; vocabulary: Promise<ResearchFilterVocabulary | null> }
>();

export const clearResearchFilterVocabularyCache = (): void => cachedVocabularies.clear();

const canonicalValuesByKey = (values: unknown[]): ReadonlyMap<string, string> => {
  const byKey = new Map<string, string>();
  for (const value of values) {
    if (typeof value !== 'string' || value.trim().length === 0) continue;
    const key = vocabularyKey(value);
    if (!byKey.has(key)) byKey.set(key, value);
  }
  return byKey;
};

const readVocabulary = async (
  scope: Record<string, unknown>,
): Promise<ResearchFilterVocabulary | null> => {
  try {
    const [schools, departments] = await Promise.all(
      VOCABULARY_FIELDS.map(({ storedField }) => ResearchEntity.distinct(storedField, scope)),
    );
    return {
      school: canonicalValuesByKey(schools),
      departments: canonicalValuesByKey(departments),
    };
  } catch (error) {
    console.error(
      'Research filter vocabulary read failed; filters apply unchanged:',
      sanitizeLogValue(error),
    );
    return null;
  }
};

const readResearchFilterVocabulary = (
  scope: Record<string, unknown>,
): Promise<ResearchFilterVocabulary | null> => {
  const now = Date.now();
  const key = JSON.stringify(scope);
  const cached = cachedVocabularies.get(key);
  if (cached && cached.expiresAt > now) return cached.vocabulary;
  const vocabulary = readVocabulary(scope);
  cachedVocabularies.set(key, { expiresAt: now + RESEARCH_FILTER_VOCABULARY_TTL_MS, vocabulary });
  void vocabulary.then((read) => {
    if (read === null) cachedVocabularies.delete(key);
  });
  return vocabulary;
};

/**
 * Maps each school and department filter value to the spelling the corpus holds and
 * drops a value no row in scope holds, so a hand-edited or stale link narrows to what
 * the filter rail could have offered instead of answering an empty "coverage gap".
 * `applied` is set only when a value changed, and names the values actually searched.
 */
export function resolveStudentFilterValues(
  filters: ResearchGroupFilterInput,
  vocabulary: ResearchFilterVocabulary | null,
): { filters: ResearchGroupFilterInput; applied?: AppliedStudentFilters } {
  if (!vocabulary) return { filters };
  let changed = false;
  const resolved: ResearchGroupFilterInput = { ...filters };
  const applied: AppliedStudentFilters = {};
  for (const { filterKey } of VOCABULARY_FIELDS) {
    const requested = filters[filterKey];
    if (!Array.isArray(requested) || requested.length === 0) continue;
    const canonical = requested.flatMap((value) => {
      const match =
        typeof value === 'string' ? vocabulary[filterKey].get(vocabularyKey(value)) : undefined;
      return match === undefined ? [] : [match];
    });
    const deduplicated = [...new Set(canonical)];
    if (
      deduplicated.length !== requested.length ||
      deduplicated.some((value, index) => value !== requested[index])
    ) {
      changed = true;
    }
    resolved[filterKey] = deduplicated.length > 0 ? deduplicated : undefined;
    applied[filterKey] = deduplicated;
  }
  return changed ? { filters: resolved, applied } : { filters };
}

export async function resolveStudentFilterValuesInScope(
  filters: ResearchGroupFilterInput,
  scope: Record<string, unknown>,
): Promise<ReturnType<typeof resolveStudentFilterValues>> {
  return resolveStudentFilterValues(filters, await readResearchFilterVocabulary(scope));
}
