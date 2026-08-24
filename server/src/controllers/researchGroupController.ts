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
  recordResearchEntityOutreach,
  resolveArchivedResearchEntityCanonicalSlug,
  searchResearchGroupsViaMeili,
  type ResearchGroupQualityFilter,
  ResearchGroupSearchSort,
} from '../services/researchGroupService';
import { getResearcherProfileByPublicKey } from '../services/researcherProfileService';
import { ResearchGroupFilterInput } from '../services/researchGroupFilters';
import { RELATED_PROGRAM_ENTITY_TYPES } from '../utils/researchEntityProgramLike';
import {
  isStudentVisibilityTier,
  publicStudentVisibilityTiers,
  type StudentVisibilityTier,
} from '../models/studentVisibility';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { hasAdminAuthorityForUser } from '../services/adminGrantService';
import { getStudentResearchInterests } from '../services/studentInterestProfileService';
import { getDepartmentResearchPage } from '../services/departmentResearchPageService';

const MAX_PAGE_SIZE = 100;
const MAX_PAGE = 1000;
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
  'studentVisibilityTier',
  'qualityFilters',
] as const;

const CURRENT_AVAILABILITY_FILTER_VALUES = new Set(['OPEN', 'ROLLING']);
const COMPENSATION_FILTER_VALUES = new Set(['PAID_OR_STIPEND', 'COURSE_CREDIT']);

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

  if (
    r.acceptanceLevel === 'verified' ||
    r.acceptanceLevel === 'verified-or-likely' ||
    r.acceptanceLevel === 'all'
  ) {
    filters.acceptanceLevel = r.acceptanceLevel;
  }

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

const resolveViewerResearchInterests = async (
  currentUser: { netId?: string; netid?: string } | undefined,
): Promise<{ interests: string[] } | undefined> => {
  const netid = currentUser?.netId || currentUser?.netid;
  if (!netid) return undefined;
  try {
    const { researchInterests } = await getStudentResearchInterests(netid);
    return researchInterests.length > 0 ? { interests: researchInterests } : undefined;
  } catch (error) {
    console.error('Research interest personalization lookup failed:', sanitizeLogValue(error));
    return undefined;
  }
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
      browseQuality?: unknown;
      qualityFilters?: unknown;
      standardOrder?: unknown;
    };

    if (isOversizedSearchRequest(body as Record<string, unknown>)) {
      return response.status(400).json({ error: 'Invalid search request' });
    }

    const q = typeof body.q === 'string' ? body.q : '';
    const requestedPage = parsePositiveIntegerParam(body.page, 1);
    const page = Math.min(MAX_PAGE, Math.max(1, Math.floor(requestedPage) || 1));
    const requestedPageSize = parsePositiveIntegerParam(body.pageSize, DEFAULT_PAGE_SIZE);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(requestedPageSize) || 1));
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
    const isDefaultRecommendedBrowse =
      q.trim().length === 0 && !sort.sortBy && !lowQualityFirst && body.standardOrder !== true;
    const personalization = isDefaultRecommendedBrowse
      ? await resolveViewerResearchInterests(currentUser)
      : undefined;

    const result = await searchResearchGroupsViaMeili(q, filters, page, pageSize, sort, {
      includeNonPublic: hasAdminAuthority,
      lowQualityFirst,
      qualityFilters: hasAdminAuthority ? parseQualityFilters(body.qualityFilters) : [],
      ...(personalization ? { personalization } : {}),
    });
    return response.json(result);
  } catch (error) {
    console.error('ResearchEntity search failed:', sanitizeLogValue(error));
    return response.status(500).json({ error: 'Search failed' });
  }
};

const RELATED_PROGRAMS_LIMIT = 5;

/**
 * Cross-surface discovery for `/research`: given the same topical query a
 * student ran against research homes, return the top few topically relevant
 * Yale programs and fellowships (issue #1509). It reuses the unified
 * ResearchEntity hybrid semantic search, filtered to the program/fellowship
 * entity types and public student-visibility only, so it introduces no new
 * index, entity type, or bespoke scorer. A blank query returns nothing rather
 * than browsing the whole program corpus, and the whole module is bounded so it
 * can never intermix with or perturb the primary research-home result list.
 */
export const searchRelatedPrograms = async (request: Request, response: Response) => {
  try {
    const body = (request.body || {}) as { q?: string; filters?: unknown };

    if (isOversizedSearchRequest(body as Record<string, unknown>)) {
      return response.status(400).json({ error: 'Invalid search request' });
    }

    const q = typeof body.q === 'string' ? body.q.trim() : '';
    if (!q) {
      return response.json({ researchEntities: [], degraded: false });
    }

    const requestedFilters = parseFilters(body.filters);
    const filters: ResearchGroupFilterInput = {
      entityType: [...RELATED_PROGRAM_ENTITY_TYPES],
      studentVisibilityTier: publicStudentVisibilityTiers,
    };
    if (requestedFilters.school) filters.school = requestedFilters.school;
    if (requestedFilters.departments) filters.departments = requestedFilters.departments;
    if (requestedFilters.researchAreas) filters.researchAreas = requestedFilters.researchAreas;

    const result = await searchResearchGroupsViaMeili(
      q,
      filters,
      1,
      RELATED_PROGRAMS_LIMIT,
      {},
      { includeNonPublic: false },
    );

    return response.json({
      researchEntities: result.researchEntities.slice(0, RELATED_PROGRAMS_LIMIT),
      degraded: result.degraded ?? false,
    });
  } catch (error) {
    console.error('Related programs search failed:', sanitizeLogValue(error));
    return response.status(500).json({ error: 'Search failed' });
  }
};

export const getResearchDepartmentPage = async (request: Request, response: Response) => {
  try {
    const page = await getDepartmentResearchPage(request.params.slug);
    if (!page) {
      throw new NotFoundError(`No research department page for slug: ${request.params.slug}`);
    }
    return response.status(200).json(page);
  } catch (error: any) {
    if (error instanceof NotFoundError) {
      return response.status(error.status).json({ error: 'Research department not found' });
    }
    console.error('Research department page failed:', sanitizeLogValue(error));
    return response.status(500).json({ error: 'Failed to fetch research department' });
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

const MAX_PERSON_PUBLIC_KEY_LENGTH = 200;
const PERSON_PUBLIC_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,199}$/i;

export const getResearcherProfile = async (request: Request, response: Response) => {
  try {
    const rawPublicKey = request.params.publicKey;
    if (
      !rawPublicKey ||
      typeof rawPublicKey !== 'string' ||
      rawPublicKey.length > MAX_PERSON_PUBLIC_KEY_LENGTH ||
      !PERSON_PUBLIC_KEY_PATTERN.test(rawPublicKey)
    ) {
      return response.status(400).json({ error: 'Invalid researcher key' });
    }

    const profile = await getResearcherProfileByPublicKey(rawPublicKey);
    if (!profile) {
      return response.status(404).json({ error: 'Researcher not found' });
    }

    return response.status(200).json(profile);
  } catch (error) {
    console.error('Researcher profile failed:', sanitizeLogValue(error));
    return response.status(500).json({ error: 'Failed to fetch researcher profile' });
  }
};

const OUTREACH_TEMPLATE_VERSION_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/i;

const sanitizeOutreachTemplateVersion = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed && OUTREACH_TEMPLATE_VERSION_PATTERN.test(trimmed) ? trimmed : undefined;
};

export const recordResearchOutreach = async (request: Request, response: Response) => {
  const currentUser = request.user as { studentProfileId?: unknown } | undefined;
  if (!currentUser?.studentProfileId) {
    return response.status(403).json({ error: 'A student profile is required' });
  }
  try {
    const isMailto = request.body?.deliveryMethod === 'mailto';
    await recordResearchEntityOutreach(request.params.slug, currentUser.studentProfileId, {
      deliveryMethod: isMailto ? 'mailto' : 'official-route',
      emailGeneratedByPlatform: isMailto && request.body?.emailGeneratedByPlatform === true,
      templateVersion: isMailto ? sanitizeOutreachTemplateVersion(request.body?.templateVersion) : undefined,
    });
    return response.status(204).send();
  } catch (error: any) {
    if (error?.message === 'INVALID_OUTREACH_REQUEST') {
      return response.status(400).json({ error: 'Invalid outreach request' });
    }
    if (error?.message === 'OUTREACH_ENTITY_NOT_FOUND') {
      return response.status(404).json({ error: 'Research entity not found' });
    }
    if (error?.message === 'NO_APPROVED_OUTREACH_ROUTE') {
      return response.status(409).json({ error: 'No approved outreach route is available' });
    }
    console.error('ResearchEntity outreach failed:', sanitizeLogValue(error));
    return response.status(500).json({ error: 'Failed to record outreach' });
  }
};
