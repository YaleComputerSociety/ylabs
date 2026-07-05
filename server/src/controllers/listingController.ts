/**
 * Controller handlers for listing CRUD routes.
 */
import { Request, Response, NextFunction } from 'express';
import {
  archiveListing,
  createListing,
  deleteListing,
  readListing,
  unarchiveListing,
  updateListing,
  getSkeletonListing,
  addView,
} from '../services/listingService';
import { readUser } from '../services/userService';
import { getMeiliIndex } from '../utils/meiliClient';
import { getConfig } from '../services/configService';
import { getListingModel } from '../db/connections';
import { buildSafeSearchRegex } from '../utils/regex';
import { logEvent } from '../services/analyticsService';
import { AnalyticsEventType } from '../models/analytics';

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

const PUBLIC_LISTING_SEARCHABLE_FIELDS = [
  'title',
  'description',
  'applicantDescription',
  'ownerFirstName',
  'ownerLastName',
  'ownerTitle',
  'ownerPrimaryDepartment',
  'professorNames',
  'departments',
  'researchAreas',
  'keywords',
];

const PUBLIC_LISTING_SORT_FIELDS = new Set(['createdAt', 'updatedAt']);

const getIdFromSlug = (slug: string): string | null => {
  const match = slug.match(/[a-fA-F0-9]{24}/);
  return match ? match[0] : null;
};

const PUBLIC_RESEARCH_OUTREACH_OUTCOMES = new Set(['emailed', 'will_contact_later', 'not_a_fit']);

const PUBLIC_RESEARCH_OUTREACH_ACTIONS = new Set(['email_click', 'outcome']);

export const buildPublicResearchOutreachEvent = (params: {
  action?: unknown;
  outcome?: unknown;
  source?: unknown;
  contactCount?: number;
}) => {
  const action = typeof params.action === 'string' ? params.action : '';
  if (!PUBLIC_RESEARCH_OUTREACH_ACTIONS.has(action)) {
    return null;
  }

  const source = typeof params.source === 'string' ? params.source.slice(0, 80) : 'research_detail';
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
  if (!PUBLIC_RESEARCH_OUTREACH_OUTCOMES.has(outcome)) {
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

const redactPublicListing = (listing: any) => {
  const source = typeof listing?.toObject === 'function' ? listing.toObject() : listing;
  const redacted = { ...(source || {}) };
  const rawId = redacted._id?.toString?.() || redacted.id;
  delete redacted.__v;
  delete redacted.ownerEmail;
  delete redacted.emails;
  delete redacted.views;
  delete redacted.favorites;
  delete redacted.archived;
  delete redacted.confirmed;
  delete redacted.audited;

  return {
    ...redacted,
    _id: rawId,
    id: rawId,
    ownerId: undefined,
    ownerEmail: undefined,
    professorIds: [],
    emails: [],
    views: 0,
    favorites: 0,
    archived: false,
    confirmed: true,
  };
};

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

const parseFilterList = (value: string | undefined, separator: RegExp | string): string[] =>
  value
    ? value
        .split(separator)
        .map((item) => item.trim())
        .filter(Boolean)
    : [];

const buildMongoFilterMatch = async (params: {
  query?: string;
  departments?: string;
  departmentsMode: string;
  academicDisciplines?: string;
  academicDisciplinesMode: string;
  researchAreas?: string;
  researchAreasMode: string;
  searchableFields?: string[];
}) => {
  const {
    query,
    departments,
    departmentsMode,
    academicDisciplines,
    academicDisciplinesMode,
    researchAreas,
    researchAreasMode,
    searchableFields = [
      'title',
      'description',
      'applicantDescription',
      'ownerFirstName',
      'ownerLastName',
      'ownerEmail',
      'ownerTitle',
      'ownerPrimaryDepartment',
      'professorNames',
      'departments',
      'researchAreas',
      'keywords',
    ],
  } = params;

  const baseFilter: Record<string, any> = { archived: false, confirmed: true };
  const crossFilterConditions: Record<string, any>[] = [];
  const departmentList = parseFilterList(departments, '||');
  const disciplineList = parseFilterList(academicDisciplines, '||');
  const researchAreaList = parseFilterList(researchAreas, ',');

  const useAndBetweenFilters =
    (departmentList.length > 0 && departmentsMode === 'intersection') ||
    (disciplineList.length > 0 && academicDisciplinesMode === 'intersection') ||
    (researchAreaList.length > 0 && researchAreasMode === 'intersection');

  if (departmentList.length > 0) {
    crossFilterConditions.push(
      departmentsMode === 'intersection'
        ? { departments: { $all: departmentList } }
        : { departments: { $in: departmentList } },
    );
  }

  if (disciplineList.length > 0) {
    const config = await getConfig();
    const departmentsByDiscipline = disciplineList.map((discipline) =>
      config.departments.list
        .filter(
          (dept: any) =>
            dept.categories.includes(discipline) || dept.primaryCategory === discipline,
        )
        .map((dept: any) => dept.displayName),
    );

    const disciplineConditions = departmentsByDiscipline
      .filter((departmentsForDiscipline) => departmentsForDiscipline.length > 0)
      .map((departmentsForDiscipline) => ({ departments: { $in: departmentsForDiscipline } }));

    if (disciplineConditions.length > 0) {
      crossFilterConditions.push(
        academicDisciplinesMode === 'intersection'
          ? { $and: disciplineConditions }
          : { $or: disciplineConditions },
      );
    }
  }

  if (researchAreaList.length > 0) {
    crossFilterConditions.push(
      researchAreasMode === 'intersection'
        ? { researchAreas: { $all: researchAreaList } }
        : { researchAreas: { $in: researchAreaList } },
    );
  }

  if (crossFilterConditions.length > 0) {
    baseFilter[useAndBetweenFilters ? '$and' : '$or'] = crossFilterConditions;
  }

  const trimmedQuery = (query || '').trim();
  if (trimmedQuery !== '') {
    const queryConditions = trimmedQuery.split(/\s+/).map((term) => ({
      $or: searchableFields.map((field) => ({ [field]: buildSafeSearchRegex(term) })),
    }));

    if (queryConditions.length > 0) {
      baseFilter.$and = [...(baseFilter.$and || []), ...queryConditions];
    }
  }

  return baseFilter;
};

type MongoListingSearchParams = {
  query?: string;
  sortBy?: string;
  sortOrder?: string;
  departments?: string;
  academicDisciplines?: string;
  researchAreas?: string;
  departmentsMode: string;
  academicDisciplinesMode: string;
  researchAreasMode: string;
  limit: number;
  offset: number;
  searchableFields?: string[];
  defaultSort?: Record<string, 1 | -1>;
};

type ListingSearchEnvelope = {
  results: any[];
  totalCount: number;
  degraded: boolean;
};

export const searchListingsViaMongo = async (
  params: MongoListingSearchParams,
): Promise<{ hits: any[]; totalCount: number }> => {
  const filter = await buildMongoFilterMatch(params);
  const sort: Record<string, 1 | -1> = {};

  if (params.sortBy) {
    sort[params.sortBy] = params.sortOrder === '1' ? 1 : -1;
  } else if (!params.query || params.query.trim() === '') {
    Object.assign(
      sort,
      params.defaultSort || {
        browseRankScore: -1,
        lastObservedAt: -1,
        createdAt: -1,
      },
    );
  } else {
    sort.updatedAt = -1;
  }

  const ListingModel = getListingModel();
  const [hits, totalCount] = await Promise.all([
    ListingModel.find(filter).sort(sort).skip(params.offset).limit(params.limit).lean(),
    ListingModel.countDocuments(filter),
  ]);

  return {
    hits: hits.map((hit: any) => ({ ...hit, _id: hit._id.toString() })),
    totalCount,
  };
};

export const searchListingsViaMeiliWithDegrade = async (
  query: string,
  searchParams: Record<string, any>,
  getIndex = () => getMeiliIndex('listings'),
) => {
  const index = await getIndex();

  try {
    const result = await index.search(query, searchParams);
    return { result, degraded: false };
  } catch (error) {
    if (!searchParams.hybrid) {
      throw error;
    }

    console.error('Meilisearch hybrid search failed; retrying keyword-only search:', error);
    const keywordParams = { ...searchParams };
    delete keywordParams.hybrid;
    const result = await index.search(query, keywordParams);
    return { result, degraded: true };
  }
};

export const searchListingsWithDegradation = async (params: {
  query: string;
  searchParams: Record<string, any>;
  mongoParams: MongoListingSearchParams;
  getIndex?: () => Promise<{
    search: (query: string, params: Record<string, any>) => Promise<any>;
  }>;
  mongoSearch?: typeof searchListingsViaMongo;
}): Promise<ListingSearchEnvelope> => {
  try {
    const meiliResult = await searchListingsViaMeiliWithDegrade(
      params.query,
      params.searchParams,
      params.getIndex,
    );

    return {
      results: meiliResult.result.hits.map((hit: any) => ({ ...hit, _id: hit.id })),
      totalCount: meiliResult.result.estimatedTotalHits,
      degraded: meiliResult.degraded,
    };
  } catch (error) {
    console.error('Meilisearch search failed; falling back to Mongo search:', error);
    const mongoResult = await (params.mongoSearch || searchListingsViaMongo)(params.mongoParams);

    return {
      results: mongoResult.hits,
      totalCount: mongoResult.totalCount,
      degraded: true,
    };
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

    const filterString = await buildRobustFilterMatch({
      departments: departments as string,
      departmentsMode: departmentsMode as string,
      academicDisciplines: academicDisciplines as string,
      academicDisciplinesMode: academicDisciplinesMode as string,
      researchAreas: researchAreas as string,
      researchAreasMode: researchAreasMode as string,
    });

    const limit = Number(pageSize);
    const offset = (Number(page) - 1) * limit;

    const sortConfig = [];
    if (sortBy) {
      const order = sortOrder === '1' ? 'asc' : 'desc';
      sortConfig.push(`${sortBy}:${order}`);
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

    const mongoParams = {
      query: query as string,
      sortBy: sortBy as string,
      sortOrder: sortOrder as string,
      departments: departments as string,
      academicDisciplines: academicDisciplines as string,
      researchAreas: researchAreas as string,
      departmentsMode: departmentsMode as string,
      academicDisciplinesMode: academicDisciplinesMode as string,
      researchAreasMode: researchAreasMode as string,
      limit,
      offset,
    };
    const searchResult = await searchListingsWithDegradation({
      query: (query as string) || '',
      searchParams,
      mongoParams,
    });

    return response.json({
      results: searchResult.results,
      totalCount: searchResult.totalCount,
      page: Number(page),
      pageSize: Number(pageSize),
      degraded: searchResult.degraded,
    });
  } catch (error) {
    console.error('Listing search failed:', error);
    return response.status(500).json({ error: 'Search failed', degraded: true });
  }
};

export const getPublicResearchSortBy = (sortBy: unknown): string | undefined => {
  return typeof sortBy === 'string' && PUBLIC_LISTING_SORT_FIELDS.has(sortBy) ? sortBy : undefined;
};

export const buildPublicResearchSearchInputs = async (queryParams: Request['query']) => {
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
  } = queryParams;

  const filterString = await buildRobustFilterMatch({
    departments: departments as string,
    departmentsMode: departmentsMode as string,
    academicDisciplines: academicDisciplines as string,
    academicDisciplinesMode: academicDisciplinesMode as string,
    researchAreas: researchAreas as string,
    researchAreasMode: researchAreasMode as string,
  });

  const limit = Number(pageSize);
  const offset = (Number(page) - 1) * limit;
  const publicSortBy = getPublicResearchSortBy(sortBy);
  const sortConfig = [];
  if (publicSortBy) {
    const order = sortOrder === '1' ? 'asc' : 'desc';
    sortConfig.push(`${publicSortBy}:${order}`);
  } else if (!query || (query as string).trim() === '') {
    sortConfig.push('createdAt:desc');
  }

  const searchParams: any = {
    filter: filterString,
    limit,
    offset,
  };

  if (sortConfig.length > 0) {
    searchParams.sort = sortConfig;
  }

  const trimmedQuery = ((query as string) || '').trim();
  if (trimmedQuery !== '') {
    searchParams.attributesToSearchOn = PUBLIC_LISTING_SEARCHABLE_FIELDS;
  }

  if (trimmedQuery !== '' && trimmedQuery.split(/\s+/).length > 1) {
    searchParams.hybrid = {
      semanticRatio: 0.8,
      embedder: 'default',
    };
  }

  const mongoParams = {
    query: query as string,
    sortBy: publicSortBy,
    sortOrder: sortOrder as string,
    departments: departments as string,
    academicDisciplines: academicDisciplines as string,
    researchAreas: researchAreas as string,
    departmentsMode: departmentsMode as string,
    academicDisciplinesMode: academicDisciplinesMode as string,
    researchAreasMode: researchAreasMode as string,
    limit,
    offset,
    searchableFields: PUBLIC_LISTING_SEARCHABLE_FIELDS,
    defaultSort: { createdAt: -1 as const },
  };

  return {
    query: (query as string) || '',
    searchParams,
    mongoParams,
    page: Number(page),
    pageSize: Number(pageSize),
  };
};

export const searchPublicResearch = async (request: Request, response: Response) => {
  try {
    const publicSearch = await buildPublicResearchSearchInputs(request.query);

    const searchResult = await searchListingsWithDegradation({
      query: publicSearch.query,
      searchParams: publicSearch.searchParams,
      mongoParams: publicSearch.mongoParams,
    });

    return response.json({
      results: searchResult.results.map((hit: any) => redactPublicListing(hit)),
      totalCount: searchResult.totalCount,
      page: publicSearch.page,
      pageSize: publicSearch.pageSize,
      degraded: searchResult.degraded,
    });
  } catch (error) {
    console.error('Public research search failed:', error);
    return response.status(500).json({ error: 'Search failed', degraded: true });
  }
};

export const getPublicResearchBySlug = async (request: Request, response: Response) => {
  const id = getIdFromSlug(request.params.slug);
  if (!id) {
    return response.status(404).json({ error: 'Research listing not found' });
  }

  const listing = await getListingModel()
    .findOne({ _id: id, archived: false, confirmed: true })
    .lean();

  if (!listing) {
    return response.status(404).json({ error: 'Research listing not found' });
  }

  return response.status(200).json({ listing: redactPublicListing(listing) });
};

export const getAuthenticatedPublicResearchBySlug = async (
  request: Request,
  response: Response,
) => {
  const id = getIdFromSlug(request.params.slug);
  if (!id) {
    return response.status(404).json({ error: 'Research listing not found' });
  }

  const listing = await getListingModel()
    .findOne({ _id: id, archived: false, confirmed: true })
    .lean();

  if (!listing) {
    return response.status(404).json({ error: 'Research listing not found' });
  }

  const currentUser = request.user as { netId?: string; userType: string };
  if (currentUser?.netId) {
    const contactCount = [listing.ownerEmail, ...(listing.emails || [])].filter(Boolean).length;
    logEvent({
      eventType: AnalyticsEventType.OUTREACH_CONTACT_REVEAL,
      netid: currentUser.netId,
      userType: currentUser.userType,
      listingId: id,
      metadata: {
        channel: 'email',
        source: 'research_detail',
        contactCount,
      },
    }).catch((error) => console.error('Error logging research contact reveal:', error));
  }

  return response.status(200).json({ listing });
};

export const recordPublicResearchOutreach = async (request: Request, response: Response) => {
  const id = getIdFromSlug(request.params.slug);
  if (!id) {
    return response.status(404).json({ error: 'Research listing not found' });
  }

  const listing = await getListingModel()
    .findOne({ _id: id, archived: false, confirmed: true })
    .select('ownerEmail emails')
    .lean();

  if (!listing) {
    return response.status(404).json({ error: 'Research listing not found' });
  }

  const contactCount = [listing.ownerEmail, ...(listing.emails || [])].filter(Boolean).length;
  const event = buildPublicResearchOutreachEvent({
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
    listingId: id,
    metadata: event.metadata,
  });

  return response.status(204).send();
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
  } catch (error) {
    console.log((error as Error).message);
    response.status(400).json({ error: (error as Error).message });
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
  } catch (error) {
    console.log((error as Error).message);
    response.status(400).json({ error: (error as Error).message });
  }
};

export const getListingById = async (request: Request, response: Response) => {
  const listing = await readListing(request.params.id);
  response.status(200).json({ listing });
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
  'emails',
  'professorIds',
  'professorNames',
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
  next: NextFunction,
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
  } catch (error) {
    next(error);
  }
};

export const archiveListingForCurrentUser = async (request: Request, response: Response) => {
  const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };

  const listing = await archiveListing(request.params.id, currentUser.netId!);
  response.status(200).json({ listing });
};

export const unarchiveListingForCurrentUser = async (request: Request, response: Response) => {
  const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };

  const listing = await unarchiveListing(request.params.id, currentUser.netId!);
  response.status(200).json({ listing });
};

export const addViewToListing = async (request: Request, response: Response) => {
  const currentUser = request.user as { netId?: string; userType: string; userConfirmed: boolean };

  const listing = await addView(request.params.id, currentUser.netId!);
  response.status(200).json({ listing });
};

export const deleteListingForCurrentUser = async (request: Request, response: Response) => {
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
};
