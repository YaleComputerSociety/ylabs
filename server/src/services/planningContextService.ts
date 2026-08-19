import mongoose from 'mongoose';
import { serializedDocumentId } from '../utils/idSerialization';
import { publicHttpUrl } from '../utils/urlSafety';

export const PLANNING_CONTEXT_CATEGORIES = [
  'open_position',
  'official_application',
  'reviewed_route',
  'qualified_participation',
] as const;

export type PlanningContextCategory = (typeof PLANNING_CONTEXT_CATEGORIES)[number];

export interface PublicPlanningContext {
  category: PlanningContextCategory;
  label: string;
  url: string;
}

const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;
const MAX_ENTITY_IDS = 100;
const ACTIONABLE_URL_CUE_RE =
  /(?:^|[^a-z0-9])(?:apply|application|applications|career|careers|internship|internships|job|jobs|opportunities|opportunity|participate|participation|program|programs|register|registration|submit)(?:[^a-z0-9]|$)/i;
const PROVENANCE_ONLY_URL_CUE_RE =
  /(?:^|[^a-z0-9])(?:about|article|articles|bio|bios|directory|directories|faculty|grant|grants|lab|labs|laboratory|laboratories|member|members|news|people|person|persons|profile|profiles|publication|publications|roster|rosters|staff|team|teams)(?:[^a-z0-9]|$)/i;

const entityId = (value: unknown): string | undefined => {
  const id = serializedDocumentId(value);
  return id && OBJECT_ID_RE.test(id) ? id : undefined;
};

export const actionablePlanningUrl = (value: unknown): string | undefined => {
  const url = publicHttpUrl(value);
  if (!url) return undefined;
  const parsed = new URL(url);
  let destination: string;
  try {
    destination = decodeURIComponent(parsed.pathname);
  } catch {
    return undefined;
  }
  if (PROVENANCE_ONLY_URL_CUE_RE.test(destination)) return undefined;
  return ACTIONABLE_URL_CUE_RE.test(destination) ? url : undefined;
};

export async function listPlanningContextsForResearchEntities(
  researchEntityIds: Array<string | mongoose.Types.ObjectId>,
): Promise<Map<string, PublicPlanningContext>> {
  const ids = Array.from(
    new Set(researchEntityIds.slice(0, MAX_ENTITY_IDS).flatMap((value) => entityId(value) || [])),
  );
  if (ids.length === 0) return new Map();
  return new Map();
}
