import type { ResearchEntityType } from '../models/researchAccessTypes';

export const CANONICAL_FACULTY_RESEARCH_ENTITY_TYPE: ResearchEntityType = 'FACULTY_RESEARCH_AREA';

export const CANONICAL_FACULTY_RESEARCH_KIND = 'individual';

export const LEGACY_FACULTY_RESEARCH_ENTITY_TYPES = [
  'INDIVIDUAL_RESEARCH',
  'FACULTY_RESEARCH',
] as const;

const LEGACY_SET = new Set<string>(LEGACY_FACULTY_RESEARCH_ENTITY_TYPES);

const INDIVIDUAL_KINDS = new Set(['individual', 'solo']);

export function isLegacyFacultyResearchEntityType(value?: string | null): boolean {
  return typeof value === 'string' && LEGACY_SET.has(value);
}

export function isIndividualResearchKind(value?: string | null): boolean {
  return typeof value === 'string' && INDIVIDUAL_KINDS.has(value);
}

export interface FacultyResearchTypeCandidate {
  id: unknown;
  slug?: string;
  entityType?: string;
  kind?: string;
}

export interface FacultyResearchTypePlanRow {
  id: unknown;
  slug: string;
  from: string;
  to: ResearchEntityType;
  kindFrom?: string;
  kindTo?: string;
}

export function planFacultyResearchTypeConsolidation(
  candidates: FacultyResearchTypeCandidate[],
): FacultyResearchTypePlanRow[] {
  const rows: FacultyResearchTypePlanRow[] = [];
  for (const candidate of candidates) {
    if (!isLegacyFacultyResearchEntityType(candidate.entityType)) continue;
    const row: FacultyResearchTypePlanRow = {
      id: candidate.id,
      slug: String(candidate.slug ?? ''),
      from: String(candidate.entityType),
      to: CANONICAL_FACULTY_RESEARCH_ENTITY_TYPE,
    };
    if (!isIndividualResearchKind(candidate.kind)) {
      row.kindFrom = candidate.kind == null ? '' : String(candidate.kind);
      row.kindTo = CANONICAL_FACULTY_RESEARCH_KIND;
    }
    rows.push(row);
  }
  return rows;
}

export interface FacultyResearchTypeConsolidationSummary {
  scanned: number;
  planned: number;
  kindRealigned: number;
  byFrom: Record<string, number>;
}

export function summarizeFacultyResearchTypeConsolidation(
  scanned: number,
  rows: FacultyResearchTypePlanRow[],
): FacultyResearchTypeConsolidationSummary {
  const byFrom: Record<string, number> = {};
  let kindRealigned = 0;
  for (const row of rows) {
    byFrom[row.from] = (byFrom[row.from] ?? 0) + 1;
    if (row.kindTo) kindRealigned += 1;
  }
  return { scanned, planned: rows.length, kindRealigned, byFrom };
}
