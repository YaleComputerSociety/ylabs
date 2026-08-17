export const OFFICIAL_PROFILE_DISCOVERED_VIA = 'OFFICIAL_PROFILE';

export const RETIRED_COLLECTIONS = ['papers', 'paper_authors'] as const;

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

export interface ScholarlyLinkCounts {
  officialProfile: number;
  nonOfficial: number;
}

export interface RetireBibliographicMirrorInvariantInput {
  officialProfileLinksBefore: number;
  officialProfileLinksAfter: number;
  nonOfficialLinksAfter: number;
}

export function assertRetireBibliographicMirrorInvariants(
  input: RetireBibliographicMirrorInvariantInput,
): void {
  if (input.officialProfileLinksAfter !== input.officialProfileLinksBefore) {
    throw new Error(
      `retire:bibliographic-mirror invariant violated: OFFICIAL_PROFILE scholarly links changed from ${input.officialProfileLinksBefore} to ${input.officialProfileLinksAfter}.`,
    );
  }
  if (input.nonOfficialLinksAfter !== 0) {
    throw new Error(
      `retire:bibliographic-mirror invariant violated: ${input.nonOfficialLinksAfter} non-OFFICIAL_PROFILE scholarly links remain after apply.`,
    );
  }
}
