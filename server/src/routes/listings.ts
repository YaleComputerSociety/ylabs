import express from 'express';
import { Listing } from '../models';
import { Request, Response, Router } from "express";

const router = Router();

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
    const dept = request.query.dept === undefined ? [] : request.query.dept;
    console.log(dept) 

    if(fname === '' && lname === '' && dept.length == 0){
      throw new Error('At least 1 query must be provided');
    } 

    const listing = await Listing.find(
      { "fname": { "$regex": fname, "$options": "i" }, 
        "lname": { "$regex": lname, "$options": "i" },
        "departments": { $elemMatch: { $in: dept } }}
    );
    console.log(fname)

    return response.status(200).json(listing);
  } catch (error) {
    console.log(error.message);
    response.status(500).send({ message: error.message });
  }
});

export default router;