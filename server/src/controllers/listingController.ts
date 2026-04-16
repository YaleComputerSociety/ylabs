/**
 * Controller handlers for listing CRUD routes.
 */
import { Request, Response } from "express";
import mongoose from 'mongoose';
import {
  archiveListing,
  createListing,
  deleteListing,
  readListing,
  unarchiveListing,
  updateListing,
  getSkeletonListing,
  addView
} from '../services/listingService';
import { readUser } from '../services/userService';
import { getListingModel } from "../db/connections";
import { getMeiliIndex } from '../utils/meiliClient';
import { getConfig } from '../services/configService';

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
    researchAreasMode
  } = params;

  const filters: string[] = ['archived = false', 'confirmed = true'];

  const departmentList = departments ? departments.split('||').filter(d => d.trim()) : [];
  const disciplineList = academicDisciplines ? academicDisciplines.split('||').filter(d => d.trim()) : [];
  const researchAreaList = researchAreas ? researchAreas.split(',').filter(r => r.trim()) : [];

  const hasFilters = departmentList.length > 0 || disciplineList.length > 0 || researchAreaList.length > 0;
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
      const condition = departmentList.map(d => `departments = "${d}"`).join(' AND ');
      filterConditions.push(`(${condition})`);
    } else {
      const condition = departmentList.map(d => `departments = "${d}"`).join(' OR ');
      filterConditions.push(`(${condition})`);
    }
  }

  if (disciplineList.length > 0) {
    const config = await getConfig();
    const departmentsByDiscipline: { [key: string]: string[] } = {};

    for (const discipline of disciplineList) {
      departmentsByDiscipline[discipline] = config.departments.list
        .filter((dept: any) => dept.categories.includes(discipline) || dept.primaryCategory === discipline)
        .map((dept: any) => dept.displayName);
    }

    if (academicDisciplinesMode === 'intersection') {
      const disciplineConditions = disciplineList
        .map(discipline => {
          const depts = departmentsByDiscipline[discipline] || [];
          if (depts.length === 0) return null;
          return `(${depts.map(d => `departments = "${d}"`).join(' OR ')})`;
        })
        .filter(Boolean);

      if (disciplineConditions.length > 0) {
        filterConditions.push(`(${disciplineConditions.join(' AND ')})`);
      }
    } else {
      const allDisciplineDepts = [...new Set(
        disciplineList.flatMap(discipline => departmentsByDiscipline[discipline] || [])
      )];
      if (allDisciplineDepts.length > 0) {
        const condition = allDisciplineDepts.map(d => `departments = "${d}"`).join(' OR ');
        filterConditions.push(`(${condition})`);
      }
    }
  }

  if (researchAreaList.length > 0) {
    if (researchAreasMode === 'intersection') {
      const condition = researchAreaList.map(r => `researchAreas = "${r}"`).join(' AND ');
      filterConditions.push(`(${condition})`);
    } else {
      const condition = researchAreaList.map(r => `researchAreas = "${r}"`).join(' OR ');
      filterConditions.push(`(${condition})`);
    }
  }

  if (filterConditions.length > 0) {
    const combinedConditions = filterConditions.join(useAndBetweenFilters ? ' AND ' : ' OR ');
    filters.push(`(${combinedConditions})`);
  }

  return filters.join(' AND ');
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
      pageSize = 10
    } = request.query;

    const filterString = await buildRobustFilterMatch({
      departments: departments as string,
      departmentsMode: departmentsMode as string,
      academicDisciplines: academicDisciplines as string,
      academicDisciplinesMode: academicDisciplinesMode as string,
      researchAreas: researchAreas as string,
      researchAreasMode: researchAreasMode as string
    });

    const limit = Number(pageSize);
    const offset = (Number(page) - 1) * limit;

    const sortConfig = [];
    if (sortBy) {
        const order = sortOrder === "1" ? "asc" : "desc";
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

    // Use hybrid search if we have a query
    if (query && (query as string).trim() !== '') {
        searchParams.hybrid = {
            semanticRatio: 0.8,
            embedder: 'default'
        };
    }

    const index = await getMeiliIndex('listings');
    const { hits, estimatedTotalHits } = await index.search(query as string || "", searchParams);

    // Map `id` back to `_id` for frontend backward compatibility
    const results = hits.map((hit: any) => ({ ...hit, _id: hit.id }));

    return response.json({ results, totalCount: estimatedTotalHits, page: Number(page), pageSize: Number(pageSize) });

  } catch (error) {
    console.error("Meilisearch search failed:", error);
    return response.status(500).json({ error: "Search failed" });
  }
};

export const createListingForCurrentUser = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string, userType: string, userConfirmed: boolean };
    
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
    const currentUser = request.user as { netId?: string, userType: string, userConfirmed: boolean };

    const listing = await getSkeletonListing(currentUser.netId!);
    response.status(201).json({ listing });
  } catch (error) {
    console.log((error as Error).message);
    response.status(400).json({ error: (error as Error).message });
  }
};

export const getListingById = async (request: Request, response: Response) => {
  try {
    const listing = await readListing(request.params.id);
    response.status(200).json({ listing });
  } catch (error) {
    throw error;
  }
};

export const updateListingForCurrentUser = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string, userType: string, userConfirmed: boolean };
    
    const listing = await updateListing(request.params.id, currentUser.netId!, request.body.data);
    response.status(200).json({ listing });
  } catch (error) {
    throw error;
  }
};

export const archiveListingForCurrentUser = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string, userType: string, userConfirmed: boolean };
    
    const listing = await archiveListing(request.params.id, currentUser.netId!);
    response.status(200).json({ listing });
  } catch (error) {
    throw error;
  }
};

export const unarchiveListingForCurrentUser = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string, userType: string, userConfirmed: boolean };
    
    const listing = await unarchiveListing(request.params.id, currentUser.netId!);
    response.status(200).json({ listing });
  } catch (error) {
    throw error;
  }
};

export const addViewToListing = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string, userType: string, userConfirmed: boolean };

    const listing = await addView(request.params.id, currentUser.netId!);
    response.status(200).json({ listing });
  } catch (error) {
    throw error;
  }
};

export const deleteListingForCurrentUser = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string, userType: string, userConfirmed: boolean };
    
    const currentListing = await readListing(request.params.id);
    if (currentUser.netId !== currentListing.ownerId) {
      const error: any = new Error(`User with id ${currentUser.netId} does not have permission to delete listing with id ${request.params.id}`);
      error.status = 403;
      throw error;
    }

    const deletedListing = await deleteListing(request.params.id);
    response.status(200).json({ deletedListing });
  } catch (error) {
    throw error;
  }
};