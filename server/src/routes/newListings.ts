import { archiveListing, createListing, deleteListing, readAllListings, readListing, unarchiveListing, updateListing } from '../services/newListingsService';
import { Request, Response, Router } from "express";
import { IncorrectPermissionsError, NotFoundError, ObjectIdError } from "../utils/errors";
import { readUser } from '../services/userService';
import { isAuthenticated, isTrustworthy } from '../utils/permissions';

const router = Router();

//Add listing
router.post("/", async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId? : string, professor? : boolean};
    if (!currentUser) {
        throw new Error('User not logged in');
    }
    const user = await readUser(currentUser.netId);
    const listing = await createListing(request.body.data, user);
    response.status(201).json({ listing });
  } catch (error) {
    console.log(error.message);
    response.status(400).json({ error: error.message });
  }
});

//Add listing for user with specified netid
router.post("/:id", async (request: Request, response: Response) => {
    try {
      const user = await readUser(request.params.id);
      const listing = await createListing(request.body, user);
      response.status(201).json({ listing });
    } catch (error) {
      console.log(error.message);
      response.status(400).json({ error: error.message });
    }
  });

//Read all listings
router.get("/", async (request: Request, response: Response) => {
    try {
        const listings = await readAllListings();
        response.status(200).json({ listings });
    } catch (error) {
        console.log(error.message);
        response.status(500).json({ error: error.message });
    }
});

//Read specific listing by ObjectId
router.get('/:id', async (request: Request, response: Response) => {
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

//Updates for current user

//Update listing by ObjectId (current user)
router.put('/:id', async (request: Request, response: Response) => {
    try {
        const currentUser = request.user as { netId? : string, professor? : boolean};
        if (!currentUser) {
            throw new Error('User not logged in');
        }
        const listing = await updateListing(request.params.id, currentUser.netId, request.body.data);
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
router.put('/:id/archive', async (request: Request, response: Response) => {
    try {
        const currentUser = request.user as { netId? : string, professor? : boolean};
        if (!currentUser) {
            throw new Error('User not logged in');
        }
        const listing = await archiveListing(request.params.id, currentUser.netId);
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
router.put('/:id/unarchive', async (request: Request, response: Response) => {
  try {
    const currentUser = request.user as { netId? : string, professor? : boolean};
        if (!currentUser) {
            throw new Error('User not logged in');
        }
      const listing = await unarchiveListing(request.params.id, currentUser.netId);
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

//Updates for specific user

//Update listing by ObjectId (specific user)
router.put('/asUser/:netid/:id', async (request: Request, response: Response) => {
    try {
        const listing = await updateListing(request.params.id, request.params.netid, request.body);
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

//Archive listing by ObjectId
router.put('/asUser/:netid/:id/archive', async (request: Request, response: Response) => {
    try {
        const listing = await archiveListing(request.params.id, request.params.netid);
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

//Unarchive listing by ObjectId
router.put('/asUser/:netid/:id/unarchive', async (request: Request, response: Response) => {
  try {
      const listing = await unarchiveListing(request.params.id, request.params.netid);
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

//Delete listing by ObjectId
router.delete('/:id', async (request: Request, response: Response) => {
    try {
        const listing = await deleteListing(request.params.id);
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

//Get listings by netid
//Get listings by search

/* Route for getting relevant listings based on the queries fname, lname, and dept (all optional, at least one of the 3 must be provided)
fname: fname must be a substring of prof's first name for the corresponding listing to be included
lname: lname must be a substring of prof's last name for the corresponding listing to be included
dept: dept must contain a department mentioned in the listing for the corresponding listing to be included
*/

//Need to update this route later for proper search behavior

/*router.get('/', async (request: Request, response: Response) => {
  try {
    const fname = request.query.fname === undefined ? '' : request.query.fname;
    const lname = request.query.lname === undefined ? '' : request.query.lname;
    const keywords = request.query.keywords === undefined ? '' :  (request.query.keywords as String).replace(',', ' ').replace('  ', ' ');
    const dept = request.query.dept === undefined || request.query.dept === '' ? [] : (request.query.dept as String).split(',');

    if(fname === '' && lname === '' && dept.length == 0 && keywords.length == 0){
      throw new Error('At least 1 query must be provided');
    } 

    let query = { "fname": { "$regex": fname, "$options": "i" }, 
                  "lname": { "$regex": lname, "$options": "i" },
                  "departments": { "$elemMatch": { "$in": dept } },
                  "$text": { "$search": keywords, "$caseSensitive": false }};

    if(dept.length === 0){
      delete query["departments"];
    }
    if(keywords == ''){
      delete query["$text"];
    }
    
    const listings = await Listing.find(query);
    return response.status(200).json(listings);

  } catch (error) {
    console.log(error.message);
    response.status(500).send({ message: error.message });
  }
});
*/

export default router;