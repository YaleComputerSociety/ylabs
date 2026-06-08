import { Request, Response } from 'express';
import {
  CompensationTypes,
  EntryPathwayStatuses,
  EntryPathwayTypes,
  EvidenceStrengths,
  ResearchEntityTypes,
} from '../models/researchAccessTypes';
import {
  pathwayBestNextStepCategories,
  searchPathways,
  type PathwaySearchFilters,
  type PathwaySearchInput,
  type PathwaySearchSort,
} from '../services/pathwaySearchService';
import { searchPathwaysViaMeili } from '../services/pathwaySearchIndexService';

const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 100;
const MAX_PAGE = 1000;
const MAX_SEARCH_QUERY_LENGTH = 512;
const MAX_FILTER_VALUES = 50;
const MAX_FILTER_VALUE_LENGTH = 120;
const SEARCH_FILTER_KEYS = [
  'pathwayIds',
  'entityIds',
  'pathwayType',
  'compensation',
  'status',
  'evidenceStrength',
  'entityType',
  'departments',
  'researchAreas',
  'bestNextStepCategory',
] as const;

const toStringArray = (value: unknown): string[] | undefined => {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item : String(item)))
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return undefined;
};

const allowedValues = <T extends readonly string[]>(
  value: unknown,
  allowed: T,
): T[number][] | undefined => {
  const allowedSet = new Set<string>(allowed);
  const values = (toStringArray(value) || []).filter((item) => allowedSet.has(item));
  return values.length > 0 ? (values as T[number][]) : undefined;
};

const parseFilters = (raw: unknown): PathwaySearchFilters => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const record = raw as Record<string, unknown>;
  const filters: PathwaySearchFilters = {};

  const pathwayIds = toStringArray(record.pathwayIds);
  if (pathwayIds) filters.pathwayIds = pathwayIds;

  const entityIds = toStringArray(record.entityIds);
  if (entityIds) filters.entityIds = entityIds;

  const pathwayType = allowedValues(record.pathwayType, EntryPathwayTypes);
  if (pathwayType) filters.pathwayType = pathwayType;

  const compensation = allowedValues(record.compensation, CompensationTypes);
  if (compensation) filters.compensation = compensation;

  const status = allowedValues(record.status, EntryPathwayStatuses);
  if (status) filters.status = status;

  const evidenceStrength = allowedValues(record.evidenceStrength, EvidenceStrengths);
  if (evidenceStrength) filters.evidenceStrength = evidenceStrength;

  const entityType = allowedValues(record.entityType, ResearchEntityTypes);
  if (entityType) filters.entityType = entityType;

  const departments = toStringArray(record.departments);
  if (departments) filters.departments = departments;

  const researchAreas = toStringArray(record.researchAreas);
  if (researchAreas) filters.researchAreas = researchAreas;

  if (typeof record.hasActivePostedOpportunity === 'boolean') {
    filters.hasActivePostedOpportunity = record.hasActivePostedOpportunity;
  }

  const bestNextStepCategory = allowedValues(
    record.bestNextStepCategory,
    pathwayBestNextStepCategories,
  );
  if (bestNextStepCategory) filters.bestNextStepCategory = bestNextStepCategory;

  return filters;
};

const parseSort = (raw: unknown): PathwaySearchSort => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const record = raw as Record<string, unknown>;
  const sortBy =
    record.sortBy === 'relevance' ||
    record.sortBy === 'confidence' ||
    record.sortBy === 'lastObservedAt' ||
    record.sortBy === 'deadline' ||
    record.sortBy === 'createdAt'
      ? record.sortBy
      : undefined;

  return {
    ...(sortBy ? { sortBy } : {}),
    sortOrder: record.sortOrder === 'asc' ? 'asc' : 'desc',
  };
};

const hasOversizedStringList = (value: unknown): boolean => {
  if (value === undefined || value === null) return false;
  const values = Array.isArray(value) ? value : [value];
  if (values.length > MAX_FILTER_VALUES) return true;
  return values.some((item) => String(item).trim().length > MAX_FILTER_VALUE_LENGTH);
};

const isOversizedSearchRequest = (body: Record<string, unknown>): boolean => {
  if (typeof body.q === 'string' && body.q.length > MAX_SEARCH_QUERY_LENGTH) return true;

  const filters = body.filters;
  if (filters && typeof filters === 'object' && !Array.isArray(filters)) {
    for (const key of SEARCH_FILTER_KEYS) {
      if (hasOversizedStringList((filters as Record<string, unknown>)[key])) return true;
    }
  }

  return false;
};

const parseSearchInput = (raw: unknown): PathwaySearchInput => {
  const body = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
  const page = Number.isFinite(Number(body.page)) ? Number(body.page) : 1;
  const requestedPageSize = Number.isFinite(Number(body.pageSize))
    ? Number(body.pageSize)
    : DEFAULT_PAGE_SIZE;

  return {
    q: typeof body.q === 'string' ? body.q : '',
    page: Math.min(MAX_PAGE, Math.max(1, Math.floor(page) || 1)),
    pageSize: Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(requestedPageSize))),
    filters: parseFilters(body.filters),
    sort: parseSort(
      body.sort && typeof body.sort === 'object' && !Array.isArray(body.sort)
        ? body.sort
        : body,
    ),
  };
};

const searchWithConfiguredBackend = (input: PathwaySearchInput) =>
  process.env.PATHWAY_SEARCH_BACKEND === 'meili'
    ? searchPathwaysViaMeili(input)
    : searchPathways(input);

export const searchPathwaysHandler = async (request: Request, response: Response) => {
  const body = request.body && typeof request.body === 'object' && !Array.isArray(request.body)
    ? (request.body as Record<string, unknown>)
    : {};
  if (isOversizedSearchRequest(body)) {
    return response.status(400).json({ error: 'Invalid pathway search request' });
  }

  const result = await searchWithConfiguredBackend(parseSearchInput(body));
  return response.status(200).json(result);
};
