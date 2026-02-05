import { Request, Response } from "express";
import {
  readFellowship,
  searchFellowships,
  getFilterOptions,
  addView,
  addFavorite,
  removeFavorite,
} from '../services/fellowshipService';

// Search fellowships with filters
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

    // Parse array filters (comma-separated or pipe-separated)
    const parseFilter = (filter: string | undefined): string[] => {
      if (!filter) return [];
      // Support both comma and pipe separators
      return filter.split(/[,|]/).map(s => s.trim()).filter(Boolean);
    };

    const result = await searchFellowships({
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
    });

    response.json({
      results: result.fellowships,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      totalPages: result.totalPages,
    });
  } catch (error) {
    console.error("Fellowship search failed:", error);
    response.status(500).json({ error: "Search failed" });
  }
};

// Get a single fellowship by ID
export const getFellowshipById = async (request: Request, response: Response) => {
  try {
    const fellowship = await readFellowship(request.params.id);
    response.status(200).json({ fellowship });
  } catch (error: any) {
    if (error.name === 'NotFoundError') {
      response.status(404).json({ error: error.message });
    } else {
      response.status(500).json({ error: error.message });
    }
  }
};

// Get filter options for dropdowns
export const getFellowshipFilterOptions = async (request: Request, response: Response) => {
  try {
    const options = await getFilterOptions();
    response.status(200).json(options);
  } catch (error: any) {
    response.status(500).json({ error: error.message });
  }
};

// Add a view to a fellowship
export const addViewToFellowship = async (request: Request, response: Response) => {
  try {
    const fellowship = await addView(request.params.id);
    response.status(200).json({ fellowship });
  } catch (error: any) {
    if (error.name === 'NotFoundError') {
      response.status(404).json({ error: error.message });
    } else {
      response.status(500).json({ error: error.message });
    }
  }
};

// Add a favorite to a fellowship
export const addFavoriteToFellowship = async (request: Request, response: Response) => {
  try {
    const fellowship = await addFavorite(request.params.id);
    response.status(200).json({ fellowship });
  } catch (error: any) {
    if (error.name === 'NotFoundError') {
      response.status(404).json({ error: error.message });
    } else {
      response.status(500).json({ error: error.message });
    }
  }
};

// Remove a favorite from a fellowship
export const removeFavoriteFromFellowship = async (request: Request, response: Response) => {
  try {
    const fellowship = await removeFavorite(request.params.id);
    response.status(200).json({ fellowship });
  } catch (error: any) {
    if (error.name === 'NotFoundError') {
      response.status(404).json({ error: error.message });
    } else {
      response.status(500).json({ error: error.message });
    }
  }
};
