import express from 'express';
import { Listing } from '../models';
import { Request, Response, Router } from "express";

const router = Router();

//Create new listing

//Hidden for security reasons

/*router.post("/", async (request: Request, response: Response) => {
    try {
        const listing = new Listing(request.body);
        await listing.save();
        response.status(201).json({ listing: listing.toObject(), success: true });
    } catch (error) {
        console.log(error.message);
        response.status(400).json({ error: error.message, success: false });
    }
});*/

// Route for getting listing by id: for testing
router.get('/byId/:id', async (request: Request, response: Response) => {
  try {
    const { id } = request.params;

    const listing = await Listing.findById(id);

    return response.status(200).json(listing);
  } catch (error) {
    console.log(error.message);
    response.status(500).send({ message: error.message });
  }
});

/* Route for getting relevant listings based on the queries fname, lname, and dept (all optional, at least one of the 3 must be provided)
fname: fname must be a substring of prof's first name for the corresponding listing to be included
lname: lname must be a substring of prof's last name for the corresponding listing to be included
dept: dept must contain a department mentioned in the listing for the corresponding listing to be included
*/
router.get('/', async (request: Request, response: Response) => {
  try {
    const fname = request.query.fname === undefined ? '' : request.query.fname;
    const lname = request.query.lname === undefined ? '' : request.query.lname;
    const keywords = request.query.keywords === undefined || request.query.keywords === '' ? [] :  (request.query.keywords as String).split(',');
    const dept = request.query.dept === undefined || request.query.dept === '' ? [] : (request.query.dept as String).split(',');

    /*if(fname === '' && lname === '' && dept.length == 0 && keywords.length == 0){
      throw new Error('At least 1 query must be provided');
    }*/

    let conditions = [];

    if (keywords.length > 0) {
      const textCondition = { "$text" : { "$search": keywords.join(" "), "$caseSensitive": false } };
      
      conditions.push(textCondition);
    }

    if (dept.length > 0) {
      conditions.push({ "departments": { "$elemMatch": { "$in": dept } } });
    }

    if(typeof fname === "string" && fname.trim()) {
      conditions.push({"fname": { "$regex": fname.trim(), "$options": "i" }})
    }

    if(typeof lname === "string" && lname.trim()) {
      conditions.push({"lname": { "$regex": lname.trim(), "$options": "i" }})
    }

    const query = conditions.length ? { $and: conditions } : {};
    
    const listings = await Listing.find(query);
    return response.status(200).json(listings);

  } catch (error) {
    console.log(error.message);
    response.status(500).send({ message: error.message });
  }
});

router.get('/all', async (request: Request, response: Response) => {
  try {
    const listings = await Listing.find();
    return response.status(200).json(listings);
  } catch (error) {
    console.log(error.message);
    response.status(500).send({ message: error.message });
  }
});

export default router;