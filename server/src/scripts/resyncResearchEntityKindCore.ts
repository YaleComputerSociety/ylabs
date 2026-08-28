import {
  mapEntityTypeToResearchGroupKind,
  researchEntityTypes,
  type ResearchGroupKind,
} from '../models/researchAccessTypes';

export interface ResearchEntityKindCandidate {
  id: unknown;
  slug?: string;
  entityType?: string;
  kind?: string;
}

export interface ResearchEntityKindPlanRow {
  id: unknown;
  slug: string;
  entityType: string;
  kindFrom: string;
  kindTo: ResearchGroupKind;
}

function hasResearchEntityType(value?: string): value is string {
  return typeof value === 'string' && researchEntityTypes.includes(value as never);
}

export function planResearchEntityKindResync(
  candidates: ResearchEntityKindCandidate[],
): ResearchEntityKindPlanRow[] {
  const rows: ResearchEntityKindPlanRow[] = [];
  for (const candidate of candidates) {
    if (!hasResearchEntityType(candidate.entityType)) continue;
    const kindTo = mapEntityTypeToResearchGroupKind(candidate.entityType);
    const kindFrom = candidate.kind == null ? '' : String(candidate.kind);
    if (kindFrom === kindTo) continue;
    rows.push({
      id: candidate.id,
      slug: String(candidate.slug ?? ''),
      entityType: candidate.entityType,
      kindFrom,
      kindTo,
    });
  }
  return rows;
}

export interface ResearchEntityKindResyncSummary {
  scanned: number;
  planned: number;
  byEntityType: Record<string, number>;
}

export function summarizeResearchEntityKindResync(
  scanned: number,
  rows: ResearchEntityKindPlanRow[],
): ResearchEntityKindResyncSummary {
  const byEntityType: Record<string, number> = {};
  for (const row of rows) {
    byEntityType[row.entityType] = (byEntityType[row.entityType] ?? 0) + 1;
  }
  return { scanned, planned: rows.length, byEntityType };
}
