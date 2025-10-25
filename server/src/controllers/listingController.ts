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
import { Listing } from "../models";

export const searchListings = async (request: Request, response: Response) => {
  try {
    const { query, sortBy, sortOrder, departments, page = 1, pageSize = 10 } = request.query;

    const order = (sortBy === "updatedAt" || sortBy === "createdAt") 
      ? sortOrder === "1" ? -1 : 1 
      : sortOrder === "1" ? 1 : -1;

    const pipeline: mongoose.PipelineStage[] = [];

    if (query) {
      pipeline.push({
        $search: {
          index: 'default',
          text: {
            query: query as string,
            path: {
              wildcard: '*'
            },
          },
        },
      });

      pipeline.push({
        $set: {
          searchScore: { $meta: 'searchScore' },
        },
      });
    }

    if (departments) {
      const departmentList = (departments as string).split(',');
      
      pipeline.push({
        $match: {
          departments: { $in: departmentList },
        },
      });
    }

    // Filter out archived and unconfirmed listings
    pipeline.push({
      $match: {
        archived: false,
        confirmed: true
      },
    });

    pipeline.push({
      $sort: sortBy 
        ? { [sortBy as string]: order, _id: 1 } 
        : { searchScore: -1, updatedAt: -1, _id: 1 },
    });

    pipeline.push(
      { $skip: (Number(page) - 1) * Number(pageSize) },
      { $limit: Number(pageSize) }
    );

    const results = await Listing.aggregate(pipeline);

    response.json({ results, page: Number(page), pageSize: Number(pageSize) });
  } catch (error) {
    console.error("Error executing search:", error);
    response.status(500).json({ error: "Internal server error" });
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