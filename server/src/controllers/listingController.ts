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
import { generateEmbedding } from '../services/embeddingService';
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

  // Base match - always required
  const baseMatch: any = {
    archived: false,
    confirmed: true
  };

  // Parse inputs
  const departmentList = departments ? departments.split('||').filter(d => d.trim()) : [];
  const disciplineList = academicDisciplines ? academicDisciplines.split('||').filter(d => d.trim()) : [];
  const researchAreaList = researchAreas ? researchAreas.split(',').filter(r => r.trim()) : [];

  // Check if any filters are active
  const hasFilters = departmentList.length > 0 || disciplineList.length > 0 || researchAreaList.length > 0;
  if (!hasFilters) {
    return baseMatch;
  }

  // Determine cross-filter mode: if ANY filter is AND, use AND between filters
  const useAndBetweenFilters =
    (departmentList.length > 0 && departmentsMode === 'intersection') ||
    (disciplineList.length > 0 && academicDisciplinesMode === 'intersection') ||
    (researchAreaList.length > 0 && researchAreasMode === 'intersection');

  // Build individual filter conditions
  const filterConditions: any[] = [];

  // 1. Department filter
  if (departmentList.length > 0) {
    if (departmentsMode === 'intersection') {
      // AND: listing must have ALL selected departments
      filterConditions.push({ departments: { $all: departmentList } });
    } else {
      // OR: listing must have at least one selected department
      filterConditions.push({ departments: { $in: departmentList } });
    }
  }

  // 2. Academic Disciplines filter (resolve to departments)
  if (disciplineList.length > 0) {
    // Get config to resolve disciplines to departments
    const config = await getConfig();
    const departmentsByDiscipline: { [key: string]: string[] } = {};

    // Build mapping of discipline -> department displayNames
    for (const discipline of disciplineList) {
      departmentsByDiscipline[discipline] = config.departments.list
        .filter(dept => dept.categories.includes(discipline) || dept.primaryCategory === discipline)
        .map(dept => dept.displayName);
    }

    if (academicDisciplinesMode === 'intersection') {
      // AND: listing must have at least one department from EACH selected discipline
      // This requires all discipline conditions to be true
      const disciplineConditions = disciplineList
        .map(discipline => {
          const depts = departmentsByDiscipline[discipline] || [];
          if (depts.length === 0) return null;
          return { departments: { $in: depts } };
        })
        .filter(Boolean);

      if (disciplineConditions.length > 0) {
        if (disciplineConditions.length === 1) {
          filterConditions.push(disciplineConditions[0]);
        } else {
          // Must match ALL disciplines (AND between disciplines)
          filterConditions.push({ $and: disciplineConditions });
        }
      }
    } else {
      // OR: listing must have at least one department from ANY selected discipline
      const allDisciplineDepts = [...new Set(
        disciplineList.flatMap(discipline => departmentsByDiscipline[discipline] || [])
      )];
      if (allDisciplineDepts.length > 0) {
        filterConditions.push({ departments: { $in: allDisciplineDepts } });
      }
    }
  }

  // 3. Research Areas filter (listing tags)
  if (researchAreaList.length > 0) {
    if (researchAreasMode === 'intersection') {
      // AND: listing must have ALL selected research areas
      filterConditions.push({ researchAreas: { $all: researchAreaList } });
    } else {
      // OR: listing must have at least one selected research area
      filterConditions.push({ researchAreas: { $in: researchAreaList } });
    }
  }

  // Combine filter conditions based on cross-filter mode
  if (filterConditions.length === 0) {
    return baseMatch;
  }

  if (filterConditions.length === 1) {
    return { ...baseMatch, ...filterConditions[0] };
  }

  if (useAndBetweenFilters) {
    // AND between all filter types
    return { ...baseMatch, $and: filterConditions };
  } else {
    // OR between all filter types
    return { ...baseMatch, $or: filterConditions };
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
      pageSize = 10
    } = request.query;

    // Build the filter match stage
    const matchStage = await buildRobustFilterMatch({
      departments: departments as string,
      departmentsMode: departmentsMode as string,
      academicDisciplines: academicDisciplines as string,
      academicDisciplinesMode: academicDisciplinesMode as string,
      researchAreas: researchAreas as string,
      researchAreasMode: researchAreasMode as string
    });

    if (!query || (query as string).trim() === '') {
      const pipeline: mongoose.PipelineStage[] = [];

      pipeline.push({ $match: matchStage });

      const order = (sortBy === "updatedAt" || sortBy === "createdAt")
        ? sortOrder === "1" ? -1 : 1
        : sortOrder === "1" ? 1 : -1;

      pipeline.push({
        $sort: sortBy
          ? { [sortBy as string]: order, _id: 1 }
          : { createdAt: -1, _id: 1 }
      });

      pipeline.push(
        { $skip: (Number(page) - 1) * Number(pageSize) },
        { $limit: Number(pageSize) }
      );

      const results = await getListingModel().aggregate(pipeline);
      return response.json({ results, page: Number(page), pageSize: Number(pageSize) });
    }

    const queryEmbedding = await generateEmbedding(query as string);
    const pipeline: mongoose.PipelineStage[] = [];

    pipeline.push({
      $vectorSearch: {
        index: 'vector_index',
        path: 'embedding',
        queryVector: queryEmbedding,
        numCandidates: 100,
        limit: 100
      }
    } as any);

    pipeline.push({
      $addFields: {
        searchScore: { $meta: 'vectorSearchScore' }
      }
    });

    pipeline.push({ $match: matchStage });

    const order = (sortBy === "updatedAt" || sortBy === "createdAt")
      ? sortOrder === "1" ? -1 : 1
      : sortOrder === "1" ? 1 : -1;

    pipeline.push({
      $sort: sortBy
        ? { [sortBy as string]: order, _id: 1 }
        : { searchScore: -1, createdAt: -1, _id: 1 }
    });

    pipeline.push(
      { $skip: (Number(page) - 1) * Number(pageSize) },
      { $limit: Number(pageSize) }
    );

    const results = await getListingModel().aggregate(pipeline);

    if (results.length === 0) {
      console.log('⚠️ Semantic search returned 0 results. Falling back to keyword search...');
      throw new Error('No semantic results - triggering fallback');
    }

    const resultsWithoutEmbedding = results.map(({ embedding, ...rest }) => rest);

    response.json({ results: resultsWithoutEmbedding, page: Number(page), pageSize: Number(pageSize) });

  } catch (error) {
    console.error("Semantic search failed, falling back to keyword search:", error);

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

      // Build the filter match stage
      const matchStage = await buildRobustFilterMatch({
        departments: departments as string,
        departmentsMode: departmentsMode as string,
        academicDisciplines: academicDisciplines as string,
        academicDisciplinesMode: academicDisciplinesMode as string,
        researchAreas: researchAreas as string,
        researchAreasMode: researchAreasMode as string
      });

      const pipeline: mongoose.PipelineStage[] = [];

      if (query) {
        pipeline.push({
          $search: {
            index: 'default',
            text: {
              query: query as string,
              path: {
                wildcard: '*'
              }
            },
          },
        });

        pipeline.push({
          $set: {
            searchScore: { $meta: 'searchScore' },
          },
        });
      }

      pipeline.push({ $match: matchStage });

      const order = (sortBy === "updatedAt" || sortBy === "createdAt")
        ? sortOrder === "1" ? -1 : 1
        : sortOrder === "1" ? 1 : -1;

      pipeline.push({
        $sort: sortBy
          ? { [sortBy as string]: order, _id: 1 }
          : { searchScore: -1, createdAt: -1, _id: 1 },
      });

      pipeline.push(
        { $skip: (Number(page) - 1) * Number(pageSize) },
        { $limit: Number(pageSize) }
      );

      const results = await getListingModel().aggregate(pipeline);

      console.log(`Fallback keyword search returned ${results.length} results`);
      response.json({ results, page: Number(page), pageSize: Number(pageSize) });

    } catch (fallbackError) {
      console.error("Keyword search fallback also failed:", fallbackError);
      response.status(500).json({ error: "Search failed" });
    }
  }
};

export const createListingForCurrentUser = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string, userType: string, userConfirmed: boolean };
    
    const user = await readUser(currentUser.netId);
    const listing = await createListing(request.body.data, user);
    response.status(201).json({ listing });
  } catch (error) {
    console.log(error.message);
    response.status(400).json({ error: error.message });
  }
};

export const getSkeletonListingForCurrentUser = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string, userType: string, userConfirmed: boolean };
    
    const listing = await getSkeletonListing(currentUser.netId);
    response.status(201).json({ listing });
  } catch (error) {
    console.log(error.message);
    response.status(400).json({ error: error.message });
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
    
    const listing = await updateListing(request.params.id, currentUser.netId, request.body.data);
    response.status(200).json({ listing });
  } catch (error) {
    throw error;
  }
};

export const archiveListingForCurrentUser = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string, userType: string, userConfirmed: boolean };
    
    const listing = await archiveListing(request.params.id, currentUser.netId);
    response.status(200).json({ listing });
  } catch (error) {
    throw error;
  }
};

export const unarchiveListingForCurrentUser = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string, userType: string, userConfirmed: boolean };
    
    const listing = await unarchiveListing(request.params.id, currentUser.netId);
    response.status(200).json({ listing });
  } catch (error) {
    throw error;
  }
};

export const addViewToListing = async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId?: string, userType: string, userConfirmed: boolean };

    const listing = await addView(request.params.id, currentUser.netId);
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