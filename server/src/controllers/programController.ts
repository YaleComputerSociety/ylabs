/**
 * Controller handlers for canonical program routes.
 */
import { Request, Response } from 'express';
import {
  readProgram,
  searchPrograms,
  getProgramFilterOptions as readProgramFilterOptions,
  addProgramView,
  addProgramFavorite,
  removeProgramFavorite,
} from '../services/programService';
import { isStudentVisibilityTier, type StudentVisibilityTier } from '../models/studentVisibility';
import { publicProgramForReader } from './programPayload';

const sendProgramError = (response: Response, error: any, fallbackMessage: string) => {
  if (error?.name === 'NotFoundError') {
    return response.status(404).json({ error: 'Program not found' });
  }

  return response.status(500).json({ error: fallbackMessage });
};

const parseFilter = (filter: string | undefined): string[] => {
  if (!filter) return [];
  return filter
    .split(/[,|]/)
    .map((s) => s.trim())
    .filter(Boolean);
};

const parseStudentVisibilityFilter = (filter: string | undefined): StudentVisibilityTier[] =>
  parseFilter(filter).filter(isStudentVisibilityTier);

const PUBLIC_PROGRAM_SORT_FIELDS = new Set([
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

const publicProgramSortField = (value: unknown): string =>
  typeof value === 'string' && PUBLIC_PROGRAM_SORT_FIELDS.has(value) ? value : 'updatedAt';

const publicProgramSortOrder = (value: unknown): 1 | -1 => (Number(value) === 1 ? 1 : -1);
const publicProgramPage = (value: unknown): number =>
  Math.min(MAX_SEARCH_PAGE, Math.max(1, Math.floor(Number(value)) || 1));
const publicProgramPageSize = (value: unknown): number =>
  Math.min(MAX_SEARCH_PAGE_SIZE, Math.max(1, Math.floor(Number(value)) || 20));

export const searchProgramsController = async (request: Request, response: Response) => {
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
      programCategory,
      programKind,
      entryMode,
      studentFacingCategory,
      studentVisibilityTier,
      includeOperatorReview,
      includeSuppressed,
    } = request.query;
    const currentUser = request.user as { userType?: string } | undefined;
    const isAdmin = currentUser?.userType === 'admin';

    const result = await searchPrograms({
      query: query as string,
      page: publicProgramPage(page),
      pageSize: publicProgramPageSize(pageSize),
      sortBy: publicProgramSortField(sortBy),
      sortOrder: publicProgramSortOrder(sortOrder),
      yearOfStudy: parseFilter(yearOfStudy as string),
      termOfAward: parseFilter(termOfAward as string),
      purpose: parseFilter(purpose as string),
      globalRegions: parseFilter(globalRegions as string),
      citizenshipStatus: parseFilter(citizenshipStatus as string),
      programCategory: parseFilter(programCategory as string),
      programKind: parseFilter(programKind as string),
      entryMode: parseFilter(entryMode as string),
      studentFacingCategory: parseFilter(studentFacingCategory as string),
      includeNonPublic: isAdmin,
      studentVisibilityTier: isAdmin
        ? parseStudentVisibilityFilter(studentVisibilityTier as string)
        : [],
      includeOperatorReview: isAdmin && includeOperatorReview === 'true',
      includeSuppressed: isAdmin && includeSuppressed === 'true',
    });
    const programs = isAdmin
      ? result.programs
      : result.programs.map(publicProgramForReader);

    response.json({
      results: programs,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      totalPages: result.totalPages,
    });
  } catch (error) {
    console.error('Program search failed:', error);
    response.status(500).json({ error: 'Search failed' });
  }
};

export const getProgramById = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { userType?: string } | undefined;
    const program = await readProgram(request.params.id, {
      includeNonPublic: currentUser?.userType === 'admin',
    });
    const publicProgram =
      currentUser?.userType === 'admin' ? program : publicProgramForReader(program);
    response.status(200).json({ program: publicProgram, fellowship: publicProgram });
  } catch (error: any) {
    sendProgramError(response, error, 'Failed to fetch program');
  }
};

export const getProgramFilterOptions = async (_request: Request, response: Response) => {
  try {
    const options = await readProgramFilterOptions();
    response.status(200).json(options);
  } catch (error: any) {
    response.status(500).json({ error: 'Failed to fetch program filters' });
  }
};

export const addViewToProgram = async (request: Request, response: Response) => {
  try {
    const program = await addProgramView(request.params.id);
    const publicProgram = publicProgramForReader(program);
    response.status(200).json({ program: publicProgram, fellowship: publicProgram });
  } catch (error: any) {
    sendProgramError(response, error, 'Failed to update program view count');
  }
};

export const addFavoriteToProgram = async (request: Request, response: Response) => {
  try {
    const program = await addProgramFavorite(request.params.id);
    const publicProgram = publicProgramForReader(program);
    response.status(200).json({ program: publicProgram, fellowship: publicProgram });
  } catch (error: any) {
    sendProgramError(response, error, 'Failed to favorite program');
  }
};

export const removeFavoriteFromProgram = async (request: Request, response: Response) => {
  try {
    const program = await removeProgramFavorite(request.params.id);
    const publicProgram = publicProgramForReader(program);
    response.status(200).json({ program: publicProgram, fellowship: publicProgram });
  } catch (error: any) {
    sendProgramError(response, error, 'Failed to remove program favorite');
  }
};
