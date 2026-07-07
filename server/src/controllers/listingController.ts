/**
 * Controller handlers for listing CRUD routes.
 */
import { Request, Response, NextFunction } from 'express';
import {
  archiveListing,
  createListing,
  deleteListing,
  readListing,
  readPublicListing,
  unarchiveListing,
  updateListing,
  getSkeletonListing,
  addView,
} from '../services/listingService';
import { readUser } from '../services/userService';
import { getMeiliIndex } from '../utils/meiliClient';
import { getConfig } from '../services/configService';
import { logEvent } from '../services/analyticsService';
import { AnalyticsEventType } from '../models/analytics';
import { redactDirectContactInfo } from '../utils/contactRedaction';
import { isPublicHttpUrl } from '../utils/urlSafety';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { serializedDocumentId } from '../utils/idSerialization';
import { buildSafeSearchRegex } from '../utils/regex';
import { getListingModel } from '../db/connections';

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

  const departmentList = splitBoundedListingSearchParam(departments, '||');
  const disciplineList = academicDisciplines
    ? splitBoundedListingSearchParam(academicDisciplines, '||')
    : [];
  const researchAreaList = splitBoundedListingSearchParam(researchAreas);

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

const LISTING_SEARCH_SORT_FIELDS = new Set([
  'title',
  'expiresAt',
]);
const DEFAULT_PUBLIC_LISTING_SORT_FIELD = 'expiresAt';
const MAX_LISTING_SEARCH_PAGE = 1000;
const MAX_LISTING_SEARCH_PAGE_SIZE = 100;
const MAX_LISTING_SEARCH_QUERY_LENGTH = 512;
const MAX_LISTING_SEARCH_FILTER_VALUES = 50;
const MAX_LISTING_SEARCH_FILTER_VALUE_LENGTH = 120;
const MAX_LISTING_SEARCH_PAGINATION_PARAM_LENGTH = 16;
const MAX_PUBLIC_LISTING_URLS = 20;
const POSITIVE_INTEGER_PARAM_RE = /^[1-9]\d*$/;

const listingSearchString = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return listingSearchString(value[0]);
  return '';
};

const boundedListingSearchQuery = (value: unknown): string =>
  listingSearchString(value).trim().slice(0, MAX_LISTING_SEARCH_QUERY_LENGTH);

const splitBoundedListingSearchParam = (value: unknown, separator = ','): string[] => {
  const seen = new Set<string>();
  const clean: string[] = [];

  for (const item of listingSearchString(value).split(separator)) {
    const boundedValue = item.trim().slice(0, MAX_LISTING_SEARCH_FILTER_VALUE_LENGTH);
    if (!boundedValue || seen.has(boundedValue)) continue;
    seen.add(boundedValue);
    clean.push(boundedValue);
    if (clean.length >= MAX_LISTING_SEARCH_FILTER_VALUES) break;
  }

  return clean;
};

const listingSearchSortField = (value: unknown): string =>
  typeof value === 'string' && LISTING_SEARCH_SORT_FIELDS.has(value) ? value : DEFAULT_PUBLIC_LISTING_SORT_FIELD;

const listingSearchSortOrder = (value: unknown): 'asc' | 'desc' => (value === '1' ? 'asc' : 'desc');

const numericListingSearchParam = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : undefined;
  }

  const raw = value.trim();
  if (!raw || raw.length > MAX_LISTING_SEARCH_PAGINATION_PARAM_LENGTH) return undefined;
  if (!POSITIVE_INTEGER_PARAM_RE.test(raw)) return undefined;

  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
};

const normalizedPositiveInteger = (value: unknown, fallback: number, max: number): number => {
  const parsed = numericListingSearchParam(value);
  if (parsed === undefined || !Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(1, Math.floor(parsed)));
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
  Array.isArray(values)
    ? values.slice(0, MAX_PUBLIC_LISTING_URLS).flatMap((value) => publicHttpUrl(value) ?? [])
    : [];

const publicListingText = (value: unknown): string | undefined =>
  typeof value === 'string' ? redactDirectContactInfo(value) : undefined;

const publicListingTextArray = (values: unknown): string[] =>
  Array.isArray(values) ? values.flatMap((value) => publicListingText(value) ?? []) : [];

const publicListingForAuthenticatedReader = (listing: any) => {
  const id = serializedDocumentId(listing._id) || serializedDocumentId(listing.id) || '';
  return {
    _id: id,
    id,
    title: publicListingText(listing.title),
    hiringStatus: publicListingText(listing.hiringStatus),
    websites: publicHttpUrls(listing.websites),
    description: publicListingText(listing.description),
    applicantDescription: publicListingText(listing.applicantDescription),
    researchAreas: publicListingTextArray(listing.researchAreas),
    keywords: publicListingTextArray(listing.keywords),
    established: listing.established,
    departments: publicListingTextArray(listing.departments),
    type: publicListingText(listing.type),
    commitment: publicListingText(listing.commitment),
    compensationType: publicListingText(listing.compensationType),
    expiresAt: listing.expiresAt,
  };
};

const LISTING_OUTREACH_OUTCOMES = new Set(['emailed', 'will_contact_later', 'not_a_fit']);
const LISTING_OUTREACH_ACTIONS = new Set(['email_click', 'outcome']);

export const buildListingOutreachEvent = (params: {
  action?: unknown;
  outcome?: unknown;
  source?: unknown;
  contactCount?: number;
}) => {
  const action = typeof params.action === 'string' ? params.action : '';
  if (!LISTING_OUTREACH_ACTIONS.has(action)) {
    return null;
  }

  const source = typeof params.source === 'string' ? params.source.slice(0, 80) : 'listing_detail';
  const baseMetadata = {
    channel: 'email',
    source,
    contactCount: params.contactCount || 0,
  };

  if (action === 'email_click') {
    return {
      eventType: AnalyticsEventType.OUTREACH_CONTACT_ATTEMPT,
      metadata: {
        ...baseMetadata,
        action,
      },
    };
  }

  const outcome = typeof params.outcome === 'string' ? params.outcome : '';
  if (!LISTING_OUTREACH_OUTCOMES.has(outcome)) {
    return null;
  }

  return {
    eventType: AnalyticsEventType.OUTREACH_OUTCOME,
    metadata: {
      ...baseMetadata,
      action,
      outcome,
    },
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

export const recordListingOutreach = async (request: Request, response: Response) => {
  try {
    const listing = await readPublicListing(request.params.id);
    const contactCount = [listing.ownerEmail, ...(listing.emails || [])].filter(Boolean).length;
    const event = buildListingOutreachEvent({
      action: request.body?.action,
      outcome: request.body?.outcome,
      source: request.body?.source,
      contactCount,
    });

    if (!event) {
      return response.status(400).json({ error: 'Invalid outreach event' });
    }

    const currentUser = request.user as { netId?: string; userType: string };
    if (!currentUser?.netId) {
      return response.status(401).json({ error: 'Authentication required' });
    }

    await logEvent({
      eventType: event.eventType,
      netid: currentUser.netId,
      userType: currentUser.userType,
      listingId: request.params.id,
      metadata: event.metadata,
    });

    return response.status(204).send();
  } catch (error: any) {
    sendListingError(response, error, 'Failed to record outreach');
  }
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

    const trimmedQuery = boundedListingSearchQuery(query);
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
    } else if (trimmedQuery === '') {
      sortConfig.push(`${DEFAULT_PUBLIC_LISTING_SORT_FIELD}:asc`);
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
    if (trimmedQuery !== '' && trimmedQuery.split(/\s+/).length > 1) {
      searchParams.hybrid = {
        semanticRatio: 0.8,
        embedder: 'default',
      };
    }

    const mongoParams = {
      query: trimmedQuery,
      sortBy: listingSearchString(sortBy),
      sortOrder: listingSearchString(sortOrder),
      departments: listingSearchString(departments),
      academicDisciplines: listingSearchString(academicDisciplines),
      researchAreas: listingSearchString(researchAreas),
      departmentsMode: departmentsMode as string,
      academicDisciplinesMode: academicDisciplinesMode as string,
      researchAreasMode: researchAreasMode as string,
      limit,
      offset,
    };
    const searchResult = await searchListingsWithDegradation({
      query: trimmedQuery,
      searchParams,
      mongoParams,
    });

    return response.json({
      results: searchResult.results,
      totalCount: searchResult.totalCount,
      page: normalizedPage,
      pageSize: limit,
      degraded: searchResult.degraded,
    });
  } catch (error: any) {
    console.error('Listing search failed:', sanitizeLogValue(error));
    return response.status(500).json({ error: 'Search failed', degraded: true });
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
    response.status(201).json({ listing: publicListingForAuthenticatedReader(listing) });
  } catch (error: any) {
    console.error('Listing create failed:', sanitizeLogValue(error));
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
    response.status(201).json({ listing: publicListingForAuthenticatedReader(listing) });
  } catch (error: any) {
    console.error('Listing skeleton failed:', sanitizeLogValue(error));
    sendListingError(response, error, 'Failed to initialize listing');
  }
};

export const getListingById = async (request: Request, response: Response) => {
  try {
    const listing = await readPublicListing(request.params.id);
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
    response.status(200).json({ listing: publicListingForAuthenticatedReader(listing) });
  } catch (error: any) {
    console.error('Listing update failed:', sanitizeLogValue(error));
    sendListingError(response, error, 'Failed to update listing');
  }
};

export const archiveListingForCurrentUser = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };

    const listing = await archiveListing(request.params.id, currentUser.netId!);
    response.status(200).json({ listing: publicListingForAuthenticatedReader(listing) });
  } catch (error: any) {
    console.error('Listing archive failed:', sanitizeLogValue(error));
    sendListingError(response, error, 'Failed to archive listing');
  }
};

export const unarchiveListingForCurrentUser = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };

    const listing = await unarchiveListing(request.params.id, currentUser.netId!);
    response.status(200).json({ listing: publicListingForAuthenticatedReader(listing) });
  } catch (error: any) {
    console.error('Listing unarchive failed:', sanitizeLogValue(error));
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
      return response.status(403).json({ error: 'Forbidden' });
    }

    const deletedListing = await deleteListing(request.params.id);
    response.status(200).json({ deletedListing: publicListingForAuthenticatedReader(deletedListing) });
  } catch (error: any) {
    console.error('Listing delete failed:', sanitizeLogValue(error));
    sendListingError(response, error, 'Failed to delete listing');
  }
};
