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

const parseFilter = (filter: string | undefined): string[] => {
  if (!filter) return [];
  return filter
    .split(/[,|]/)
    .map((s) => s.trim())
    .filter(Boolean);
};

const parseStudentVisibilityFilter = (filter: string | undefined): StudentVisibilityTier[] =>
  parseFilter(filter).filter(isStudentVisibilityTier);

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
      page: parseInt(page as string, 10),
      pageSize: parseInt(pageSize as string, 10),
      sortBy: sortBy as string,
      sortOrder: parseInt(sortOrder as string, 10),
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

    response.json({
      results: result.programs,
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
    response.status(200).json({ program, fellowship: program });
  } catch (error: any) {
    if (error.name === 'NotFoundError') {
      response.status(404).json({ error: error.message });
    } else {
      response.status(500).json({ error: error.message });
    }
  }
};

export const getProgramFilterOptions = async (_request: Request, response: Response) => {
  try {
    const options = await readProgramFilterOptions();
    response.status(200).json(options);
  } catch (error: any) {
    response.status(500).json({ error: error.message });
  }
};

export const addViewToProgram = async (request: Request, response: Response) => {
  try {
    const program = await addProgramView(request.params.id);
    response.status(200).json({ program, fellowship: program });
  } catch (error: any) {
    if (error.name === 'NotFoundError') {
      response.status(404).json({ error: error.message });
    } else {
      response.status(500).json({ error: error.message });
    }
  }
};

export const addFavoriteToProgram = async (request: Request, response: Response) => {
  try {
    const program = await addProgramFavorite(request.params.id);
    response.status(200).json({ program, fellowship: program });
  } catch (error: any) {
    if (error.name === 'NotFoundError') {
      response.status(404).json({ error: error.message });
    } else {
      response.status(500).json({ error: error.message });
    }
  }
};

export const removeFavoriteFromProgram = async (request: Request, response: Response) => {
  try {
    const program = await removeProgramFavorite(request.params.id);
    response.status(200).json({ program, fellowship: program });
  } catch (error: any) {
    if (error.name === 'NotFoundError') {
      response.status(404).json({ error: error.message });
    } else {
      response.status(500).json({ error: error.message });
    }
  }
};
