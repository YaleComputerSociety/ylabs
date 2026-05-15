import { Request, Response } from 'express';
import {
  pathwayBestNextStepCategories,
  searchPathways,
  type PathwayBestNextStepCategory,
  type PathwaySearchFilters,
  type PathwaySearchSort,
} from '../services/pathwaySearchService';
import { searchPathwaysViaMeili } from '../services/pathwaySearchIndexService';
import {
  compensationTypes,
  entryPathwayStatuses,
  entryPathwayTypes,
  evidenceStrengths,
  researchEntityTypes,
  type CompensationType,
  type EntryPathwayStatus,
  type EntryPathwayType,
  type EvidenceStrength,
  type ResearchEntityType,
} from '../models/researchAccessTypes';

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 24;

const ALLOWED_SORT_FIELDS: NonNullable<PathwaySearchSort['sortBy']>[] = [
  'relevance',
  'confidence',
  'lastObservedAt',
  'deadline',
  'createdAt',
];

const toStringArray = (value: unknown): string[] | undefined => {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) {
    const values = value
      .map((v) => (typeof v === 'string' ? v : String(v)))
      .map((v) => v.trim())
      .filter(Boolean);
    return values.length > 0 ? values : undefined;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return [value.trim()];
  }
  return undefined;
};

const filterAllowed = <T extends string>(
  values: string[] | undefined,
  allowed: readonly T[],
): T[] | undefined => {
  if (!values) return undefined;
  const allowedSet = new Set<string>(allowed);
  const filtered = values.filter((value): value is T => allowedSet.has(value));
  return filtered.length > 0 ? filtered : undefined;
};

const parseFilters = (raw: unknown): PathwaySearchFilters => {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const filters: PathwaySearchFilters = {};

  const pathwayType = filterAllowed<EntryPathwayType>(
    toStringArray(r.pathwayType),
    entryPathwayTypes,
  );
  if (pathwayType) filters.pathwayType = pathwayType;

  const compensation = filterAllowed<CompensationType>(
    toStringArray(r.compensation),
    compensationTypes,
  );
  if (compensation) filters.compensation = compensation;

  const status = filterAllowed<EntryPathwayStatus>(
    toStringArray(r.status),
    entryPathwayStatuses,
  );
  if (status) filters.status = status;

  const evidenceStrength = filterAllowed<EvidenceStrength>(
    toStringArray(r.evidenceStrength),
    evidenceStrengths,
  );
  if (evidenceStrength) filters.evidenceStrength = evidenceStrength;

  const entityType = filterAllowed<ResearchEntityType>(
    toStringArray(r.entityType),
    researchEntityTypes,
  );
  if (entityType) filters.entityType = entityType;

  const departments = toStringArray(r.departments);
  if (departments) filters.departments = departments;

  const researchAreas = toStringArray(r.researchAreas);
  if (researchAreas) filters.researchAreas = researchAreas;

  if (typeof r.hasActivePostedOpportunity === 'boolean') {
    filters.hasActivePostedOpportunity = r.hasActivePostedOpportunity;
  }

  const bestNextStepCategory = filterAllowed<PathwayBestNextStepCategory>(
    toStringArray(r.bestNextStepCategory),
    pathwayBestNextStepCategories,
  );
  if (bestNextStepCategory) filters.bestNextStepCategory = bestNextStepCategory;

  return filters;
};

export const searchPathwayResults = async (request: Request, response: Response) => {
  try {
    const body = (request.body || {}) as {
      q?: string;
      page?: number;
      pageSize?: number;
      filters?: unknown;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
    };

    const q = typeof body.q === 'string' ? body.q : '';
    const page = Number.isFinite(Number(body.page)) ? Number(body.page) : 1;
    const requestedPageSize = Number.isFinite(Number(body.pageSize))
      ? Number(body.pageSize)
      : DEFAULT_PAGE_SIZE;
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, requestedPageSize));
    const filters = parseFilters(body.filters);

    const sort: PathwaySearchSort = {};
    if (
      typeof body.sortBy === 'string' &&
      ALLOWED_SORT_FIELDS.includes(body.sortBy as NonNullable<PathwaySearchSort['sortBy']>)
    ) {
      sort.sortBy = body.sortBy as NonNullable<PathwaySearchSort['sortBy']>;
      sort.sortOrder = body.sortOrder === 'asc' ? 'asc' : 'desc';
    }

    const searchInput = {
      q,
      page,
      pageSize,
      filters,
      sort,
    };
    const result =
      process.env.PATHWAY_SEARCH_BACKEND === 'meili'
        ? await searchPathwaysViaMeili(searchInput)
        : await searchPathways(searchInput);

    return response.json(result);
  } catch (error) {
    console.error('Pathway search failed:', error);
    return response.status(500).json({ error: 'Search failed' });
  }
};
