export const RETIRED_PROGRAM_ENTITY_TYPE = 'PROGRAM';

export type ProgramFellowshipMatchKey = 'sourceKey' | 'title';

export interface ProgramResearchEntityCandidate {
  id: string;
  slug?: string;
  name?: string;
  archived?: boolean;
  fellowshipMatchKey?: ProgramFellowshipMatchKey;
  signalCount?: number;
}

export interface RetireProgramResearchEntityRow {
  id: string;
  slug?: string;
  name?: string;
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

  for (const candidate of input.candidates) {
    const hasFellowship = Boolean(candidate.fellowshipMatchKey);
    const isArchived = candidate.archived === true;
    const row: RetireProgramResearchEntityRow = {
      id: candidate.id,
      ...(candidate.slug ? { slug: candidate.slug } : {}),
      ...(candidate.name ? { name: candidate.name } : {}),
      alreadyArchived: isArchived,
      hasFellowship,
      ...(candidate.fellowshipMatchKey ? { fellowshipMatchKey: candidate.fellowshipMatchKey } : {}),
      signalCount: candidate.signalCount ?? 0,
    };
    rows.push(row);

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
    toArchive,
    rows,
  };
}
