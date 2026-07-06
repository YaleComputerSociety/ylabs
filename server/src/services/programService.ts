/**
 * Program-facing service wrappers.
 *
 * Storage still uses the Fellowship model while `/api/programs` is the canonical
 * public contract for fellowships, center internships, and recurring programs.
 */
import {
  addFavorite,
  addView,
  archiveFellowship,
  bulkCreateFellowships,
  createFellowship,
  deleteFellowship,
  getFilterOptions,
  readAllFellowships,
  readFellowship,
  readFellowships,
  removeFavorite,
  searchFellowships,
  unarchiveFellowship,
  updateFellowship,
} from './fellowshipService';

export const createProgram = createFellowship;
export const readProgram = readFellowship;
export const readPrograms = readFellowships;
export const readAllPrograms = readAllFellowships;
export const updateProgram = updateFellowship;
export const archiveProgram = archiveFellowship;
export const unarchiveProgram = unarchiveFellowship;
export const deleteProgram = deleteFellowship;
export const addProgramView = addView;
export const addProgramFavorite = addFavorite;
export const removeProgramFavorite = removeFavorite;
export const bulkCreatePrograms = bulkCreateFellowships;
export const getProgramFilterOptions = getFilterOptions;

export const searchPrograms = async (params: Parameters<typeof searchFellowships>[0]) => {
  const result = await searchFellowships(params);
  return {
    programs: result.fellowships,
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    totalPages: result.totalPages,
  };
};
