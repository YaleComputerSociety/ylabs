/**
 * Controller handlers for ResearchGroup browse and detail routes.
 *
 * Both endpoints are public (no auth required); they only expose materialized
 * data shaped for the labs browse page.
 */
import { Request, Response } from 'express';
import { NotFoundError } from '../utils/errors';
import {
  getResearchGroupDetail,
  searchResearchGroupsViaMeili,
  ResearchGroupSearchSort,
} from '../services/researchGroupService';
import { ResearchGroupFilterInput } from '../services/researchGroupFilters';

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 24;

const toStringArray = (value: unknown): string[] | undefined => {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) {
    return value
      .map((v) => (typeof v === 'string' ? v : String(v)))
      .filter((v) => v.trim().length > 0);
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return [value];
  }
  return undefined;
};

const ALLOWED_SORT_FIELDS: ResearchGroupSearchSort['sortBy'][] = [
  'lastObservedAt',
  'name',
  'createdAt',
  'updatedAt',
];

const parseFilters = (raw: unknown): ResearchGroupFilterInput => {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const filters: ResearchGroupFilterInput = {};

  const kind = toStringArray(r.kind);
  if (kind) filters.kind = kind;

  const school = toStringArray(r.school);
  if (school) filters.school = school;

  const departments = toStringArray(r.departments);
  if (departments) filters.departments = departments;

  const researchAreas = toStringArray(r.researchAreas);
  if (researchAreas) filters.researchAreas = researchAreas;

  const openness = toStringArray(r.openness);
  if (openness) filters.openness = openness;

  if (typeof r.acceptingUndergrads === 'boolean') {
    filters.acceptingUndergrads = r.acceptingUndergrads;
  }

  if (
    r.acceptanceLevel === 'verified' ||
    r.acceptanceLevel === 'verified-or-likely' ||
    r.acceptanceLevel === 'all'
  ) {
    filters.acceptanceLevel = r.acceptanceLevel;
  }

  return filters;
};

export const searchResearchGroups = async (request: Request, response: Response) => {
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

    const sort: ResearchGroupSearchSort = {};
    if (
      typeof body.sortBy === 'string' &&
      ALLOWED_SORT_FIELDS.includes(body.sortBy as ResearchGroupSearchSort['sortBy'])
    ) {
      sort.sortBy = body.sortBy as ResearchGroupSearchSort['sortBy'];
      sort.sortOrder = body.sortOrder === 'asc' ? 'asc' : 'desc';
    }

    const result = await searchResearchGroupsViaMeili(q, filters, page, pageSize, sort);
    return response.json(result);
  } catch (error) {
    console.error('ResearchEntity search failed:', error);
    return response.status(500).json({ error: 'Search failed' });
  }
};

export const getResearchGroupBySlug = async (request: Request, response: Response) => {
  const slug = request.params.slug;
  if (!slug || typeof slug !== 'string' || slug.trim().length === 0) {
    return response.status(400).json({ error: 'Missing slug' });
  }

  const detail = await getResearchGroupDetail(slug);
  if (!detail) {
    throw new NotFoundError(`Research entity not found with slug: ${slug}`);
  }

  return response.status(200).json(detail);
};
