export const RETIRED_PROGRAM_ENTITY_TYPE = 'PROGRAM';

/**
 * Every `entityType` value that has been retired from `researchEntityTypes` and
 * whose surviving rows must be archived out of the student corpus.
 *
 * `PROGRAM` predates the enum (#1948). The five dead-end types were retired in
 * #2202 after measurement showed they published 157 student-ready pages with no
 * lead, no roster, no affiliated-lab edge, and no contact email.
 */
export const RETIRED_RESEARCH_ENTITY_TYPES = [
  RETIRED_PROGRAM_ENTITY_TYPE,
  'COLLECTIONS_INITIATIVE',
  'ARCHIVE_OR_MUSEUM_PROJECT',
  'DIGITAL_HUMANITIES_PROJECT',
  'COURSE_SEQUENCE',
  'GROUP',
] as const;

export type ProgramFellowshipMatchKey = 'sourceKey' | 'title';

export interface ProgramResearchEntityCandidate {
  id: string;
  slug?: string;
  name?: string;
  entityType?: string;
  archived?: boolean;
  fellowshipMatchKey?: ProgramFellowshipMatchKey;
  signalCount?: number;
}

export interface RetireProgramResearchEntityRow {
  id: string;
  slug?: string;
  name?: string;
  entityType?: string;
  alreadyArchived: boolean;
  hasFellowship: boolean;
  fellowshipMatchKey?: ProgramFellowshipMatchKey;
  signalCount: number;
}

export interface RetireProgramResearchEntitiesPlan {
  scanned: number;
  alreadyArchived: number;
  toArchiveCount: number;
  withFellowship: number;
  withoutFellowship: number;
  byEntityType: Record<string, number>;
  toArchive: string[];
  rows: RetireProgramResearchEntityRow[];
}

export function normalizeFellowshipTitle(value: string | undefined): string {
  return (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function buildRetireProgramResearchEntitiesPlan(input: {
  candidates: ProgramResearchEntityCandidate[];
}): RetireProgramResearchEntitiesPlan {
  const rows: RetireProgramResearchEntityRow[] = [];
  const toArchive: string[] = [];
  let alreadyArchived = 0;
  let withFellowship = 0;
  let withoutFellowship = 0;
  const byEntityType: Record<string, number> = {};

  for (const candidate of input.candidates) {
    const hasFellowship = Boolean(candidate.fellowshipMatchKey);
    const isArchived = candidate.archived === true;
    const row: RetireProgramResearchEntityRow = {
      id: candidate.id,
      ...(candidate.slug ? { slug: candidate.slug } : {}),
      ...(candidate.name ? { name: candidate.name } : {}),
      ...(candidate.entityType ? { entityType: candidate.entityType } : {}),
      alreadyArchived: isArchived,
      hasFellowship,
      ...(candidate.fellowshipMatchKey ? { fellowshipMatchKey: candidate.fellowshipMatchKey } : {}),
      signalCount: candidate.signalCount ?? 0,
    };
    rows.push(row);

    if (candidate.entityType) {
      byEntityType[candidate.entityType] = (byEntityType[candidate.entityType] || 0) + 1;
    }

    if (hasFellowship) withFellowship += 1;
    else withoutFellowship += 1;

    if (isArchived) {
      alreadyArchived += 1;
      continue;
    }
    toArchive.push(candidate.id);
  }

  return {
    scanned: input.candidates.length,
    alreadyArchived,
    toArchiveCount: toArchive.length,
    withFellowship,
    withoutFellowship,
    byEntityType,
    toArchive,
    rows,
  };
}
