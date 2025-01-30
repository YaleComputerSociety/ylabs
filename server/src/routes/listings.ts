import express from 'express';
import { Listing } from '../models';
import { Request, Response, Router } from "express";

const router = Router();

const handleError = (response: Response, error: any) => {
  console.error(error.message);
  response.status(500).json({ message: error.message });
};

// Route for getting listing by id: for testing
router.get('/byId/:id', async (request: Request, response: Response) => {
  try {
    const { id } = request.params;

    const listing = await Listing.findById(id);

    return response.status(200).json(listing);
  } catch (error) {
    handleError(response, error);
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
    handleError(response, error);
  }
});

router.post('/add', async (request: Request, response: Response) => {
  try {
    const listingData = request.body; // Get the data from the request body
    if (!listingData) {
      throw new Error('At least one of the data should be provided');
    }
    const newListing = new Listing(listingData); // Create a new Listing instance
    const savedListing = await newListing.save(); // Save the listing to the database
    return response.status(200).json(savedListing); // Return the saved listing
  } catch (error) {
    handleError(response, error);
  }
});

router.put('/update/:id', async (request: Request, response: Response) => {
  try {
    const { id } = request.params; // Get the ID from the request parameters
    const updatedData = request.body; // Get the updated data from the request body

    const updatedListing = await Listing.findByIdAndUpdate(id, updatedData, { new: true });
    //Model.findByIdAndUpdate(id, update, options, callback);
    if (!updatedListing) {
      return response.status(404).send({ message: 'Listing not found' });
    }

    return response.status(200).json(updatedListing); // Return the updated listing
  } catch (error) {
    handleError(response, error);
  }
});

router.delete('/delete/:id', async (request: Request, response: Response) => {
  try {
    const { id } = request.params;
    const deletedListing = await Listing.findByIdAndDelete(id);
    //Model.findByIdAndUpdate(id, update, options, callback);
    if (!deletedListing) {
      return response.status(404).send({ message: 'Listing not found' });
    }

    return response.status(200).json({ message: 'Listing deleted successfully' });
  } catch (error) {
    handleError(response, error); 
  }
});

// add update delete three func CRUD
// use postman w arbitrary query to test backend API
export default router;