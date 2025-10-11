import { archiveListing, createListing, deleteListing, readAllListings, readListing, unarchiveListing, updateListing, getSkeletonListing, addView } from '../services/newListingsService';
import { Request, Response, Router } from "express";
import { IncorrectPermissionsError, NotFoundError, ObjectIdError } from "../utils/errors";
import { readUser } from '../services/userService';
import { NewListing } from '../models';
import mongoose from 'mongoose';
import { isAuthenticated, isTrustworthy } from '../utils/permissions';
import { logEvent } from '../services/analyticsService';
import { AnalyticsEventType } from '../models';

const router = Router();

router.get('/search', isAuthenticated, async (request: Request, response: Response) => {
    try {
      const { query, sortBy, sortOrder, departments, page = 1, pageSize = 10 } = request.query;

      const order = (sortBy === "updatedAt" || sortBy === "createdAt") ? sortOrder === "1" ? -1: 1 : sortOrder === "1" ? 1: -1;

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
      })
  
      pipeline.push({
          $sort: sortBy ? { [sortBy as string]: order, _id: 1 } : { searchScore: -1, updatedAt: -1, _id: 1 },
      });
  
      pipeline.push(
          { $skip: (Number(page) - 1) * Number(pageSize) },
          { $limit: Number(pageSize) }
      );
  
      const results = await NewListing.aggregate(pipeline);

      // Log search event
      const currentUser = request.user as { netId?: string, userType: string };
      if (currentUser?.netId) {
        logEvent({
          eventType: AnalyticsEventType.SEARCH,
          netid: currentUser.netId,
          userType: currentUser.userType,
          searchQuery: query as string || '',
          searchDepartments: departments ? (departments as string).split(',') : []
        });
      }

      response.json({ results, page: Number(page), pageSize: Number(pageSize) });
    } catch (error) {
      console.error("Error executing search:", error);
      response.status(500).json({ error: "Internal server error" });
    }
  });

//Add listing
router.post("/", isAuthenticated, async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId? : string, userType: string, userConfirmed: boolean};
    if (!currentUser) {
        throw new Error('User not logged in');
    }
    if (!(currentUser.userType === 'admin' || currentUser.userType === 'professor' || currentUser.userType === 'faculty')) {
        throw new Error('User does not have permission to create listings');
    }

    const user = await readUser(currentUser.netId);
    const listing = await createListing(request.body.data, user);

    // Log listing creation
    logEvent({
      eventType: AnalyticsEventType.LISTING_CREATE,
      netid: currentUser.netId,
      userType: currentUser.userType,
      listingId: listing._id.toString()
    });

    response.status(201).json({ listing });
  } catch (error) {
    console.log(error.message);
    response.status(400).json({ error: error.message });
  }
});

//Get a skeleton listing for the current user
router.get('/skeleton', isAuthenticated, async (request: Request, response: Response) => {
    try {
        const currentUser = request.user as { netId? : string, userType: string, userConfirmed: boolean};
        if (!currentUser) {
            throw new Error('User not logged in');
        }
        const listing = await getSkeletonListing(currentUser.netId);
        response.status(201).json({ listing });
    } catch (error) {
        console.log(error.message);
        response.status(400).json({ error: error.message})
    }
});

//Read specific listing by ObjectId
router.get('/:id', isAuthenticated, async (request: Request, response: Response) => {
    try {
        const listing = await readListing(request.params.id);
        response.status(200).json({ listing });
    } catch (error) {
        console.log(error.message);
        if (error instanceof NotFoundError || error instanceof ObjectIdError) {
            response.status(error.status).json({ error: error.message });
        } else {
            response.status(500).json({ error: error.message });
        }
    }
});

//Update listing by ObjectId (current user)
router.put('/:id', isAuthenticated, async (request: Request, response: Response) => {
    try {
        const currentUser = request.user as { netId? : string, userType: string, userConfirmed: boolean};
        if (!currentUser) {
            throw new Error('User not logged in');
        }
        const listing = await updateListing(request.params.id, currentUser.netId, request.body.data);

        // Log listing update
        logEvent({
          eventType: AnalyticsEventType.LISTING_UPDATE,
          netid: currentUser.netId,
          userType: currentUser.userType,
          listingId: request.params.id
        });

        response.status(200).json({ listing });
    } catch (error) {
        console.log(error.message);
        if (error instanceof NotFoundError || error instanceof ObjectIdError) {
            response.status(error.status).json({ error: error.message });
        } else if (error instanceof IncorrectPermissionsError) {
            response.status(error.status).json({ error: error.message, incorrectPermissions: true });
        } else {
            response.status(500).json({ error: error.message });
        }
    }
});

//Archive listing by ObjectId (current user)
router.put('/:id/archive', isAuthenticated, async (request: Request, response: Response) => {
    try {
        const currentUser = request.user as { netId? : string, userType: string, userConfirmed: boolean};
        if (!currentUser) {
            throw new Error('User not logged in');
        }
        const listing = await archiveListing(request.params.id, currentUser.netId);

        // Log listing archive
        logEvent({
          eventType: AnalyticsEventType.LISTING_ARCHIVE,
          netid: currentUser.netId,
          userType: currentUser.userType,
          listingId: request.params.id
        });

        response.status(200).json({ listing });
    } catch (error) {
        console.log(error.message);
        if (error instanceof NotFoundError || error instanceof ObjectIdError) {
            response.status(error.status).json({ error: error.message });
        } else if (error instanceof IncorrectPermissionsError) {
            response.status(error.status).json({ error: error.message, incorrectPermissions: true });
        } else {
            response.status(500).json({ error: error.message });
        }
    }
});

//Unarchive listing by ObjectId (current user)
router.put('/:id/unarchive', isAuthenticated, async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId? : string, userType: string, userConfirmed: boolean};
    if (!currentUser) {
        throw new Error('User not logged in');
    }
    const listing = await unarchiveListing(request.params.id, currentUser.netId);

    // Log listing unarchive
    logEvent({
      eventType: AnalyticsEventType.LISTING_UNARCHIVE,
      netid: currentUser.netId,
      userType: currentUser.userType,
      listingId: request.params.id
    });

    response.status(200).json({ listing });
  } catch (error) {
    console.log(error.message);
    if (error instanceof NotFoundError || error instanceof ObjectIdError) {
        response.status(error.status).json({ error: error.message });
    } else if (error instanceof IncorrectPermissionsError) {
        response.status(error.status).json({ error: error.message, incorrectPermissions: true });
    } else {
        response.status(500).json({ error: error.message });
    }
  }
});

//Add view by ObjectId (current user)
router.put('/:id/addView', isAuthenticated, async (request: Request, response: Response) => {
    try {
        const currentUser = request.user as { netId? : string, userType: string, userConfirmed: boolean};
        if (!currentUser) {
            throw new Error('User not logged in');
        }

        const listing = await addView(request.params.id, currentUser.netId);

        // Log listing view event
        logEvent({
          eventType: AnalyticsEventType.LISTING_VIEW,
          netid: currentUser.netId,
          userType: currentUser.userType,
          listingId: request.params.id
        });

        response.status(200).json({ listing });
    } catch (error) {
        console.log(error.message);
        if (error instanceof NotFoundError || error instanceof ObjectIdError) {
            response.status(error.status).json({ error: error.message });
        } else if (error instanceof IncorrectPermissionsError) {
            response.status(error.status).json({ error: error.message, incorrectPermissions: true });
        } else {
            response.status(500).json({ error: error.message });
        }
    }
});

//Delete listing by ObjectId (current user)
router.delete('/:id', isAuthenticated, async (request: Request, response: Response) => {
    try {
        const currentUser = request.user as { netId? : string, userType: string, userConfirmed: boolean};
        if (!currentUser) {
            throw new Error('User not logged in');
        }
        const listing = await deleteListing(request.params.id);
        response.status(200).json({ listing });
    } catch (error) {
        console.log(error.message);
        if (error instanceof NotFoundError || error instanceof ObjectIdError) {
            response.status(error.status).json({ error: error.message });
        } else if (error instanceof IncorrectPermissionsError) {
            response.status(error.status).json({ error: error.message, incorrectPermissions: true });
        } else {
            response.status(500).json({ error: error.message });
        }
    }
});

export default router;