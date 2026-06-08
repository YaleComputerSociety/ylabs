/**
 * Controller handlers for listing CRUD routes.
 */
import { Request, Response, NextFunction } from 'express';
import {
  archiveListing,
  createListing,
  deleteListing,
  readAllListings,
  readListing,
  unarchiveListing,
  updateListing,
  getSkeletonListing,
  addView,
} from '../services/listingService';
import { readUser } from '../services/userService';
import { getMeiliIndex } from '../utils/meiliClient';
import { getConfig } from '../services/configService';
import { redactDirectContactInfo } from '../utils/contactRedaction';
import { isPublicHttpUrl } from '../utils/urlSafety';

/**
 * Build robust filter match stage for MongoDB aggregation
 *
 * Filter Logic:
 * - Each filter (departments, disciplines, research areas) can be AND or OR mode
 * - Within a filter with OR mode: listing matches if it has ANY of the selected values
 * - Within a filter with AND mode: listing matches if it has ALL of the selected values
 * - Cross-filter logic:
 *   - If ALL filters are OR mode: combine filters with OR (match any filter)
 *   - If ANY filter is AND mode: combine filters with AND (match all filters)
 *
 * For Academic Disciplines:
 * - OR mode: listing has a department from ANY selected discipline
 * - AND mode: listing has at least one department from EACH selected discipline
 */
const escapeMeiliFilterValue = (value: string): string =>
  value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

const buildRobustFilterMatch = async (params: {
  departments?: string;
  departmentsMode: string;
  academicDisciplines?: string;
  academicDisciplinesMode: string;
  researchAreas?: string;
  researchAreasMode: string;
}) => {
  const {
    departments,
    departmentsMode,
    academicDisciplines,
    academicDisciplinesMode,
    researchAreas,
    researchAreasMode,
  } = params;

  const filters: string[] = ['archived = false', 'confirmed = true'];

  const departmentList = departments ? departments.split('||').filter((d) => d.trim()) : [];
  const disciplineList = academicDisciplines
    ? academicDisciplines.split('||').filter((d) => d.trim())
    : [];
  const researchAreaList = researchAreas ? researchAreas.split(',').filter((r) => r.trim()) : [];

  const hasFilters =
    departmentList.length > 0 || disciplineList.length > 0 || researchAreaList.length > 0;
  if (!hasFilters) {
    return filters.join(' AND ');
  }

  const useAndBetweenFilters =
    (departmentList.length > 0 && departmentsMode === 'intersection') ||
    (disciplineList.length > 0 && academicDisciplinesMode === 'intersection') ||
    (researchAreaList.length > 0 && researchAreasMode === 'intersection');

  const filterConditions: string[] = [];

  if (departmentList.length > 0) {
    if (departmentsMode === 'intersection') {
      const condition = departmentList
        .map((d) => `departments = "${escapeMeiliFilterValue(d)}"`)
        .join(' AND ');
      filterConditions.push(`(${condition})`);
    } else {
      const condition = departmentList
        .map((d) => `departments = "${escapeMeiliFilterValue(d)}"`)
        .join(' OR ');
      filterConditions.push(`(${condition})`);
    }
  }

  if (disciplineList.length > 0) {
    const config = await getConfig();
    const departmentsByDiscipline: { [key: string]: string[] } = {};

    for (const discipline of disciplineList) {
      departmentsByDiscipline[discipline] = config.departments.list
        .filter(
          (dept: any) =>
            dept.categories.includes(discipline) || dept.primaryCategory === discipline,
        )
        .map((dept: any) => dept.displayName);
    }

    if (academicDisciplinesMode === 'intersection') {
      const disciplineConditions = disciplineList
        .map((discipline) => {
          const depts = departmentsByDiscipline[discipline] || [];
          if (depts.length === 0) return null;
          return `(${depts.map((d) => `departments = "${escapeMeiliFilterValue(d)}"`).join(' OR ')})`;
        })
        .filter(Boolean);

      if (disciplineConditions.length > 0) {
        filterConditions.push(`(${disciplineConditions.join(' AND ')})`);
      }
    } else {
      const allDisciplineDepts = [
        ...new Set(
          disciplineList.flatMap((discipline) => departmentsByDiscipline[discipline] || []),
        ),
      ];
      if (allDisciplineDepts.length > 0) {
        const condition = allDisciplineDepts
          .map((d) => `departments = "${escapeMeiliFilterValue(d)}"`)
          .join(' OR ');
        filterConditions.push(`(${condition})`);
      }
    }
  }

  if (researchAreaList.length > 0) {
    if (researchAreasMode === 'intersection') {
      const condition = researchAreaList
        .map((r) => `researchAreas = "${escapeMeiliFilterValue(r)}"`)
        .join(' AND ');
      filterConditions.push(`(${condition})`);
    } else {
      const condition = researchAreaList
        .map((r) => `researchAreas = "${escapeMeiliFilterValue(r)}"`)
        .join(' OR ');
      filterConditions.push(`(${condition})`);
    }
  }

  if (filterConditions.length > 0) {
    const combinedConditions = filterConditions.join(useAndBetweenFilters ? ' AND ' : ' OR ');
    filters.push(`(${combinedConditions})`);
  }

  return filters.join(' AND ');
};

const splitParam = (value?: string, separator = ','): string[] =>
  value ? value.split(separator).map((item) => item.trim()).filter(Boolean) : [];

const LISTING_SEARCH_SORT_FIELDS = new Set([
  'createdAt',
  'updatedAt',
  'title',
  'expiresAt',
]);
const MAX_LISTING_SEARCH_PAGE = 1000;
const MAX_LISTING_SEARCH_PAGE_SIZE = 100;

const listingSearchSortField = (value: unknown): string =>
  typeof value === 'string' && LISTING_SEARCH_SORT_FIELDS.has(value) ? value : 'createdAt';

const listingSearchSortOrder = (value: unknown): 'asc' | 'desc' => (value === '1' ? 'asc' : 'desc');

const normalizedPositiveInteger = (value: unknown, fallback: number, max: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(1, Math.floor(parsed)));
};

const listingIncludes = (listing: any, query: string): boolean => {
  if (!query) return true;
  const haystack = [
    listing.title,
    listing.description,
    listing.ownerFirstName,
    listing.ownerLastName,
    ...(listing.departments || []),
    ...(listing.researchAreas || []),
    ...(listing.keywords || []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
};

const matchesListFilter = (values: string[] = [], selected: string[], mode: string): boolean => {
  if (selected.length === 0) return true;
  const normalized = new Set(values.map((value) => value.toLowerCase()));
  const checks = selected.map((value) => normalized.has(value.toLowerCase()));
  return mode === 'intersection' ? checks.every(Boolean) : checks.some(Boolean);
};

const publicHttpUrl = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  try {
    if (!isPublicHttpUrl(value)) return undefined;
    return value;
  } catch {
    return undefined;
  }
};

const publicHttpUrls = (values: unknown): string[] =>
  Array.isArray(values) ? values.flatMap((value) => publicHttpUrl(value) ?? []) : [];

const publicListingText = (value: unknown): unknown =>
  typeof value === 'string' ? redactDirectContactInfo(value) : value;

const publicListingForAuthenticatedReader = (listing: any) => {
  const id = listing._id?.toString?.() || listing._id || listing.id;
  return {
    _id: id,
    id,
    researchEntityId: listing.researchEntityId,
    researchGroupId: listing.researchGroupId,
    title: listing.title,
    hiringStatus: listing.hiringStatus,
    websites: publicHttpUrls(listing.websites),
    description: publicListingText(listing.description),
    applicantDescription: publicListingText(listing.applicantDescription),
    researchAreas: Array.isArray(listing.researchAreas) ? listing.researchAreas : [],
    keywords: Array.isArray(listing.keywords) ? listing.keywords : [],
    established: listing.established,
    departments: Array.isArray(listing.departments) ? listing.departments : [],
    type: listing.type,
    commitment: listing.commitment,
    compensationType: listing.compensationType,
    expiresAt: listing.expiresAt,
    createdAt: listing.createdAt,
    updatedAt: listing.updatedAt,
  };
};

const sendListingError = (response: Response, error: any, fallbackMessage: string) => {
  const status = error?.status ?? error?.statusCode;
  if (Number.isInteger(status) && status >= 400 && status < 500) {
    const body =
      status === 403
        ? { error: 'Incorrect permissions', incorrectPermissions: true }
        : { error: 'Listing not found' };
    return response.status(status).json(body);
  }
  if (error?.name === 'ValidationError') {
    return response.status(400).json({ error: 'Validation error' });
  }

  return response.status(500).json({ error: fallbackMessage });
};

export const searchListings = async (request: Request, response: Response) => {
  try {
    const {
      query,
      sortBy,
      sortOrder,
      departments,
      academicDisciplines,
      researchAreas,
      departmentsMode = 'union',
      academicDisciplinesMode = 'union',
      researchAreasMode = 'union',
      page = 1,
      pageSize = 10,
    } = request.query;

    const filterString = await buildRobustFilterMatch({
      departments: departments as string,
      departmentsMode: departmentsMode as string,
      academicDisciplines: academicDisciplines as string,
      academicDisciplinesMode: academicDisciplinesMode as string,
      researchAreas: researchAreas as string,
      researchAreasMode: researchAreasMode as string,
    });

    const normalizedPage = normalizedPositiveInteger(page, 1, MAX_LISTING_SEARCH_PAGE);
    const limit = normalizedPositiveInteger(pageSize, 10, MAX_LISTING_SEARCH_PAGE_SIZE);
    const offset = (normalizedPage - 1) * limit;

    const sortConfig = [];
    if (sortBy) {
      sortConfig.push(`${listingSearchSortField(sortBy)}:${listingSearchSortOrder(sortOrder)}`);
    } else if (!query || (query as string).trim() === '') {
      // Just recent if no query
      sortConfig.push(`createdAt:desc`);
    }

    const searchParams: any = {
      filter: filterString,
      limit,
      offset,
    };

    if (sortConfig.length > 0) {
      searchParams.sort = sortConfig;
    }

    // Use hybrid search for multi-word queries; keyword-only for single-word queries
    // to avoid semantic drift (e.g. "startup" pulling in "early development" embryo docs).
    const trimmedQuery = ((query as string) || '').trim();
    if (trimmedQuery !== '' && trimmedQuery.split(/\s+/).length > 1) {
      searchParams.hybrid = {
        semanticRatio: 0.8,
        embedder: 'default',
      };
    }

    const index = await getMeiliIndex('listings');
    const { hits, estimatedTotalHits } = await index.search((query as string) || '', searchParams);

    // Map `id` back to `_id` for frontend backward compatibility
    const results = hits.map(publicListingForAuthenticatedReader);

    return response.json({
      results,
      totalCount: estimatedTotalHits,
      page: normalizedPage,
      pageSize: limit,
    });
  } catch (error: any) {
    if (error?.cause?.code === 'index_not_found') {
      const {
        query = '',
        departments,
        researchAreas,
        departmentsMode = 'union',
        researchAreasMode = 'union',
        page = 1,
        pageSize = 10,
      } = request.query;
      const normalizedPage = normalizedPositiveInteger(page, 1, MAX_LISTING_SEARCH_PAGE);
      const limit = normalizedPositiveInteger(pageSize, 10, MAX_LISTING_SEARCH_PAGE_SIZE);
      const offset = (normalizedPage - 1) * limit;
      const departmentList = splitParam(departments as string | undefined, '||');
      const researchAreaList = splitParam(researchAreas as string | undefined);
      const trimmedQuery = ((query as string) || '').trim();

      const allListings = await readAllListings();
      const filtered = allListings
        .filter((listing: any) => listing.archived !== true && listing.confirmed === true)
        .filter((listing: any) => listingIncludes(listing, trimmedQuery))
        .filter((listing: any) =>
          matchesListFilter(listing.departments || [], departmentList, departmentsMode as string),
        )
        .filter((listing: any) =>
          matchesListFilter(listing.researchAreas || [], researchAreaList, researchAreasMode as string),
        )
        .sort(
          (a: any, b: any) =>
            new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime(),
        );
      const results = filtered
        .slice(offset, offset + limit)
        .map(publicListingForAuthenticatedReader);

      return response.json({
        results,
        totalCount: filtered.length,
        page: normalizedPage,
        pageSize: limit,
      });
    }

    console.error('Meilisearch search failed:', error);
    return response.status(500).json({ error: 'Search failed' });
  }
};

export const createListingForCurrentUser = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as {
      netId?: string;
      userType: string;
      userConfirmed: boolean;
    };

    const user = await readUser(currentUser.netId);
    const listing = await createListing(request.body.data, user);
    response.status(201).json({ listing });
  } catch (error: any) {
    console.error('Listing create failed:', error);
    sendListingError(response, error, 'Failed to create listing');
  }
};

export const getSkeletonListingForCurrentUser = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as {
      netId?: string;
      userType: string;
      userConfirmed: boolean;
    };

    const listing = await getSkeletonListing(currentUser.netId!);
    response.status(201).json({ listing });
  } catch (error: any) {
    console.error('Listing skeleton failed:', error);
    sendListingError(response, error, 'Failed to initialize listing');
  }
};

export const getListingById = async (request: Request, response: Response) => {
  try {
    const listing = await readListing(request.params.id);
    response.status(200).json({ listing: publicListingForAuthenticatedReader(listing) });
  } catch (error: any) {
    sendListingError(response, error, 'Failed to fetch listing');
  }
};

const LISTING_SELF_UPDATABLE_FIELDS = [
  'title',
  'hiringStatus',
  'websites',
  'description',
  'applicantDescription',
  'researchAreas',
  'keywords',
  'established',
  'departments',
] as const;

const filterListingUpdate = (data: any): Record<string, any> => {
  const update: Record<string, any> = {};
  if (!data || typeof data !== 'object') return update;
  for (const field of LISTING_SELF_UPDATABLE_FIELDS) {
    if (data[field] !== undefined) {
      update[field] = data[field];
    }
  }
  return update;
};

export const updateListingForCurrentUser = async (
  request: Request,
  response: Response,
  _next: NextFunction,
) => {
  try {
    const currentUser = request.user as {
      netId?: string;
      userType: string;
      userConfirmed: boolean;
    };

    const safeData = filterListingUpdate(request.body?.data);
    const listing = await updateListing(request.params.id, currentUser.netId!, safeData);
    response.status(200).json({ listing });
  } catch (error: any) {
    console.error('Listing update failed:', error);
    sendListingError(response, error, 'Failed to update listing');
  }
};

export const archiveListingForCurrentUser = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };

    const listing = await archiveListing(request.params.id, currentUser.netId!);
    response.status(200).json({ listing });
  } catch (error: any) {
    console.error('Listing archive failed:', error);
    sendListingError(response, error, 'Failed to archive listing');
  }
};

export const unarchiveListingForCurrentUser = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };

    const listing = await unarchiveListing(request.params.id, currentUser.netId!);
    response.status(200).json({ listing });
  } catch (error: any) {
    console.error('Listing unarchive failed:', error);
    sendListingError(response, error, 'Failed to unarchive listing');
  }
};

export const addViewToListing = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };

    const listing = await addView(request.params.id, currentUser.netId!);
    response.status(200).json({ listing: publicListingForAuthenticatedReader(listing) });
  } catch (error: any) {
    sendListingError(response, error, 'Failed to update listing view count');
  }
};

export const deleteListingForCurrentUser = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };

    const currentListing = await readListing(request.params.id);
    if (currentUser.netId !== currentListing.ownerId) {
      const error: any = new Error(
        `User with id ${currentUser.netId} does not have permission to delete listing with id ${request.params.id}`,
      );
      error.status = 403;
      throw error;
    }

    const deletedListing = await deleteListing(request.params.id);
    response.status(200).json({ deletedListing });
  } catch (error: any) {
    console.error('Listing delete failed:', error);
    sendListingError(response, error, 'Failed to delete listing');
  }
};
