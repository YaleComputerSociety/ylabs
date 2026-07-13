import mongoose from 'mongoose';
import { ContactRoute } from '../models/contactRoute';
import { EntryPathway } from '../models/entryPathway';
import { PostedOpportunity } from '../models/postedOpportunity';
import { serializedDocumentId } from '../utils/idSerialization';
import { publicHttpUrl } from '../utils/urlSafety';
import {
  isApprovedPublicContactRoute,
  isStudentPublishablePathway,
} from './studentAccessPublicationPolicy';

export type PlanningContextCategory =
  | 'open_position'
  | 'official_application'
  | 'reviewed_route'
  | 'qualified_participation';

export interface PublicPlanningContext {
  category: PlanningContextCategory;
  label: string;
  url: string;
}

interface Candidate extends PublicPlanningContext {
  entityId: string;
  stableId: string;
  precedence: number;
}

const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;
const MAX_ENTITY_IDS = 100;
const APPLICATION_PATHWAY_TYPES = new Set(['POSTED_ROLE', 'CENTER_INTERNSHIP', 'STUDENT_JOB']);
const PARTICIPATION_PATHWAY_TYPES = new Set(['RECURRING_PROGRAM']);
const DISALLOWED_ROUTE_TYPES = new Set(['FACULTY_PI', 'UNKNOWN']);
const ACTIONABLE_URL_CUE_RE =
  /(?:^|[^a-z0-9])(?:apply|application|applications|career|careers|internship|internships|job|jobs|opportunities|opportunity|participate|participation|program|programs|register|registration|submit)(?:[^a-z0-9]|$)/i;
const PROVENANCE_ONLY_URL_CUE_RE =
  /(?:^|[^a-z0-9])(?:about|article|articles|bio|bios|directory|directories|faculty|grant|grants|lab|labs|laboratory|laboratories|member|members|news|people|person|persons|profile|profiles|publication|publications|roster|rosters|staff|team|teams)(?:[^a-z0-9]|$)/i;

const entityId = (value: unknown): string | undefined => {
  const id = serializedDocumentId(value);
  return id && OBJECT_ID_RE.test(id) ? id : undefined;
};

const approved = (record: any): boolean => record?.review?.status === 'approved';

const usableUrl = (...values: unknown[]): string | undefined => {
  for (const value of values) {
    const url = publicHttpUrl(value);
    if (url) return url;
  }
  return undefined;
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

const usableActionableUrl = (...values: unknown[]): string | undefined => {
  for (const value of values) {
    const url = actionablePlanningUrl(value);
    if (url) return url;
  }
  return undefined;
};

const hasExplicitInstructions = (pathway: any): boolean =>
  Boolean(String(pathway?.bestNextStep || '').trim() || String(pathway?.explanation || '').trim());

const hasApplicationInstructions = (pathway: any): boolean =>
  /\b(apply|application|register|submit)\b/i.test(
    `${String(pathway?.bestNextStep || '')} ${String(pathway?.explanation || '')}`,
  );

const isCurrentOpportunity = (opportunity: any): boolean => {
  if (!['OPEN', 'ROLLING'].includes(opportunity.status)) return false;
  if (!opportunity.deadline) return true;
  const deadline = new Date(opportunity.deadline);
  return !Number.isNaN(deadline.getTime()) && deadline.getTime() >= Date.now();
};

export function selectPlanningContexts(input: {
  pathways: any[];
  opportunities: any[];
  routes: any[];
}): Map<string, PublicPlanningContext> {
  const pathwaysById = new Map(
    input.pathways.map((pathway) => [serializedDocumentId(pathway._id), pathway]),
  );
  const candidates: Candidate[] = [];

  for (const opportunity of input.opportunities) {
    const pathway = pathwaysById.get(serializedDocumentId(opportunity.entryPathwayId));
    const id = entityId(opportunity.researchEntityId) || entityId(pathway?.researchEntityId);
    const url = usableActionableUrl(opportunity.applicationUrl);
    if (
      !id ||
      !url ||
      opportunity.archived === true ||
      !isCurrentOpportunity(opportunity) ||
      !approved(opportunity) ||
      !pathway ||
      pathway.archived === true ||
      !approved(pathway) ||
      !isStudentPublishablePathway(pathway) ||
      !APPLICATION_PATHWAY_TYPES.has(pathway.pathwayType)
    )
      continue;
    candidates.push({
      entityId: id,
      stableId: serializedDocumentId(opportunity._id) || '',
      precedence: 0,
      category: 'open_position',
      label: 'Open position',
      url: url!,
    });
  }

  for (const pathway of input.pathways) {
    const id = entityId(pathway.researchEntityId);
    const url = usableActionableUrl(
      ...(Array.isArray(pathway.sourceUrls) ? pathway.sourceUrls : []),
    );
    if (
      !id ||
      !url ||
      pathway.archived === true ||
      !approved(pathway) ||
      !isStudentPublishablePathway(pathway) ||
      !hasExplicitInstructions(pathway)
    )
      continue;
    if (APPLICATION_PATHWAY_TYPES.has(pathway.pathwayType) && hasApplicationInstructions(pathway)) {
      candidates.push({
        entityId: id,
        stableId: serializedDocumentId(pathway._id) || '',
        precedence: 1,
        category: 'official_application',
        label: 'Official application',
        url: url!,
      });
    } else if (PARTICIPATION_PATHWAY_TYPES.has(pathway.pathwayType)) {
      candidates.push({
        entityId: id,
        stableId: serializedDocumentId(pathway._id) || '',
        precedence: 3,
        category: 'qualified_participation',
        label: 'Participation instructions',
        url: url!,
      });
    }
  }

  for (const route of input.routes) {
    const id = entityId(route.researchEntityId);
    const url = usableUrl(route.url);
    if (
      !id ||
      !url ||
      route.archived === true ||
      !isApprovedPublicContactRoute(route) ||
      DISALLOWED_ROUTE_TYPES.has(route.routeType)
    )
      continue;
    candidates.push({
      entityId: id,
      stableId: serializedDocumentId(route._id) || '',
      precedence: route.routeType === 'OFFICIAL_APPLICATION' ? 1 : 2,
      category:
        route.routeType === 'OFFICIAL_APPLICATION' ? 'official_application' : 'reviewed_route',
      label:
        route.routeType === 'OFFICIAL_APPLICATION'
          ? 'Official application'
          : 'Official contact route',
      url: url!,
    });
  }

  candidates.sort((a, b) => a.precedence - b.precedence || a.stableId.localeCompare(b.stableId));
  const selected = new Map<string, PublicPlanningContext>();
  for (const {
    entityId: id,
    stableId: _stableId,
    precedence: _precedence,
    ...context
  } of candidates) {
    if (!selected.has(id)) selected.set(id, context);
  }
  return selected;
}

export async function listPlanningContextsForResearchEntities(
  researchEntityIds: Array<string | mongoose.Types.ObjectId>,
): Promise<Map<string, PublicPlanningContext>> {
  const ids = Array.from(
    new Set(researchEntityIds.slice(0, MAX_ENTITY_IDS).flatMap((value) => entityId(value) || [])),
  );
  if (ids.length === 0) return new Map();
  const objectIds = ids.map((id) => new mongoose.Types.ObjectId(id));
  const [pathways, routes] = await Promise.all([
    EntryPathway.find({ researchEntityId: { $in: objectIds }, archived: false }).lean(),
    ContactRoute.find({
      researchEntityId: { $in: objectIds },
      archived: false,
      'review.status': 'approved',
    }).lean(),
  ]);
  const pathwayIds = (pathways as any[]).flatMap((pathway) => {
    const id = entityId(pathway._id);
    return id ? [new mongoose.Types.ObjectId(id)] : [];
  });
  const opportunities = await PostedOpportunity.find({
    $or: [
      { researchEntityId: { $in: objectIds } },
      ...(pathwayIds.length > 0 ? [{ entryPathwayId: { $in: pathwayIds } }] : []),
    ],
    archived: false,
    status: { $in: ['OPEN', 'ROLLING'] },
  }).lean();
  return selectPlanningContexts({
    pathways: pathways as any[],
    opportunities: opportunities as any[],
    routes: routes as any[],
  });
}
