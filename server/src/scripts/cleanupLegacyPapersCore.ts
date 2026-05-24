export interface CleanupLegacyPapersArgs {
  apply: boolean;
  confirmDropLegacyPapers: boolean;
}

export interface LegacyCollectionState {
  exists: boolean;
  count: number;
}

export interface LegacyPaperCleanupState {
  legacyCollections: {
    papers: LegacyCollectionState;
    paper_authors: LegacyCollectionState;
    paper_entity_links: LegacyCollectionState;
  };
  scholarlyLinks: {
    total: number;
    userLinked: number;
    entityLinked: number;
  };
  legacyAnchors: {
    usersWithLegacyPaperEvidence: number;
    ambiguousUsersSkipped: number;
    usersMissingScholarlyLinks: number;
    researchEntitiesWithLegacyPaperEvidence: number;
    researchEntitiesMissingScholarlyLinks: number;
  };
}

export interface LegacyPaperCleanupReadiness {
  ready: boolean;
  blockers: string[];
}

export function parseCleanupLegacyPapersArgs(argv: string[]): CleanupLegacyPapersArgs {
  return {
    apply: argv.includes('--apply'),
    confirmDropLegacyPapers: argv.includes('--confirm-drop-legacy-papers'),
  };
}

function hasLegacyPaperData(state: LegacyPaperCleanupState): boolean {
  return Object.values(state.legacyCollections).some((collection) => collection.count > 0);
}

export function buildLegacyPaperCleanupReadiness(
  state: LegacyPaperCleanupState,
): LegacyPaperCleanupReadiness {
  const blockers: string[] = [];

  if (!hasLegacyPaperData(state)) {
    return { ready: true, blockers };
  }

  if (state.scholarlyLinks.total === 0) {
    blockers.push('No compact scholarly links exist yet.');
  }

  if (state.legacyAnchors.usersMissingScholarlyLinks > 0) {
    blockers.push(
      `${state.legacyAnchors.usersMissingScholarlyLinks} legacy user paper anchor(s) do not have compact scholarly links.`,
    );
  }

  if (state.legacyAnchors.researchEntitiesMissingScholarlyLinks > 0) {
    blockers.push(
      `${state.legacyAnchors.researchEntitiesMissingScholarlyLinks} legacy research-entity paper anchor(s) do not have compact scholarly links.`,
    );
  }

  return {
    ready: blockers.length === 0,
    blockers,
  };
}
