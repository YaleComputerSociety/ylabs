export const RETIRED_COLLECTIONS = [
  'papers',
  'paper_authors',
  'research_scholarly_links',
  'research_scholarly_attributions',
] as const;

export const RETIRED_USER_FIELDS = [
  'publications',
  'hIndex',
  'openAlexId',
  'semanticScholarId',
  'openAlexWorksSyncedAt',
  'orcidWorksSyncedAt',
  'europePmcWorksSyncedAt',
  'pubmedWorksSyncedAt',
] as const;

export const RETIRED_RESEARCH_ENTITY_FIELDS = [
  'recentPaperCount',
  'activePaperCount2yCache',
  'featuredPaperIds',
  'lastPaperAtCache',
] as const;

export interface RetireBibliographicMirrorInvariantInput {
  remainingByCollection: Record<string, number>;
}

export function assertRetireBibliographicMirrorInvariants(
  input: RetireBibliographicMirrorInvariantInput,
): void {
  const survivors = Object.entries(input.remainingByCollection)
    .filter(([, remaining]) => remaining !== 0)
    .map(([name, remaining]) => `${name}=${remaining}`);

  if (survivors.length > 0) {
    throw new Error(
      `retire:bibliographic-mirror invariant violated: rows remain after apply (${survivors.join(', ')}).`,
    );
  }

  const missing = RETIRED_COLLECTIONS.filter(
    (name) => !Object.hasOwn(input.remainingByCollection, name),
  );
  if (missing.length > 0) {
    throw new Error(
      `retire:bibliographic-mirror invariant violated: no post-apply count reported for ${missing.join(', ')}.`,
    );
  }
}
