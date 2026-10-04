export const SERVED_FACET_SNAPSHOT_MIN_RESEARCH_AREA_ROWS = 3;

export interface ServedFacetSnapshot {
  readonly capturedOn: string;
  readonly servedRowCount: number;
  readonly minResearchAreaRows: number;
  readonly researchAreas: Readonly<Record<string, number>>;
  readonly departments: Readonly<Record<string, number>>;
}

export interface ServedFacetDocument {
  readonly researchAreas?: unknown;
  readonly departments?: unknown;
}

const stringValues = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
    : [];

const countValues = (documents: readonly ServedFacetDocument[], field: keyof ServedFacetDocument) => {
  const counts = new Map<string, number>();
  for (const document of documents) {
    for (const value of new Set(stringValues(document[field]))) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return counts;
};

const sortedRecord = (counts: Map<string, number>, minRows: number): Record<string, number> =>
  Object.fromEntries(
    [...counts.entries()]
      .filter(([, count]) => count >= minRows)
      .sort(([left], [right]) => left.localeCompare(right)),
  );

export function buildServedFacetSnapshot(
  documents: readonly ServedFacetDocument[],
  capturedOn: string,
  minResearchAreaRows = SERVED_FACET_SNAPSHOT_MIN_RESEARCH_AREA_ROWS,
): ServedFacetSnapshot {
  return {
    capturedOn,
    servedRowCount: documents.length,
    minResearchAreaRows,
    researchAreas: sortedRecord(countValues(documents, 'researchAreas'), minResearchAreaRows),
    departments: sortedRecord(countValues(documents, 'departments'), 1),
  };
}
