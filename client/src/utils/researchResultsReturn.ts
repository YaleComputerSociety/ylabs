export interface ResearchResultsReturn {
  search: string;
  depth: number;
}

interface ResearchResultsReturnState {
  researchResultsReturn: ResearchResultsReturn;
}

const isResearchResultsReturn = (value: unknown): value is ResearchResultsReturn => {
  const candidate = value as Partial<ResearchResultsReturn> | null;
  return (
    typeof candidate?.search === 'string' &&
    (candidate.search === '' || candidate.search.startsWith('?')) &&
    Number.isInteger(candidate.depth) &&
    (candidate.depth ?? 0) >= 1
  );
};

export const readResearchResultsReturn = (state: unknown): ResearchResultsReturn | null => {
  const value = (state as { researchResultsReturn?: unknown } | null)?.researchResultsReturn;
  return isResearchResultsReturn(value) ? value : null;
};

export const researchResultsReturnState = (search: string): ResearchResultsReturnState => ({
  researchResultsReturn: { search, depth: 1 },
});

export const deeperResearchResultsReturnState = (
  state: unknown,
): Partial<ResearchResultsReturnState> => {
  const current = readResearchResultsReturn(state);
  return current
    ? { researchResultsReturn: { search: current.search, depth: current.depth + 1 } }
    : {};
};

export const researchResultsHref = (resultsReturn: ResearchResultsReturn | null): string =>
  `/research${resultsReturn?.search ?? ''}`;

const openedResultSlugByHistoryEntry = new Map<string, string>();

export const rememberOpenedResearchResult = (historyEntryKey: string, slug: string): void => {
  openedResultSlugByHistoryEntry.set(historyEntryKey, slug);
};

export const openedResearchResultFor = (historyEntryKey: string): string | undefined =>
  openedResultSlugByHistoryEntry.get(historyEntryKey);

export const forgetOpenedResearchResults = (): void => {
  openedResultSlugByHistoryEntry.clear();
};

export const RESEARCH_RESULT_LINK_ATTRIBUTE = 'data-research-result-slug';
