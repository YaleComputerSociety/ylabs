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
import { sanitizeLogValue } from '../utils/logSanitizer';
import { hasAdminAuthorityForUser } from '../services/adminGrantService';

const sendProgramError = (response: Response, error: any, fallbackMessage: string) => {
  if (error?.name === 'NotFoundError') {
    return response.status(404).json({ error: 'Program not found' });
  }

  return response.status(500).json({ error: fallbackMessage });
};

const MAX_PROGRAM_SEARCH_QUERY_LENGTH = 512;
const MAX_PROGRAM_SEARCH_FILTER_VALUES = 50;
const MAX_PROGRAM_SEARCH_FILTER_VALUE_LENGTH = 120;

const searchParamString = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return searchParamString(value[0]);
  return '';
};

const boundedSearchQuery = (value: unknown): string =>
  searchParamString(value).trim().slice(0, MAX_PROGRAM_SEARCH_QUERY_LENGTH);

const parseFilter = (filter: unknown): string[] => {
  const seen = new Set<string>();
  const clean: string[] = [];

  for (const item of searchParamString(filter).split(/[,|]/)) {
    const boundedValue = item.trim().slice(0, MAX_PROGRAM_SEARCH_FILTER_VALUE_LENGTH);
    if (!boundedValue || seen.has(boundedValue)) continue;
    seen.add(boundedValue);
    clean.push(boundedValue);
    if (clean.length >= MAX_PROGRAM_SEARCH_FILTER_VALUES) break;
  }

  return clean;
};

const parseStudentVisibilityFilter = (filter: unknown): StudentVisibilityTier[] =>
  parseFilter(filter).filter(isStudentVisibilityTier);

const PUBLIC_PROGRAM_SORT_FIELDS = new Set([
  'title',
  'deadline',
  'applicationOpenDate',
  'views',
  'favorites',
]);
const OPERATOR_PROGRAM_SORT_FIELDS = new Set([
  ...PUBLIC_PROGRAM_SORT_FIELDS,
  'updatedAt',
  'createdAt',
]);
const DEFAULT_PUBLIC_PROGRAM_SORT_FIELD = 'deadline';
const MAX_SEARCH_PAGE = 1000;
const MAX_SEARCH_PAGE_SIZE = 100;
const MAX_PROGRAM_SEARCH_PAGINATION_PARAM_LENGTH = 16;
const POSITIVE_INTEGER_PARAM_RE = /^[1-9]\d*$/;

const publicProgramSortField = (value: unknown, includeOperatorFields = false): string => {
  const allowedFields = includeOperatorFields
    ? OPERATOR_PROGRAM_SORT_FIELDS
    : PUBLIC_PROGRAM_SORT_FIELDS;
  return typeof value === 'string' && allowedFields.has(value)
    ? value
    : DEFAULT_PUBLIC_PROGRAM_SORT_FIELD;
};

const numericSearchParam = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : undefined;
  }

  const raw = value.trim();
  if (!raw || raw.length > MAX_PROGRAM_SEARCH_PAGINATION_PARAM_LENGTH) return undefined;
  if (!POSITIVE_INTEGER_PARAM_RE.test(raw)) return undefined;

  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
};

const publicProgramSortOrder = (value: unknown): 1 | -1 =>
  numericSearchParam(value) === 1 ? 1 : -1;
const publicProgramPage = (value: unknown): number =>
  Math.min(MAX_SEARCH_PAGE, Math.max(1, Math.floor(numericSearchParam(value) || 1)));
const publicProgramPageSize = (value: unknown): number =>
  Math.min(MAX_SEARCH_PAGE_SIZE, Math.max(1, Math.floor(numericSearchParam(value) || 20)));

export const searchProgramsController = async (request: Request, response: Response) => {
  try {
    const {
      query,
      page = '1',
      pageSize = '20',
      sortBy = DEFAULT_PUBLIC_PROGRAM_SORT_FIELD,
      sortOrder = '1',
      yearOfStudy,
      termOfAward,
      purpose,
      globalRegions,
      citizenshipStatus,
      programCategory,
      programKind,
      entryMode,
      studentFacingCategory,
      subjects,
      studentVisibilityTier,
      includeOperatorReview,
      includeSuppressed,
    } = request.query;
    const currentUser = request.user as
      | { netId?: string; netid?: string; userType?: string }
      | undefined;
    const hasAdminAuthority = await hasAdminAuthorityForUser(currentUser);

    const result = await searchPrograms({
      query: boundedSearchQuery(query),
      page: publicProgramPage(page),
      pageSize: publicProgramPageSize(pageSize),
      sortBy: publicProgramSortField(sortBy, hasAdminAuthority),
      sortOrder: publicProgramSortOrder(sortOrder),
      yearOfStudy: parseFilter(yearOfStudy),
      termOfAward: parseFilter(termOfAward),
      purpose: parseFilter(purpose),
      globalRegions: parseFilter(globalRegions),
      citizenshipStatus: parseFilter(citizenshipStatus),
      programCategory: parseFilter(programCategory),
      programKind: parseFilter(programKind),
      entryMode: parseFilter(entryMode),
      studentFacingCategory: parseFilter(studentFacingCategory),
      subjects: parseFilter(subjects),
      includeNonPublic: hasAdminAuthority,
      studentVisibilityTier: hasAdminAuthority
        ? parseStudentVisibilityFilter(studentVisibilityTier)
        : [],
      includeOperatorReview: hasAdminAuthority && includeOperatorReview === 'true',
      includeSuppressed: hasAdminAuthority && includeSuppressed === 'true',
    });
    const programs = hasAdminAuthority
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
    console.error('Program search failed:', sanitizeLogValue(error));
    response.status(500).json({ error: 'Search failed' });
  }
};

export const getProgramById = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as
      | { netId?: string; netid?: string; userType?: string }
      | undefined;
    const hasAdminAuthority = await hasAdminAuthorityForUser(currentUser);
    const program = await readProgram(request.params.id, {
      includeNonPublic: hasAdminAuthority,
    });
    const publicProgram = hasAdminAuthority ? program : publicProgramForReader(program);
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
