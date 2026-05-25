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
  listResearchSearchSuggestions,
  searchResearchGroupsViaMeili,
  ResearchGroupSearchSort,
  ResearchGroupQualityFilter,
} from '../services/researchGroupService';
import { ResearchGroupFilterInput } from '../services/researchGroupFilters';
import {
  isStudentVisibilityTier,
  type StudentVisibilityTier,
} from '../models/studentVisibility';

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

const ALLOWED_QUALITY_FILTERS = new Set<ResearchGroupQualityFilter>([
  'description-issue',
  'missing-lead',
  'profile-fallback',
]);

const parseQualityFilters = (raw: unknown): ResearchGroupQualityFilter[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((value) => (typeof value === 'string' ? value : String(value)))
    .filter((value): value is ResearchGroupQualityFilter =>
      ALLOWED_QUALITY_FILTERS.has(value as ResearchGroupQualityFilter),
    );
};

const parseStudentVisibilityTiers = (raw: unknown): StudentVisibilityTier[] => {
  const values = toStringArray(raw) || [];
  return values.filter(isStudentVisibilityTier);
};

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
      browseQuality?: string;
      qualityFilters?: unknown;
      studentVisibilityTier?: unknown;
      includeSuppressed?: boolean;
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

    const currentUser = request.user as { userType?: string } | undefined;
    const canUseAdminBrowseQuality = currentUser?.userType === 'admin';
    const canUseAdminQualityControls = canUseAdminBrowseQuality && q.trim() === '';
    const options = {
      lowQualityFirst:
        canUseAdminQualityControls && body.browseQuality === 'low-first',
      includeQualitySummary: canUseAdminQualityControls && body.browseQuality === 'low-first',
      qualityFilters: canUseAdminQualityControls ? parseQualityFilters(body.qualityFilters) : [],
      studentVisibilityTiers:
        canUseAdminBrowseQuality ? parseStudentVisibilityTiers(body.studentVisibilityTier) : [],
      includeSuppressed: canUseAdminBrowseQuality && body.includeSuppressed === true,
    };

    const result = await searchResearchGroupsViaMeili(
      q,
      filters,
      page,
      pageSize,
      sort,
      options,
    );
    return response.json(result);
  } catch (error) {
    console.error('ResearchEntity search failed:', error);
    return response.status(500).json({ error: 'Search failed' });
  }
};

export const getResearchSearchSuggestions = async (_request: Request, response: Response) => {
  const suggestions = await listResearchSearchSuggestions(6);
  return response.json({ suggestions });
};

export const getResearchGroupBySlug = async (request: Request, response: Response) => {
  const slug = request.params.slug;
  if (!slug || typeof slug !== 'string' || slug.trim().length === 0) {
    return response.status(400).json({ error: 'Missing slug' });
  }

  const currentUser = request.user as { userType?: string } | undefined;
  const detail = await getResearchGroupDetail(slug, {
    includeQualitySummary: currentUser?.userType === 'admin',
  });
  if (!detail) {
    throw new NotFoundError(`Research entity not found with slug: ${slug}`);
  }

  return response.status(200).json(detail);
};
