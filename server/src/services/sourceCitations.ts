const nonBlankUrls = (values: unknown[]): string[] =>
  values.filter((url): url is string => typeof url === 'string' && url.trim() !== '');

/**
 * Every citation an entity carries: its `sourceUrls` plus each `fieldProvenance.*.sourceUrl`,
 * deduplicated. `hasLiveSourceCitation` and the last-citation write guard read this one union,
 * so a writer can never disagree with the visibility gate about what a row cites.
 */
export function citationUrlsOf(entity: {
  sourceUrls?: unknown;
  fieldProvenance?: unknown;
}): string[] {
  const stored = Array.isArray(entity.sourceUrls) ? nonBlankUrls(entity.sourceUrls) : [];
  const provenance =
    entity.fieldProvenance && typeof entity.fieldProvenance === 'object'
      ? nonBlankUrls(
          Object.values(entity.fieldProvenance as Record<string, unknown>).map((record) =>
            record && typeof record === 'object'
              ? (record as { sourceUrl?: unknown }).sourceUrl
              : undefined,
          ),
        )
      : [];
  return [...new Set([...stored, ...provenance])];
}
