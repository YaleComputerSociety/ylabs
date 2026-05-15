import type { LabDetailPayload } from './labDetail';
import type {
  ResearchEntity as ResearchEntityBacking,
  ResearchGroupSearchFilters,
  ResearchGroupSearchRequest,
  ResearchGroupSearchResponse,
  ResearchGroupSortBy,
  ResearchGroupSortOrder,
} from './researchGroup';

export type ResearchEntity = ResearchEntityBacking;
export type ResearchEntitySearchFilters = ResearchGroupSearchFilters;
export type ResearchEntitySearchRequest = ResearchGroupSearchRequest;
export type ResearchEntitySortBy = ResearchGroupSortBy;
export type ResearchEntitySortOrder = ResearchGroupSortOrder;

export interface ResearchEntitySearchResponse
  extends Omit<ResearchGroupSearchResponse, 'hits' | 'researchEntities'> {
  researchEntities?: ResearchEntity[];
  hits?: ResearchEntity[];
}

export interface NormalizedResearchEntitySearchResponse
  extends Omit<ResearchGroupSearchResponse, 'hits' | 'researchEntities'> {
  researchEntities: ResearchEntity[];
  hits: ResearchEntity[];
}

export interface ResearchEntityDetailPayload
  extends Omit<LabDetailPayload, 'group' | 'researchEntity'> {
  researchEntity: ResearchEntity;
  group?: ResearchEntity;
}

type MaybeResearchEntityDetailPayload =
  Partial<Omit<LabDetailPayload, 'group' | 'researchEntity'>> & {
    researchEntity?: ResearchEntity | null;
    group?: ResearchEntity | null;
  };

export function normalizeResearchEntitySearchResponse(
  response: ResearchEntitySearchResponse,
): NormalizedResearchEntitySearchResponse {
  const researchEntities = Array.isArray(response.researchEntities)
    ? response.researchEntities
    : Array.isArray(response.hits)
      ? response.hits
      : [];

  return {
    ...response,
    hits: researchEntities,
    researchEntities,
    estimatedTotalHits: response.estimatedTotalHits ?? researchEntities.length,
    page: response.page ?? 1,
    pageSize: response.pageSize ?? researchEntities.length,
  };
}

export function normalizeResearchEntityDetailPayload(
  payload: MaybeResearchEntityDetailPayload,
): ResearchEntityDetailPayload {
  const researchEntity = payload.researchEntity || payload.group;
  if (!researchEntity) {
    throw new Error('Research detail payload is missing researchEntity');
  }

  return {
    ...payload,
    researchEntity,
    group: payload.group ?? researchEntity,
    members: payload.members ?? [],
    recentPapers: payload.recentPapers ?? [],
    recentArxivPreprints: payload.recentArxivPreprints ?? [],
    activeListings: payload.activeListings ?? [],
    entryPathways: payload.entryPathways ?? [],
    accessSignals: payload.accessSignals ?? [],
    contactRoutes: payload.contactRoutes ?? [],
    postedOpportunities: payload.postedOpportunities ?? [],
  };
}
