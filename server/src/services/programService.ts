/**
 * Program-facing service wrappers.
 *
 * Storage still uses the Fellowship model while `/api/programs` is the canonical
 * public contract for fellowships, center internships, and recurring programs.
 */
import {
  getFilterOptions,
  readFellowship,
  readFellowships,
  searchFellowships,
  updateFellowship,
} from './fellowshipService';

export const readProgram = readFellowship;
export const readPrograms = readFellowships;
export const updateProgram = updateFellowship;
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
