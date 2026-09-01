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
  normalizeResearchDetailSlug,
  resolveArchivedResearchEntityCanonicalSlug,
  searchResearchGroupsViaMeili,
  type ResearchGroupQualityFilter,
  ResearchGroupSearchSort,
} from '../services/researchGroupService';
import { ResearchGroupFilterInput } from '../services/researchGroupFilters';
import {
  isStudentVisibilityTier,
  publicStudentVisibilityTiers,
  type StudentVisibilityTier,
} from '../models/studentVisibility';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { hasAdminAuthorityForUser } from '../services/adminGrantService';
import { maxReachableResearchSearchPage } from '../services/researchSearchPagination';

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 24;
const MAX_SEARCH_QUERY_LENGTH = 512;
const MAX_FILTER_VALUES = 50;
const MAX_FILTER_VALUE_LENGTH = 120;
const MAX_SEARCH_PAGINATION_PARAM_LENGTH = 16;
const POSITIVE_INTEGER_PARAM_RE = /^[1-9]\d*$/;
const SEARCH_FILTER_KEYS = [
  'kind',
  'entityType',
  'school',
  'departments',
  'researchAreas',
  'currentAvailability',
  'compensation',
  'eligibleStudentLevels',
  'studentVisibilityTier',
  'qualityFilters',
] as const;

const CURRENT_AVAILABILITY_FILTER_VALUES = new Set(['OPEN', 'ROLLING']);
const COMPENSATION_FILTER_VALUES = new Set(['PAID_OR_STIPEND', 'COURSE_CREDIT']);
const ELIGIBLE_STUDENT_LEVEL_FILTER_VALUES = new Set([
  'FIRST_YEAR',
  'SOPHOMORE',
  'JUNIOR',
  'SENIOR',
]);

const toStringArray = (value: unknown): string[] | undefined => {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) {
    return value
      .filter((v): v is string => typeof v === 'string')
      .filter((v) => v.trim().length > 0);
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return [value];
  }
  return undefined;
};

const PUBLIC_ALLOWED_SORT_FIELDS: ResearchGroupSearchSort['sortBy'][] = ['lastObservedAt', 'name'];

const OPERATOR_ALLOWED_SORT_FIELDS: ResearchGroupSearchSort['sortBy'][] = [
  ...PUBLIC_ALLOWED_SORT_FIELDS,
  'createdAt',
  'updatedAt',
];

const parseFilters = (raw: unknown): ResearchGroupFilterInput => {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  const filters: ResearchGroupFilterInput = {};

  const kind = toStringArray(r.kind);
  if (kind) filters.kind = kind;

  const entityType = toStringArray(r.entityType);
  if (entityType) filters.entityType = entityType;

  const school = toStringArray(r.school);
  if (school) filters.school = school;

  const departments = toStringArray(r.departments);
  if (departments) filters.departments = departments;

  const researchAreas = toStringArray(r.researchAreas);
  if (researchAreas) filters.researchAreas = researchAreas;

  if (r.hostsUndergrads === true) {
    filters.hostsUndergrads = true;
  }

  if (r.hasDocumentedWayIn === true) {
    filters.hasDocumentedWayIn = true;
  }

  const currentAvailability = toStringArray(r.currentAvailability)?.filter((value) =>
    CURRENT_AVAILABILITY_FILTER_VALUES.has(value),
  ) as ResearchGroupFilterInput['currentAvailability'];
  if (currentAvailability?.length) filters.currentAvailability = currentAvailability;

  const compensation = toStringArray(r.compensation)?.filter((value) =>
    COMPENSATION_FILTER_VALUES.has(value),
  ) as ResearchGroupFilterInput['compensation'];
  if (compensation?.length) filters.compensation = compensation;

  const eligibleStudentLevels = toStringArray(r.eligibleStudentLevels)?.filter((value) =>
    ELIGIBLE_STUDENT_LEVEL_FILTER_VALUES.has(value),
  ) as ResearchGroupFilterInput['eligibleStudentLevels'];
  if (eligibleStudentLevels?.length) filters.eligibleStudentLevels = eligibleStudentLevels;

  return filters;
};

const parseStudentVisibilityTiers = (value: unknown): StudentVisibilityTier[] => {
  const values = toStringArray(value) || [];
  return values.filter(isStudentVisibilityTier);
};

const parseQualityFilters = (value: unknown): ResearchGroupQualityFilter[] => {
  const values = toStringArray(value) || [];
  return values.filter(
    (filter): filter is ResearchGroupQualityFilter =>
      filter === 'description-issue' || filter === 'missing-lead' || filter === 'profile-fallback',
  );
};

const hasOversizedStringList = (value: unknown): boolean => {
  if (value === undefined || value === null) return false;
  const values = Array.isArray(value) ? value : [value];
  if (values.length > MAX_FILTER_VALUES) return true;
  return values.some(
    (item) => typeof item !== 'string' || item.trim().length > MAX_FILTER_VALUE_LENGTH,
  );
};

const isOversizedSearchRequest = (body: Record<string, unknown>): boolean => {
  if (typeof body.q === 'string' && body.q.length > MAX_SEARCH_QUERY_LENGTH) return true;

  const filters = body.filters;
  if (filters && typeof filters === 'object' && !Array.isArray(filters)) {
    for (const key of SEARCH_FILTER_KEYS) {
      if (hasOversizedStringList((filters as Record<string, unknown>)[key])) return true;
    }
  }

  return (
    hasOversizedStringList(body.studentVisibilityTier) ||
    hasOversizedStringList(body.qualityFilters)
  );
};

const parsePositiveIntegerParam = (value: unknown, fallback: number): number => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' && typeof value !== 'number') return fallback;
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : fallback;
  }

  const raw = value.trim();
  if (!raw || raw.length > MAX_SEARCH_PAGINATION_PARAM_LENGTH) return fallback;
  if (!POSITIVE_INTEGER_PARAM_RE.test(raw)) return fallback;

  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
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
      studentVisibilityTier?: unknown;
      includeSuppressed?: boolean;
      // Opt-in for a caller with no retained facet copy (a fresh deep link, or a
      // non-browser client). Page 1 always includes them.
      includeFacets?: boolean;
      browseQuality?: unknown;
      qualityFilters?: unknown;
    };

    if (isOversizedSearchRequest(body as Record<string, unknown>)) {
      return response.status(400).json({ error: 'Invalid search request' });
    }

    const q = typeof body.q === 'string' ? body.q : '';
    const requestedPage = parsePositiveIntegerParam(body.page, 1);
    const requestedPageSize = parsePositiveIntegerParam(body.pageSize, DEFAULT_PAGE_SIZE);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(requestedPageSize) || 1));
    // Depth is bounded in records, so the reachable page number falls out of the
    // requested page size rather than being a second independent client-controlled
    // dimension (OWASP API4:2023).
    const page = Math.max(1, Math.floor(requestedPage) || 1);
    // Past the bound, answer with an empty page instead of clamping to the last
    // reachable one: a clamped response looks like a full page of new rows to a
    // client that tracks its own page counter, which appends the same entities
    // forever. An empty depth-limited page terminates the walk and dispatches no
    // search work. No result-set size is reported: the search never ran, so any
    // total here would be invented, and `depthLimited` already ends the walk.
    if (page > maxReachableResearchSearchPage(pageSize)) {
      return response.json({
        researchEntities: [],
        page,
        pageSize,
        depthLimited: true,
      });
    }
    // Facets describe the whole result set, not the page, and they dominate the
    // payload: a 100-record page measured 568,858 characters with 805 distinct
    // department values in one facet. They change on scrape cadence rather than per
    // keystroke, so they are sent once for a result set and the client retains
    // them while paging. `includeFacets: true` forces them for a caller that has
    // no retained copy.
    const includeFacets = page === 1 || body.includeFacets === true;
    const filters = parseFilters(body.filters);
    const currentUser = request.user as
      | { netId?: string; netid?: string; userType?: string }
      | undefined;
    const hasAdminAuthority = await hasAdminAuthorityForUser(currentUser);
    const requestedTiers = hasAdminAuthority
      ? parseStudentVisibilityTiers(body.studentVisibilityTier)
      : [];
    if (requestedTiers.length > 0) {
      filters.studentVisibilityTier = requestedTiers;
    } else if (!(hasAdminAuthority && body.includeSuppressed === true)) {
      filters.studentVisibilityTier = publicStudentVisibilityTiers;
    }

    const sort: ResearchGroupSearchSort = {};
    const allowedSortFields = hasAdminAuthority
      ? OPERATOR_ALLOWED_SORT_FIELDS
      : PUBLIC_ALLOWED_SORT_FIELDS;
    if (
      typeof body.sortBy === 'string' &&
      allowedSortFields.includes(body.sortBy as ResearchGroupSearchSort['sortBy'])
    ) {
      sort.sortBy = body.sortBy as ResearchGroupSearchSort['sortBy'];
      sort.sortOrder = body.sortOrder === 'asc' ? 'asc' : 'desc';
    }

    const lowQualityFirst = hasAdminAuthority && body.browseQuality === 'low-first';

    const result = await searchResearchGroupsViaMeili(q, filters, page, pageSize, sort, {
      includeNonPublic: hasAdminAuthority,
      lowQualityFirst,
      qualityFilters: hasAdminAuthority ? parseQualityFilters(body.qualityFilters) : [],
      // Skipped in the search layer rather than stripped here, so a page that
      // needs no facets also skips the facet queries instead of only shrinking
      // the payload.
      includeFacets,
    });
    if (includeFacets) return response.json(result);
    // Omitted rather than emptied: an empty object is indistinguishable from "this
    // result set has no facets" to a client, which would clear a populated filter
    // panel. Absent means "unchanged, keep what you have".
    const { facetDistribution: _omittedFacets, ...withoutFacets } = result;
    return response.json(withoutFacets);
  } catch (error) {
    console.error('ResearchEntity search failed:', sanitizeLogValue(error));
    return response.status(500).json({ error: 'Search failed' });
  }
};

export const getResearchGroupBySlug = async (request: Request, response: Response) => {
  try {
    const rawSlug = request.params.slug;
    if (!rawSlug || typeof rawSlug !== 'string' || rawSlug.trim().length === 0) {
      return response.status(400).json({ error: 'Missing slug' });
    }

    const slug = normalizeResearchDetailSlug(rawSlug);
    if (!slug) {
      return response.status(400).json({ error: 'Invalid slug' });
    }

    const detail = await getResearchGroupDetail(slug);
    if (!detail) {
      const canonicalSlug = await resolveArchivedResearchEntityCanonicalSlug(slug);
      if (canonicalSlug) {
        return response.redirect(302, `${request.baseUrl}/${encodeURIComponent(canonicalSlug)}`);
      }
      throw new NotFoundError(`Research entity not found with slug: ${slug}`);
    }

    return response.status(200).json(detail);
  } catch (error: any) {
    if (error instanceof NotFoundError) {
      return response.status(error.status).json({ error: 'Research entity not found' });
    }
    console.error('ResearchEntity detail failed:', sanitizeLogValue(error));
    return response.status(500).json({ error: 'Failed to fetch research entity' });
  }
};
