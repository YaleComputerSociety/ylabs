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

const PUBLIC_FELLOWSHIP_SORT_FIELDS = new Set([
  'updatedAt',
  'createdAt',
  'title',
  'deadline',
  'applicationOpenDate',
  'views',
  'favorites',
]);
const MAX_SEARCH_PAGE = 1000;
const MAX_SEARCH_PAGE_SIZE = 100;

const publicFellowshipSortField = (value: unknown): string =>
  typeof value === 'string' && PUBLIC_FELLOWSHIP_SORT_FIELDS.has(value) ? value : 'updatedAt';

const publicFellowshipSortOrder = (value: unknown): 1 | -1 => (Number(value) === 1 ? 1 : -1);
const publicFellowshipPage = (value: unknown): number =>
  Math.min(MAX_SEARCH_PAGE, Math.max(1, Math.floor(Number(value)) || 1));
const publicFellowshipPageSize = (value: unknown): number =>
  Math.min(MAX_SEARCH_PAGE_SIZE, Math.max(1, Math.floor(Number(value)) || 20));

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
      sortBy = 'updatedAt',
      sortOrder = '-1',
      yearOfStudy,
      termOfAward,
      purpose,
      globalRegions,
      citizenshipStatus,
    } = request.query;

    const parseFilter = (filter: string | undefined): string[] => {
      if (!filter) return [];
      return filter
        .split(/[,|]/)
        .map((s) => s.trim())
        .filter(Boolean);
    };

    const result = await searchFellowships({
      query: query as string,
      page: publicFellowshipPage(page),
      pageSize: publicFellowshipPageSize(pageSize),
      sortBy: publicFellowshipSortField(sortBy),
      sortOrder: publicFellowshipSortOrder(sortOrder),
      yearOfStudy: parseFilter(yearOfStudy as string),
      termOfAward: parseFilter(termOfAward as string),
      purpose: parseFilter(purpose as string),
      globalRegions: parseFilter(globalRegions as string),
      citizenshipStatus: parseFilter(citizenshipStatus as string),
    });

    response.json({
      results: result.fellowships.map(publicProgramForReader),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      totalPages: result.totalPages,
    });
  } catch (error) {
    console.error('Fellowship search failed:', error);
    response.status(500).json({ error: 'Search failed' });
  }
};

export const getFellowshipById = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { userType?: string } | undefined;
    const fellowship = await readFellowship(request.params.id, {
      includeNonPublic: currentUser?.userType === 'admin',
    });
    response.status(200).json({
      fellowship:
        currentUser?.userType === 'admin' ? fellowship : publicProgramForReader(fellowship),
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
