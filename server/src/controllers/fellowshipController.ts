/**
 * Controller handlers for fellowship CRUD routes.
 */
import { Request, Response } from 'express';
import {
  readFellowship,
  searchFellowships,
  getFilterOptions,
  addView,
  addFavorite,
  removeFavorite,
} from '../services/fellowshipService';
import { publicProgramForReader } from './programPayload';
import { sanitizeLogValue } from '../utils/logSanitizer';
import { hasAdminAuthorityForUser } from '../services/adminGrantService';

const PUBLIC_FELLOWSHIP_SORT_FIELDS = new Set([
  'title',
  'deadline',
  'applicationOpenDate',
  'views',
  'favorites',
]);
const DEFAULT_PUBLIC_FELLOWSHIP_SORT_FIELD = 'deadline';
const MAX_SEARCH_PAGE = 1000;
const MAX_SEARCH_PAGE_SIZE = 100;
const MAX_FELLOWSHIP_SEARCH_QUERY_LENGTH = 512;
const MAX_FELLOWSHIP_SEARCH_FILTER_VALUES = 50;
const MAX_FELLOWSHIP_SEARCH_FILTER_VALUE_LENGTH = 120;
const MAX_FELLOWSHIP_SEARCH_PAGINATION_PARAM_LENGTH = 16;
const POSITIVE_INTEGER_PARAM_RE = /^[1-9]\d*$/;

const publicFellowshipSortField = (value: unknown): string =>
  typeof value === 'string' && PUBLIC_FELLOWSHIP_SORT_FIELDS.has(value)
    ? value
    : DEFAULT_PUBLIC_FELLOWSHIP_SORT_FIELD;

const numericSearchParam = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : undefined;
  }

  const raw = value.trim();
  if (!raw || raw.length > MAX_FELLOWSHIP_SEARCH_PAGINATION_PARAM_LENGTH) return undefined;
  if (!POSITIVE_INTEGER_PARAM_RE.test(raw)) return undefined;

  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
};

const publicFellowshipSortOrder = (value: unknown): 1 | -1 => (numericSearchParam(value) === 1 ? 1 : -1);
const publicFellowshipPage = (value: unknown): number =>
  Math.min(MAX_SEARCH_PAGE, Math.max(1, Math.floor(numericSearchParam(value) || 1)));
const publicFellowshipPageSize = (value: unknown): number =>
  Math.min(MAX_SEARCH_PAGE_SIZE, Math.max(1, Math.floor(numericSearchParam(value) || 20)));

const searchParamString = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return searchParamString(value[0]);
  return '';
};

const boundedSearchQuery = (value: unknown): string =>
  searchParamString(value).trim().slice(0, MAX_FELLOWSHIP_SEARCH_QUERY_LENGTH);

const parseFilter = (filter: unknown): string[] => {
  const seen = new Set<string>();
  const clean: string[] = [];

  for (const item of searchParamString(filter).split(/[,|]/)) {
    const boundedValue = item.trim().slice(0, MAX_FELLOWSHIP_SEARCH_FILTER_VALUE_LENGTH);
    if (!boundedValue || seen.has(boundedValue)) continue;
    seen.add(boundedValue);
    clean.push(boundedValue);
    if (clean.length >= MAX_FELLOWSHIP_SEARCH_FILTER_VALUES) break;
  }

  return clean;
};

const sendFellowshipError = (response: Response, error: any, fallbackMessage: string) => {
  if (error?.name === 'NotFoundError') {
    return response.status(404).json({ error: 'Fellowship not found' });
  }

  return response.status(500).json({ error: fallbackMessage });
};

export const searchFellowshipsController = async (request: Request, response: Response) => {
  try {
    const {
      query,
      page = '1',
      pageSize = '20',
      sortBy = DEFAULT_PUBLIC_FELLOWSHIP_SORT_FIELD,
      sortOrder = '1',
      yearOfStudy,
      termOfAward,
      purpose,
      globalRegions,
      citizenshipStatus,
    } = request.query;

    const result = await searchFellowships({
      query: boundedSearchQuery(query),
      page: publicFellowshipPage(page),
      pageSize: publicFellowshipPageSize(pageSize),
      sortBy: publicFellowshipSortField(sortBy),
      sortOrder: publicFellowshipSortOrder(sortOrder),
      yearOfStudy: parseFilter(yearOfStudy),
      termOfAward: parseFilter(termOfAward),
      purpose: parseFilter(purpose),
      globalRegions: parseFilter(globalRegions),
      citizenshipStatus: parseFilter(citizenshipStatus),
    });

    response.json({
      results: result.fellowships.map(publicProgramForReader),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      totalPages: result.totalPages,
    });
  } catch (error) {
    console.error('Fellowship search failed:', sanitizeLogValue(error));
    response.status(500).json({ error: 'Search failed' });
  }
};

export const getFellowshipById = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as
      | { netId?: string; netid?: string; userType?: string }
      | undefined;
    const hasAdminAuthority = await hasAdminAuthorityForUser(currentUser);
    const fellowship = await readFellowship(request.params.id, {
      includeNonPublic: hasAdminAuthority,
    });
    response.status(200).json({
      fellowship:
        hasAdminAuthority ? fellowship : publicProgramForReader(fellowship),
    });
  } catch (error: any) {
    sendFellowshipError(response, error, 'Failed to fetch fellowship');
  }
};

export const getFellowshipFilterOptions = async (request: Request, response: Response) => {
  try {
    const options = await getFilterOptions();
    response.status(200).json(options);
  } catch (error: any) {
    response.status(500).json({ error: 'Failed to fetch fellowship filters' });
  }
};

export const addViewToFellowship = async (request: Request, response: Response) => {
  try {
    const fellowship = await addView(request.params.id);
    response.status(200).json({ fellowship: publicProgramForReader(fellowship) });
  } catch (error: any) {
    sendFellowshipError(response, error, 'Failed to update fellowship view count');
  }
};

export const addFavoriteToFellowship = async (request: Request, response: Response) => {
  try {
    const fellowship = await addFavorite(request.params.id);
    response.status(200).json({ fellowship: publicProgramForReader(fellowship) });
  } catch (error: any) {
    sendFellowshipError(response, error, 'Failed to favorite fellowship');
  }
};

export const removeFavoriteFromFellowship = async (request: Request, response: Response) => {
  try {
    const fellowship = await removeFavorite(request.params.id);
    response.status(200).json({ fellowship: publicProgramForReader(fellowship) });
  } catch (error: any) {
    sendFellowshipError(response, error, 'Failed to remove fellowship favorite');
  }
};
