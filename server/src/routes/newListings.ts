import { archiveListing, createListing, deleteListing, readAllListings, readListing, unarchiveListing, updateListing } from '../services/newListingsService';
import { Request, Response, Router } from "express";
import { NotFoundError, ObjectIdError } from "../utils/errors";
import { isAuthenticated, isProfessor } from '../utils/permissions';

const router = Router();

//Add listing
router.post("/", isAuthenticated, isProfessor, async (request: Request, response: Response) => {
  try {
    const listing = await createListing(request.body);
    response.status(201).json({ listing });
  } catch (error) {
    console.log(error.message);
    response.status(400).json({ error: error.message });
  }
});

//Read all listings
router.get("/", isAuthenticated, async (request: Request, response: Response) => {
    try {
        const listings = await readAllListings();
        response.status(200).json({ listings });
    } catch (error) {
        console.log(error.message);
        response.status(500).json({ error: error.message });
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

//Update listing by ObjectId
router.put('/:id', isAuthenticated, isProfessor, async (request: Request, response: Response) => {
    try {
        const listing = await updateListing(request.params.id, request.body);
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

//Archive listing by ObjectId
router.put('/:id/archive', isAuthenticated, isProfessor, async (request: Request, response: Response) => {
    try {
        const listing = await archiveListing(request.params.id);
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

//Unarchive listing by ObjectId
router.put('/:id/unarchive', isAuthenticated, isProfessor, async (request: Request, response: Response) => {
  try {
      const listing = await unarchiveListing(request.params.id);
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

//Delete listing by ObjectId
router.delete('/:id', isAuthenticated, isProfessor, async (request: Request, response: Response) => {
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